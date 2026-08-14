import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry, fetchWithTimeout } from "./http";

function jsonResponse(status: number, body: unknown = null, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchWithTimeout", () => {
  it("returns the response when the server answers in time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ok: true })));
    const res = await fetchWithTimeout("https://example.com/", {}, 1000);
    expect(res.status).toBe(200);
  });

  it("aborts when the timeout fires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
          })
      )
    );
    const promise = fetchWithTimeout("https://example.com/", {}, 50);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).rejects.toThrow();
  });
});

describe("fetchWithRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const fn = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fn);
    const res = await fetchWithRetry("https://example.com/", {}, { maxAttempts: 3 });
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After on 429 and returns the success that follows", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fn);
    const promise = fetchWithRetry("https://example.com/", {}, { maxAttempts: 3 });
    await vi.advanceTimersByTimeAsync(1100);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("backs off and retries 5xx responses", async () => {
    vi.useFakeTimers();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(502))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fn);
    const promise = fetchWithRetry("https://example.com/", {}, { maxAttempts: 3, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100 + 200);
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns a permanent 4xx immediately without retrying", async () => {
    const fn = vi.fn(async () => jsonResponse(404));
    vi.stubGlobal("fetch", fn);
    const res = await fetchWithRetry("https://example.com/", {}, { maxAttempts: 3 });
    expect(res.status).toBe(404);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops retrying at maxAttempts and returns the last retryable status", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => jsonResponse(500));
    vi.stubGlobal("fetch", fn);
    const promise = fetchWithRetry("https://example.com/", {}, { maxAttempts: 2, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const res = await promise;
    expect(res.status).toBe(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("rethrows the caller's abort instead of retrying", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      })
    );
    const promise = fetchWithRetry("https://example.com/", {}, { signal: controller.signal, maxAttempts: 3 });
    await expect(promise).rejects.toThrow();
  });

  it("exhausts retries on persistent network failure and throws", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fn);
    const promise = fetchWithRetry("https://example.com/", {}, { maxAttempts: 2, baseDelayMs: 100 });
    // Attach the rejection handler before advancing timers so the fake-timer rejection
    // is consumed instead of surfacing as an unhandled error.
    const assertion = expect(promise).rejects.toThrow("fetch failed");
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honors a caller cancel that fires during backoff (no long hang)", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}, { "retry-after": "60" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fn);
    const promise = fetchWithRetry("https://example.com/", {}, { signal: controller.signal, maxAttempts: 3 });
    // First attempt returns 429 with a 60 s Retry-After; cancel during that backoff.
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(promise).rejects.toThrow();
    // No second attempt should ever be issued after the cancel.
    expect(fn).toHaveBeenCalledTimes(1);
  });
});