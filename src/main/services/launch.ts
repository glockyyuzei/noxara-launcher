/**
 * Orchestrates a real launch: resolve version metadata, ensure client jar + libraries +
 * assets are present (downloading/verifying via noxara-core), pick a Java runtime, then
 * hand off to noxara-core's launch.start which spawns the JVM and streams output.
 */
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { coreBridge } from "./core-bridge";
import { getDb } from "./database";
import { getActiveAccount, getMicrosoftRefreshToken } from "./accounts";
import { detectJava } from "./java";
import { librariesDir, assetsDir, versionsDir } from "../filesystem/paths";
import { refreshMsaToken, completeMinecraftLogin } from "../auth/microsoft";
import { getFabricVersionDetail } from "./fabric";

interface DownloadTaskInput {
  url: string;
  dest: string;
  sha1?: string;
  size?: number;
  label: string;
}

function currentOsRuleAllows(rules: unknown): boolean {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  const os = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
  let allowed = false;
  for (const rule of rules as Array<{ action?: string; os?: { name?: string } }>) {
    const matches = !rule.os?.name || rule.os.name === os;
    if (matches) allowed = rule.action !== "disallow";
  }
  return allowed;
}

function mavenCoordToRelPath(name: string): string {
  const [group, artifact, version, classifier] = name.split(":");
  const groupPath = group.replace(/\./g, "/");
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ""}.jar`;
  return path.join(groupPath, artifact, version, file);
}

function nativesClassifierForCurrentOs(natives: Record<string, string> | undefined): string | null {
  if (!natives) return null;
  const osKey = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";
  const raw = natives[osKey];
  if (!raw) return null;
  // Some older library entries use a "${arch}" placeholder (32/64-bit variants).
  // We assume 64-bit, which covers the overwhelming majority of systems still able
  // to run modern Minecraft/Java at all.
  return raw.replace("${arch}", "64");
}

async function ensureVersionAssetsAndLibraries(
  versionDetail: any,
  nativesDir: string
): Promise<{ clientJarPath: string; librariesDirPath: string; assetsDirPath: string }> {
  const libDir = librariesDir();
  const assetDir = assetsDir();
  const verDir = path.join(versionsDir(), versionDetail.id);
  fs.mkdirSync(verDir, { recursive: true });

  const clientJarPath = path.join(verDir, `${versionDetail.id}.jar`);
  const tasks: DownloadTaskInput[] = [
    {
      url: versionDetail.downloads.client.url,
      dest: clientJarPath,
      sha1: versionDetail.downloads.client.sha1,
      size: versionDetail.downloads.client.size,
      label: `Minecraft ${versionDetail.id} client`,
    },
  ];

  const nativeJarPaths: string[] = [];

  for (const lib of versionDetail.libraries ?? []) {
    if (!currentOsRuleAllows(lib.rules)) continue;
    const artifact = lib.downloads?.artifact;
    if (artifact) {
      const dest = path.join(libDir, mavenCoordToRelPath(lib.name));
      tasks.push({
        url: artifact.url,
        dest,
        sha1: artifact.sha1,
        size: artifact.size,
        label: lib.name,
      });
    }

    // Older-style native libraries: a separate classifier jar (e.g. "natives-windows")
    // that needs to be downloaded AND extracted into the instance's natives folder —
    // it must never end up on the classpath itself.
    const classifier = nativesClassifierForCurrentOs(lib.natives);
    if (classifier && lib.downloads?.classifiers?.[classifier]) {
      const nativeArtifact = lib.downloads.classifiers[classifier];
      const dest = path.join(libDir, "natives-cache", `${lib.name.replace(/[:]/g, "_")}-${classifier}.jar`);
      tasks.push({
        url: nativeArtifact.url,
        dest,
        sha1: nativeArtifact.sha1,
        size: nativeArtifact.size,
        label: `${lib.name} (natives: ${classifier})`,
      });
      nativeJarPaths.push(dest);
    }
  }

  // Asset index + objects
  const assetIndexResp = await fetch(versionDetail.assetIndex.url);
  const assetIndex = (await assetIndexResp.json()) as { objects: Record<string, { hash: string; size: number }> };
  const objectsDir = path.join(assetDir, "objects");
  const indexesDir = path.join(assetDir, "indexes");
  fs.mkdirSync(indexesDir, { recursive: true });
  fs.writeFileSync(
    path.join(indexesDir, `${versionDetail.assets}.json`),
    JSON.stringify(assetIndex)
  );

  for (const [assetPath, obj] of Object.entries(assetIndex.objects)) {
    const prefix = obj.hash.slice(0, 2);
    tasks.push({
      url: `https://resources.download.minecraft.net/${prefix}/${obj.hash}`,
      dest: path.join(objectsDir, prefix, obj.hash),
      sha1: obj.hash,
      size: obj.size,
      label: `asset:${assetPath}`,
    });
  }

  const taskId = randomUUID();
  // Full asset/library downloads can take several minutes on a slow connection —
  // the default 30s IPC timeout was killing legitimate in-progress downloads.
  const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const failed = await coreBridge.call<{ failed: string[] }>(
    "downloads.batch",
    { taskId, tasks },
    DOWNLOAD_TIMEOUT_MS
  );
  if (failed.failed.length > 0) {
    // Only client jar, libraries, and natives are launch-critical. A handful of missed
    // asset files (often background music tracks — large files, first candidates to
    // time out on a slow connection) shouldn't block the whole launch; Minecraft
    // tolerates a missing sound asset far better than it tolerates never starting.
    const criticalFailures = failed.failed.filter((label) => !label.startsWith("asset:"));
    const assetFailures = failed.failed.length - criticalFailures.length;

    if (criticalFailures.length > 0) {
      throw new Error(
        `${criticalFailures.length} required file(s) failed to download; try Repair Instance. ` +
          `(${criticalFailures.slice(0, 3).join(", ")}${criticalFailures.length > 3 ? "…" : ""})`
      );
    }
    if (assetFailures > 0) {
      console.warn(`[launch] ${assetFailures} non-critical asset(s) failed to download — continuing anyway`);
    }
  }

  if (nativeJarPaths.length > 0) {
    await coreBridge.call("natives.extract", {
      jarPaths: nativeJarPaths,
      destDir: nativesDir,
    });
  }

  return { clientJarPath, librariesDirPath: libDir, assetsDirPath: assetDir };
}

