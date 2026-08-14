import { coreBridge } from "./core-bridge";
import type { VersionManifest } from "../../shared/types/ipc";

export async function getVersionManifest(forceRefresh = false): Promise<VersionManifest> {
  return coreBridge.call<VersionManifest>("mojang.getVersionManifest", { forceRefresh });
}
