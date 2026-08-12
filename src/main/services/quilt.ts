/**
 * Quilt Loader metadata, proxied through noxara-core's `quilt.*` RPC methods.
 *
 * Mirrors fabric.ts exactly: transient failures are retried with backoff on top of
 * Rust's own internal retries, successfully-fetched loader lists are cached in-memory
 * per Minecraft version with a TTL, and permanent failures (e.g. an unrecognized
 * Minecraft version) surface a truthful, non-retried error.
 */
import { coreBridge, type CoreBridgeError } from "./core-bridge";

export interface QuiltLoaderVersion {
  version: string;
  stable: boolean;
  build: number | null;
  maven: string;
  separator?: string | null;
}

const LOADER_VERSIONS_TTL_MS = 10 * 60 * 1000;
const QUILT_FETCH_TIMEOUT_MS = 60_000;
const QUILT_DETAIL_TIMEOUT_MS = 90_000;

const loaderVersionsCache = new Map<string, { fetchedAt: number; versions: QuiltLoaderVersion[] }>();

const TRANSIENT_CODES = new Set([
  "timeout",
  "network_error",
  "request_error",
  "quilt.network_error",
  "quilt.bad_response",
]);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as CoreBridgeError).code;
  if (code) return TRANSIENT_CODES.has(code);
  return /timed out|timeout|econnreset|econnrefused|temporary failure|failed to reach|network/i.test(err.message);
}

async function callWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isTransientError(err)) break;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Quilt metadata request failed");
}

export function quiltUnsupportedError(gameVersion: string): Error {
  return new Error(
    `Quilt does not support Minecraft ${gameVersion}. ` +
      `This Minecraft version cannot be launched with the Quilt Loader.`
  );
}

function isLoaderSupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as CoreBridgeError).code;
  return code === "quilt.bad_request" || code === "quilt.unsupported";
}

export async function getQuiltLoaderVersions(
  gameVersion: string,
  opts?: { forceRefresh?: boolean }
): Promise<QuiltLoaderVersion[]> {
  const cached = loaderVersionsCache.get(gameVersion);
  if (!opts?.forceRefresh && cached && Date.now() - cached.fetchedAt < LOADER_VERSIONS_TTL_MS) {
    return cached.versions;
  }

  try {
    const versions = await callWithRetry(() =>
      coreBridge.call<QuiltLoaderVersion[]>("quilt.getLoaderVersions", { gameVersion }, QUILT_FETCH_TIMEOUT_MS)
    );
    loaderVersionsCache.set(gameVersion, { fetchedAt: Date.now(), versions });
    return versions;
  } catch (err) {
    if (isLoaderSupportedError(err)) {
      throw quiltUnsupportedError(gameVersion);
    }
    throw err;
  }
}

/** Picks the newest stable loader build, falling back to the newest build of any
 * stability. Returns null when no loader builds exist at all for this version. */
export function pickLatestQuiltLoaderVersion(versions: QuiltLoaderVersion[]): string | null {
  if (versions.length === 0) return null;
  const stable = versions.find((v) => v.stable);
  return (stable ?? versions[0]).version;
}

/** Resolves and validates a specific loader version for an instance, mirroring the
 * Fabric flow. Throws a truthful error on unsupported versions or unlisted builds. */
export async function resolveQuiltLoaderVersion(gameVersion: string, requested: string | null | undefined): Promise<string> {
  const versions = await getQuiltLoaderVersions(gameVersion);
  if (versions.length === 0) throw quiltUnsupportedError(gameVersion);

  const resolved = requested && requested !== "latest" ? requested : pickLatestQuiltLoaderVersion(versions);
  if (!resolved) throw quiltUnsupportedError(gameVersion);

  if (requested && requested !== "latest" && !versions.some((v) => v.version === requested)) {
    throw new Error(
      `Quilt Loader ${requested} is not a published build for Minecraft ${gameVersion}. ` +
        `Select one of the loader versions listed for this Minecraft version.`
    );
  }
  return resolved;
}

export function getQuiltVersionDetail(gameVersion: string, loaderVersion: string) {
  return callWithRetry(() =>
    coreBridge.call<{ detail: any; recommendedJavaMajor: number }>(
      "quilt.getVersionDetail",
      { gameVersion, loaderVersion },
      QUILT_DETAIL_TIMEOUT_MS
    )
  );
}