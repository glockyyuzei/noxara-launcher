import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import { getDb } from "./database";
import { instanceDir, slugifyInstanceName } from "../filesystem/paths";
import { startActivity, updateActivity, succeedActivity, failActivity } from "./activity";
import type { CreateInstanceInput, InstanceRecord } from "../../shared/types/ipc";
import { resolveFabricLoaderVersion } from "./fabric";
import { resolveQuiltLoaderVersion } from "./quilt";
import { getForgeVersions } from "./forge";
import { getNeoForgeVersions } from "./neoforge";

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
  if (!["vanilla", "fabric", "forge", "neoforge", "quilt"].includes(input.loader)) {
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

  const activityId = randomUUID();
  startActivity(activityId, {
    type: "instance",
    title: input.name.trim(),
    description: "Creating instance",
    status: "preparing",
  });

  try {
    // Resolve a real, currently-published loader version instead of trusting a
    // placeholder from the UI — this is what actually gets installed and launched.
    // Fabric additionally gets validated against the actually-published loader builds
    // for the selected Minecraft version (an unsupported version fails clearly here,
    // before any instance directory is created).
    let resolvedLoaderVersion = input.loaderVersion ?? null;
    if (input.loader === "fabric") {
      resolvedLoaderVersion = await resolveFabricLoaderVersion(input.minecraftVersion, resolvedLoaderVersion);
    } else if (input.loader === "quilt") {
      resolvedLoaderVersion = await resolveQuiltLoaderVersion(input.minecraftVersion, resolvedLoaderVersion);
    } else if (input.loader === "forge") {
      // Forge's own installer/processor pipeline only actually runs on first launch (it
      // needs a resolved Java runtime, which we don't have yet during instance creation —
      // see launch.ts). Here we only need to pin down and validate *which* Forge build
      // this instance is committed to, exactly like Fabric does with its loader version.
      const forgeVersions = await getForgeVersions(input.minecraftVersion);
      if (!resolvedLoaderVersion || resolvedLoaderVersion === "latest") {
        const chosen = forgeVersions.find((v) => v.recommended) ?? forgeVersions.find((v) => v.latest) ?? forgeVersions[0];
        resolvedLoaderVersion = chosen.fullVersion;
      } else if (!forgeVersions.some((v) => v.fullVersion === resolvedLoaderVersion)) {
        throw new Error(`Forge ${resolvedLoaderVersion} is not a published build for Minecraft ${input.minecraftVersion}`);
      }
    } else if (input.loader === "neoforge") {
      // Same contract as Forge: pin down and validate which NeoForge build this instance
      // is committed to; the installer itself runs during first launch (see launch.ts).
      const neoforgeVersions = await getNeoForgeVersions(input.minecraftVersion);
      if (!resolvedLoaderVersion || resolvedLoaderVersion === "latest") {
        const chosen = neoforgeVersions.find((v) => v.recommended) ?? neoforgeVersions.find((v) => v.latest) ?? neoforgeVersions[0];
        resolvedLoaderVersion = chosen.fullVersion;
      } else if (!neoforgeVersions.some((v) => v.fullVersion === resolvedLoaderVersion)) {
        throw new Error(`NeoForge ${resolvedLoaderVersion} is not a published build for Minecraft ${input.minecraftVersion}`);
      }
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

    succeedActivity(activityId, { description: "Instance created" });
    return rowToRecord(record);
  } catch (err) {
    failActivity(activityId, err instanceof Error ? err.message : "Instance creation failed");
    throw err;
  }
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

  const activityId = randomUUID();
  startActivity(activityId, {
    type: "instance",
    title: newName.trim(),
    description: "Duplicating instance",
    status: "preparing",
  });

  try {
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
    // Tie the wrapper activity to the new instance so the UI can show CREATING while
    // the mutable content is copied (createInstance's own activity had no id yet).
    updateActivity(activityId, { instanceId: created.id });
    for (const sub of ["mods", "config", "saves", "resourcepacks", "shaderpacks"]) {
      const src = path.join(source.instance_dir, sub);
      const dest = path.join(newDir, sub);
      if (fs.existsSync(src)) {
        fs.cpSync(src, dest, { recursive: true });
      }
    }

    succeedActivity(activityId, { description: "Instance duplicated" });
    return created;
  } catch (err) {
    failActivity(activityId, err instanceof Error ? err.message : "Duplicate failed");
    throw err;
  }
}

export function openInstanceFolder(id: string): void {
  const dir = getInstanceDirById(id);
  shell.openPath(dir);
}

/** Editable per-instance settings. Only the fields the UI actually exposes today —
 * pinning a Java runtime, or changing memory — are updatable; everything else is
 * immutable once the instance exists. */
export interface UpdateInstanceInput {
  name?: string;
  javaPath?: string | null;
  minRamMb?: number;
  maxRamMb?: number;
}

/** Applies a partial update to an instance's mutable settings and returns the fresh
 * record. Validates the same constraints as creation (RAM bounds, name non-empty). */
export function updateInstance(id: string, patch: UpdateInstanceInput): InstanceRecord {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as InstanceRow | undefined;
  if (!existing) throw new Error(`instance ${id} not found`);

  if (patch.name !== undefined && patch.name.trim().length === 0) {
    throw new Error("Instance name cannot be empty");
  }
  const minRamMb = patch.minRamMb ?? existing.min_ram_mb;
  const maxRamMb = patch.maxRamMb ?? existing.max_ram_mb;
  if (minRamMb < 512) throw new Error("Minimum RAM must be at least 512 MB");
  if (maxRamMb < minRamMb) throw new Error("Maximum RAM cannot be lower than minimum RAM");
  const totalSystemMb = Math.round(require("node:os").totalmem() / (1024 * 1024));
  if (maxRamMb > totalSystemMb * 0.9) {
    throw new Error(`Requested ${maxRamMb} MB exceeds a safe share of this system's ${totalSystemMb} MB RAM`);
  }

  db.prepare("UPDATE instances SET name = ?, java_path = ?, min_ram_mb = ?, max_ram_mb = ? WHERE id = ?").run(
    patch.name !== undefined ? patch.name.trim() : existing.name,
    patch.javaPath === undefined ? existing.java_path : patch.javaPath,
    minRamMb,
    maxRamMb,
    id
  );

  const updated = db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as InstanceRow;
  return rowToRecord(updated);
}
