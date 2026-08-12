/**
 * Central place for every Noxara directory path, plus path-safety helpers used
 * before any filesystem write/delete/extract (spec section 64: file system safety).
 */
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { getSettings } from "../services/settings";

export function rootDir(): string {
  return path.join(app.getPath("userData"));
}

export function instancesDir(): string {
  // Honors the user's "Game directory" setting; empty means the launcher default.
  const dir = getSettings().gameDir.trim() || path.join(rootDir(), "instances");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function instanceDir(instanceId: string): string {
  return path.join(instancesDir(), instanceId);
}

export function librariesDir(): string {
  const dir = path.join(rootDir(), "libraries");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function assetsDir(): string {
  const dir = path.join(rootDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function versionsDir(): string {
  const dir = path.join(rootDir(), "versions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function javaDir(): string {
  const dir = path.join(rootDir(), "java");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function skinsDir(): string {
  const dir = path.join(rootDir(), "skins");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Asserts `candidate` resolves to a path inside `base`. Throws otherwise.
 * Used before every extraction, deletion, or write derived from user/network input
 * (archive entries, instance names, mod filenames) to block path traversal.
 */
export function assertWithin(base: string, candidate: string): string {
  const resolvedBase = path.resolve(base);
  const resolvedCandidate = path.resolve(base, candidate);
  const relative = path.relative(resolvedBase, resolvedCandidate);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path traversal blocked: "${candidate}" escapes "${base}"`);
  }
  return resolvedCandidate;
}

/** Sanitizes a user-supplied instance name into a safe directory-name fragment. */
export function slugifyInstanceName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64);
  return slug.length > 0 ? slug : "instance";
}
