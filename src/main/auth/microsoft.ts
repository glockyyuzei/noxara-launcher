/**
 * Real Microsoft account authentication for desktop apps, using the OAuth 2.0 device
 * authorization grant (no password ever touches this app — spec section 19).
 *
 * Flow: Microsoft (device code) -> Xbox Live -> XSTS -> Minecraft Services -> Profile.
 *
 * IMPORTANT — this requires a real Azure AD application registration:
 * Noxara Labs must register an app at https://portal.azure.com (Entra ID > App registrations)
 * as a "Public client / native" app with the Xbox Live sign-in permission, then set
 * NOXARA_MSA_CLIENT_ID below via environment/config. Without a real client ID, this code
 * is correct but cannot complete a login — there is no working substitute for that
 * credential, and this codebase does not fabricate one.
 */

const CLIENT_ID = process.env.NOXARA_MSA_CLIENT_ID ?? "";
const DEVICE_CODE_URL =
  "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";
const MC_ENTITLEMENT_URL = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_SKINS_URL = "https://api.minecraftservices.com/minecraft/profile/skins";

// Some of these endpoints sit behind bot-protection (Akamai/WAF) that silently
// 403s requests with no User-Agent header — Node's built-in fetch doesn't send one
// by default the way a browser does, unlike most Minecraft-launcher HTTP clients.
const COMMON_HEADERS = { "User-Agent": "NoxaraLauncher/0.1 (+https://noxara.dev)" };

/** Reads and truncates a response body for error messages — safe to include since
 * it's Microsoft's own response, never anything we sent (no tokens in here). */
async function safeBodySnippet(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    return text.slice(0, 300);
  } catch {
    return "";
  }
}

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

export interface MinecraftSession {
  minecraftAccessToken: string;
  minecraftUuid: string;
  minecraftUsername: string;
  /** Microsoft refresh token, to be stored in the OS credential store only. */
  msaRefreshToken: string;
  expiresAt: number; // epoch ms
}

function assertConfigured(): void {
  if (!CLIENT_ID) {
    throw new Error(
      "Microsoft sign-in is not configured: set NOXARA_MSA_CLIENT_ID to a real Azure AD " +
        "public client application ID registered by Noxara Labs before enabling this feature."
    );
  }
}

export async function requestDeviceCode(): Promise<DeviceCodeInfo> {
  assertConfigured();
  const resp = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...COMMON_HEADERS },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: "XboxLive.signin offline_access",
    }),
  });
  if (!resp.ok) throw new Error(`Failed to start device code flow: ${resp.status} ${await safeBodySnippet(resp)}`);
  const data = (await resp.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresInSeconds: data.expires_in,
    pollIntervalSeconds: data.interval,
  };
}

/** Polls the token endpoint until the user completes sign-in in their browser. */
export async function pollForToken(
  deviceCode: string,
  intervalSeconds: number,
  expiresInSeconds: number
): Promise<{ accessToken: string; refreshToken: string }> {
  assertConfigured();
  const deadline = Date.now() + expiresInSeconds * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalSeconds * 1000));

    const resp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...COMMON_HEADERS },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: deviceCode,
      }),
    });
    const data = (await resp.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };

    if (resp.ok && data.access_token && data.refresh_token) {
      return { accessToken: data.access_token, refreshToken: data.refresh_token };
    }
    if (data.error && data.error !== "authorization_pending") {
      throw new Error(`Microsoft sign-in failed: ${data.error}`);
    }
    // authorization_pending -> keep polling
  }
  throw new Error("Device code expired before sign-in completed");
}

async function xboxLiveAuth(msaAccessToken: string): Promise<{ token: string; userHash: string }> {
  const resp = await fetch(XBL_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...COMMON_HEADERS },
    body: JSON.stringify({
      Properties: {
        AuthMethod: "RPS",
        SiteName: "user.auth.xboxlive.com",
        RpsTicket: `d=${msaAccessToken}`,
      },
      RelyingParty: "http://auth.xboxlive.com",
      TokenType: "JWT",
    }),
  });
  if (!resp.ok) throw new Error(`Xbox Live authentication failed: ${resp.status} ${await safeBodySnippet(resp)}`);
  const data = (await resp.json()) as { Token: string; DisplayClaims: { xui: { uhs: string }[] } };
  return { token: data.Token, userHash: data.DisplayClaims.xui[0].uhs };
}

async function xstsAuth(xblToken: string): Promise<{ token: string; userHash: string }> {
  const resp = await fetch(XSTS_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...COMMON_HEADERS },
    body: JSON.stringify({
      Properties: { SandboxId: "RETAIL", UserTokens: [xblToken] },
      RelyingParty: "rp://api.minecraftservices.com/",
      TokenType: "JWT",
    }),
  });
  if (resp.status === 401) {
    const data = (await resp.json()) as { XErr?: number };
    if (data.XErr === 2148916233) throw new Error("This Microsoft account has no Xbox profile.");
    if (data.XErr === 2148916238) throw new Error("This account is a child account and needs adult supervision approval.");
    throw new Error("Xbox Live rejected this account for Minecraft.");
  }
  if (!resp.ok) throw new Error(`XSTS authorization failed: ${resp.status} ${await safeBodySnippet(resp)}`);
  const data = (await resp.json()) as { Token: string; DisplayClaims: { xui: { uhs: string }[] } };
  return { token: data.Token, userHash: data.DisplayClaims.xui[0].uhs };
}

