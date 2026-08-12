/**
 * Installs/removes/updates mods for an instance using real Modrinth downloads.
 * Files are written into <instanceDir>/mods (created at instance-creation time),
 * validated with assertWithin before every write/delete, and tracked in the
 * existing `mods` SQLite table (see database/migrations/0002_mods_and_skins.sql
 * for the source_version_id/game_version/loader columns added for this).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getDb } from "./database";
import { getInstanceDirById, listInstances } from "./instances";
import { assertWithin } from "../filesystem/paths";
import * as modrinth from "./modrinth";
import type {
  InstalledMod,
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
  const loader = ["fabric", "forge"].includes(instance.loader)
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
  const res = await fetch(url);
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

export async function installMod(
  instanceId: string,
  projectId: string,
  versionId: string
): Promise<InstalledMod> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);
  if (!loader) {
    throw new Error("This instance's loader doesn't support mods (vanilla instances can't run mods).");
  }

  const version: ModrinthVersion = await modrinth.getVersion(versionId);

  if (!version.loaders.includes(loader) || !version.gameVersions.includes(gameVersion)) {
    throw new Error(
      `This mod version doesn't support Minecraft ${gameVersion} on ${loader}. Choose a compatible version.`
    );
  }

  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error("This mod version has no downloadable files.");

  const dir = modsDirFor(instanceId);
  // Sanitize the filename Modrinth gave us before it ever touches the filesystem.
  const safeFilename = path.basename(file.filename);
  const destPath = assertWithin(dir, safeFilename);

  const taskId = randomUUID();
  try {
    await downloadWithProgress(file.url, destPath, taskId, version.name, instanceId);
  } catch (err) {
    modDownloadEvents.emit("complete", {
      taskId,
      success: false,
      error: err instanceof Error ? err.message : "Download failed",
    });
    throw err;
  }

  const actualSha1 = sha1Of(destPath);
  if (file.sha1 && actualSha1.toLowerCase() !== file.sha1.toLowerCase()) {
    fs.rmSync(destPath, { force: true });
    modDownloadEvents.emit("complete", { taskId, success: false, error: "Checksum mismatch" });
    throw new Error("Downloaded file failed checksum verification and was removed.");
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM mods WHERE instance_id = ? AND source_id = ?")
    .get(instanceId, projectId) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();

  const row: ModRow = {
    id,
    instance_id: instanceId,
    name: version.name.split(" ")[0] || version.name, // Modrinth version "name" is often "<Mod> <ver>"
    version: version.versionNumber,
    source: "modrinth",
    source_id: projectId,
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

  return rowToInstalledMod(row);
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
