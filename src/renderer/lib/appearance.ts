import type { LauncherSettings } from "@shared/types/ipc";

/** Re-applies the appearance settings to the document (root font scale for the UI
 * scale slider, classes for compact mode and animations). Called on startup and
 * whenever settings are saved. */
export function applyAppearance(settings: LauncherSettings): void {
  const root = document.documentElement;
  // Tailwind sizing is rem-based, so scaling the root font-size scales the whole UI
  // proportionally (text, spacing, icon sizes).
  root.style.fontSize = `${Math.round(settings.uiScale * 16)}px`;
  root.classList.toggle("noxara-compact", settings.compactMode);
  root.classList.toggle("noxara-no-anim", !settings.uiAnimations);
}

/** Broadcast that settings were saved so the App-level appearance effect re-applies
 * without a reload. */
export function notifySettingsApplied(): void {
  window.dispatchEvent(new Event("noxara:settings-applied"));
}