async function loginToMinecraft(xstsToken: string, userHash: string): Promise<{ accessToken: string; expiresIn: number }> {
  const resp = await fetch(MC_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...COMMON_HEADERS },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
  });
  if (!resp.ok) throw new Error(`Minecraft authentication failed: ${resp.status} ${await safeBodySnippet(resp)}`);
  const data = (await resp.json()) as { access_token: string; expires_in: number };
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

async function verifyOwnership(mcAccessToken: string): Promise<void> {
  const resp = await fetch(MC_ENTITLEMENT_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}`, ...COMMON_HEADERS },
  });
  if (!resp.ok) throw new Error(`Unable to verify Minecraft ownership: ${resp.status} ${await safeBodySnippet(resp)}`);
  const data = (await resp.json()) as { items?: unknown[] };
  if (!data.items || data.items.length === 0) {
    throw new Error("This Microsoft account does not own Minecraft: Java Edition");
  }
}

async function fetchProfile(mcAccessToken: string): Promise<{ id: string; name: string; skinUrl: string | null }> {
  const resp = await fetch(MC_PROFILE_URL, {
    headers: { Authorization: `Bearer ${mcAccessToken}`, ...COMMON_HEADERS },
  });
  if (resp.status === 404) throw new Error("This account does not have a Minecraft profile yet.");
  if (!resp.ok) throw new Error(`Failed to load Minecraft profile: ${resp.status} ${await safeBodySnippet(resp)}`);
  const data = (await resp.json()) as {
    id: string;
    name: string;
    skins?: Array<{ state?: string; url?: string; textureUrl?: string; variant?: string }>;
  };
  // Prefer the currently-active skin; Mojang's profile endpoint returns the hosted
  // texture URLs ("textureUrl") which are stable CDN links (they do not expire).
  const skin = (data.skins ?? []).find((s) => s.state === "ACTIVE") ?? data.skins?.[0];
  return { id: data.id, name: data.name, skinUrl: skin?.textureUrl ?? skin?.url ?? null };
}

/** Fetches just the Minecraft profile's identity + active skin texture URL. Used by the
 * avatar pipeline to build a stable, locally-embedded avatar (see services/avatar.ts). */
export async function fetchProfileForAvatar(mcAccessToken: string): Promise<{ id: string; name: string; skinUrl: string | null }> {
  return fetchProfile(mcAccessToken);
}

/** Runs the full chain after MSA tokens are obtained. Never logs any token value. */
export async function completeMinecraftLogin(msaAccessToken: string, msaRefreshToken: string): Promise<MinecraftSession> {
  const xbl = await xboxLiveAuth(msaAccessToken);
  const xsts = await xstsAuth(xbl.token);
  const mc = await loginToMinecraft(xsts.token, xsts.userHash);
  await verifyOwnership(mc.accessToken);
  const profile = await fetchProfile(mc.accessToken);

  return {
    minecraftAccessToken: mc.accessToken,
    minecraftUuid: profile.id,
    minecraftUsername: profile.name,
    msaRefreshToken,
    expiresAt: Date.now() + mc.expiresIn * 1000,
  };
}

export async function refreshMsaToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
  assertConfigured();
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...COMMON_HEADERS },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
      scope: "XboxLive.signin offline_access",
    }),
  });
  if (!resp.ok) throw new Error("Failed to refresh Microsoft session; please sign in again.");
  const data = (await resp.json()) as { access_token: string; refresh_token: string };
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

/**
 * Uploads a local skin PNG to Mojang's real skin service so it becomes this account's
 * actual in-game skin — visible in vanilla Minecraft and any other launcher, not just
 * Noxara, because it's now stored on the account's Mojang profile rather than anything
 * client-local. This is the multipart endpoint the official launcher itself uses for
 * uploading a skin file directly (as opposed to the JSON+URL variant, which requires
 * the skin to already be hosted somewhere public).
 */
export async function uploadSkinToMojang(
  mcAccessToken: string,
  pngBytes: Buffer,
  variant: "classic" | "slim"
): Promise<void> {
  const form = new FormData();
  form.append("variant", variant);
  // Buffer's backing ArrayBufferLike can be typed as SharedArrayBuffer, which BlobPart
  // doesn't accept — copying into a fresh Uint8Array gives it its own plain ArrayBuffer.
  form.append("file", new Blob([new Uint8Array(pngBytes)], { type: "image/png" }), "skin.png");

  const resp = await fetch(MC_SKINS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${mcAccessToken}`, ...COMMON_HEADERS },
    body: form,
  });
  if (!resp.ok) {
    const snippet = await safeBodySnippet(resp);
    throw new Error(`Mojang rejected the skin upload (${resp.status}): ${snippet || "no additional details returned"}`);
  }
}
