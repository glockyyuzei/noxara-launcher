/**
 * Installs/removes/updates mods for an instance using real Modrinth downloads.
 * Files are written into <instanceDir>/mods (created at instance-creation time),
 * validated with assertWithin before every write/delete, and tracked in the
 * existing `mods` SQLite table (see database/migrations/0002_mods_and_skins.sql
 * for the source_version_id/game_version/loader columns added for this).
 *
 * Also owns Modrinth dependency resolution: every version's `dependencies` are
 * reported (getModDependencies), missing required deps can be auto-installed
 * (installMissingDependencies, used by instance repair), and the install pipeline
 * reports real progress through the global activity system.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getDb } from "./database";
import { getInstanceDirById, listInstances } from "./instances";
import { assertWithin } from "../filesystem/paths";
import { registerDownload, unregisterDownload, signalFor } from "./download-control";
import { startActivity, progressActivity, succeedActivity, failActivity, isActivityActive } from "./activity";
import * as modrinth from "./modrinth";
import type {
  InstalledMod,
  ModDependenciesResult,
  ModDependency,
  ModLoader,
  ModUpdateInfo,
  ModrinthVersion,
} from "../../shared/types/ipc";

/** Emits "progress" / "complete" for the IPC layer to forward to the renderer. */
export const modDownloadEvents = new EventEmitter();

interface ModRow {
  id: string;
  instance_id: string;
  name: string;
  version: string;
  source: "modrinth" | "modpack" | "local";
  source_id: string | null;
  filename: string;
  enabled: number;
  sha1: string | null;
  source_version_id: string | null;
  game_version: string | null;
  loader: string | null;
}

