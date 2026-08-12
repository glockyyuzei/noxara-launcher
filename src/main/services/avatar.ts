/**
 * Renders a self-contained Microsoft account avatar.
 *
 * Why this exists: the launcher used to store a bare `https://crafatar.com/avatars/<uuid>`
 * URL on the account row. That couples the UI to a third-party site being reachable at
 * that exact moment, produces ugly broken-image states when it isn't, and offers no
 * fallback. Instead we build a small PNG (the 8x8 head square cropped from the
 * account's actual Minecraft skin, upscaled to a crisp face) and embed it as a
 * `data:` URL in the database — offline-safe, never expires, no broken <img>.
 *
 * If the skin can't be fetched (no skin, network hiccup, API rejects), we degrade to
 * the crafatar UUID avatar as a second source, also embedded. Only if both fail do we
 * return null, letting the UI render a clean initial-based fallback.
 */
import { nativeImage } from "electron";

/** Crops the front face of the head from a Minecraft skin texture and upscales it to a
 * displayable square. Mojang textures are 64x64; the head's front face lives in the
 * 8x8 block at (8,8). Coordinates scale proportionally for unusual texture sizes. */
function cropHeadFromSkin(png: Buffer): Buffer | null {
  try {
    const img = nativeImage.createFromBuffer(png);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (width < 8 || height < 8) return null;

    const scale = width / 64;
    const rect = {
      x: Math.round(8 * scale),
      y: Math.round(8 * scale),
      width: Math.round(8 * scale),
      height: Math.round(8 * scale),
    };
    const face = img.crop(rect);
    if (face.isEmpty()) return null;
    const sized = face.resize({ width: 96, height: 96 });
    if (sized.isEmpty()) return null;
    return sized.toPNG();
  } catch {
    return null;
  }
}

async function downloadBuffer(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "NoxaraLauncher/0.1 (+https://noxara.dev)" },
    });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

function asDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Builds a stable, embedded avatar data URL for a Microsoft account.
 * Prefers the account's current Minecraft skin; falls back to crafatar; returns null
 * only when both sources are unavailable (UI then shows the initial-based fallback). */
export async function resolveAvatarDataUrl(mcAccessToken: string, uuid: string): Promise<string | null> {
  // 1) The account's real Minecraft skin (cropped head).
  try {
    const { fetchProfileForAvatar } = await import("../auth/microsoft");
    const profile = await fetchProfileForAvatar(mcAccessToken);
    if (profile.skinUrl) {
      const png = await downloadBuffer(profile.skinUrl);
      if (png) {
        const head = cropHeadFromSkin(png);
        if (head) return asDataUrl(head);
      }
    }
  } catch {
    // fall through to crafatar
  }

  // 2) crafatar's UUID avatar — embedded too, so an outage after sign-in can't break it.
  try {
    const png = await downloadBuffer(`https://crafatar.com/avatars/${uuid}?size=96`);
    if (png) {
      const img = nativeImage.createFromBuffer(png);
      if (!img.isEmpty()) {
        const sized = img.resize({ width: 96, height: 96 });
        return asDataUrl(sized.isEmpty() ? png : sized.toPNG());
      }
      return asDataUrl(png);
    }
  } catch {
    // fall through
  }

  return null;
}