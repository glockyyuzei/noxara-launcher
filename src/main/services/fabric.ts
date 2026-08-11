import { coreBridge } from "./core-bridge";

export interface FabricLoaderVersion {
  version: string;
  stable: boolean;
  build: number | null;
}

export async function getFabricLoaderVersions(gameVersion: string): Promise<FabricLoaderVersion[]> {
  const raw = await coreBridge.call<Array<{ version: string; stable: boolean; build: number | null }>>(
    "fabric.getLoaderVersions",
    { gameVersion }
  );
  return raw;
}

/** Picks the newest stable loader build, falling back to the newest build of any
 * stability if no stable release exists yet for this Minecraft version. */
export async function getLatestFabricLoaderVersion(gameVersion: string): Promise<string> {
  const versions = await getFabricLoaderVersions(gameVersion);
  if (versions.length === 0) {
    throw new Error(`Fabric has no loader builds available for Minecraft ${gameVersion}`);
  }
  const stable = versions.find((v) => v.stable);
  return (stable ?? versions[0]).version;
}

export async function getFabricVersionDetail(gameVersion: string, loaderVersion: string) {
  return coreBridge.call<{ detail: any; recommendedJavaMajor: number }>("fabric.getVersionDetail", {
    gameVersion,
    loaderVersion,
  });
}
