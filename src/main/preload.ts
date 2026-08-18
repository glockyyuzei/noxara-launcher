/**
 * The ONLY bridge between the sandboxed renderer and privileged main process.
 * Exposes a narrow, typed API via contextBridge — no ipcRenderer, no Node globals,
 * no raw channel strings ever reach the renderer (spec section 2: secure IPC).
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/types/ipc";
import type {
  ActivityListPayload,
  ActivityUpdatedPayload,
  ActivityRemovedPayload,
  ContentCategory,
  ContentDownloadCompletePayload,
  ContentDownloadProgressPayload,
  CreateInstanceInput,
  UpdateInstanceInput,
  DownloadCompletePayload,
  DownloadProgressPayload,
  DownloadTaskInfo,
  DownloadTasksChangedPayload,
  ForgeInstallProgressPayload,
  GameExitPayload,
  GameOutputPayload,
  GameStartedPayload,
  InstanceHealthReport,
  ModDependenciesResult,
  ModDownloadCompletePayload,
  ModDownloadProgressPayload,
  ModLoader,
  ModSearchQuery,
  MicrosoftDeviceCodeInfo,
  ModpackImportInput,
  ServerInput,
  ServerPingResult,
} from "../shared/types/ipc";

const api = {
  getVersionManifest: (forceRefresh?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.getVersionManifest, forceRefresh),

  detectJava: () => ipcRenderer.invoke(IPC_CHANNELS.detectJava),
  testJavaPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.testJavaPath, path),
  ensureJavaRuntime: (majorVersion: number) => ipcRenderer.invoke(IPC_CHANNELS.ensureJavaRuntime, majorVersion),

  listInstances: () => ipcRenderer.invoke(IPC_CHANNELS.listInstances),
  createInstance: (input: CreateInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.createInstance, input),
  updateInstance: (id: string, patch: UpdateInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.updateInstance, id, patch),
  deleteInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteInstance, id),
  duplicateInstance: (id: string, newName: string) => ipcRenderer.invoke(IPC_CHANNELS.duplicateInstance, id, newName),
  openInstanceFolder: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.openInstanceFolder, id),

  listBackups: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.listBackups, instanceId),
  createBackup: (instanceId: string, label: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.createBackup, instanceId, label),
  restoreBackup: (backupId: string) => ipcRenderer.invoke(IPC_CHANNELS.restoreBackup, backupId),
  deleteBackup: (backupId: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteBackup, backupId),

  getStorageBreakdown: () => ipcRenderer.invoke(IPC_CHANNELS.getStorageBreakdown),
  clearStorageCache: (categoryId: string) => ipcRenderer.invoke(IPC_CHANNELS.clearStorageCache, categoryId),

  listAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.listAccounts),
  createOfflineProfile: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.createOfflineProfile, username),
  setActiveAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.setActiveAccount, id),
  removeAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.removeAccount, id),
  startMicrosoftLogin: (): Promise<MicrosoftDeviceCodeInfo> => ipcRenderer.invoke(IPC_CHANNELS.startMicrosoftLogin),
  completeMicrosoftLogin: (deviceCode: string, pollIntervalSeconds: number, expiresInSeconds: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.completeMicrosoftLogin, deviceCode, pollIntervalSeconds, expiresInSeconds),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  refreshAccountProfile: (accountId: string) => ipcRenderer.invoke(IPC_CHANNELS.refreshAccountProfile, accountId),

  launchInstance: (id: string, extraGameArgs?: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.launchInstance, id, extraGameArgs),
  listRunningInstances: () => ipcRenderer.invoke(IPC_CHANNELS.listRunningInstances),
  killInstance: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.killInstance, instanceId),

  getForgeVersions: (mcVersion: string) => ipcRenderer.invoke(IPC_CHANNELS.getForgeVersions, mcVersion),
  getNeoForgeVersions: (mcVersion: string) => ipcRenderer.invoke(IPC_CHANNELS.getNeoForgeVersions, mcVersion),
  getFabricLoaderVersions: (mcVersion: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.getFabricLoaderVersions, mcVersion, forceRefresh),
  getQuiltLoaderVersions: (mcVersion: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.getQuiltLoaderVersions, mcVersion, forceRefresh),

  searchMods: (query: ModSearchQuery) => ipcRenderer.invoke(IPC_CHANNELS.searchMods, query),
  getModCategories: () => ipcRenderer.invoke(IPC_CHANNELS.getModCategories),
  getModVersions: (projectId: string, loader?: ModLoader, gameVersion?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getModVersions, projectId, loader, gameVersion),
  installMod: (instanceId: string, projectId: string, versionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.installMod, instanceId, projectId, versionId),
  listInstalledMods: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.listInstalledMods, instanceId),
  removeMod: (instanceId: string, modId: string) => ipcRenderer.invoke(IPC_CHANNELS.removeMod, instanceId, modId),
  checkModUpdates: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.checkModUpdates, instanceId),
  getModDependencies: (instanceId: string, versionId: string): Promise<ModDependenciesResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.getModDependencies, instanceId, versionId),

  installContent: (instanceId: string, versionId: string, category: ContentCategory) =>
    ipcRenderer.invoke(IPC_CHANNELS.installContent, instanceId, versionId, category),
  listInstalledContent: (instanceId: string, category: ContentCategory) =>
    ipcRenderer.invoke(IPC_CHANNELS.listInstalledContent, instanceId, category),
  removeContent: (instanceId: string, itemId: string, category: ContentCategory) =>
    ipcRenderer.invoke(IPC_CHANNELS.removeContent, instanceId, itemId, category),
  setContentEnabled: (instanceId: string, itemId: string, category: ContentCategory, enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setContentEnabled, instanceId, itemId, category, enabled),
  checkModpackUpdates: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.checkModpackUpdates, instanceId),
  checkContentUpdates: (instanceId: string, category: ContentCategory) =>
    ipcRenderer.invoke(IPC_CHANNELS.checkContentUpdates, instanceId, category),

  pickModpackFile: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.pickModpackFile),
  importModpackFromFile: (mrpackPath: string, input: ModpackImportInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.importModpackFromFile, mrpackPath, input),
  installModpackNewInstance: (versionId: string, input: ModpackImportInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.installModpackNewInstance, versionId, input),
  pickModpackSavePath: (defaultFileName: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.pickModpackSavePath, defaultFileName),
  exportModpack: (instanceId: string, destPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.exportModpack, instanceId, destPath),

  listDownloadTasks: (): Promise<DownloadTaskInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.listDownloadTasks),
  cancelDownload: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelDownload, taskId),
  retryDownload: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.retryDownload, taskId),

  listActivities: (): Promise<ActivityListPayload> => ipcRenderer.invoke(IPC_CHANNELS.listActivities),
  cancelActivity: (activityId: string) => ipcRenderer.invoke(IPC_CHANNELS.cancelActivity, activityId),
  retryActivity: (activityId: string) => ipcRenderer.invoke(IPC_CHANNELS.retryActivity, activityId),
  clearCompletedActivities: () => ipcRenderer.invoke(IPC_CHANNELS.clearCompletedActivities),

  checkInstanceHealth: (instanceId: string): Promise<InstanceHealthReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.checkInstanceHealth, instanceId),
  repairInstance: (instanceId: string): Promise<InstanceHealthReport> =>
    ipcRenderer.invoke(IPC_CHANNELS.repairInstance, instanceId),

  listServers: (instanceId?: string | null) => ipcRenderer.invoke(IPC_CHANNELS.listServers, instanceId),
  addServer: (input: ServerInput) => ipcRenderer.invoke(IPC_CHANNELS.addServer, input),
  updateServer: (id: string, input: Partial<ServerInput>) => ipcRenderer.invoke(IPC_CHANNELS.updateServer, id, input),
  removeServer: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.removeServer, id),
  pingServer: (address: string, port: number): Promise<ServerPingResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.pingServer, address, port),

  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.getSettings),
  setSettings: (partial: Record<string, unknown>) => ipcRenderer.invoke(IPC_CHANNELS.setSettings, partial),
  getSystemInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getSystemInfo),
  pickFolder: (title: string) => ipcRenderer.invoke(IPC_CHANNELS.pickFolder, title),
  pickJavaExecutable: () => ipcRenderer.invoke(IPC_CHANNELS.pickJavaExecutable),
  openDataDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.openDataDirectory),

  listSkins: () => ipcRenderer.invoke(IPC_CHANNELS.listSkins),
  uploadSkin: (name: string, base64Png: string, model: "classic" | "slim") =>
    ipcRenderer.invoke(IPC_CHANNELS.uploadSkin, name, base64Png, model),
  deleteSkin: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteSkin, id),
  renameSkin: (id: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.renameSkin, id, name),
  getAccountSkin: (accountId: string) => ipcRenderer.invoke(IPC_CHANNELS.getAccountSkin, accountId),
  applySkin: (accountId: string, skinId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.applySkin, accountId, skinId),
  getAccountSkinTexture: (accountId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getAccountSkinTexture, accountId),

  windowMinimize: () => ipcRenderer.send(IPC_CHANNELS.windowMinimize),
  windowMaximize: () => ipcRenderer.send(IPC_CHANNELS.windowMaximize),
  windowClose: () => ipcRenderer.send(IPC_CHANNELS.windowClose),

  onDownloadProgress: (cb: (payload: DownloadProgressPayload) => void) => {
    const listener = (_e: unknown, payload: DownloadProgressPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventDownloadProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventDownloadProgress, listener);
  },
  onDownloadComplete: (cb: (payload: DownloadCompletePayload) => void) => {
    const listener = (_e: unknown, payload: DownloadCompletePayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventDownloadComplete, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventDownloadComplete, listener);
  },
  onGameOutput: (cb: (payload: GameOutputPayload) => void) => {
    const listener = (_e: unknown, payload: GameOutputPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventGameOutput, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventGameOutput, listener);
  },
  onGameOutputBatch: (cb: (payloads: GameOutputPayload[]) => void) => {
    const listener = (_e: unknown, payloads: GameOutputPayload[]) => cb(payloads);
    ipcRenderer.on(IPC_CHANNELS.eventGameOutputBatch, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventGameOutputBatch, listener);
  },
  onGameStarted: (cb: (payload: GameStartedPayload) => void) => {
    const listener = (_e: unknown, payload: GameStartedPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventGameStarted, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventGameStarted, listener);
  },
  onGameExit: (cb: (payload: GameExitPayload) => void) => {
    const listener = (_e: unknown, payload: GameExitPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventGameExit, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventGameExit, listener);
  },
  onModDownloadProgress: (cb: (payload: ModDownloadProgressPayload) => void) => {
    const listener = (_e: unknown, payload: ModDownloadProgressPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventModDownloadProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventModDownloadProgress, listener);
  },
  onContentDownloadProgress: (cb: (payload: ContentDownloadProgressPayload) => void) => {
    const listener = (_e: unknown, payload: ContentDownloadProgressPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventContentDownloadProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventContentDownloadProgress, listener);
  },
  onContentDownloadComplete: (cb: (payload: ContentDownloadCompletePayload) => void) => {
    const listener = (_e: unknown, payload: ContentDownloadCompletePayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventContentDownloadComplete, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventContentDownloadComplete, listener);
  },
  onModDownloadComplete: (cb: (payload: ModDownloadCompletePayload) => void) => {
    const listener = (_e: unknown, payload: ModDownloadCompletePayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventModDownloadComplete, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventModDownloadComplete, listener);
  },
  onForgeInstallProgress: (cb: (payload: ForgeInstallProgressPayload) => void) => {
    const listener = (_e: unknown, payload: ForgeInstallProgressPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventForgeInstallProgress, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventForgeInstallProgress, listener);
  },
  onDownloadTasksChanged: (cb: (payload: DownloadTasksChangedPayload) => void) => {
    const listener = (_e: unknown, payload: DownloadTasksChangedPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventDownloadTasksChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventDownloadTasksChanged, listener);
  },
  onActivityUpdated: (cb: (payload: ActivityUpdatedPayload) => void) => {
    const listener = (_e: unknown, payload: ActivityUpdatedPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventActivityUpdated, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventActivityUpdated, listener);
  },
  onActivityRemoved: (cb: (payload: ActivityRemovedPayload) => void) => {
    const listener = (_e: unknown, payload: ActivityRemovedPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.eventActivityRemoved, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.eventActivityRemoved, listener);
  },
};

contextBridge.exposeInMainWorld("noxara", api);

export type PreloadApi = typeof api;
