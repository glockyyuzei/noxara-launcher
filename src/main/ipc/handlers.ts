import { ipcMain, BrowserWindow, shell, dialog } from "electron";
import { IPC_CHANNELS } from "../../shared/types/ipc";
import type { CreateInstanceInput, UpdateInstanceInput } from "../../shared/types/ipc";
import { coreBridge } from "../services/core-bridge";
import { rootDir } from "../filesystem/paths";
import * as mojangService from "../services/mojang";
import * as javaService from "../services/java";
import * as instancesService from "../services/instances";
import * as accountsService from "../services/accounts";
import * as launchService from "../services/launch";
import * as modrinthService from "../services/modrinth";
import * as modsService from "../services/mods";
import * as forgeService from "../services/forge";
import * as fabricService from "../services/fabric";
import * as quiltService from "../services/quilt";
import * as neoforgeService from "../services/neoforge";
import * as skinsService from "../services/skins";
import * as contentService from "../services/content";
import * as serversService from "../services/servers";
import * as settingsService from "../services/settings";
import * as modpackExportService from "../services/modpack-export";
import * as microsoftLoginService from "../services/microsoft-login";
import * as backupsService from "../services/backups";
import * as storageService from "../services/storage";
import { pingServer } from "../services/server-ping";
import { cancelDownload, retryDownload, listDownloadTasks, downloadControlEvents } from "../services/download-control";
import {
  activityEvents,
  listActivities,
  cancelActivity,
  retryActivity,
  clearCompletedActivities,
  progressActivity,
  succeedActivity,
  syncDownloadControls,
  syncControlsNow,
} from "../services/activity";
import { checkInstanceHealth, repairInstance } from "../services/health";
import { getModDependencies } from "../services/mods";
import { applyStartOnBoot, applyTrayPreference, applyDiscordPresence } from "../app-settings";
import { logger } from "../services/logger";
import type {
  ContentCategory,
  LauncherSettings,
  ModLoader,
  ModSearchQuery,
  ModpackImportInput,
  ServerInput,
} from "../../shared/types/ipc";

/** Wraps a handler so unexpected errors become clean, non-leaking IPC rejections
 * (spec section 57: never dump raw exceptions into the UI). Full detail still logs
 * to the main-process console for diagnostics. */
