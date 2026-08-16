/**
 * Shared Minecraft file resolution: ensures the client jar, libraries, assets and
 * natives for a version detail are present on disk, downloading/verifying via
 * noxara-core's `downloads.batch` (sha1-verified, skip-if-present). Used by both
 * launch and instance repair so both report the same real progress.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { coreBridge } from "./core-bridge";
import { NOXARA_USER_AGENT } from "./http";
import { getSettings } from "./settings";
import { librariesDir, assetsDir, versionsDir } from "../filesystem/paths";

export interface DownloadTaskInput {
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
  return raw.replace("${arch}", "64");
}

/** `versionDetail` is the loosely-standardized Mojang/loader version JSON (see launch.ts). */
export async function ensureVersionAssetsAndLibraries(
  versionDetail: any,
  nativesDir: string,
  taskId = randomUUID()
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
  const assetIndexResp = await fetchWithTimeout(versionDetail.assetIndex.url, 30_000);
  if (!assetIndexResp.ok) {
    throw new Error(`Failed to download asset index (HTTP ${assetIndexResp.status}) for ${versionDetail.id}.`);
  }
  const assetIndex = (await assetIndexResp.json()) as { objects: Record<string, { hash: string; size: number }> };
  const objectsDir = path.join(assetDir, "objects");
  const indexesDir = path.join(assetDir, "indexes");
  fs.mkdirSync(indexesDir, { recursive: true });
  fs.writeFileSync(path.join(indexesDir, `${versionDetail.assets}.json`), JSON.stringify(assetIndex));

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

  const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  const settings = getSettings();
  // Chunk the batch so a full-version asset list never becomes a single gigantic
  // JSON-RPC message that can exceed the core bridge's message-size guard.
  const BATCH_CHUNK_SIZE = 512;
  const failed: string[] = [];
  for (let i = 0; i < tasks.length; i += BATCH_CHUNK_SIZE) {
    const chunk = tasks.slice(i, i + BATCH_CHUNK_SIZE);
    const result = await coreBridge.call<{ failed: string[] }>(
      "downloads.batch",
      {
        taskId,
        tasks: chunk,
        maxConcurrency: settings.maxConcurrentDownloads,
        maxAttempts: settings.downloadRetryCount,
        perRequestTimeoutSec: settings.downloadTimeoutSec,
      },
      DOWNLOAD_TIMEOUT_MS
    );
    failed.push(...result.failed);
  }
  if (failed.length > 0) {
    // Only client jar, libraries, and natives are launch-critical. A handful of missed
    // asset files (often background music tracks) shouldn't block launch — Minecraft
    // tolerates a missing sound asset far better than it tolerates never starting.
    const criticalFailures = failed.filter((label) => !label.startsWith("asset:"));
    if (criticalFailures.length > 0) {
      throw new Error(
        `${criticalFailures.length} required file(s) failed to download; try Repair Instance. ` +
          `(${criticalFailures.slice(0, 3).join(", ")}${criticalFailures.length > 3 ? "…" : ""})`
      );
    }
  }

  if (nativeJarPaths.length > 0) {
    const marker = path.join(nativesDir, ".noxara-natives-complete");
    // Re-extract only when this instance's natives were never fully extracted OR the
    // set of native jars changed since (e.g. the instance switched Minecraft versions,
    // which ships different native libraries). The marker records the version + exact
    // jar paths so an upgrade/downgrade triggers a fresh extraction; identical launches
    // skip the unzip entirely.
    const needsExtract = (() => {
      if (!fs.existsSync(marker)) return true;
      try {
        const recorded = JSON.parse(fs.readFileSync(marker, "utf-8")) as {
          version?: string;
          jars?: string[];
        };
        if (recorded.version !== versionDetail.id) return true;
        const recordedJars = recorded.jars ?? [];
        if (recordedJars.length !== nativeJarPaths.length) return true;
        return recordedJars.some((j, i) => j !== nativeJarPaths[i]);
      } catch {
        return true; // corrupt/legacy marker — re-extract to be safe
      }
    })();
    if (needsExtract) {
      await coreBridge.call("natives.extract", {
        jarPaths: nativeJarPaths,
        destDir: nativesDir,
      });
      fs.writeFileSync(marker, JSON.stringify({ version: versionDetail.id, jars: nativeJarPaths }));
    }
  }

  return { clientJarPath, librariesDirPath: libDir, assetsDirPath: assetDir };
}

/** `fetch` with an AbortSignal timeout — fails instead of hanging forever. Sends the
 * standard Noxara User-Agent (Mojang's asset endpoint otherwise sees a default UA). */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: { "User-Agent": NOXARA_USER_AGENT } });
  } finally {
    clearTimeout(timer);
  }
}