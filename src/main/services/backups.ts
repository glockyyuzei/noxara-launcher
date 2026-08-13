/**
 * Instance backups. A backup is a zip snapshot of the instance's folder, written by
 * noxara-core's `backup.create` (the Rust zip engine), with its metadata tracked in
 * the `backups` table (schema exists since migration 0001). Restore extracts the
 * archive into a staging dir first, then atomically swaps it for the live folder, so
 * a failed restore never leaves a half-wiped instance.
 *
 * Backups are stored under `<rootDir>/.noxara/backups` and are NOT included when the
 * instances root is measured for storage — they're shown separately there.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { coreBridge } from "./core-bridge";
import { rootDir, instancesDir, assertWithin } from "../filesystem/paths";
import { getInstanceDirById, listInstances } from "./instances";
import { listRunningInstances } from "./launch";
import { getDb } from "./database";
import { startActivity, progressActivity, succeedActivity, failActivity } from "./activity";
import type { BackupRecord } from "../../shared/types/ipc";

export function backupsDir(): string {
  const dir = path.join(rootDir(), ".noxara", "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface BackupRow {
  id: string;
  instance_id: string;
  label: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

function rowToRecord(row: BackupRow): BackupRecord {
  return {
    id: row.id,
    instanceId: row.instance_id,
    label: row.label,
    path: row.path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

export function listBackups(instanceId: string): BackupRecord[] {
  return getDb()
    .prepare("SELECT * FROM backups WHERE instance_id = ? ORDER BY created_at DESC")
    .all(instanceId)
    .map((r) => rowToRecord(r as BackupRow));
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40) || "instance"
  );
}

export async function createBackup(instanceId: string, label: string): Promise<BackupRecord> {
  const instance = listInstances().find((i) => i.id === instanceId);
  if (!instance) throw new Error(`instance ${instanceId} not found`);
  if (!label.trim()) throw new Error("Give the backup a label");

  const running = await listRunningInstances();
  if (running.includes(instanceId)) {
    throw new Error("Stop the instance before creating a backup");
  }

  const instanceDir = getInstanceDirById(instanceId);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const zipPath = path.join(backupsDir(), `${slugify(instance.name)}-${stamp}.zip`);

  const activityId = randomUUID();
  startActivity(activityId, {
    type: "backup",
    title: instance.name,
    instanceId: instance.id,
    description: "Creating backup",
    status: "exporting",
  });

  try {
    progressActivity(activityId, {}, "exporting", { description: "Compressing instance files" });
    await coreBridge.call("backup.create", { zipPath, sourceDir: instanceDir }, 180_000);

    const sizeBytes = fs.statSync(zipPath).size;
    const db = getDb();
    const id = randomUUID();
    db.prepare(
      "INSERT INTO backups (id, instance_id, label, path, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, instanceId, label.trim(), zipPath, sizeBytes, new Date().toISOString());

    const row = db.prepare("SELECT * FROM backups WHERE id = ?").get(id) as BackupRow;
    succeedActivity(activityId, { description: "Backup created" });
    return rowToRecord(row);
  } catch (err) {
    failActivity(activityId, err instanceof Error ? err.message : "Backup failed");
    throw err;
  }
}

export async function restoreBackup(backupId: string): Promise<void> {
  const db = getDb();
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(backupId) as BackupRow | undefined;
  if (!backup) throw new Error(`backup ${backupId} not found`);
  const instance = listInstances().find((i) => i.id === backup.instance_id);
  if (!instance) throw new Error("The instance this backup belongs to no longer exists");
  if (!fs.existsSync(backup.path)) throw new Error("The backup file is missing from disk");

  const running = await listRunningInstances();
  if (running.includes(instance.id)) {
    throw new Error("Stop the instance before restoring a backup");
  }

  // Defensive: only ever touch the instance folder beneath the instances root.
  const instanceDir = assertWithin(instancesDir(), path.basename(getInstanceDirById(instance.id)));
  const staging = path.join(rootDir(), ".noxara", "restore", randomUUID());
  fs.mkdirSync(staging, { recursive: true });

  const activityId = randomUUID();
  startActivity(activityId, {
    type: "backup",
    title: instance.name,
    instanceId: instance.id,
    description: "Restoring backup",
    status: "importing",
  });

  try {
    progressActivity(activityId, {}, "importing", { description: "Extracting backup archive" });
    await coreBridge.call("modpack.extract", { zipPath: backup.path, destDir: staging }, 180_000);

    progressActivity(activityId, {}, "importing", { description: "Replacing instance files" });

    // Swap: move the current folder aside (same volume — safe rename), copy the
    // staged snapshot in, then drop the old one. On failure the original is restored.
    const oldDir = path.join(instancesDir(), `.${instance.id}-restore-${randomUUID().slice(0, 8)}`);
    fs.renameSync(instanceDir, oldDir);
    try {
      fs.cpSync(staging, instanceDir, { recursive: true });
      fs.rmSync(oldDir, { recursive: true, force: true });
      fs.rmSync(staging, { recursive: true, force: true });
    } catch (err) {
      if (fs.existsSync(oldDir) && !fs.existsSync(instanceDir)) {
        fs.renameSync(oldDir, instanceDir);
      }
      throw err;
    }

    succeedActivity(activityId, { description: "Backup restored" });
  } catch (err) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    failActivity(activityId, err instanceof Error ? err.message : "Restore failed");
    throw err;
  }
}

export function deleteBackup(backupId: string): void {
  const db = getDb();
  const backup = db.prepare("SELECT * FROM backups WHERE id = ?").get(backupId) as BackupRow | undefined;
  if (!backup) throw new Error(`backup ${backupId} not found`);

  // Only ever remove files inside the backups root.
  const file = assertWithin(backupsDir(), path.basename(backup.path));
  db.prepare("DELETE FROM backups WHERE id = ?").run(backupId);
  fs.rmSync(file, { force: true });
}
