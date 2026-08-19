/**
 * Server list persistence. Backed by the existing `servers` table. Servers can be
 * scoped to a single instance (instance_id set) or available to every instance
 * (instance_id NULL). Addresses are validated before saving — we only ever store
 * real hostnames/IPs with an optional port, never shell strings.
 */
import { randomUUID } from "node:crypto";
import { getDb } from "./database";
import type { ServerInput, ServerRecord } from "../../shared/types/ipc";

interface ServerRow {
  id: string;
  name: string;
  address: string;
  port: number;
  icon_data: string | null;
  favorite: number;
  instance_id: string | null;
  created_at: string;
}

function rowToRecord(row: ServerRow): ServerRecord {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    port: row.port,
    iconData: row.icon_data,
    favorite: Boolean(row.favorite),
    instanceId: row.instance_id,
    createdAt: row.created_at,
  };
}

function validateAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed || trimmed.length > 253) {
    throw new Error("Server address cannot be empty.");
  }
  if (/[\s;|&`$<>]/.test(trimmed)) {
    throw new Error("Server address contains invalid characters.");
  }
  return trimmed;
}

export function listServers(instanceId?: string | null): ServerRecord[] {
  const db = getDb();
  const rows = (
    instanceId
      ? db
          .prepare("SELECT * FROM servers WHERE instance_id = ? OR instance_id IS NULL ORDER BY favorite DESC, name COLLATE NOCASE ASC")
          .all(instanceId)
      : db.prepare("SELECT * FROM servers ORDER BY favorite DESC, name COLLATE NOCASE ASC").all()
  ) as ServerRow[];
  return rows.map(rowToRecord);
}

export function addServer(input: ServerInput): ServerRecord {
  const name = input.name.trim().slice(0, 64) || "Minecraft Server";
  const address = validateAddress(input.address);
  const port = input.port ?? 25565;
  if (port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }

  const row: ServerRow = {
    id: randomUUID(),
    name,
    address,
    port,
    icon_data: input.iconData ?? null,
    favorite: 0,
    instance_id: input.instanceId ?? null,
    created_at: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `INSERT INTO servers (id, name, address, port, icon_data, favorite, instance_id, created_at)
       VALUES (@id, @name, @address, @port, @icon_data, @favorite, @instance_id, @created_at)`
    )
    .run(row);

  return rowToRecord(row);
}

export function updateServer(id: string, input: Partial<ServerInput>): ServerRecord {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as ServerRow | undefined;
  if (!existing) throw new Error("Server not found.");

  const row: ServerRow = {
    ...existing,
    name: (input.name?.trim() || existing.name).slice(0, 64),
    address: validateAddress(input.address ?? existing.address),
    port: input.port ?? existing.port,
    icon_data: input.iconData !== undefined ? input.iconData : existing.icon_data,
    instance_id: input.instanceId !== undefined ? input.instanceId : existing.instance_id,
    favorite: input.favorite !== undefined ? (input.favorite ? 1 : 0) : existing.favorite,
  };
  if (row.port < 1 || row.port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }

  db.prepare(
    `UPDATE servers SET name = @name, address = @address, port = @port, icon_data = @icon_data,
       favorite = @favorite, instance_id = @instance_id WHERE id = @id`
  ).run(row);

  return rowToRecord(row);
}

export function removeServer(id: string): void {
  getDb().prepare("DELETE FROM servers WHERE id = ?").run(id);
}

/** Finds a saved server whose address matches (case-insensitive), preferring an exact
 * port match and falling back to any address match. Used to turn a raw address seen in
 * the game log (or a `--server` launch arg) into the friendly name the user saved. */
export function findServerByAddress(address: string, port?: number): ServerRecord | undefined {
  const trimmed = address.trim().toLowerCase();
  if (!trimmed) return undefined;
  const candidates = listServers().filter((s) => s.address.trim().toLowerCase() === trimmed);
  if (candidates.length === 0) return undefined;
  if (port !== undefined) {
    return candidates.find((s) => s.port === port) ?? candidates[0];
  }
  return candidates[0];
}