function modsDirFor(instanceId: string): string {
  const instanceDir = getInstanceDirById(instanceId);
  const dir = path.join(instanceDir, "mods");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rowToInstalledMod(row: ModRow): InstalledMod {
  const dir = modsDirFor(row.instance_id);
  const fileExists = fs.existsSync(path.join(dir, row.filename));
  return {
    id: row.id,
    instanceId: row.instance_id,
    name: row.name,
    version: row.version,
    source: row.source,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    filename: row.filename,
    enabled: Boolean(row.enabled),
    fileExists,
  };
}

export function listInstalledMods(instanceId: string): InstalledMod[] {
  const rows = getDb()
    .prepare("SELECT * FROM mods WHERE instance_id = ? ORDER BY name COLLATE NOCASE ASC")
    .all(instanceId) as ModRow[];
  return rows.map(rowToInstalledMod);
}

function instanceLoaderAndVersion(instanceId: string): { loader: ModLoader | null; gameVersion: string } {
  const instance = listInstances().find((i) => i.id === instanceId);
  if (!instance) throw new Error(`instance ${instanceId} not found`);
  const loader = ["fabric", "forge", "neoforge", "quilt"].includes(instance.loader)
    ? (instance.loader as ModLoader)
    : null;
  return { loader, gameVersion: instance.minecraftVersion };
}

async function downloadWithProgress(
  url: string,
  destPath: string,
  taskId: string,
  modName: string,
  instanceId: string
): Promise<void> {
  // When the user hits Cancel on the Downloads page this signal aborts mid-stream.
  const res = await fetch(url, { signal: signalFor(taskId) });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${res.statusText}`);
  }
  const totalBytes = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const tmpPath = `${destPath}.part`;
  const fileHandle = fs.createWriteStream(tmpPath);

  let bytesDownloaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await new Promise<void>((resolve, reject) => {
          fileHandle.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
        });
        bytesDownloaded += value.byteLength;
        modDownloadEvents.emit("progress", {
          taskId,
          modName,
          instanceId,
          bytesDownloaded,
          totalBytes,
        });
        // Feed real byte deltas into the global activity manager (the activity owns
        // the same taskId as this download, whether it's a standalone mod install or
        // a repair/launch batch), so the overlay shows actual bytes + rate + ETA.
        progressActivity(taskId, {
          currentBytes: bytesDownloaded,
          totalBytes,
          progress: totalBytes > 0 ? Math.min(1, bytesDownloaded / totalBytes) : undefined,
        });
      }
    }
    await new Promise<void>((resolve, reject) =>
      fileHandle.close((err) => (err ? reject(err) : resolve()))
    );
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    fileHandle.close();
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

function sha1Of(filePath: string): string {
  const hash = createHash("sha1");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

/** Shared install core used by the normal install flow, dependency auto-install,
 * and instance repair. When `manageActivity` is true (normal installs) it owns the
 * activity lifecycle; when false (repair/deps) the caller's activity receives the
 * progress events because the taskId matches it. */
async function installVersionFile(
  instanceId: string,
  version: ModrinthVersion,
  taskId: string,
  opts: {
    source: ModRow["source"];
    sourceId: string;
    skipCompatCheck?: boolean;
    manageActivity?: boolean;
  }
): Promise<InstalledMod> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);

  if (opts.manageActivity) {
    startActivity(taskId, {
      type: "mod",
      title: version.name,
      description: "Preparing mod download",
      instanceId,
      status: "preparing",
    });
  }

  try {
    if (!opts.skipCompatCheck) {
      if (!loader) {
        throw new Error("This instance's loader doesn't support mods (vanilla instances can't run mods).");
      }
      if (!version.loaders.includes(loader) || !version.gameVersions.includes(gameVersion)) {
        throw new Error(
          `This mod version doesn't support Minecraft ${gameVersion} on ${loader}. Choose a compatible version.`
        );
      }
    }

    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) throw new Error("This mod version has no downloadable files.");

    const dir = modsDirFor(instanceId);
    // Sanitize the filename Modrinth gave us before it ever touches the filesystem.
    const safeFilename = path.basename(file.filename);
    const destPath = assertWithin(dir, safeFilename);

    try {
      if (opts.manageActivity) {
        progressActivity(taskId, {}, "downloading", { description: `Downloading ${version.name}` });
      }
      await downloadWithProgress(file.url, destPath, taskId, version.name, instanceId);
    } catch (err) {
      modDownloadEvents.emit("complete", {
        taskId,
        success: false,
        error: err instanceof Error ? err.message : "Download failed",
      });
      if (opts.manageActivity) failActivity(taskId, err instanceof Error ? err.message : "Download failed");
      throw err;
    }

    const actualSha1 = sha1Of(destPath);
    if (file.sha1 && actualSha1.toLowerCase() !== file.sha1.toLowerCase()) {
      fs.rmSync(destPath, { force: true });
      modDownloadEvents.emit("complete", { taskId, success: false, error: "Checksum mismatch" });
      if (opts.manageActivity) failActivity(taskId, "Downloaded file failed checksum verification and was removed.");
      throw new Error("Downloaded file failed checksum verification and was removed.");
    }

    const db = getDb();
    const existing = db
      .prepare("SELECT id, filename FROM mods WHERE instance_id = ? AND source_id = ?")
      .get(instanceId, opts.sourceId) as { id: string; filename: string } | undefined;
    const id = existing?.id ?? randomUUID();
    // Updating/reinstalling: drop the previously-downloaded file when its name
    // changed so an update never leaves a stale duplicate behind.
    if (existing && existing.filename && existing.filename !== safeFilename) {
      fs.rmSync(assertWithin(dir, path.basename(existing.filename)), { force: true });
    }

    const row: ModRow = {
      id,
      instance_id: instanceId,
      name: version.name.split(" ")[0] || version.name, // Modrinth version "name" is often "<Mod> <ver>"
      version: version.versionNumber,
      source: opts.source,
      source_id: opts.sourceId,
      filename: safeFilename,
      enabled: 1,
      sha1: actualSha1,
      source_version_id: version.id,
      game_version: gameVersion,
      loader,
    };

    db.prepare(
      `INSERT INTO mods (id, instance_id, name, version, source, source_id, filename, enabled, sha1, source_version_id, game_version, loader)
       VALUES (@id, @instance_id, @name, @version, @source, @source_id, @filename, @enabled, @sha1, @source_version_id, @game_version, @loader)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, version = @version, filename = @filename, sha1 = @sha1,
         source_version_id = @source_version_id, game_version = @game_version, loader = @loader`
    ).run(row);

    modDownloadEvents.emit("complete", { taskId, success: true });
    if (opts.manageActivity) succeedActivity(taskId, { description: "Mod installed" });

    return rowToInstalledMod(row);
  } catch (err) {
    if (opts.manageActivity) {
      failActivity(taskId, err instanceof Error ? err.message : "Install failed");
    }
    throw err;
  }
}

export async function installMod(
  instanceId: string,
  projectId: string,
  versionId: string
): Promise<InstalledMod> {
  const taskId = randomUUID();
  // Register the download so the Downloads page can Cancel/Retry it. Retry re-runs
  // the whole install under the SAME taskId, so the store entry flips back to
  // "downloading" instead of creating a duplicate row.
  registerDownload(taskId, {
    kind: "mod",
    run: () => installModCore(instanceId, projectId, versionId, taskId).then(() => undefined),
  });
  try {
    const mod = await installModCore(instanceId, projectId, versionId, taskId);
    unregisterDownload(taskId);
    return mod;
  } catch (err) {
    // Keep the handles registered so a failed download can be Retried from the UI.
    throw err;
  }
}