function safe<T extends unknown[], R>(fn: (...args: T) => Promise<R> | R) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error("[ipc] handler error", { error: err instanceof Error ? err.message : String(err) });
      throw new Error(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.getVersionManifest, safe((_e, forceRefresh?: boolean) => mojangService.getVersionManifest(forceRefresh)));

  ipcMain.handle(IPC_CHANNELS.detectJava, safe(() => javaService.detectJava()));
  ipcMain.handle(IPC_CHANNELS.testJavaPath, safe((_e, path: string) => javaService.testJavaPath(path)));
  ipcMain.handle(
    IPC_CHANNELS.ensureJavaRuntime,
    safe((_e, majorVersion: number) => javaService.installJavaRuntime(majorVersion))
  );

  ipcMain.handle(IPC_CHANNELS.listInstances, safe(() => instancesService.listInstances()));
  ipcMain.handle(IPC_CHANNELS.createInstance, safe((_e, input: CreateInstanceInput) => instancesService.createInstance(input)));
  ipcMain.handle(
    IPC_CHANNELS.updateInstance,
    safe((_e, id: string, patch: UpdateInstanceInput) => instancesService.updateInstance(id, patch))
  );
  ipcMain.handle(IPC_CHANNELS.deleteInstance, safe((_e, id: string) => instancesService.deleteInstance(id)));
  ipcMain.handle(IPC_CHANNELS.duplicateInstance, safe((_e, id: string, name: string) => instancesService.duplicateInstance(id, name)));
  ipcMain.handle(IPC_CHANNELS.openInstanceFolder, safe((_e, id: string) => instancesService.openInstanceFolder(id)));

  ipcMain.handle(IPC_CHANNELS.listBackups, safe((_e, instanceId: string) => backupsService.listBackups(instanceId)));
  ipcMain.handle(
    IPC_CHANNELS.createBackup,
    safe((_e, instanceId: string, label: string) => backupsService.createBackup(instanceId, label))
  );
  ipcMain.handle(IPC_CHANNELS.restoreBackup, safe((_e, backupId: string) => backupsService.restoreBackup(backupId)));
  ipcMain.handle(IPC_CHANNELS.deleteBackup, safe((_e, backupId: string) => backupsService.deleteBackup(backupId)));

  ipcMain.handle(IPC_CHANNELS.getStorageBreakdown, safe(() => storageService.getStorageBreakdown()));
  ipcMain.handle(
    IPC_CHANNELS.clearStorageCache,
    safe((_e, categoryId: string) => storageService.clearStorageCache(categoryId))
  );

  ipcMain.handle(IPC_CHANNELS.listAccounts, safe(() => accountsService.listAccounts()));
  ipcMain.handle(IPC_CHANNELS.createOfflineProfile, safe((_e, username: string) => accountsService.createOfflineProfile(username)));
  ipcMain.handle(IPC_CHANNELS.setActiveAccount, safe((_e, id: string) => accountsService.setActiveAccount(id)));
  ipcMain.handle(IPC_CHANNELS.removeAccount, safe((_e, id: string) => accountsService.removeAccount(id)));
  ipcMain.handle(IPC_CHANNELS.startMicrosoftLogin, safe(() => microsoftLoginService.startMicrosoftLogin()));
  ipcMain.handle(
    IPC_CHANNELS.completeMicrosoftLogin,
    safe((_e, deviceCode: string, pollIntervalSeconds: number, expiresInSeconds: number) =>
      microsoftLoginService.completeMicrosoftLogin(deviceCode, pollIntervalSeconds, expiresInSeconds)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.openExternal,
    safe(async (_e, url: string) => {
      // Only ever open the exact Microsoft verification URL flow hands us — never an
      // arbitrary renderer-supplied string without validation.
      const parsed = new URL(url);
      const allowedHost = parsed.hostname === "microsoft.com" || parsed.hostname.endsWith(".microsoft.com") || parsed.hostname.endsWith(".microsoftonline.com");
      if (parsed.protocol !== "https:" || !allowedHost) {
        throw new Error("Refusing to open a non-Microsoft URL");
      }
      await shell.openExternal(url);
    })
  );

  ipcMain.handle(
    IPC_CHANNELS.refreshAccountProfile,
    safe((_e, accountId: string) => accountsService.refreshAccountProfile(accountId))
  );

  ipcMain.handle(IPC_CHANNELS.launchInstance, safe((_e, id: string, extraGameArgs?: string[]) => launchService.launchInstance(id, extraGameArgs)));
  ipcMain.handle(IPC_CHANNELS.listRunningInstances, safe(() => launchService.listRunningInstances()));
  ipcMain.handle(IPC_CHANNELS.killInstance, safe((_e, instanceId: string) => launchService.killInstance(instanceId)));

  ipcMain.handle(IPC_CHANNELS.getForgeVersions, safe((_e, mcVersion: string) => forgeService.getForgeVersions(mcVersion)));

  ipcMain.handle(
    IPC_CHANNELS.getNeoForgeVersions,
    safe((_e, mcVersion: string) => neoforgeService.getNeoForgeVersions(mcVersion))
  );

  ipcMain.handle(
    IPC_CHANNELS.getFabricLoaderVersions,
    safe((_e, mcVersion: string, forceRefresh?: boolean) => fabricService.getFabricLoaderVersions(mcVersion, { forceRefresh }))
  );

  ipcMain.handle(
    IPC_CHANNELS.getQuiltLoaderVersions,
    safe((_e, mcVersion: string, forceRefresh?: boolean) => quiltService.getQuiltLoaderVersions(mcVersion, { forceRefresh }))
  );

  ipcMain.handle(
    IPC_CHANNELS.searchMods,
    safe((_e, query: ModSearchQuery) => modrinthService.searchMods(query))
  );
  ipcMain.handle(IPC_CHANNELS.getModCategories, safe(() => modrinthService.getModCategories()));
  ipcMain.handle(
    IPC_CHANNELS.getModVersions,
    safe((_e, projectId: string, loader?: ModLoader, gameVersion?: string) =>
      modrinthService.getProjectVersions(projectId, loader, gameVersion)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.installMod,
    safe((_e, instanceId: string, projectId: string, versionId: string) =>
      modsService.installMod(instanceId, projectId, versionId)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.listInstalledMods,
    safe((_e, instanceId: string) => modsService.listInstalledMods(instanceId))
  );
  ipcMain.handle(
    IPC_CHANNELS.removeMod,
    safe((_e, instanceId: string, modId: string) => modsService.removeMod(instanceId, modId))
  );
  ipcMain.handle(
    IPC_CHANNELS.checkModUpdates,
    safe((_e, instanceId: string) => modsService.checkModUpdates(instanceId))
  );
  ipcMain.handle(
    IPC_CHANNELS.getModDependencies,
    safe((_e, instanceId: string, versionId: string) => getModDependencies(instanceId, versionId))
  );

  // Content (resource packs / shaders / modpacks via Modrinth)
  ipcMain.handle(
    IPC_CHANNELS.installContent,
    safe((_e, instanceId: string, versionId: string, category: ContentCategory) =>
      contentService.installContent(instanceId, versionId, category)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.listInstalledContent,
    safe((_e, instanceId: string, category: ContentCategory) =>
      contentService.listInstalledContent(instanceId, category)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.removeContent,
    safe((_e, instanceId: string, itemId: string, category: ContentCategory) =>
      contentService.removeContent(instanceId, itemId, category)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.setContentEnabled,
    safe((_e, instanceId: string, itemId: string, category: ContentCategory, enabled: boolean) =>
      contentService.setContentEnabled(instanceId, itemId, category, enabled)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.checkModpackUpdates,
    safe((_e, instanceId: string) => contentService.checkModpackUpdates(instanceId))
  );
  ipcMain.handle(
    IPC_CHANNELS.checkContentUpdates,
    safe((_e, instanceId: string, category: ContentCategory) =>
      contentService.checkContentUpdates(instanceId, category as Exclude<ContentCategory, "modpack">)
    )
  );

  // Modpack import/export (.mrpack)
  ipcMain.handle(
    IPC_CHANNELS.pickModpackFile,
    safe(async (): Promise<string | null> => {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: "Import Modpack (.mrpack)",
        properties: ["openFile"],
        filters: [{ name: "Modrinth Modpack", extensions: ["mrpack"] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    })
  );
  ipcMain.handle(
    IPC_CHANNELS.importModpackFromFile,
    safe((_e, mrpackPath: string, input: ModpackImportInput) =>
      contentService.importModpackFromFile(mrpackPath, input)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.installModpackNewInstance,
    safe((_e, versionId: string, input: ModpackImportInput) =>
      contentService.installModpackNewInstance(versionId, input)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.pickModpackSavePath,
    safe(async (_e, defaultFileName: string): Promise<string | null> => {
      const win = getWindow();
      const safeName = (String(defaultFileName || "modpack").replace(/[^\w .-]/g, "").slice(0, 64).trim() || "modpack") + ".mrpack";
      const result = await dialog.showSaveDialog(win!, {
        title: "Export Modpack",
        defaultPath: safeName,
        filters: [{ name: "Modrinth Modpack", extensions: ["mrpack"] }],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    })
  );
  ipcMain.handle(
    IPC_CHANNELS.exportModpack,
    safe((_e, instanceId: string, destPath: string) =>
      modpackExportService.exportModpack(instanceId, destPath)
    )
  );

  // Download control (Cancel/Retry for single-file mod/content downloads)
  ipcMain.handle(IPC_CHANNELS.listDownloadTasks, safe(() => listDownloadTasks()));
  ipcMain.handle(IPC_CHANNELS.cancelDownload, safe((_e, taskId: string) => cancelDownload(taskId)));
  ipcMain.handle(IPC_CHANNELS.retryDownload, safe((_e, taskId: string) => retryDownload(taskId)));

  // Global activity system (progress/status for every long-running operation)
  ipcMain.handle(IPC_CHANNELS.listActivities, safe(() => listActivities()));
  ipcMain.handle(IPC_CHANNELS.cancelActivity, safe((_e, activityId: string) => cancelActivity(activityId)));
  ipcMain.handle(IPC_CHANNELS.retryActivity, safe((_e, activityId: string) => retryActivity(activityId)));
  ipcMain.handle(IPC_CHANNELS.clearCompletedActivities, safe(() => clearCompletedActivities()));

  // Instance health / repair
  ipcMain.handle(IPC_CHANNELS.checkInstanceHealth, safe((_e, instanceId: string) => checkInstanceHealth(instanceId)));
  ipcMain.handle(IPC_CHANNELS.repairInstance, safe((_e, instanceId: string) => repairInstance(instanceId)));

  // Servers
  ipcMain.handle(
    IPC_CHANNELS.listServers,
    safe((_e, instanceId?: string | null) => serversService.listServers(instanceId))
  );
  ipcMain.handle(IPC_CHANNELS.addServer, safe((_e, input: ServerInput) => serversService.addServer(input)));
  ipcMain.handle(
    IPC_CHANNELS.updateServer,
    safe((_e, id: string, input: Partial<ServerInput>) => serversService.updateServer(id, input))
  );
  ipcMain.handle(IPC_CHANNELS.removeServer, safe((_e, id: string) => serversService.removeServer(id)));
  ipcMain.handle(
    IPC_CHANNELS.pingServer,
    safe((_e, address: string, port: number) => pingServer(address, port))
  );

  // Settings
  ipcMain.handle(IPC_CHANNELS.getSettings, safe(() => settingsService.getSettings()));
  ipcMain.handle(
    IPC_CHANNELS.getSystemInfo,
    safe(() => ({
      totalRamMb: Math.round(require("node:os").totalmem() / (1024 * 1024)),
    }))
  );
  ipcMain.handle(
    IPC_CHANNELS.setSettings,
    safe((_e, partial: Partial<LauncherSettings>) => {
      const updated = settingsService.setSettings(partial);
      // Re-apply app-level effects the moment a preference changes (no restart needed).
      applyStartOnBoot();
      applyTrayPreference(getWindow);
      applyDiscordPresence();
      return updated;
    })
  );
  ipcMain.handle(
    IPC_CHANNELS.pickFolder,
    safe(async (_e, title: string) => {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win!, {
        title,
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    })
  );
  ipcMain.handle(
    IPC_CHANNELS.pickJavaExecutable,
    safe(async () => {
      const win = getWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: "Select a Java executable",
        properties: ["openFile"],
        filters: [{ name: "Java executable", extensions: ["exe", "bat", "cmd", "sh", "java"] }],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    })
  );
  ipcMain.handle(IPC_CHANNELS.openDataDirectory, safe(() => shell.openPath(rootDir())));

  ipcMain.handle(IPC_CHANNELS.listSkins, safe(() => skinsService.listSkins()));
  ipcMain.handle(
    IPC_CHANNELS.uploadSkin,
    safe((_e, name: string, base64Png: string, model: "classic" | "slim") =>
      skinsService.uploadSkin(name, base64Png, model)
    )
  );
  ipcMain.handle(IPC_CHANNELS.deleteSkin, safe((_e, id: string) => skinsService.deleteSkin(id)));
  ipcMain.handle(
    IPC_CHANNELS.renameSkin,
    safe((_e, id: string, name: string) => skinsService.renameSkin(id, name))
  );
  ipcMain.handle(
    IPC_CHANNELS.getAccountSkin,
    safe((_e, accountId: string) => skinsService.getAccountSkin(accountId))
  );
  ipcMain.handle(
    IPC_CHANNELS.applySkin,
    safe((_e, accountId: string, skinId: string) => skinsService.applySkin(accountId, skinId))
  );
  ipcMain.handle(
    IPC_CHANNELS.getAccountSkinTexture,
    safe((_e, accountId: string) => skinsService.getAccountSkinTexture(accountId))
  );

  ipcMain.on(IPC_CHANNELS.windowMinimize, () => {
    const win = getWindow();
    if (!win) return;
    // Settings → General → Minimize to tray: hide instead of minimizing.
    if (settingsService.getSettings().minimizeToTray) {
      win.hide();
    } else {
      win.minimize();
    }
  });
  ipcMain.on(IPC_CHANNELS.windowMaximize, () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on(IPC_CHANNELS.windowClose, () => getWindow()?.close());

  // Forward noxara-core events straight through to the renderer.
  const forward = (channel: string) => (data: unknown) => getWindow()?.webContents.send(channel, data);
  coreBridge.on("download.progress", forward(IPC_CHANNELS.eventDownloadProgress));
  coreBridge.on("download.complete", forward(IPC_CHANNELS.eventDownloadComplete));
  coreBridge.on("game.started", forward(IPC_CHANNELS.eventGameStarted));
  coreBridge.on("game.output", forward(IPC_CHANNELS.eventGameOutput));
  // A user-requested stop (launchService.killInstance) makes the core report the
  // process as exited non-zero -> `crashed: true`. Normalize that to a normal exit so
  // the renderer never shows a crash banner for a stop the user initiated. Only a
  // genuinely crashed/launch-failed instance should surface as crashed.
  coreBridge.on("game.exit", (p: { instanceId: string; code: number | null; crashed: boolean }) => {
    const userStopped = launchService.takeUserStopped(p.instanceId);
    getWindow()?.webContents.send(IPC_CHANNELS.eventGameExit, {
      ...p,
      crashed: userStopped ? false : p.crashed,
    });
  });
  coreBridge.on("forge.install.progress", forward(IPC_CHANNELS.eventForgeInstallProgress));

  // Global activity events -> renderer overlay.
  activityEvents.on("updated", (payload) => getWindow()?.webContents.send(IPC_CHANNELS.eventActivityUpdated, payload));
  activityEvents.on("removed", (payload) => getWindow()?.webContents.send(IPC_CHANNELS.eventActivityRemoved, payload));

  // Aggregate real progress from every source into the activity registry. Services own
  // the lifecycle (terminal states / status transitions); this layer only feeds bytes,
  // file counts, and stage messages through so the overlay always shows backend truth.
  coreBridge.on("download.progress", (p: { taskId: string; label: string; bytesDownloaded: number; totalBytes: number; fileIndex: number; fileCount: number }) => {
    progressActivity(
      p.taskId,
      {
        currentBytes: p.bytesDownloaded,
        totalBytes: p.totalBytes,
        currentFile: p.label,
        completedFiles: p.fileIndex,
        totalFiles: p.fileCount,
        progress: p.totalBytes > 0 ? p.bytesDownloaded / p.totalBytes : undefined,
      },
      "downloading"
    );
  });

  coreBridge.on("forge.install.progress", (p: { taskId: string; stage: string; message: string }) => {
    if (p.stage === "complete") {
      succeedActivity(p.taskId, { description: p.message });
    } else {
      progressActivity(p.taskId, {}, "installing", { description: p.message });
    }
  });

  // Mod downloads run in Node (not the Rust sidecar), so forward their events directly
  // AND feed the bytes into the activity registry (progressActivity is a no-op when no
  // activity carries the taskId, so repair's shared taskId also benefits).
  modsService.modDownloadEvents.on("progress", forward(IPC_CHANNELS.eventModDownloadProgress));
  modsService.modDownloadEvents.on("complete", forward(IPC_CHANNELS.eventModDownloadComplete));
  modsService.modDownloadEvents.on(
    "progress",
    (p: { taskId: string; bytesDownloaded: number; totalBytes: number }) => {
      progressActivity(
        p.taskId,
        {
          currentBytes: p.bytesDownloaded,
          totalBytes: p.totalBytes,
          progress: p.totalBytes > 0 ? p.bytesDownloaded / p.totalBytes : undefined,
        },
        "downloading"
      );
    }
  );

  // Content downloads (resource packs / shaders / modpacks) also run in Node.
  contentService.contentDownloadEvents.on("progress", forward(IPC_CHANNELS.eventContentDownloadProgress));
  contentService.contentDownloadEvents.on("complete", forward(IPC_CHANNELS.eventContentDownloadComplete));
  contentService.contentDownloadEvents.on(
    "progress",
    (p: { taskId: string; bytesDownloaded: number; totalBytes: number }) => {
      progressActivity(
        p.taskId,
        {
          currentBytes: p.bytesDownloaded,
          totalBytes: p.totalBytes,
          progress: p.totalBytes > 0 ? p.bytesDownloaded / p.totalBytes : undefined,
        },
        "downloading"
      );
    }
  );

  // Keep the renderer's Downloads page in sync with which tasks can be cancelled/retried.
  const forwardTasks = () =>
    getWindow()?.webContents.send(IPC_CHANNELS.eventDownloadTasksChanged, { tasks: listDownloadTasks() });
  downloadControlEvents.on("changed", forwardTasks);

  // Keep the activity registry's cancel/retry flags in sync with the same registry.
  const syncActivityControls = () => syncDownloadControls(listDownloadTasks());
  downloadControlEvents.on("changed", syncActivityControls);
  // Seed both once in case work was active before this handler registered.
  forwardTasks();
  syncControlsNow();
}
