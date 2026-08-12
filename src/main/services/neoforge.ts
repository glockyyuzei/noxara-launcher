import { randomUUID } from "node:crypto";
import path from "node:path";
import { coreBridge } from "./core-bridge";
import { librariesDir, rootDir } from "../filesystem/paths";

export interface NeoForgeVersion {
  minecraftVersion: string;
  forgeVersion: string;
  fullVersion: string;
  recommended: boolean;
  latest: boolean;
}

export async function getNeoForgeVersions(mcVersion: string): Promise<NeoForgeVersion[]> {
  const raw = await coreBridge.call<
    Array<{
      minecraft_version: string;
      forge_version: string;
      full_version: string;
      recommended: boolean;
      latest: boolean;
    }>
  >("neoforge.getVersions", { mcVersion }, 90_000);

  return raw.map((v) => ({
    minecraftVersion: v.minecraft_version,
    forgeVersion: v.forge_version,
    fullVersion: v.full_version,
    recommended: v.recommended,
    latest: v.latest,
  }));
}

/** Picks NeoForge's own "recommended" build, falling back to "latest", then the newest
 * published build if neither tag is available for this Minecraft version. */
export async function getRecommendedNeoForgeVersion(mcVersion: string): Promise<NeoForgeVersion> {
  const versions = await getNeoForgeVersions(mcVersion);
  if (versions.length === 0) {
    throw new Error(`NeoForge has no published builds for Minecraft ${mcVersion}`);
  }
  return versions.find((v) => v.recommended) ?? versions.find((v) => v.latest) ?? versions[0];
}

/**
 * Runs the real NeoForge installer pipeline (Forge-derived) for
 * (mcVersion, fullNeoForgeVersion) and returns a launchable VersionDetail merged onto
 * the given vanilla detail. Requires the vanilla client jar to already be downloaded
 * and a working Java runtime, same preconditions as the Forge install path.
 */
export async function installNeoForge(
  taskId: string,
  mcVersion: string,
  fullVersion: string,
  javaPath: string,
  vanillaClientJar: string,
  vanillaDetail: any
): Promise<{ detail: any }> {
  const workDir = path.join(rootDir(), "neoforge-install", `${mcVersion}-${fullVersion}-${randomUUID().slice(0, 8)}`);
  const FORGE_INSTALL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes, like Forge

  return coreBridge.call<{ detail: any }>(
    "neoforge.install",
    {
      taskId,
      mcVersion,
      fullVersion,
      javaPath,
      librariesDir: librariesDir(),
      workDir,
      vanillaClientJar,
      vanillaDetail,
    },
    FORGE_INSTALL_TIMEOUT_MS
  );
}