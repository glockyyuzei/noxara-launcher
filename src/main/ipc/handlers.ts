import { ipcMain, BrowserWindow, shell, dialog } from "electron";
import { IPC_CHANNELS } from "../../shared/types/ipc";
import type { CreateInstanceInput } from "../../shared/types/ipc";
import { coreBridge } from "../services/core-bridge";
import * as mojangService from "../services/mojang";
import * as javaService from "../services/java";
import * as instancesService from "../services/instances";
import * as accountsService from "../services/accounts";
import * as launchService from "../services/launch";
import * as modrinthService from "../services/modrinth";
import * as modsService from "../services/mods";
import * as forgeService from "../services/forge";
import * as skinsService from "../services/skins";
import * as contentService from "../services/content";
import * as serversService from "../services/servers";
import * as settingsService from "../services/settings";
import * as microsoftLoginService from "../services/microsoft-login";
import type {
  ContentCategory,
  LauncherSettings,
  ModLoader,
  ModSearchQuery,
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
      console.error("[ipc]", err);
      throw new Error(err instanceof Error ? err.message : "An unexpected error occurred.");
    }
  };
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC_CHANNELS.getVersionManifest, safe((_e, forceRefresh?: boolean) => mojangService.getVersionManifest(forceRefresh)));
  ipcMain.handle(IPC_CHANNELS.getRecommendedJava, safe((_e, versionId: string) => mojangService.getRecommendedJava(versionId)));

  ipcMain.handle(IPC_CHANNELS.detectJava, safe(() => javaService.detectJava()));
  ipcMain.handle(IPC_CHANNELS.testJavaPath, safe((_e, path: string) => javaService.testJavaPath(path)));

  ipcMain.handle(IPC_CHANNELS.listInstances, safe(() => instancesService.listInstances()));
  ipcMain.handle(IPC_CHANNELS.createInstance, safe((_e, input: CreateInstanceInput) => instancesService.createInstance(input)));
  ipcMain.handle(IPC_CHANNELS.deleteInstance, safe((_e, id: string) => instancesService.deleteInstance(id)));
  ipcMain.handle(IPC_CHANNELS.duplicateInstance, safe((_e, id: string, name: string) => instancesService.duplicateInstance(id, name)));
  ipcMain.handle(IPC_CHANNELS.openInstanceFolder, safe((_e, id: string) => instancesService.openInstanceFolder(id)));

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

  ipcMain.handle(IPC_CHANNELS.launchInstance, safe((_e, id: string, extraGameArgs?: string[]) => launchService.launchInstance(id, extraGameArgs)));
  ipcMain.handle(IPC_CHANNELS.listRunningInstances, safe(() => launchService.listRunningInstances()));
  ipcMain.handle(IPC_CHANNELS.killInstance, safe((_e, instanceId: string) => launchService.killInstance(instanceId)));

  ipcMain.handle(IPC_CHANNELS.getForgeVersions, safe((_e, mcVersion: string) => forgeService.getForgeVersions(mcVersion)));

  ipcMain.handle(
    IPC_CHANNELS.searchMods,
    safe((_e, query: ModSearchQuery) => modrinthService.searchMods(query))
  );
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

  // Settings
  ipcMain.handle(IPC_CHANNELS.getSettings, safe(() => settingsService.getSettings()));
  ipcMain.handle(
    IPC_CHANNELS.setSettings,
    safe((_e, partial: Partial<LauncherSettings>) => settingsService.setSettings(partial))
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
    IPC_CHANNELS.setAccountSkin,
    safe((_e, accountId: string, skinId: string | null) =>
      skinsService.setAccountSkin(accountId, skinId)
    )
  );
  ipcMain.handle(
    IPC_CHANNELS.applySkin,
    safe((_e, accountId: string, skinId: string) => skinsService.applySkin(accountId, skinId))
  );

  ipcMain.on(IPC_CHANNELS.windowMinimize, () => getWindow()?.minimize());
  ipcMain.on(IPC_CHANNELS.windowMaximize, () => {
    const win = getWindow();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on(IPC_CHANNELS.windowClose, () => getWindow()?.close());

  // Forward noxara-core events straight through to the renderer.
  const forward = (channel: string) => (data: unknown) => getWindow()?.webContents.send(channel, data);
  coreBridge.on("download.progress", forward(IPC_CHANNELS.eventDownloadProgress));
  coreBridge.on("download.complete", forward(IPC_CHANNELS.eventDownloadComplete));
  coreBridge.on("game.started", forward(IPC_CHANNELS.eventGameStarted));
  coreBridge.on("game.output", forward(IPC_CHANNELS.eventGameOutput));
  coreBridge.on("game.exit", forward(IPC_CHANNELS.eventGameExit));
  coreBridge.on("forge.install.progress", forward(IPC_CHANNELS.eventForgeInstallProgress));

  // Mod downloads run in Node (not the Rust sidecar), so forward their events directly.
  modsService.modDownloadEvents.on("progress", forward(IPC_CHANNELS.eventModDownloadProgress));
  modsService.modDownloadEvents.on("complete", forward(IPC_CHANNELS.eventModDownloadComplete));

  // Content downloads (resource packs / shaders / modpacks) also run in Node.
  contentService.contentDownloadEvents.on("progress", forward(IPC_CHANNELS.eventContentDownloadProgress));
  contentService.contentDownloadEvents.on("complete", forward(IPC_CHANNELS.eventContentDownloadComplete));
}
