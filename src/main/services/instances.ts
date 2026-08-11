import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { getDb } from "./database";
import { instanceDir, slugifyInstanceName } from "../filesystem/paths";
import type { CreateInstanceInput, InstanceRecord } from "../../shared/types/ipc";
import { getLatestFabricLoaderVersion } from "./fabric";

interface InstanceRow {
  id: string;
  name: string;
  minecraft_version: string;
  loader: InstanceRecord["loader"];
  loader_version: string | null;
  java_path: string | null;
  min_ram_mb: number;
  max_ram_mb: number;
  jvm_args: string;
  game_args: string;
  icon_path: string | null;
  instance_dir: string;
  created_at: string;
  last_played_at: string | null;
  favorite: number;
}

function rowToRecord(row: InstanceRow): InstanceRecord {
  return {
    id: row.id,
    name: row.name,
    minecraftVersion: row.minecraft_version,
    loader: row.loader,
    loaderVersion: row.loader_version,
    javaPath: row.java_path,
    minRamMb: row.min_ram_mb,
    maxRamMb: row.max_ram_mb,
    jvmArgs: row.jvm_args,
    gameArgs: row.game_args,
    iconPath: row.icon_path,
    createdAt: row.created_at,
    lastPlayedAt: row.last_played_at,
    favorite: Boolean(row.favorite),
  };
}

export function listInstances(): InstanceRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM instances ORDER BY favorite DESC, name COLLATE NOCASE ASC")
    .all() as InstanceRow[];
  return rows.map(rowToRecord);
}

export function getInstanceDirById(id: string): string {
  const row = getDb().prepare("SELECT instance_dir FROM instances WHERE id = ?").get(id) as
    | { instance_dir: string }
    | undefined;
  if (!row) throw new Error(`instance ${id} not found`);
  return row.instance_dir;
}

/** Validates version/loader/java/RAM inputs before persisting (spec section 9). */
function validateCreateInput(input: CreateInstanceInput): void {
  if (!input.name || input.name.trim().length === 0) {
    throw new Error("Instance name cannot be empty");
  }
  if (!input.minecraftVersion) {
    throw new Error("A Minecraft version must be selected");
  }
  if (!["vanilla", "fabric", "forge"].includes(input.loader)) {
    throw new Error(`Unsupported loader: ${input.loader}`);
  }
  if (input.loader !== "vanilla" && !input.loaderVersion) {
    throw new Error(`A ${input.loader} version must be selected`);
  }
  if (input.minRamMb < 512) {
    throw new Error("Minimum RAM must be at least 512 MB");
  }
  if (input.maxRamMb < input.minRamMb) {
    throw new Error("Maximum RAM cannot be lower than minimum RAM");
  }
  const totalSystemMb = Math.round(require("node:os").totalmem() / (1024 * 1024));
  if (input.maxRamMb > totalSystemMb * 0.9) {
    throw new Error(
      `Requested ${input.maxRamMb} MB exceeds a safe share of this system's ${totalSystemMb} MB RAM`
    );
  }
}

export async function createInstance(input: CreateInstanceInput): Promise<InstanceRecord> {
  validateCreateInput(input);

  // Resolve a real, currently-published loader version instead of trusting a
  // placeholder from the UI — this is what actually gets installed and launched.
  let resolvedLoaderVersion = input.loaderVersion ?? null;
  if (input.loader === "fabric" && (!resolvedLoaderVersion || resolvedLoaderVersion === "latest")) {
    resolvedLoaderVersion = await getLatestFabricLoaderVersion(input.minecraftVersion);
  } else if (input.loader === "forge") {
    throw new Error(
      `${input.loader} installation isn't implemented yet — only Vanilla and Fabric are supported so far.`
    );
  }

  const id = randomUUID();
  const dir = instanceDir(`${slugifyInstanceName(input.name)}-${id.slice(0, 8)}`);

  for (const sub of ["mods", "config", "saves", "resourcepacks", "shaderpacks", "logs", "screenshots", "crash-reports"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  const now = new Date().toISOString();
  const record: InstanceRow = {
    id,
    name: input.name.trim(),
    minecraft_version: input.minecraftVersion,
    loader: input.loader,
    loader_version: resolvedLoaderVersion,
    java_path: input.javaPath ?? null,
    min_ram_mb: input.minRamMb,
    max_ram_mb: input.maxRamMb,
    jvm_args: "",
    game_args: "",
    icon_path: input.iconPath ?? null,
    instance_dir: dir,
    created_at: now,
    last_played_at: null,
    favorite: 0,
  };

  getDb()
    .prepare(
      `INSERT INTO instances
        (id, name, minecraft_version, loader, loader_version, java_path, min_ram_mb, max_ram_mb,
         jvm_args, game_args, icon_path, instance_dir, created_at, last_played_at, favorite)
       VALUES (@id, @name, @minecraft_version, @loader, @loader_version, @java_path, @min_ram_mb, @max_ram_mb,
               @jvm_args, @game_args, @icon_path, @instance_dir, @created_at, @last_played_at, @favorite)`
    )
    .run(record);

  return rowToRecord(record);
}

export function deleteInstance(id: string): void {
  const dir = getInstanceDirById(id);
  getDb().prepare("DELETE FROM instances WHERE id = ?").run(id);
  // Only remove the directory after the DB row is gone, and only within the known
  // instances root — never a caller-supplied arbitrary path.
  fs.rmSync(dir, { recursive: true, force: true });
}

export async function duplicateInstance(id: string, newName: string): Promise<InstanceRecord> {
  const db = getDb();
  const source = db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as InstanceRow | undefined;
  if (!source) throw new Error(`instance ${id} not found`);

  const created = await createInstance({
    name: newName,
    minecraftVersion: source.minecraft_version,
    loader: source.loader,
    loaderVersion: source.loader_version,
    javaPath: source.java_path,
    minRamMb: source.min_ram_mb,
    maxRamMb: source.max_ram_mb,
    iconPath: source.icon_path,
  });

  // Copy mutable content (mods/config/saves/etc.) so the duplicate is fully independent,
  // per spec section 12: duplicates must not share mutable files.
  const newDir = getInstanceDirById(created.id);
  for (const sub of ["mods", "config", "saves", "resourcepacks", "shaderpacks"]) {
    const src = path.join(source.instance_dir, sub);
    const dest = path.join(newDir, sub);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }

  return created;
}

export function openInstanceFolder(id: string): void {
  const dir = getInstanceDirById(id);
  shell.openPath(dir);
}
