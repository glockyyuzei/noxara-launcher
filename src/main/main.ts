import "dotenv/config";
import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./windows/main-window";
import { registerIpcHandlers } from "./ipc/handlers";
import { coreBridge } from "./services/core-bridge";
import { getDb, closeDb } from "./services/database";

let mainWindow: BrowserWindow | null = null;

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
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    coreBridge.stop();
    closeDb();
  });
}
