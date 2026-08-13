/**
 * Orchestrates a real launch: resolve version metadata, ensure client jar + libraries +
 * assets are present (downloading/verifying via noxara-core), pick a Java runtime, then
 * hand off to noxara-core's launch.start which spawns the JVM and streams output.
 *
 * Every phase reports real progress through the global activity system (the launch
 * itself, the file downloads, and any loader install that runs on first launch).
 */
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { coreBridge } from "./core-bridge";
import { getDb } from "./database";
import { getActiveAccount, resolveMinecraftSession } from "./accounts";
import { carrySkinIntoInstance } from "./skins";
import { getSettings } from "./settings";
import { detectJava, ensureJavaRuntime } from "./java";
import { ensureVersionAssetsAndLibraries } from "./game-files";
import { getFabricVersionDetail } from "./fabric";
import { getQuiltVersionDetail } from "./quilt";
import { installForge } from "./forge";
import { installNeoForge } from "./neoforge";
import { startActivity, progressActivity, succeedActivity, failActivity } from "./activity";

/** Maps an instance id to the activity that represents its launch, so game.started
 * can flip it to Completed exactly when the JVM actually comes up. */
const launchActivityByInstance = new Map<string, string>();

coreBridge.on("game.started", (p: { instanceId: string }) => {
  const activityId = launchActivityByInstance.get(p.instanceId);
  if (activityId) {
    succeedActivity(activityId, { description: "Game started" });
    launchActivityByInstance.delete(p.instanceId);
  }
});

async function resolveJavaPath(
  instanceJavaPath: string | null,
  recommendedMajor: number,
  activityId: string,
  javaComponent: string | null
): Promise<string> {
  if (instanceJavaPath && fs.existsSync(instanceJavaPath)) return instanceJavaPath;

  const settings = getSettings();
  if (!settings.autoDetectJava && settings.defaultJavaPath && fs.existsSync(settings.defaultJavaPath)) {
    return settings.defaultJavaPath;
  }

  const installs = await detectJava();
  const exact = installs.find((j) => j.majorVersion === recommendedMajor);
  if (exact) return exact.path;

  const newest = installs.filter((j) => j.majorVersion >= recommendedMajor).sort((a, b) => a.majorVersion - b.majorVersion)[0];
  if (newest) return newest.path;

  // No compatible Java installed anywhere — automatically install Mojang's official
  // bundled runtime (same one the vanilla launcher ships) so the user can launch
  // without installing anything. Progress streams under the launch activity.
  progressActivity(activityId, {}, "downloading", { description: `Downloading Java ${recommendedMajor} runtime` });
  try {
    const managedPath = await ensureJavaRuntime(javaComponent ?? "", recommendedMajor, activityId);
    if (managedPath && fs.existsSync(managedPath)) {
      return managedPath;
    }
  } catch (err) {
    throw new Error(
      `No compatible Java was found and the automatic Java ${recommendedMajor} download failed: ` +
        `${err instanceof Error ? err.message : "unknown error"}`
    );
  }

  throw new Error(
    `No installed Java runtime satisfies Minecraft's requirement (Java ${recommendedMajor}+). ` +
      `Open Java Manager to install one.`
  );
}

async function resolveAccountForLaunch() {
  const account = getActiveAccount();
  if (!account) throw new Error("No active account. Add a Microsoft account or offline profile first.");
  return resolveMinecraftSession(account.id);
}

