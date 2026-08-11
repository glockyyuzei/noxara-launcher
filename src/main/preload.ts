/**
 * The ONLY bridge between the sandboxed renderer and privileged main process.
 * Exposes a narrow, typed API via contextBridge — no ipcRenderer, no Node globals,
 * no raw channel strings ever reach the renderer (spec section 2: secure IPC).
 */
import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS } from "../shared/types/ipc";
import type {
  CreateInstanceInput,
  DownloadCompletePayload,
  DownloadProgressPayload,
  ForgeInstallProgressPayload,
  GameExitPayload,
  GameOutputPayload,
  ModDownloadCompletePayload,
  ModDownloadProgressPayload,
  ModLoader,
  ModSearchQuery,
  MicrosoftDeviceCodeInfo,
} from "../shared/types/ipc";

const api = {
  getVersionManifest: (forceRefresh?: boolean) => ipcRenderer.invoke(IPC_CHANNELS.getVersionManifest, forceRefresh),
  getRecommendedJava: (versionId: string) => ipcRenderer.invoke(IPC_CHANNELS.getRecommendedJava, versionId),

  detectJava: () => ipcRenderer.invoke(IPC_CHANNELS.detectJava),
  testJavaPath: (path: string) => ipcRenderer.invoke(IPC_CHANNELS.testJavaPath, path),

  listInstances: () => ipcRenderer.invoke(IPC_CHANNELS.listInstances),
  createInstance: (input: CreateInstanceInput) => ipcRenderer.invoke(IPC_CHANNELS.createInstance, input),
  deleteInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteInstance, id),
  duplicateInstance: (id: string, newName: string) => ipcRenderer.invoke(IPC_CHANNELS.duplicateInstance, id, newName),
  openInstanceFolder: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.openInstanceFolder, id),

  listAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.listAccounts),
  createOfflineProfile: (username: string) => ipcRenderer.invoke(IPC_CHANNELS.createOfflineProfile, username),
  setActiveAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.setActiveAccount, id),
  removeAccount: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.removeAccount, id),
  startMicrosoftLogin: (): Promise<MicrosoftDeviceCodeInfo> => ipcRenderer.invoke(IPC_CHANNELS.startMicrosoftLogin),
  completeMicrosoftLogin: (deviceCode: string, pollIntervalSeconds: number, expiresInSeconds: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.completeMicrosoftLogin, deviceCode, pollIntervalSeconds, expiresInSeconds),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),

  launchInstance: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.launchInstance, id),

  getForgeVersions: (mcVersion: string) => ipcRenderer.invoke(IPC_CHANNELS.getForgeVersions, mcVersion),

  searchMods: (query: ModSearchQuery) => ipcRenderer.invoke(IPC_CHANNELS.searchMods, query),
  getModVersions: (projectId: string, loader?: ModLoader, gameVersion?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getModVersions, projectId, loader, gameVersion),
  installMod: (instanceId: string, projectId: string, versionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.installMod, instanceId, projectId, versionId),
  listInstalledMods: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.listInstalledMods, instanceId),
  removeMod: (instanceId: string, modId: string) => ipcRenderer.invoke(IPC_CHANNELS.removeMod, instanceId, modId),
  checkModUpdates: (instanceId: string) => ipcRenderer.invoke(IPC_CHANNELS.checkModUpdates, instanceId),

  listSkins: () => ipcRenderer.invoke(IPC_CHANNELS.listSkins),
  uploadSkin: (name: string, base64Png: string, model: "classic" | "slim") =>
    ipcRenderer.invoke(IPC_CHANNELS.uploadSkin, name, base64Png, model),
  deleteSkin: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteSkin, id),
  renameSkin: (id: string, name: string) => ipcRenderer.invoke(IPC_CHANNELS.renameSkin, id, name),
  getAccountSkin: (accountId: string) => ipcRenderer.invoke(IPC_CHANNELS.getAccountSkin, accountId),
  setAccountSkin: (accountId: string, skinId: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.setAccountSkin, accountId, skinId),
  applySkin: (accountId: string, skinId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.applySkin, accountId, skinId),

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
};

contextBridge.exposeInMainWorld("noxara", api);

export type PreloadApi = typeof api;
