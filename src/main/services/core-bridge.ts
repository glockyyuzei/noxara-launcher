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

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
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
        pending.reject(new Error("noxara-core process exited unexpectedly"));
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
    if (!pending) return;
    this.pending.delete(id);

    if (parsed.ok) {
      pending.resolve(parsed.result);
    } else {
      const error = parsed.error as { code?: string; message?: string } | undefined;
      pending.reject(new Error(error?.message ?? "noxara-core returned an unknown error"));
    }
  }

  /** Calls a method on noxara-core and awaits its single JSON-RPC response. */
  call<T>(method: string, params: unknown = {}, timeoutMs = 30_000): Promise<T> {
    if (!this.proc) {
      return Promise.reject(new Error("noxara-core is not running"));
    }
    const id = randomUUID();
    const request = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`noxara-core call "${method}" timed out`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.proc!.stdin.write(request);
    });
  }
}

export const coreBridge = new CoreBridge();
