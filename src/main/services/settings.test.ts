import { describe, it, expect } from "vitest";
import { clampSettings, DEFAULT_SETTINGS } from "./settings";

describe("clampSettings", () => {
  it("returns defaults for an empty/corrupt store", () => {
    expect(clampSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("passes through valid values unchanged", () => {
    const out = clampSettings({
      defaultMinRamMb: 2048,
      defaultMaxRamMb: 8192,
      launchWidth: 1280,
      launchHeight: 720,
      maxConcurrentDownloads: 8,
      downloadRetryCount: 3,
      downloadTimeoutSec: 120,
      uiScale: 1.25,
    });
    expect(out.defaultMinRamMb).toBe(2048);
    expect(out.defaultMaxRamMb).toBe(8192);
    expect(out.launchWidth).toBe(1280);
    expect(out.launchHeight).toBe(720);
    expect(out.maxConcurrentDownloads).toBe(8);
    expect(out.uiScale).toBe(1.25);
  });

  it("rejects RAM below the 512 MB floor", () => {
    expect(clampSettings({ defaultMinRamMb: 128 }).defaultMinRamMb).toBe(DEFAULT_SETTINGS.defaultMinRamMb);
    expect(clampSettings({ defaultMaxRamMb: 256 }).defaultMaxRamMb).toBe(DEFAULT_SETTINGS.defaultMaxRamMb);
  });

  it("rejects negative window sizes but has no upper cap (min-floor guard only)", () => {
    const out = clampSettings({ launchWidth: -50, launchHeight: 999999 });
    expect(out.launchWidth).toBe(DEFAULT_SETTINGS.launchWidth);
    expect(out.launchHeight).toBe(999999);
  });

  it("caps concurrent downloads at 16 and floors at 1 (falling back to default outside range)", () => {
    expect(clampSettings({ maxConcurrentDownloads: 999 }).maxConcurrentDownloads).toBe(16);
    expect(clampSettings({ maxConcurrentDownloads: 0 }).maxConcurrentDownloads).toBe(DEFAULT_SETTINGS.maxConcurrentDownloads);
  });

  it("falls back to defaults for download retry count and timeout outside their bounds", () => {
    expect(clampSettings({ downloadRetryCount: 99 }).downloadRetryCount).toBe(DEFAULT_SETTINGS.downloadRetryCount);
    expect(clampSettings({ downloadRetryCount: 0 }).downloadRetryCount).toBe(DEFAULT_SETTINGS.downloadRetryCount);
    expect(clampSettings({ downloadTimeoutSec: 5 }).downloadTimeoutSec).toBe(DEFAULT_SETTINGS.downloadTimeoutSec);
    expect(clampSettings({ downloadTimeoutSec: 5000 }).downloadTimeoutSec).toBe(DEFAULT_SETTINGS.downloadTimeoutSec);
  });

  it("falls back to default uiScale outside [0.7, 1.5]", () => {
    expect(clampSettings({ uiScale: 3 }).uiScale).toBe(DEFAULT_SETTINGS.uiScale);
    expect(clampSettings({ uiScale: 0.1 }).uiScale).toBe(DEFAULT_SETTINGS.uiScale);
  });

  it("coerces wrong types back to defaults", () => {
    const out = clampSettings({
      autoDetectJava: "yes",
      minimizeOnLaunch: 1,
      startOnBoot: "true",
      gameDir: 42,
      discordRpc: "no",
    });
    expect(out.autoDetectJava).toBe(DEFAULT_SETTINGS.autoDetectJava);
    expect(out.minimizeOnLaunch).toBe(DEFAULT_SETTINGS.minimizeOnLaunch);
    expect(out.startOnBoot).toBe(DEFAULT_SETTINGS.startOnBoot);
    expect(out.gameDir).toBe(DEFAULT_SETTINGS.gameDir);
    expect(out.discordRpc).toBe(DEFAULT_SETTINGS.discordRpc);
  });

  it("honours the discordRpc boolean", () => {
    expect(clampSettings({ discordRpc: false }).discordRpc).toBe(false);
    expect(clampSettings({ discordRpc: true }).discordRpc).toBe(true);
    expect(DEFAULT_SETTINGS.discordRpc).toBe(true);
  });

  it("rounds fractional numeric settings", () => {
    expect(clampSettings({ defaultMinRamMb: 2048.7 }).defaultMinRamMb).toBe(2049);
  });
});