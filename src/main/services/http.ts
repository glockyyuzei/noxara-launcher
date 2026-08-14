/**
 * Shared outbound-HTTP helpers for the main process.
 *
 * Every network call the launcher makes (Modrinth, Mojang, Microsoft, skin CDNs,
 * downloads) should go through these instead of a bare `fetch`, so that:
 *   - no request can hang forever (a per-request timeout aborts the socket), and
 *   - transient failures (429 rate limits, 5xx, network hiccups) are retried with
 *     backoff instead of failing the user's action outright, and
 *   - every request carries a consistent, contactable User-Agent (many of these
 *     hosts — Akamai-protected Mojang endpoints, Modrinth's CDN — behave differently
 *     or reject requests without one).
 *
 * `AbortSignal.any`/`timeout` are available on Node 20+ (Electron 32 ships Node 20).
 */

/**
 * Single User-Agent for every outbound request. The contact URL is deliberate: hosts
 * that rate-limit or block launcher traffic can reach out instead of banning. Never
 * includes tokens or any account data.
 */
export const NOXARA_USER_AGENT = "NoxaraLauncher/0.1 (+https://noxara.dev)";

/** Default ceiling for one HTTP attempt before we abort it. Downloads can be slower
 * than API calls, so the per-caller default varies; callers pass what fits. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Statuses treated as temporary. 429 is retried honoring Retry-After; 5xx and 408
 * are always retried. Everything else (4xx) is considered permanent and returned
 * immediately so the caller can surface the real error. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface FetchRetryOptions {
  /** Overall cap for a single attempt (ms). */
  timeoutMs?: number;
  /** Max attempts including the first (default 3). */
  maxAttempts?: number;
  /** Base delay between attempts (ms); doubles each retry (default 1000). */
  baseDelayMs?: number;
  /** Extra signal (e.g. a user-cancellation AbortController) to observe. */
  signal?: AbortSignal;
  /** Called between attempts with the attempt number (1-based) and retry-after in
   * ms (already resolved) so callers can surface progress if they want. */
  onRetry?: (attempt: number, delayMs: number, reason: { status?: number; message?: string }) => void;
}

/**
 * `fetch` that combines an optional caller signal (cancel) with a hard timeout.
 * If either fires first, the request aborts. Never hangs. Injects the standard
 * Noxara User-Agent unless the caller provides their own.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...init, headers: withDefaultUserAgent(init.headers), signal: combined });
}

/**
 * `fetch` with timeout + bounded retry on transient failures (429 with Retry-After
 * honored, 5xx, 408, network errors). Non-retryable HTTP statuses (4xx) and
 * definitive errors are returned/rethrown after the first attempt.
 *
 * Returns the final Response (caller checks `.ok` / status). Throws only on a
 * network-level failure that also exhausted retries, or a caller-provided abort.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  opts: FetchRetryOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 1000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetchWithTimeout(url, init, timeoutMs, opts.signal);
    } catch (err) {
      if (opts.signal?.aborted) throw err; // user cancel — never swallow
      lastErr = err;
      if (attempt >= maxAttempts) break;
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      opts.onRetry?.(attempt, delayMs, { message: err instanceof Error ? err.message : String(err) });
      await abortableSleep(delayMs, opts.signal);
      continue;
    }

    if (res.ok || !RETRYABLE_STATUSES.has(res.status)) {
      return res; // success, or a permanent/known status — hand it to the caller
    }

    if (attempt >= maxAttempts) {
      return res; // give up and let the caller read the (429/5xx) status
    }

    const delayMs = retryAfterMs(res) ?? baseDelayMs * 2 ** (attempt - 1);
    opts.onRetry?.(attempt, delayMs, { status: res.status });
    await abortableSleep(delayMs, opts.signal);
  }
  throw lastErr ?? new Error("Request failed after retries.");
}

/**
 * Merges the standard User-Agent into whatever headers a caller supplied (headers
 * win if they set their own, so callers can deliberately override for a host that
 * expects something specific).
 */
function withDefaultUserAgent(headers?: HeadersInit): HeadersInit {
  if (headers instanceof Headers) {
    if (headers.has("User-Agent")) return headers;
    const merged = new Headers(headers);
    merged.set("User-Agent", NOXARA_USER_AGENT);
    return merged;
  }
  if (Array.isArray(headers)) {
    if (headers.some(([k]) => k.toLowerCase() === "user-agent")) return headers;
    return [...headers, ["User-Agent", NOXARA_USER_AGENT]];
  }
  const obj = { ...(headers as Record<string, string> | undefined) };
  if (Object.keys(obj).some((k) => k.toLowerCase() === "user-agent")) return obj;
  obj["User-Agent"] = NOXARA_USER_AGENT;
  return obj;
}

/**
 * Sleeps `ms`, but wakes early — and rethrows — if `signal` aborts, so a user cancel
 * during a backoff wait is honored immediately instead of hanging until the timer
 * elapses (a large Retry-After can be many seconds). Plain `timers/promises` sleep
 * ignores signals, which is exactly what we must avoid here.
 */
async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    await new Promise((r) => setTimeout(r, ms));
    return;
  }
  if (signal.aborted) throw signal.reason ?? new Error("Request aborted.");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Request aborted."));
      },
      { once: true }
    );
  });
}

/** Parses a Retry-After header (seconds or HTTP-date) into ms, or null. */
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}