async function installModCore(
  instanceId: string,
  projectId: string,
  versionId: string,
  taskId: string
): Promise<InstalledMod> {
  const version: ModrinthVersion = await modrinth.getVersion(versionId);
  // Register the activity up front (the id is shared by the whole install) so the
  // dependency downloads that follow report real byte progress through it. When the
  // main file install runs it re-registers the same id, which just resets timestamps.
  startActivity(taskId, {
    type: "mod",
    title: version.name,
    description: "Preparing mod download",
    instanceId,
    status: "preparing",
  });
  try {
    // 1. Install missing required dependencies FIRST so a dependency failure aborts
    //    before the mod itself lands — the mod can never sit installed-but-broken.
    await installMissingDependenciesForVersion(instanceId, version, taskId);
    // 2. Then the mod itself (manageActivity completes the shared activity).
    return await installVersionFile(instanceId, version, taskId, {
      source: "modrinth",
      sourceId: projectId,
      manageActivity: true,
    });
  } catch (err) {
    // Deps-first failure means the mod row was never created; fail the activity unless
    // installVersionFile already did (it moves the record to recent in that case).
    if (isActivityActive(taskId)) {
      failActivity(taskId, err instanceof Error ? err.message : "Install failed");
    }
    throw err;
  }
}

/** Installs every missing required dependency of `version` into the instance. Uses
 * the same activity/taskId as the parent install so the overlay shows one continuous
 * operation; dependency downloads report real byte progress through it. */
async function installMissingDependenciesForVersion(
  instanceId: string,
  version: ModrinthVersion,
  taskId: string
): Promise<void> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);
  if (!loader) return;

  const installedProjectIds = new Set(
    listInstalledMods(instanceId)
      .map((m) => m.sourceId)
      .filter((id): id is string => Boolean(id))
  );

  const missing = await getModDependencies(instanceId, version.id).then((r) => r.missing);
  for (const dep of missing) {
    if (installedProjectIds.has(dep.projectId)) continue;
    await resolveAndInstallDependency(instanceId, dep.projectId, taskId, loader, gameVersion);
    installedProjectIds.add(dep.projectId);
  }
}

export function removeMod(instanceId: string, modId: string): void {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM mods WHERE id = ? AND instance_id = ?")
    .get(modId, instanceId) as ModRow | undefined;
  if (!row) throw new Error("Mod not found for this instance.");

  const dir = modsDirFor(instanceId);
  const filePath = assertWithin(dir, path.basename(row.filename));
  fs.rmSync(filePath, { force: true });

  db.prepare("DELETE FROM mods WHERE id = ?").run(modId);
}

export async function checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);
  if (!loader) return [];

  const installed = listInstalledMods(instanceId).filter(
    (m) => m.source === "modrinth" && m.sourceId
  );

  const updates: ModUpdateInfo[] = [];
  for (const mod of installed) {
    try {
      const versions = await modrinth.getProjectVersions(mod.sourceId!, loader, gameVersion);
      const latest = versions[0]; // Modrinth returns newest-first for this endpoint.
      if (latest && latest.id !== mod.sourceVersionId) {
        updates.push({ modId: mod.id, currentVersion: mod.version, latestVersion: latest });
      }
    } catch {
      // Skip mods whose project lookup fails (e.g. removed from Modrinth) rather
      // than failing the whole update check.
      continue;
    }
  }
  return updates;
}

/* -------------------------------------------------------------------------- */
/* Mod dependencies                                                            */
/* -------------------------------------------------------------------------- */

