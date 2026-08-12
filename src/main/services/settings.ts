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
};

function clampSettings(s: Record<string, unknown>): LauncherSettings {
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
