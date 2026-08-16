/**
 * Structured JSON-lines logger for the Electron main process.
 *
 * Writes one JSON object per line to `<userData>/logs/main.log` so a user/developer
 * can inspect what the launcher did (and why) without fishing through console output.
 *
 * Secret safety (spec: never log tokens): `log()` accepts a plain message plus an
 * optional structured context object; any field whose key matches a known secret
 * pattern (token, password, secret, authorization, xsts, device_code) is scrubbed
 * before the line is written. Callers never pass raw secrets — this is a backstop.
 *
 * Gated by Settings → debug mode: debug lines are only written when debugMode is on,
 * info/warn/error always are.
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

const SECRET_KEY_PATTERN = /token|password|passwd|secret|authorization|xsts|devicecode|usercode/i;

/** Normalizes a key for secret matching: "access_token", "accessToken", "user_code"
 * and "userCode" all collapse to the same stripped form so both naming conventions
 * are caught. */
function normalizedKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "");
}

export function scrub(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY_PATTERN.test(normalizedKey(key))) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, k);
    }
    return out;
  }
  return value;
}

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Whether Settings → debug mode is currently enabled (checked per write so toggling
 * it takes effect without a restart). */
export function isDebugLoggingEnabled(): boolean {
  return process.env.NOXARA_LOG === "debug";
}

function write(level: string, message: string, context?: Record<string, unknown>): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (context && Object.keys(context).length > 0) {
    entry.ctx = scrub(context);
  }
  const line = JSON.stringify(entry) + "\n";
  const dir = path.join(app.getPath("userData"), "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "main.log"), line);
  } catch {
    // Logging must never take the app down — fall back to console.
    if (level === "error") console.error(message);
    else console.log(message);
  }
}

export const logger: Logger = {
  info: (message, context) => write("info", message, context),
  warn: (message, context) => write("warn", message, context),
  error: (message, context) => write("error", message, context),
  debug: (message, context) => {
    if (isDebugLoggingEnabled()) write("debug", message, context);
  },
};