export async function launchInstance(instanceId: string, extraGameArgs?: string[]): Promise<{ started: boolean }> {
  const db = getDb();
  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(instanceId) as
    | {
        id: string;
        name: string;
        minecraft_version: string;
        loader: "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";
        loader_version: string | null;
        instance_dir: string;
        java_path: string | null;
        min_ram_mb: number;
        max_ram_mb: number;
        jvm_args: string;
        game_args: string;
      }
    | undefined;
  if (!instance) throw new Error(`instance ${instanceId} not found`);

  // The launch activity doubles as the taskId for the file downloads, so the batch
  // progress events update this same record.
  const activityId = randomUUID();
  startActivity(activityId, {
    type: "instance",
    title: instance.name,
    instanceId: instance.id,
    description: "Preparing to launch",
    status: "preparing",
  });
  launchActivityByInstance.set(instanceId, activityId);

  try {
    const manifest = await coreBridge.call<{ versions: { id: string }[] }>("mojang.getVersionManifest", {
      forceRefresh: false,
    });
    if (!manifest.versions.some((v) => v.id === instance.minecraft_version)) {
      throw new Error(`Unknown Minecraft version: ${instance.minecraft_version}`);
    }

    const { detail: vanillaDetail, recommendedJavaMajor } = await coreBridge.call<{
      detail: any;
      recommendedJavaMajor: number;
    }>("mojang.getVersionDetail", { versionId: instance.minecraft_version });

    let versionDetail: any = vanillaDetail;
    // The exact runtime component Mojang's version JSON requests (e.g. "java-runtime-21").
    // Loader-merged details inherit javaVersion from the vanilla base, so reading it
    // from the vanilla detail is authoritative for every loader path.
    const javaComponent =
      (vanillaDetail?.javaVersion as { component?: string } | undefined)?.component ?? null;

    if (instance.loader === "fabric") {
      if (!instance.loader_version) {
        throw new Error("This instance has no Fabric Loader version recorded — try recreating it.");
      }
      progressActivity(activityId, {}, "preparing", { description: `Resolving Fabric ${instance.loader_version}` });
      ({ detail: versionDetail } = await getFabricVersionDetail(instance.minecraft_version, instance.loader_version));
    } else if (instance.loader === "quilt") {
      if (!instance.loader_version) {
        throw new Error("This instance has no Quilt Loader version recorded — try recreating it.");
      }
      progressActivity(activityId, {}, "preparing", { description: `Resolving Quilt ${instance.loader_version}` });
      ({ detail: versionDetail } = await getQuiltVersionDetail(instance.minecraft_version, instance.loader_version));
    } else if (instance.loader === "forge" || instance.loader === "neoforge") {
      if (!instance.loader_version) {
        throw new Error(
          `This instance has no ${instance.loader === "forge" ? "Forge" : "NeoForge"} version recorded — try recreating it.`
        );
      }
      // Forge/NeoForge's own installer tools need a real vanilla client jar to patch
      // against (the MINECRAFT_JAR token) and a working JVM to run in — resolve both
      // before running the installer pipeline. NeoForge's installer is Forge-derived
      // and shares the same processor/install_profile format.
      const nativesDir = path.join(instance.instance_dir, "natives");
      progressActivity(activityId, {}, "downloading", { description: "Downloading Minecraft files" });
      const { clientJarPath: vanillaClientJarPath } = await ensureVersionAssetsAndLibraries(
        vanillaDetail,
        nativesDir,
        activityId
      );
      const javaPathForInstall = await resolveJavaPath(instance.java_path, recommendedJavaMajor, activityId, javaComponent);

      const loaderName = instance.loader === "forge" ? "Forge" : "NeoForge";
      const loaderActivityId = randomUUID();
      startActivity(loaderActivityId, {
        type: "loader",
        title: loaderName,
        instanceId: instance.id,
        description: `Installing ${loaderName} ${instance.loader_version}`,
        status: "installing",
      });
      try {
        const { detail } =
          instance.loader === "forge"
            ? await installForge(
                loaderActivityId,
                instance.minecraft_version,
                instance.loader_version,
                javaPathForInstall,
                vanillaClientJarPath,
                vanillaDetail
              )
            : await installNeoForge(
                loaderActivityId,
                instance.minecraft_version,
                instance.loader_version,
                javaPathForInstall,
                vanillaClientJarPath,
                vanillaDetail
              );
        succeedActivity(loaderActivityId, { description: `${loaderName} installed` });
        versionDetail = detail;
      } catch (err) {
        failActivity(loaderActivityId, err instanceof Error ? err.message : `${loaderName} install failed`);
        throw err;
      }
    }

    progressActivity(activityId, {}, "downloading", { description: "Downloading Minecraft files" });
    const { clientJarPath, librariesDirPath, assetsDirPath } = await ensureVersionAssetsAndLibraries(
      versionDetail,
      path.join(instance.instance_dir, "natives"),
      activityId
    );
    progressActivity(activityId, {}, "verifying", { description: "Preparing launch" });

    const javaPath = await resolveJavaPath(instance.java_path, recommendedJavaMajor, activityId, javaComponent);
    const account = await resolveAccountForLaunch();

    db.prepare("UPDATE instances SET last_played_at = ? WHERE id = ?").run(new Date().toISOString(), instanceId);

    // Offline accounts with a selected skin carry that PNG into the game directory on
    // every launch so the skin actually accompanies the profile the game uses — the
    // file is verified byte-for-byte after the copy and persists in the instance until
    // the next launch overwrites it. Best-effort: a skin problem must never block the
    // game from starting, so a failure here is logged, not thrown.
    const activeAccount = getActiveAccount();
    if (activeAccount?.kind === "offline") {
      const carried = carrySkinIntoInstance(activeAccount.id, instance.instance_dir);
      if (carried.ok) {
        console.log(`[launch] carried offline skin into ${carried.pngPath}`);
      } else if (carried.reason) {
        console.log(`[launch] offline skin not carried: ${carried.reason}`);
      }
    }

    const settings = getSettings();
    const result = await coreBridge.call<{ started: boolean }>("launch.start", {
      instance: {
        instance_id: instance.id,
        instance_dir: instance.instance_dir,
        natives_dir: path.join(instance.instance_dir, "natives"),
        libraries_dir: librariesDirPath,
        assets_dir: assetsDirPath,
        client_jar: clientJarPath,
        java_path: javaPath,
        min_ram_mb: instance.min_ram_mb,
        max_ram_mb: instance.max_ram_mb,
        extra_jvm_args: instance.jvm_args ? instance.jvm_args.split(/\s+/).filter(Boolean) : [],
        extra_game_args: [
          ...(instance.game_args ? instance.game_args.split(/\s+/).filter(Boolean) : []),
          ...(extraGameArgs ?? []),
        ],
        width: settings.launchWidth,
        height: settings.launchHeight,
      },
      account: {
        username: account.username,
        uuid: account.uuid,
        access_token: account.accessToken,
        user_type: account.userType,
      },
      versionDetail,
    });
    progressActivity(activityId, {}, "launching", { description: "Launching Minecraft" });
    return result;
  } catch (err) {
    failActivity(activityId, err instanceof Error ? err.message : "Launch failed");
    launchActivityByInstance.delete(instanceId);
    throw err;
  }
}

/** The set of instance ids whose Minecraft process is still alive on the Rust side. */
export async function listRunningInstances(): Promise<string[]> {
  const result = await coreBridge.call<{ running: string[] }>("launch.running");
  return result.running ?? [];
}

/** Terminates the tracked Minecraft process for an instance, if one is running. */
export async function killInstance(instanceId: string): Promise<void> {
  await coreBridge.call("launch.stop", { instanceId });
}
