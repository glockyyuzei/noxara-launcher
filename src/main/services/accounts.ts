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

export function getAccountById(id: string): AccountRecord | null {
  const row = getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  return row ? rowToRecord(row) : null;
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

/**
 * Stores a freshly-authenticated Microsoft account. Called after auth/microsoft.ts succeeds.
 *
 * The avatar is embedded as a `data:` URL (cropped head from the account's real skin)
 * rather than a hot link to a third-party host — third-party avatar URLs can be
 * unreachable or change, which used to surface as broken images in the account card.
 * Only if both the skin and the fallback service fail does the account end up with no
 * avatar (the UI renders a clean initial-based fallback instead of a broken image).
 */
export async function saveMicrosoftAccount(
  username: string,
  uuid: string,
  msaRefreshToken: string,
  mcAccessToken?: string
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
    avatar_url: null,
    is_active: existing?.is_active ?? 0,
    created_at: existing?.created_at ?? new Date().toISOString(),
  };

  db.prepare(
    `INSERT INTO accounts (id, kind, username, uuid, avatar_url, is_active, created_at)
     VALUES (@id, @kind, @username, @uuid, @avatar_url, @is_active, @created_at)
     ON CONFLICT(id) DO UPDATE SET username = @username, avatar_url = @avatar_url`
  ).run(row);

  // Build + persist the embedded avatar. Failures here are non-fatal: the account is
  // already saved and a later "Refresh profile" can repopulate the avatar.
  if (mcAccessToken) {
    const avatarUrl = await resolveAccountAvatar(mcAccessToken, uuid);
    if (avatarUrl) {
      db.prepare("UPDATE accounts SET avatar_url = ? WHERE id = ?").run(avatarUrl, id);
      row.avatar_url = avatarUrl;
    }
  }

  await keytar.setPassword(KEYTAR_SERVICE, id, msaRefreshToken);

  if (listAccounts().length === 1) {
    setActiveAccount(id);
  }
  return rowToRecord(row);
}

/** Builds an embedded avatar data URL via the avatar pipeline (skin head, then crafatar). */
async function resolveAccountAvatar(mcAccessToken: string, uuid: string): Promise<string | null> {
  try {
    const { resolveAvatarDataUrl } = await import("./avatar");
    return await resolveAvatarDataUrl(mcAccessToken, uuid);
  } catch (err) {
    console.warn("[accounts] avatar resolution failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Re-fetches a Microsoft account's profile (gamertag, UUID, avatar) using a freshly
 * refreshed session, then persists and returns the up-to-date record. Offline accounts
 * have no remote profile to refresh and are returned unchanged.
 */
export async function refreshAccountProfile(accountId: string): Promise<AccountRecord> {
  const account = getAccountById(accountId);
  if (!account) throw new Error("Account not found.");
  if (account.kind === "offline") return account;

  // resolveMinecraftSession refreshes MSA -> Xbox -> XSTS -> Minecraft tokens and
  // persists the rotated refresh token, giving us a live Minecraft access token.
  const session = await resolveMinecraftSession(accountId);

  // The freshly-derived Minecraft profile is authoritative for name + avatar.
  const { fetchProfileForAvatar } = await import("../auth/microsoft");
  const profile = await fetchProfileForAvatar(session.accessToken);
  const avatarUrl = await resolveAccountAvatar(session.accessToken, profile.id);

  const db = getDb();
  db.prepare("UPDATE accounts SET username = ?, uuid = ?, avatar_url = ? WHERE id = ?").run(
    profile.name,
    profile.id,
    avatarUrl,
    accountId
  );

  return getAccountById(accountId) ?? account;
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

export interface ResolvedMinecraftSession {
  username: string;
  uuid: string;
  /** Empty string for offline accounts — vanilla's offline mode expects no token. */
  accessToken: string;
  userType: "msa" | "legacy";
}

/**
 * Gets a launch/API-ready Minecraft session for an account: for offline profiles this
 * is just the stored local identity; for Microsoft accounts it refreshes the MSA
 * session and walks it through Xbox Live -> XSTS -> Minecraft Services to produce a
 * live access token.
 *
 * This is the single place that logic lives — both launching the game (launch.ts) and
 * anything else that needs to call an authenticated Mojang API on the user's behalf
 * (e.g. uploading a skin) should go through this rather than re-deriving it.
 *
 * Also fixes a real bug in the code this replaced: Microsoft rotates the refresh token
 * on every use, and the previous inline version never persisted the newly-issued one —
 * only the original token from initial sign-in ever got saved. Depending on Microsoft's
 * rotation/revocation policy for the app registration, that can silently break
 * Microsoft sign-in after the first refresh, forcing a full re-login. We persist the
 * rotated token here so that doesn't happen.
 */
export async function resolveMinecraftSession(accountId: string): Promise<ResolvedMinecraftSession> {
  const account = getAccountById(accountId);
  if (!account) throw new Error("Account not found.");

  if (account.kind === "offline") {
    return { username: account.username, uuid: account.uuid, accessToken: "", userType: "legacy" };
  }

  const refreshToken = await getMicrosoftRefreshToken(account.id);
  if (!refreshToken) {
    throw new Error("Microsoft session is missing; please sign in again.");
  }

  // Imported lazily to avoid a require cycle: auth/microsoft.ts has no reason to know
  // about the accounts service, but the accounts service needs its token-exchange chain.
  const { refreshMsaToken, completeMinecraftLogin } = await import("../auth/microsoft");

  const refreshed = await refreshMsaToken(refreshToken);
  const session = await completeMinecraftLogin(refreshed.accessToken, refreshed.refreshToken);

  // Persist Microsoft's newly-rotated refresh token — see doc comment above.
  await keytar.setPassword(KEYTAR_SERVICE, account.id, refreshed.refreshToken);

  return {
    username: account.username,
    uuid: session.minecraftUuid,
    accessToken: session.minecraftAccessToken,
    userType: "msa",
  };
}
