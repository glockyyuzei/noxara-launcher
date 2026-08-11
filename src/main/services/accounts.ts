/**
 * Account persistence. Non-secret metadata (username, uuid, kind) lives in SQLite;
 * Microsoft refresh tokens live ONLY in the OS credential store via keytar, keyed by
 * account id — never in SQLite, never logged (spec sections 19, 52, 54).
 */
import { randomUUID } from "node:crypto";
import * as keytar from "keytar";
import { getDb } from "./database";
import type { AccountRecord } from "../../shared/types/ipc";

const KEYTAR_SERVICE = "NoxaraLauncher";

interface AccountRow {
  id: string;
  kind: "microsoft" | "offline";
  username: string;
  uuid: string;
  avatar_url: string | null;
  is_active: number;
  created_at: string;
}

function rowToRecord(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    kind: row.kind,
    username: row.username,
    uuid: row.uuid,
    avatarUrl: row.avatar_url,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

export function listAccounts(): AccountRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM accounts ORDER BY is_active DESC, created_at ASC")
    .all() as AccountRow[];
  return rows.map(rowToRecord);
}

/** Deterministic offline UUID derived the way vanilla offline mode does: from "OfflinePlayer:<name>". */
function offlineUuidFor(username: string): string {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${username}`).digest();
  // Set version (3) and variant bits per RFC 4122 to match vanilla's offline UUID derivation.
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createOfflineProfile(username: string): AccountRecord {
  const trimmed = username.trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(trimmed)) {
    throw new Error("Offline usernames must be 3-16 characters: letters, numbers, underscore.");
  }

  const db = getDb();
  const id = randomUUID();
  const row: AccountRow = {
    id,
    kind: "offline",
    username: trimmed,
    uuid: offlineUuidFor(trimmed),
    avatar_url: null,
    is_active: 0,
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO accounts (id, kind, username, uuid, avatar_url, is_active, created_at)
     VALUES (@id, @kind, @username, @uuid, @avatar_url, @is_active, @created_at)`
  ).run(row);

  if (listAccounts().length === 1) {
    setActiveAccount(id);
  }
  return rowToRecord(row);
}

/** Stores a freshly-authenticated Microsoft account. Called after auth/microsoft.ts succeeds. */
export async function saveMicrosoftAccount(
  username: string,
  uuid: string,
  msaRefreshToken: string
): Promise<AccountRecord> {
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM accounts WHERE kind = 'microsoft' AND uuid = ?")
    .get(uuid) as AccountRow | undefined;

  const id = existing?.id ?? randomUUID();
  const row: AccountRow = {
    id,
    kind: "microsoft",
    username,
    uuid,
    avatar_url: `https://crafatar.com/avatars/${uuid}`,
    is_active: existing?.is_active ?? 0,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO accounts (id, kind, username, uuid, avatar_url, is_active, created_at)
     VALUES (@id, @kind, @username, @uuid, @avatar_url, @is_active, @created_at)
     ON CONFLICT(id) DO UPDATE SET username = @username, avatar_url = @avatar_url`
  ).run(row);

  await keytar.setPassword(KEYTAR_SERVICE, id, msaRefreshToken);

  if (listAccounts().length === 1) {
    setActiveAccount(id);
  }
  return rowToRecord(row);
}

export async function getMicrosoftRefreshToken(accountId: string): Promise<string | null> {
  return keytar.getPassword(KEYTAR_SERVICE, accountId);
}

export function setActiveAccount(id: string): void {
  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM accounts WHERE id = ?").get(id);
  if (!exists) throw new Error(`account ${id} not found`);
  const tx = db.transaction(() => {
    db.prepare("UPDATE accounts SET is_active = 0").run();
    db.prepare("UPDATE accounts SET is_active = 1 WHERE id = ?").run(id);
  });
  tx();
}

export async function removeAccount(id: string): Promise<void> {
  const db = getDb();
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  await keytar.deletePassword(KEYTAR_SERVICE, id).catch(() => undefined);
}

export function getActiveAccount(): AccountRecord | null {
  const row = getDb().prepare("SELECT * FROM accounts WHERE is_active = 1").get() as
    | AccountRow
    | undefined;
  return row ? rowToRecord(row) : null;
}