/** Resolves a version's Modrinth dependencies against what's installed. */
export async function getModDependencies(
  instanceId: string,
  versionId: string
): Promise<ModDependenciesResult> {
  const version = await modrinth.getVersion(versionId);

  const installedProjectIds = new Set(
    listInstalledMods(instanceId)
      .map((m) => m.sourceId)
      .filter((id): id is string => Boolean(id))
  );

  const result: ModDependenciesResult = { present: [], missing: [], incompatible: [], optional: [] };

  const required: ModDependency[] = [];
  const incompatible: ModDependency[] = [];
  const optional: ModDependency[] = [];

  for (const dep of version.dependencies) {
    const entry: ModDependency = {
      projectId: dep.projectId,
      versionId: dep.versionId,
      dependencyType: dep.dependencyType,
    };
    if (dep.dependencyType === "incompatible") incompatible.push(entry);
    else if (dep.dependencyType === "optional") optional.push(entry);
    else if (dep.dependencyType === "required") required.push(entry);
    // "embedded" deps ship inside the downloaded file itself — nothing to install.
  }

  // Best-effort display metadata (title/icon) for dependency rows; failures (e.g.
  // projects removed from Modrinth) degrade gracefully to projectId-only entries.
  const enrich = async (list: ModDependency[]) => {
    await Promise.all(
      list.map(async (dep) => {
        try {
          const project = await modrinth.getProject(dep.projectId);
          dep.name = project.title;
          dep.iconUrl = project.iconUrl;
        } catch {
          /* keep projectId-only */
        }
      })
    );
  };

  await Promise.all([enrich(required), enrich(incompatible), enrich(optional)]);

  for (const dep of required) {
    const installed = installedProjectIds.has(dep.projectId);
    if (installed) result.present.push({ dependency: dep, installed: true });
    else result.missing.push(dep);
  }
  // Only *real* conflicts matter to the user: an incompatibility with a project that
  // isn't installed is moot (the mod can install fine), so it's reported with
  // `installed: false` and the UI ignores it. Installed conflicts block the install.
  result.incompatible = incompatible.map((dep) => ({
    dependency: dep,
    installed: installedProjectIds.has(dep.projectId),
  }));
  result.optional = optional;

  return result;
}

/** Resolves and installs the latest compatible version of a dependency project. */
async function resolveAndInstallDependency(
  instanceId: string,
  projectId: string,
  taskId: string,
  loader: ModLoader,
  gameVersion: string
): Promise<void> {
  const versions = await modrinth.getProjectVersions(projectId, loader, gameVersion);
  const compatible =
    versions.find((v) => v.loaders.includes(loader) && v.gameVersions.includes(gameVersion)) ??
    versions[0];
  if (!compatible) {
    throw new Error(`No compatible ${projectId} version found for Minecraft ${gameVersion} on ${loader}.`);
  }
  await installVersionFile(instanceId, compatible, taskId, {
    source: "modrinth",
    sourceId: projectId,
    skipCompatCheck: true,
  });
}

/** Installs missing required dependencies for every installed Modrinth mod.
 * Returns the number of dependencies installed. Used by instance repair. */
export async function installMissingDependencies(
  instanceId: string,
  taskId: string
): Promise<number> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);
  if (!loader) return 0;

  const installed = listInstalledMods(instanceId).filter(
    (m) => m.source === "modrinth" && m.sourceId && m.sourceVersionId
  );

  const installedProjectIds = new Set(installed.map((m) => m.sourceId));
  const missingRequired = new Map<string, ModDependency>();

  for (const mod of installed) {
    try {
      const deps = await getModDependencies(instanceId, mod.sourceVersionId!);
      for (const dep of deps.missing) {
        if (!installedProjectIds.has(dep.projectId) && !missingRequired.has(dep.projectId)) {
          missingRequired.set(dep.projectId, dep);
        }
      }
    } catch {
      // A mod whose version lookup fails shouldn't abort the whole repair.
      continue;
    }
  }

  let installedCount = 0;
  for (const dep of missingRequired.values()) {
    try {
      await resolveAndInstallDependency(instanceId, dep.projectId, taskId, loader, gameVersion);
      installedProjectIds.add(dep.projectId);
      installedCount += 1;
    } catch {
      // A dependency that can't be resolved (removed from Modrinth, no compatible
      // version) is left to the health check to surface — never fails the repair.
      continue;
    }
  }
  return installedCount;
}

/** Re-downloads the file of every installed mod whose file is missing on disk.
 * Returns the number of files restored. Used by instance repair. */
export async function redownloadMissingModFiles(instanceId: string, taskId: string): Promise<number> {
  const installed = listInstalledMods(instanceId);
  let restored = 0;
  for (const mod of installed) {
    if (mod.fileExists) continue;
    const versionId = mod.sourceVersionId;
    if (mod.source !== "modrinth" || !versionId) {
      // Local/unknown mods with missing files can't be re-fetched; skip.
      continue;
    }
    try {
      const version = await modrinth.getVersion(versionId);
      await installVersionFile(instanceId, version, taskId, {
        source: mod.source,
        sourceId: mod.sourceId ?? version.projectId,
        skipCompatCheck: true,
      });
      restored += 1;
    } catch {
      continue;
    }
  }
  return restored;
}