import "dotenv/config";
import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./windows/main-window";
import { registerIpcHandlers } from "./ipc/handlers";
import { coreBridge } from "./services/core-bridge";
import { getDb, closeDb } from "./services/database";
import { getSettings } from "./services/settings";

let mainWindow: BrowserWindow | null = null;

// With Settings → "Close on launch" the launcher window closes as soon as the game
// starts, but the app process (and the noxara-core sidecar that supervises the game)
// must stay alive — quitting would tear the running Minecraft session down with it.
// We defer the quit until the game's exit event, then shut the app down cleanly.
let closeOnLaunchPending = false;

// Single instance lock — a second launch focuses the existing window instead of
// spawning a duplicate app (and a duplicate noxara-core process).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    getDb(); // run migrations before anything else touches the DB
    coreBridge.start();
    registerIpcHandlers(() => mainWindow);

    // Window behavior tied to Settings → Launch. Read per-launch so changes apply
    // without a restart. Handlers.ts separately forwards game.started to the renderer.
    coreBridge.on("game.started", () => {
      const s = getSettings();
      if (s.minimizeOnLaunch && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.minimize();
      }
      if (s.closeOnLaunch) {
        closeOnLaunchPending = true;
        mainWindow?.close();
      }
    });
    coreBridge.on("game.exit", () => {
      if (!closeOnLaunchPending) return;
      closeOnLaunchPending = false;
      // The launcher was closed behind a running game — now that the game is done,
      // finish the quits.
      if (BrowserWindow.getAllWindows().length === 0) app.quit();
    });

    mainWindow = createMainWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    // Don't quit if the window closed because the game launched ("close on launch") —
    // the app stays alive to supervise the game and quits on its exit (see above).
    if (process.platform !== "darwin" && !closeOnLaunchPending) app.quit();
  });

  app.on("before-quit", () => {
    coreBridge.stop();
    closeDb();
  });
}
