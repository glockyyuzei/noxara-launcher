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
 * Offline/cracked accounts have no real Mojang profile to upload a skin to. Vanilla
 * Minecraft fetches skins from Mojang's authenticated session server, and there's no
 * legitimate client-side hook for "load this local PNG instead" without either a
 * client-side mod or a local server impersonating Mojang's skin API — the kind of
 * authentication-adjacent spoofing this project has explicitly decided not to build.
 * `applySkin` reflects that honestly: it throws a clear, specific error for offline
 * accounts rather than pretending the skin was applied.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getDb } from "./database";
import { skinsDir } from "../filesystem/paths";
import { assertWithin } from "../filesystem/paths";
import { getAccountById, resolveMinecraftSession } from "./accounts";
import { uploadSkinToMojang } from "../auth/microsoft";
import type { SkinRecord } from "../../shared/types/ipc";

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
 * Actually applies a stored skin in-game: uploads it to Mojang's real skin service for
 * Microsoft accounts, then (only on success) records it as this account's selected
 * skin. Throws — rather than silently no-op'ing — for offline accounts, since there is
 * no real operation to perform for them; the caller/UI must surface that honestly
 * instead of showing "Applied".
 */
export async function applySkin(accountId: string, skinId: string): Promise<void> {
  const db = getDb();
  const skinRow = db.prepare("SELECT * FROM skins WHERE id = ?").get(skinId) as SkinRow | undefined;
  if (!skinRow) throw new Error("Skin not found.");

  const account = getAccountById(accountId);
  if (!account) throw new Error("Account not found.");

  if (account.kind === "offline") {
    throw new Error(
      "Offline profiles can't have a real in-game skin — Mojang's skin service only works for a " +
        "signed-in Microsoft account. Sign in with Microsoft, then apply the skin to that account."
    );
  }

  const session = await resolveMinecraftSession(accountId);
  const pngBytes = fs.readFileSync(skinRow.file_path);
  await uploadSkinToMojang(session.accessToken, pngBytes, skinRow.model);

  // Only persisted as "selected" once Mojang has actually confirmed the upload —
  // never claim a skin is applied off the back of a failed request.
  setAccountSkin(accountId, skinId);
}
