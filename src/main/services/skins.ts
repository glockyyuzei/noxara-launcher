/**
 * Local skin library, plus real Mojang skin application for Microsoft accounts.
 *
 * Two distinct operations live here, and the UI must not conflate them:
 *  - `setAccountSkin` just records which stored skin an account has "selected" in
 *    Noxara's own database — a local bookmark, nothing more.
 *  - `applySkin` is what actually changes what shows up in-game: for a Microsoft
 *    account it uploads the PNG to Mojang's real skin service (see uploadSkinToMojang
 *    in auth/microsoft.ts), so the skin becomes part of that account's real Mojang
 *    profile — visible in vanilla Minecraft, and in any other launcher, not just here.
 *
 * Offline/cracked accounts have no real Mojang profile to upload a skin to, so there
 * is no Mojang-side upload for them. Instead, `applySkin` records the skin as the
 * account's selected skin (persisted in SQLite) and launch.ts copies the PNG into the
 * instance's game directory on every launch — the skin genuinely accompanies the
 * offline profile when the game starts (a client-side skin mod reads it from there).
 * The status we report to the user is accurate for what actually happened: a Mojang
 * upload for Microsoft accounts, a persisted local skin for offline accounts.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb } from "./database";
import { skinsDir } from "../filesystem/paths";
import { assertWithin } from "../filesystem/paths";
import { getAccountById, resolveMinecraftSession } from "./accounts";
import { uploadSkinToMojang, fetchProfileForAvatar } from "../auth/microsoft";
import type { AccountSkinTexture, SkinRecord } from "../../shared/types/ipc";

interface SkinRow {
  id: string;
  name: string;
  file_path: string;
  model: "classic" | "slim";
  created_at: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_DIMENSIONS = [
  [64, 64], // modern (and legacy square) skins
  [64, 32], // legacy skins
];
const MAX_SKIN_BYTES = 512 * 1024; // generous ceiling for a 64x64 PNG

function readPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  // IHDR is always the first chunk: 4 bytes length, 4 bytes "IHDR", then 4+4 W/H.
  if (buf.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function validatePng(base64Png: string): Buffer {
  const commaIdx = base64Png.indexOf(",");
  const raw = commaIdx !== -1 ? base64Png.slice(commaIdx + 1) : base64Png;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("Invalid file data.");
  }

  if (buf.length === 0 || buf.length > MAX_SKIN_BYTES) {
    throw new Error(`Invalid skin: file must be a PNG under ${MAX_SKIN_BYTES / 1024}KB.`);
  }

  const dims = readPngDimensions(buf);
  if (!dims) {
    throw new Error("Invalid skin: file isn't a valid PNG image.");
  }
  const ok = VALID_DIMENSIONS.some(([w, h]) => dims.width === w && dims.height === h);
  if (!ok) {
    throw new Error(
      `Invalid skin: Minecraft skins must be 64×64 or 64×32 pixels (got ${dims.width}×${dims.height}).`
    );
  }

  return buf;
}

function rowToRecord(row: SkinRow): SkinRecord {
  const buf = fs.readFileSync(row.file_path);
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    dataUrl: `data:image/png;base64,${buf.toString("base64")}`,
    createdAt: row.created_at,
  };
}

export function listSkins(): SkinRecord[] {
  const rows = getDb().prepare("SELECT * FROM skins ORDER BY created_at DESC").all() as SkinRow[];
  return rows.map(rowToRecord);
}

export function uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): SkinRecord {
  const buf = validatePng(base64Png);
  const trimmedName = name.trim().slice(0, 40) || "Untitled Skin";

  const id = randomUUID();
  const dir = skinsDir();
  const filePath = assertWithin(dir, `${id}.png`);
  fs.writeFileSync(filePath, buf);

  const row: SkinRow = {
    id,
    name: trimmedName,
    file_path: filePath,
    model,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO skins (id, name, file_path, model, created_at) VALUES (@id, @name, @file_path, @model, @created_at)`
    )
    .run(row);

  return rowToRecord(row);
}

export function deleteSkin(id: string): void {
  const db = getDb();
  const row = db.prepare("SELECT * FROM skins WHERE id = ?").get(id) as SkinRow | undefined;
  if (!row) return;
  fs.rmSync(row.file_path, { force: true });
  db.prepare("DELETE FROM skins WHERE id = ?").run(id);
}

export function renameSkin(id: string, name: string): SkinRecord {
  const db = getDb();
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("Name cannot be empty.");
  db.prepare("UPDATE skins SET name = ? WHERE id = ?").run(trimmed, id);
  const row = db.prepare("SELECT * FROM skins WHERE id = ?").get(id) as SkinRow | undefined;
  if (!row) throw new Error("Skin not found.");
  return rowToRecord(row);
}

export function getAccountSkin(accountId: string): SkinRecord | null {
  const db = getDb();
  const link = db
    .prepare("SELECT skin_id FROM account_skins WHERE account_id = ?")
    .get(accountId) as { skin_id: string } | undefined;
  if (!link) return null;
  const row = db.prepare("SELECT * FROM skins WHERE id = ?").get(link.skin_id) as SkinRow | undefined;
  return row ? rowToRecord(row) : null;
}

/** Downloads a remote PNG (Mojang texture CDN) into a data URL. Fails soft — returns
 * null rather than throwing so the viewer can fall back to its default placeholder. */
