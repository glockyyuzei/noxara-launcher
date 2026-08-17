/**
 * Launcher settings. Persisted as a single JSON document in the existing `settings`
 * key/value table (key `launcher`), so values survive restarts without any new
 * storage machinery. Consumers read the merged object through getSettings(); writers
 * only ever pass a partial patch.
 */
import { getDb } from "./database";
import type { LauncherSettings } from "../../shared/types/ipc";

const SETTINGS_KEY = "launcher";

export const DEFAULT_SETTINGS: LauncherSettings = {
  gameDir: "",
  defaultJavaPath: "",
  autoDetectJava: true,
  defaultMinRamMb: 2048,
  defaultMaxRamMb: 4096,
  launchWidth: 854,
  launchHeight: 480,
  minimizeOnLaunch: false,
  closeOnLaunch: false,
  startMinimized: false,
  showSnapshots: false,
  maxConcurrentDownloads: 8,
  startOnBoot: false,
  minimizeToTray: false,
  confirmBeforeCloseRunningInstances: true,
  discordRpc: true,
  uiScale: 1,
  compactMode: false,
  uiAnimations: true,
  downloadRetryCount: 3,
  downloadTimeoutSec: 120,
  debugMode: false,
};

/** Sanitizes a raw settings object against the defaults. Every read and write goes
 * through this, so a corrupt/crafted stored value can never crash the app or produce
 * nonsensical settings (negative RAM, absurd window sizes, etc.). Exported for tests. */
export function clampSettings(s: Record<string, unknown>): LauncherSettings {
  const d = DEFAULT_SETTINGS;
  return {
    gameDir: typeof s.gameDir === "string" ? s.gameDir : d.gameDir,
    defaultJavaPath: typeof s.defaultJavaPath === "string" ? s.defaultJavaPath : d.defaultJavaPath,
    autoDetectJava: typeof s.autoDetectJava === "boolean" ? s.autoDetectJava : d.autoDetectJava,
    defaultMinRamMb:
      typeof s.defaultMinRamMb === "number" && s.defaultMinRamMb >= 512 ? Math.round(s.defaultMinRamMb) : d.defaultMinRamMb,
    defaultMaxRamMb:
      typeof s.defaultMaxRamMb === "number" && s.defaultMaxRamMb >= 512 ? Math.round(s.defaultMaxRamMb) : d.defaultMaxRamMb,
    launchWidth: typeof s.launchWidth === "number" && s.launchWidth >= 320 ? Math.round(s.launchWidth) : d.launchWidth,
    launchHeight: typeof s.launchHeight === "number" && s.launchHeight >= 240 ? Math.round(s.launchHeight) : d.launchHeight,
    minimizeOnLaunch: typeof s.minimizeOnLaunch === "boolean" ? s.minimizeOnLaunch : d.minimizeOnLaunch,
    closeOnLaunch: typeof s.closeOnLaunch === "boolean" ? s.closeOnLaunch : d.closeOnLaunch,
    startMinimized: typeof s.startMinimized === "boolean" ? s.startMinimized : d.startMinimized,
    showSnapshots: typeof s.showSnapshots === "boolean" ? s.showSnapshots : d.showSnapshots,
    maxConcurrentDownloads:
      typeof s.maxConcurrentDownloads === "number" && s.maxConcurrentDownloads >= 1
        ? Math.min(Math.round(s.maxConcurrentDownloads), 16)
        : d.maxConcurrentDownloads,
    startOnBoot: typeof s.startOnBoot === "boolean" ? s.startOnBoot : d.startOnBoot,
    minimizeToTray: typeof s.minimizeToTray === "boolean" ? s.minimizeToTray : d.minimizeToTray,
    confirmBeforeCloseRunningInstances:
      typeof s.confirmBeforeCloseRunningInstances === "boolean"
        ? s.confirmBeforeCloseRunningInstances
        : d.confirmBeforeCloseRunningInstances,
    discordRpc: typeof s.discordRpc === "boolean" ? s.discordRpc : d.discordRpc,
    uiScale: typeof s.uiScale === "number" && s.uiScale >= 0.7 && s.uiScale <= 1.5 ? s.uiScale : d.uiScale,
    compactMode: typeof s.compactMode === "boolean" ? s.compactMode : d.compactMode,
    uiAnimations: typeof s.uiAnimations === "boolean" ? s.uiAnimations : d.uiAnimations,
    downloadRetryCount:
      typeof s.downloadRetryCount === "number" && s.downloadRetryCount >= 1 && s.downloadRetryCount <= 5
        ? Math.round(s.downloadRetryCount)
        : d.downloadRetryCount,
    downloadTimeoutSec:
      typeof s.downloadTimeoutSec === "number" && s.downloadTimeoutSec >= 30 && s.downloadTimeoutSec <= 600
        ? Math.round(s.downloadTimeoutSec)
        : d.downloadTimeoutSec,
    debugMode: typeof s.debugMode === "boolean" ? s.debugMode : d.debugMode,
  };
}

function readRaw(): Record<string, unknown> {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function getSettings(): LauncherSettings {
  return clampSettings(readRaw());
}

export function setSettings(partial: Partial<LauncherSettings>): LauncherSettings {
  const merged = clampSettings({ ...readRaw(), ...partial });
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}
