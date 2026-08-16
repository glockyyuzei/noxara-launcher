/**
 * Owns the lifecycle of the noxara-core Rust sidecar process and implements the
 * stdio JSON-RPC client side described in native/rust/src/protocol.rs.
 *
 * This is the ONLY place in the main process that spawns noxara-core. All Rust-backed
 * functionality (Mojang metadata, Java detection, downloads, launching) is called
 * through `call()` below, never via ad-hoc child_process usage elsewhere.
 */
import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { EventEmitter } from "node:events";
import { logger } from "./logger";

/** An error surfaced from noxara-core (or a local bridge failure) with an optional
 * machine-readable `code` that callers match on to decide retry/classification
 * (e.g. "timeout", "fabric.network_error", "bad_request"). */
export type CoreBridgeError = Error & { code?: string };

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: CoreBridgeError) => void;
  /** Set once the promise has settled so a late Rust response can't double-fire. */
  settled: boolean;
  /** When a timed-out promise was rejected (used to sweep abandoned entries). */
  rejectedAt?: number;
}

/** A single JSON-RPC line from the core is at most a few KB. If the buffer ever grows
 * past this, the core is emitting a malformed/hostile line with no newline — reset it
 * rather than let memory grow unbounded. */
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

/** Matching cap for the request side: a single JSON-RPC request line must never exceed
 * this. Real requests are a few KB; anything past the cap is a buggy/hostile caller.
 * We reject it locally (structured `bad_request` error) instead of shipping it to the
 * core, where Rust's stdin reader also enforces the same cap as defense-in-depth. */
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

/** How long a timed-out (already-settled) call's id is kept waiting for its response
 * before it's considered truly orphaned and swept. Long enough for slow Rust tasks to
 * finish and log a "late response", short enough that a hung core can't pile up
 * entries forever. */
const SETTLED_TTL_MS = 60_000;