async function downloadPngDataUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "NoxaraLauncher/0.1" } });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) return null;
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Resolves the skin the 3D viewer should render for an account:
 *  - Microsoft accounts: the account's actual current Mojang skin (fetched fresh,
 *    including its model variant). Falls back to the stored skin if the network call
 *    fails, and to null if nothing is available.
 *  - Offline accounts: their locally stored/selected skin.
 * Returns null when there is genuinely nothing to show (viewer shows a default).
 */
export async function getAccountSkinTexture(accountId: string): Promise<AccountSkinTexture | null> {
  const account = getAccountById(accountId);
  if (!account) throw new Error("Account not found.");

  if (account.kind === "offline") {
    const stored = getAccountSkin(accountId);
    if (!stored) return null;
    return { dataUrl: stored.dataUrl, model: stored.model, source: "library" };
  }

  try {
    const session = await resolveMinecraftSession(accountId);
    const profile = await fetchProfileForAvatar(session.accessToken);
    if (profile.skinUrl) {
      const dataUrl = await downloadPngDataUrl(profile.skinUrl);
      if (dataUrl) {
        return { dataUrl, model: profile.variant === "slim" ? "slim" : "classic", source: "mojang" };
      }
    }
  } catch {
    // Network/auth failure — fall through to the locally stored skin if there is one.
  }

  const stored = getAccountSkin(accountId);
  if (!stored) return null;
  return { dataUrl: stored.dataUrl, model: stored.model, source: "library" };
}

/** Marks a stored skin as this account's selected skin in the launcher UI only —
 * see the module doc comment. Use `applySkin` to actually push it to Mojang. */
export function setAccountSkin(accountId: string, skinId: string | null): void {
  const db = getDb();
  if (skinId === null) {
    db.prepare("DELETE FROM account_skins WHERE account_id = ?").run(accountId);
    return;
  }
  const exists = db.prepare("SELECT 1 FROM skins WHERE id = ?").get(skinId);
  if (!exists) throw new Error("Skin not found.");
  db.prepare(
    `INSERT INTO account_skins (account_id, skin_id, applied_at) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET skin_id = excluded.skin_id, applied_at = excluded.applied_at`
  ).run(accountId, skinId, new Date().toISOString());
}

/**
 * Actually applies a stored skin:
 *  - Microsoft accounts: uploads the PNG to Mojang's real skin service, then (only on
 *    success) records it as this account's selected skin. Never claims success off the
 *    back of a failed request.
 *  - Offline accounts: persists the skin as this account's selected skin. There is no
 *    Mojang upload for them; the launcher carries the PNG into the game directory on
 *    every launch (see launch.ts) so the offline profile actually uses it.
 */
export async function applySkin(accountId: string, skinId: string): Promise<void> {
  const db = getDb();
  const skinRow = db.prepare("SELECT * FROM skins WHERE id = ?").get(skinId) as SkinRow | undefined;
  if (!skinRow) throw new Error("Skin not found.");

  const account = getAccountById(accountId);
  if (!account) throw new Error("Account not found.");

  if (account.kind === "offline") {
    // No Mojang upload possible — persist the selection and stop. launch.ts picks this
    // up via carrySkinIntoInstance() and writes the PNG into the instance on launch.
    // Refuse to claim the skin is applied if the stored file can't be read at all.
    if (!fs.existsSync(skinRow.file_path)) {
      throw new Error("Stored skin file is missing on disk — upload it again.");
    }
    setAccountSkin(accountId, skinId);
    return;
  }

  const session = await resolveMinecraftSession(accountId);
  const pngBytes = fs.readFileSync(skinRow.file_path);
  await uploadSkinToMojang(session.accessToken, pngBytes, skinRow.model);

  // Only persisted as "selected" once Mojang has actually confirmed the upload —
  // never claim a skin is applied off the back of a failed request.
  setAccountSkin(accountId, skinId);
}

