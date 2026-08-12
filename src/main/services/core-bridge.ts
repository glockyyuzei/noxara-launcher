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

/** An error surfaced from noxara-core (or a local bridge failure) with an optional
 * machine-readable `code` that callers match on to decide retry/classification
 * (e.g. "timeout", "fabric.network_error", "bad_request"). */
export type CoreBridgeError = Error & { code?: string };

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: CoreBridgeError) => void;
  /** Set once the promise has settled so a late Rust response can't double-fire. */
  settled: boolean;
}

export class CoreBridge extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, PendingCall>();
  private buffer = "";

  start(): void {
    const binPath = this.resolveBinaryPath();
    this.proc = spawn(binPath, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NOXARA_LOG: "info" },
    });

    this.proc.stdout.setEncoding("utf-8");
    this.proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));

    this.proc.stderr.setEncoding("utf-8");
    this.proc.stderr.on("data", (chunk: string) => {
      // Human-readable Rust logs only — never parsed, just surfaced for diagnostics.
      console.log(`[noxara-core] ${chunk.trim()}`);
    });

    this.proc.on("exit", (code) => {
      console.warn(`[noxara-core] exited with code ${code}`);
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
      console.warn("[noxara-core] unparsable line:", line);
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
      console.warn(`[noxara-core] late response for ${id} after it was abandoned`);
      return;
    }
    this.pending.delete(id);

    if (pending.settled) {
      // The promise rejected at its timeout while the Rust task was still working;
      // the response has now arrived but nothing is listening. Dispose and move on.
      console.warn(`[noxara-core] late response for ${id} after it was abandoned`);
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
    const id = randomUUID();
    const request = JSON.stringify({ id, method, params }) + "\n";

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
        reject(coreError("timeout", `noxara-core call "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, pending);
      this.proc!.stdin.write(request);
    });
  }
}

function coreError(code: string | undefined, message: string): CoreBridgeError {
  const err = new Error(message) as CoreBridgeError;
  if (code) err.code = code;
  return err;
}

export const coreBridge = new CoreBridge();