export class CoreBridge extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingCall>();
  private buffer = "";
  private lastSweep = 0;

  start(): void {
    const binPath = this.resolveBinaryPath();
    this.proc = spawn(binPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      // Inherit the NOXARA_LOG level set by app-settings.applyDebugLogLevel() (which
      // runs before coreBridge.start()). Hardcoding "info" here silently disabled the
      // Settings → Debug logging toggle: the core only ever ran at info even when the
      // user enabled verbose logging.
      env: process.env,
    });

    this.proc.stdout.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));

    this.proc.stderr.setEncoding("utf-8");
    this.proc.stderr.on("data", (chunk: string) => {
      // Human-readable Rust logs only — never parsed, just surfaced for diagnostics
      // through the structured logger (writes to <userData>/logs/main.log). The core's
      // own EnvFilter (NOXARA_LOG) gates verbosity, so whatever reaches stderr is worth
      // persisting at info level; debug-mode adds the core's trace-level noise too.
      const text = chunk.trim();
      if (text.length > 0) logger.info(`[noxara-core] ${text}`);
    });

    this.proc.on("exit", (code) => {
      logger.warn(`[noxara-core] exited with code ${code}`);
      for (const [, pending] of this.pending) {
        pending.settled = true;
        pending.reject(coreError("process_exited", "noxara-core process exited unexpectedly"));
      }
      this.pending.clear();
      this.proc = null;
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  private resolveBinaryPath(): string {
    const exeName = process.platform === "win32" ? "noxara-core.exe" : "noxara-core";
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "noxara-core", exeName);
    }
    return path.join(app.getAppPath(), "native", "rust", "target", "release", exeName);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    // Guard against a malformed/hostile core emitting an endless line with no newline:
    // reset the buffer (dropping the partial line) instead of letting it grow forever.
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      logger.warn("[noxara-core] stdout buffer exceeded the size cap; discarding partial line");
      this.buffer = "";
      return;
    }
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length === 0) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      logger.warn("[noxara-core] unparsable line", { line: line.slice(0, 500) });
      return;
    }

    if (typeof parsed.event === "string") {
      // Unsolicited event (download progress, game output, etc.)
      this.emit(parsed.event, parsed.data);
      return;
    }

    const id = parsed.id as string | undefined;
    if (!id) return;
    const pending = this.pending.get(id);
    if (!pending) {
      // The caller already gave up (e.g. timed out while the Rust task was still
      // processing). Not an error — the request genuinely completed, just late.
      logger.warn("[noxara-core] late response after it was abandoned", { id });
      return;
    }
    this.pending.delete(id);

    if (pending.settled) {
      // The promise rejected at its timeout while the Rust task was still working;
      // the response has now arrived but nothing is listening. Dispose and move on.
      logger.warn("[noxara-core] late response after it was abandoned", { id });
      return;
    }

    if (parsed.ok) {
      pending.settled = true;
      pending.resolve(parsed.result);
    } else {
      const error = parsed.error as { code?: string; message?: string } | undefined;
      pending.settled = true;
      pending.reject(coreError(error?.code, error?.message ?? "noxara-core returned an unknown error"));
    }
  }

  /**
   * Calls a method on noxara-core and awaits its single JSON-RPC response.
   *
   * Timeout handling: when `timeoutMs` elapses the promise rejects with
   * `code === "timeout"`, but the pending entry is kept so that a late response from
   * the (still-working) Rust task is matched, logged, and disposed of instead of
   * being silently orphaned. Callers that care about reliability should retry on
   * `code === "timeout"` — the underlying work is still completing.
   */
  call<T>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.proc) {
      return Promise.reject(coreError("not_running", "noxara-core is not running"));
    }
    this.sweepSettled();
    const id = randomUUID();
    const request = JSON.stringify({ id, method, params }) + "\n";

    // Reject oversized requests locally rather than shipping them to the core. The
    // byte count matters (UTF-8), not the char count.
    if (Buffer.byteLength(request) > MAX_REQUEST_BYTES) {
      return Promise.reject(
        coreError(
          "bad_request",
          `The "${method}" request is too large to send to noxara-core (over ${MAX_REQUEST_BYTES} bytes).`
        )
      );
    }

    return new Promise<T>((resolve, reject) => {
      const pending: PendingCall = {
        settled: false,
        resolve: (v) => {
          clearTimeout(timer);
          pending.settled = true;
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          pending.settled = true;
          reject(e);
        },
      };

      const timer = setTimeout(() => {
        if (pending.settled) return;
        // Mark the promise settled, but KEEP the mapping alive so a late response from
        // the (still-working) Rust task is matched and disposed of in handleLine
        // instead of leaking. The promise has already rejected — callers retry on
        // `code === "timeout"`.
        pending.settled = true;
        pending.rejectedAt = Date.now();
        reject(
          coreError(
            "timeout",
            `The "${method}" request did not respond in time (after ${timeoutMs / 1000}s). ` +
              `It may still be completing in the background — retry the action.`
          )
        );
      }, timeoutMs);

      this.pending.set(id, pending);
      this.proc!.stdin.write(request);
    });
  }

  /** Drops pending entries that timed out long ago and whose response is never coming
   * (the Rust task truly died or never started). Kept briefly so a genuinely-late
   * response still gets matched + logged instead of being silently orphaned; swept
   * once per call so the map can't grow without bound. */
  private sweepSettled(): void {
    const now = Date.now();
    if (now - this.lastSweep < 10_000) return;
    this.lastSweep = now;
    for (const [id, pending] of this.pending) {
      if (pending.settled && pending.rejectedAt && now - pending.rejectedAt > SETTLED_TTL_MS) {
        this.pending.delete(id);
      }
    }
  }
}

function coreError(code: string | undefined, message: string): CoreBridgeError {
  const err = new Error(message) as CoreBridgeError;
  if (code) err.code = code;
  return err;
}

export const coreBridge = new CoreBridge();