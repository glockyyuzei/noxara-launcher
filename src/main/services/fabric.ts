/**
 * Fabric Loader metadata, proxied through noxara-core's `fabric.*` RPC methods.
 *
 * Reliability philosophy (mirrors native/rust/src/fabric.rs):
 *   * managed error codes from Rust — `fabric.network_error` (transient, retry),
 *     `fabric.bad_request` (bad/unrecognized version — NOT retried), timeouts
 *   * transient failures are retried here with a short backoff on top of Rust's own
 *     internal retries, so one flaky meta-API request can never permanently break
 *     instance creation
 *   * successfully-fetched loader lists are cached in-memory per Minecraft version
 *     with a TTL, so re-opening the wizard or resolving "latest" reuses real data
 *     instead of hammering Fabric's API
 */
import { coreBridge, type CoreBridgeError } from "./core-bridge";
import { logger } from "./logger";

export interface FabricLoaderVersion {
  version: string;
  stable: boolean;
  build: number | null;
  maven: string;
  separator?: string | null;
}

/** TTL for the in-memory loader-version cache. Loader builds for a given Minecraft
 * version change a few times a month at most, so 10 minutes is plenty fresh while
 * keeping the API quiet. */
const LOADER_VERSIONS_TTL_MS = 10 * 60 * 1000;

/** Sensible upper bound for a single loader-list fetch. The Rust side gives each
 * request its own 30s timeout and retries internally, so 60s here is generous without
 * being "wait forever". */
const FABRIC_FETCH_TIMEOUT_MS = 60_000;

/** The version-detail chain performs several dependent HTTP fetches against both
 * Mojang and Fabric metadata — give one attempt real headroom on a cold cache, and
 * rely on retry rather than a sky-high single timeout. */
const FABRIC_DETAIL_TIMEOUT_MS = 90_000;

const loaderVersionsCache = new Map<string, { fetchedAt: number; versions: FabricLoaderVersion[] }>();

const TRANSIENT_CODES = new Set([
  "timeout",
  "network_error",
  "request_error",
  "fabric.network_error",
  "fabric.bad_response",
]);

function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as CoreBridgeError).code;
  if (code) return TRANSIENT_CODES.has(code);
  // Fallback for errors that predate error codes: match on the message shape.
  return /timed out|timeout|econnreset|econnrefused|temporary failure|failed to reach|network/i.test(err.message);
}

/** Retries a noxara-core call while the failure looks transient (timeout/network).
 * Permanent errors (e.g. `fabric.bad_request` = version not Fabric-supported) fail
 * immediately with the precise message intact. */
async function callWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isTransientError(err)) break;
      logger.warn("[fabric] transient failure", { attempt, attempts, error: (err as Error).message });
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Fabric metadata request failed");
}

/** A clear, truthful error when Fabric itself says this version has no loader builds. */
export function fabricUnsupportedError(gameVersion: string): Error {
  return new Error(
    `Fabric does not support Minecraft ${gameVersion}. ` +
      `This Minecraft version cannot be launched with the Fabric Loader.`
  );
}

function isLoaderSupportedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as CoreBridgeError).code;
  return code === "fabric.bad_request" || code === "fabric.unsupported";
}

export async function getFabricLoaderVersions(
  gameVersion: string,
  opts?: { forceRefresh?: boolean }
): Promise<FabricLoaderVersion[]> {
  const cached = loaderVersionsCache.get(gameVersion);
  if (!opts?.forceRefresh && cached && Date.now() - cached.fetchedAt < LOADER_VERSIONS_TTL_MS) {
    return cached.versions;
  }

  try {
    const versions = await callWithRetry(() =>
      coreBridge.call<FabricLoaderVersion[]>("fabric.getLoaderVersions", { gameVersion }, FABRIC_FETCH_TIMEOUT_MS)
    );
    loaderVersionsCache.set(gameVersion, { fetchedAt: Date.now(), versions });
    return versions;
  } catch (err) {
    if (isLoaderSupportedError(err)) {
      throw fabricUnsupportedError(gameVersion);
    }
    throw err;
  }
}

/** Picks the newest stable loader build, falling back to the newest build of any
 * stability if no stable release exists yet for this Minecraft version. Returns null
 * when no loader builds exist at all. */
export function pickLatestFabricLoaderVersion(versions: FabricLoaderVersion[]): string | null {
  if (versions.length === 0) return null;
  const stable = versions.find((v) => v.stable);
  return (stable ?? versions[0]).version;
}

/** Resolves and validates a specific loader version for an instance, mirroring how the
 * Forge flow pins down a real published build. Throws a truthful error when the
 * requested Minecraft version is Fabric-unsupported or when the given loader build
 * isn't actually published for it. */
export async function resolveFabricLoaderVersion(gameVersion: string, requested: string | null | undefined): Promise<string> {
  const versions = await getFabricLoaderVersions(gameVersion);
  if (versions.length === 0) throw fabricUnsupportedError(gameVersion);

  const resolved = requested && requested !== "latest" ? requested : pickLatestFabricLoaderVersion(versions);
  if (!resolved) throw fabricUnsupportedError(gameVersion);

  if (requested && requested !== "latest" && !versions.some((v) => v.version === requested)) {
    throw new Error(
      `Fabric Loader ${requested} is not a published build for Minecraft ${gameVersion}. ` +
        `Select one of the loader versions listed for this Minecraft version.`
    );
  }
  return resolved;
}

/** Picks the newest stable loader build for a Minecraft version (legacy entry point). */
export async function getLatestFabricLoaderVersion(gameVersion: string): Promise<string> {
  return resolveFabricLoaderVersion(gameVersion, "latest");
}

export function getFabricVersionDetail(gameVersion: string, loaderVersion: string) {
  return callWithRetry(() =>
    coreBridge.call<{ detail: any; recommendedJavaMajor: number }>(
      "fabric.getVersionDetail",
      { gameVersion, loaderVersion },
      FABRIC_DETAIL_TIMEOUT_MS
    )
  );
}