async function resolveJavaPath(instanceJavaPath: string | null, recommendedMajor: number): Promise<string> {
  if (instanceJavaPath && fs.existsSync(instanceJavaPath)) return instanceJavaPath;

  const installs = await detectJava();
  const exact = installs.find((j) => j.majorVersion === recommendedMajor);
  if (exact) return exact.path;

  const newest = installs.filter((j) => j.majorVersion >= recommendedMajor).sort((a, b) => a.majorVersion - b.majorVersion)[0];
  if (newest) return newest.path;

  throw new Error(
    `No installed Java runtime satisfies Minecraft's requirement (Java ${recommendedMajor}+). ` +
      `Open Java Manager to install one.`
  );
}

async function resolveAccountForLaunch() {
  const account = getActiveAccount();
  if (!account) throw new Error("No active account. Add a Microsoft account or offline profile first.");

  if (account.kind === "offline") {
    return { username: account.username, uuid: account.uuid, accessToken: "", userType: "legacy" };
  }

  const refreshToken = await getMicrosoftRefreshToken(account.id);
  if (!refreshToken) {
    throw new Error("Microsoft session is missing; please sign in again.");
  }
  const refreshed = await refreshMsaToken(refreshToken);
  const session = await completeMinecraftLogin(refreshed.accessToken, refreshed.refreshToken);
  return {
    username: account.username,
    uuid: session.minecraftUuid,
    accessToken: session.minecraftAccessToken,
    userType: "msa",
  };
}

export async function launchInstance(instanceId: string): Promise<{ started: boolean }> {
  const db = getDb();
  const instance = db.prepare("SELECT * FROM instances WHERE id = ?").get(instanceId) as
    | {
        id: string;
        minecraft_version: string;
        loader: "vanilla" | "fabric" | "forge";
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

  const manifest = await coreBridge.call<{ versions: { id: string }[] }>("mojang.getVersionManifest", {
    forceRefresh: false,
  });
  if (!manifest.versions.some((v) => v.id === instance.minecraft_version)) {
    throw new Error(`Unknown Minecraft version: ${instance.minecraft_version}`);
  }

  const { detail: versionDetail, recommendedJavaMajor } =
    instance.loader === "fabric"
      ? await getFabricVersionDetail(instance.minecraft_version, instance.loader_version ?? "")
      : await coreBridge.call<{ detail: any; recommendedJavaMajor: number }>("mojang.getVersionDetail", {
          versionId: instance.minecraft_version,
        });

  const { clientJarPath, librariesDirPath, assetsDirPath } = await ensureVersionAssetsAndLibraries(
    versionDetail,
    path.join(instance.instance_dir, "natives")
  );
  const javaPath = await resolveJavaPath(instance.java_path, recommendedJavaMajor);
  const account = await resolveAccountForLaunch();

  db.prepare("UPDATE instances SET last_played_at = ? WHERE id = ?").run(new Date().toISOString(), instanceId);

  return coreBridge.call<{ started: boolean }>("launch.start", {
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
      extra_game_args: instance.game_args ? instance.game_args.split(/\s+/).filter(Boolean) : [],
      width: 854,
      height: 480,
    },
    account: {
      username: account.username,
      uuid: account.uuid,
      access_token: account.accessToken,
      user_type: account.userType,
    },
    versionDetail,
  });
}
