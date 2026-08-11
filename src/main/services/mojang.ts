import { coreBridge } from "./core-bridge";
import type { VersionManifest } from "../../shared/types/ipc";

export async function getVersionManifest(forceRefresh = false): Promise<VersionManifest> {
  return coreBridge.call<VersionManifest>("mojang.getVersionManifest", { forceRefresh });
}

export async function getRecommendedJava(versionId: string): Promise<{ majorVersion: number }> {
  const result = await coreBridge.call<{ recommendedJavaMajor: number }>("mojang.getVersionDetail", {
    versionId,
  });
  return { majorVersion: result.recommendedJavaMajor };
}