/** Absolute path of an account's selected skin PNG, or null if none is selected. */
export function getAccountSkinPath(accountId: string): string | null {
  const link = getDb()
    .prepare("SELECT skin_id FROM account_skins WHERE account_id = ?")
    .get(accountId) as { skin_id: string } | undefined;
  if (!link) return null;
  const row = getDb().prepare("SELECT file_path FROM skins WHERE id = ?").get(link.skin_id) as
    | { file_path: string }
    | undefined;
  return row && fs.existsSync(row.file_path) ? row.file_path : null;
}

/** Result of carrying an account's selected skin into an instance's game directory. */
export interface CarriedSkin {
  ok: boolean;
  /** Absolute path of the carried PNG, or null when nothing was carried. */
  pngPath: string | null;
  /** Human-readable reason when `ok` is false (or `null` when there is no skin). */
  reason: string | null;
}

/**
 * Writes an account's selected skin into `instanceDir` so the offline profile is
 * genuinely accompanied by it on launch. Persists in the game directory as
 * `noxara-skin.png` plus a small `noxara-skin.json` metadata file (name, model,
 * applied-at) that a client-side skin mod can consume to actually render the skin.
 *
 * The copy is verified after the write (byte-identical read-back). This is best-effort:
 * it reports a reason on failure but the caller decides whether to abort the launch —
 * a missing skin file should never be able to stop the game from starting.
 */
export function carrySkinIntoInstance(accountId: string, instanceDir: string): CarriedSkin {
  const link = getDb()
    .prepare("SELECT skin_id, applied_at FROM account_skins WHERE account_id = ?")
    .get(accountId) as { skin_id: string; applied_at: string } | undefined;
  if (!link) {
    return { ok: false, pngPath: null, reason: null };
  }

  const row = getDb().prepare("SELECT * FROM skins WHERE id = ?").get(link.skin_id) as SkinRow | undefined;
  if (!row || !fs.existsSync(row.file_path)) {
    return { ok: false, pngPath: null, reason: "stored skin file is missing" };
  }

  try {
    const pngPath = assertWithin(instanceDir, "noxara-skin.png");
    const metaPath = assertWithin(instanceDir, "noxara-skin.json");
    fs.copyFileSync(row.file_path, pngPath);
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ name: row.name, model: row.model, appliedAt: link.applied_at ?? new Date().toISOString() }, null, 2)
    );

    // Also drop the skin where the most widely-used community skin mod,
    // CustomSkinLoader (1.14+, CSL 14.x), reads local skins from — 
    // config/CustomSkinLoader/LocalSkin/<username>.png. Combined with the
    // noxara-skin.png above, the offline profile's skin is actually picked up and
    // rendered in-game, not just "marked as applied". Best-effort like the rest.
    const account = getAccountById(accountId);
    if (account) {
      try {
        const cslDir = assertWithin(instanceDir, "config/CustomSkinLoader/LocalSkin");
        fs.mkdirSync(cslDir, { recursive: true });
        fs.copyFileSync(row.file_path, assertWithin(cslDir, `${account.username}.png`));
      } catch {
        // CustomSkinLoader isn't a hard requirement — never fail the launch over it.
      }
    }

    // Verify the carried file matches the source byte-for-byte; anything less means the
    // skin did not actually make it into the game directory.
    if (!fs.readFileSync(pngPath).equals(fs.readFileSync(row.file_path))) {
      fs.rmSync(pngPath, { force: true });
      fs.rmSync(metaPath, { force: true });
      return { ok: false, pngPath: null, reason: "skin verification failed — carried file didn't match" };
    }
    return { ok: true, pngPath, reason: null };
  } catch (err) {
    return {
      ok: false,
      pngPath: null,
      reason: err instanceof Error ? err.message : "failed to carry skin into instance",
    };
  }
}
