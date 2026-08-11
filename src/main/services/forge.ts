import { randomUUID } from "node:crypto";
import path from "node:path";
import { coreBridge } from "./core-bridge";
import { librariesDir, rootDir } from "../filesystem/paths";

// The rest of this codebase (see launch.ts) treats the merged Mojang/loader version
// JSON as `any` rather than a fully-typed shape — it's a large, loosely-standardized
// third-party document (Mojang's own schema plus whatever a loader's version.json
// adds/overrides), so we follow that same convention here instead of inventing a
// parallel type that would inevitably drift from what the Rust core actually returns.
type VersionDetail = any;

export interface ForgeVersion {
  minecraftVersion: string;
  forgeVersion: string;
  fullVersion: string;
  recommended: boolean;
  latest: boolean;
}

export async function getForgeVersions(mcVersion: string): Promise<ForgeVersion[]> {
  const raw = await coreBridge.call<
    Array<{
      minecraft_version: string;
      forge_version: string;
      full_version: string;
      recommended: boolean;
      latest: boolean;
    }>
  >("forge.getVersions", { mcVersion });

  return raw.map((v) => ({
    minecraftVersion: v.minecraft_version,
    forgeVersion: v.forge_version,
    fullVersion: v.full_version,
    recommended: v.recommended,
    latest: v.latest,
  }));
}

/** Picks Forge's own "recommended" build, falling back to "latest", then the newest
 * published build if neither tag is available for this Minecraft version. */
export async function getRecommendedForgeVersion(mcVersion: string): Promise<ForgeVersion> {
  const versions = await getForgeVersions(mcVersion);
  if (versions.length === 0) {
    throw new Error(`Forge has no published builds for Minecraft ${mcVersion}`);
  }
  return versions.find((v) => v.recommended) ?? versions.find((v) => v.latest) ?? versions[0];
}

/**
 * Runs the real Forge installer pipeline for (mcVersion, fullForgeVersion) and returns
 * a launchable VersionDetail merged onto the given vanilla detail. Requires the vanilla
 * client jar to already be downloaded (same precondition as Fabric's install path) and
 * a working Java runtime capable of running Forge's own installer tools.
 *
 * Emits `forge.install.progress` events (forwarded to the renderer as
 * `noxara:event:forgeInstallProgress`) for the duration of the install — this can take
 * anywhere from ~10 seconds to a couple of minutes depending on the Forge version.
 */
export async function installForge(
  taskId: string,
  mcVersion: string,
  fullForgeVersion: string,
  javaPath: string,
  vanillaClientJar: string,
  vanillaDetail: VersionDetail
): Promise<{ detail: VersionDetail }> {
  const workDir = path.join(rootDir(), "forge-install", `${mcVersion}-${fullForgeVersion}-${randomUUID().slice(0, 8)}`);

  // Forge's own installer/processor pipeline shells out to `java`, downloads dozens of
  // small library jars, and can be slow on a cold connection — give it real headroom
  // rather than the default 30s IPC timeout (mirrors the launch download timeout).
  const FORGE_INSTALL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

  return coreBridge.call<{ detail: VersionDetail }>(
    "forge.install",
    {
      taskId,
      mcVersion,
      fullForgeVersion,
      javaPath,
      librariesDir: librariesDir(),
      workDir,
      vanillaClientJar,
      vanillaDetail,
    },
    FORGE_INSTALL_TIMEOUT_MS
  );
}
