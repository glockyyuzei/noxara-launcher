/**
 * App-level effects driven by Settings — start-on-boot, minimize-to-tray, the close
 * confirmation while instances are running, and the noxara-core log level (debug).
 *
 * Kept in its own module (instead of main.ts) so the settings IPC handler can re-apply
 * these the moment a preference changes without creating an import cycle.
 */
import path from "node:path";
import { app, BrowserWindow, Tray, Menu, dialog, nativeImage } from "electron";
import { getSettings } from "./services/settings";
import { coreBridge } from "./services/core-bridge";
import { presence } from "./services/presence";

let tray: Tray | null = null;
let forceClose = false;
let runningGames = 0;

coreBridge.on("game.started", () => {
  runningGames += 1;
});
coreBridge.on("game.exit", () => {
  runningGames = Math.max(0, runningGames - 1);
});

/** How many Minecraft processes the core currently supervises (real process state). */
export function runningGameCount(): number {
  return runningGames;
}

/** Applies the debug-mode log level. Must run BEFORE coreBridge.start() to take effect. */
export function applyDebugLogLevel(): void {
  process.env.NOXARA_LOG = getSettings().debugMode ? "debug" : "info";
}

/** Registers Noxara to start when the user signs in (Windows/macOS login items). */
export function applyStartOnBoot(): void {
  const s = getSettings();
  if (process.platform === "win32" || process.platform === "darwin") {
    app.setLoginItemSettings({ openAtLogin: s.startOnBoot });
  }
}

/** Connects/disconnects Discord Rich Presence based on the `discordRpc` setting.
 * Reapplied at startup and whenever the setting changes (see the settings IPC handler). */
export function applyDiscordPresence(): void {
  if (getSettings().discordRpc) {
    presence.start();
  } else {
    presence.stop();
  }
}

function trayIcon(): Electron.NativeImage {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, "renderer", "noxara_banner.png")]
    : [path.join(app.getAppPath(), "src", "renderer", "public", "noxara_banner.png")];
  for (const candidate of candidates) {
    const img = nativeImage.createFromPath(candidate);
    if (!img.isEmpty()) return img.resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

/** Creates/destroys the system tray entry based on the minimize-to-tray preference. */
export function applyTrayPreference(getWindow: () => BrowserWindow | null): void {
  const show = () => {
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.show();
      win.focus();
    }
  };
  if (getSettings().minimizeToTray) {
    if (!tray) {
      tray = new Tray(trayIcon());
      tray.setToolTip("Noxara Launcher");
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: "Show Noxara", click: show },
          { type: "separator" },
          {
            label: "Quit Noxara",
            click: () => {
              forceClose = true;
              app.quit();
            },
          },
        ])
      );
      tray.on("click", show);
    }
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
}

/**
 * Attaches window-level behavior:
 *   * minimize-to-tray (prevented at the OS level, hides the window instead),
 *   * confirm-before-close while Minecraft processes are running.
 * `isClosingForLaunch` lets the caller exempt the automatic "close on launch" path.
 */
export function installWindowBehavior(
  getWindow: () => BrowserWindow | null,
  isClosingForLaunch: () => boolean
): void {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;

  win.on("close", (e) => {
    const s = getSettings();
    if (forceClose || isClosingForLaunch() || runningGames === 0) return;
    if (!s.confirmBeforeCloseRunningInstances) return;
    e.preventDefault();
    dialog
      .showMessageBox(win, {
        type: "warning",
        title: "Minecraft is still running",
        message: runningGames === 1 ? "1 instance is still running." : `${runningGames} instances are still running.`,
        detail:
          "Closing Noxara will not stop Minecraft — the game keeps running in the background. Quit Noxara anyway?",
        buttons: ["Quit Noxara", "Cancel"],
        defaultId: 1,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          forceClose = true;
          win.destroy();
        }
      });
  });
}