import type {
  CreateInstanceInput,
  UpdateInstanceInput,
  InstanceRecord,
  BackupRecord,
  StorageBreakdown,
  AccountRecord,
  JavaInstallation,
  VersionManifest,
  DownloadProgressPayload,
  DownloadCompletePayload,
  ForgeVersion,
  FabricLoaderVersion,
  QuiltLoaderVersion,
  NeoForgeVersion,
  ForgeInstallProgressPayload,
  GameOutputPayload,
  GameExitPayload,
  GameStartedPayload,
  ModSearchQuery,
  ModrinthSearchResult,
  ModrinthCategory,
  ModrinthVersion,
  ModLoader,
  InstalledMod,
  ModUpdateInfo,
  ModDownloadProgressPayload,
  ModDownloadCompletePayload,
  ContentCategory,
  ContentDownloadProgressPayload,
  ContentDownloadCompletePayload,
  InstalledContent,
  ModpackUpdateInfo,
  ModpackImportInput,
  DownloadTaskInfo,
  DownloadTasksChangedPayload,
  ActivityListPayload,
  ActivityUpdatedPayload,
  ActivityRemovedPayload,
  InstanceHealthReport,
  ModDependenciesResult,
  ServerRecord,
  ServerInput,
  ServerPingResult,
  LauncherSettings,
  SkinRecord,
  AccountSkinTexture,
  MicrosoftDeviceCodeInfo,
} from "@shared/types/ipc";

declare global {
  interface Window {
    noxara: {
      getVersionManifest(forceRefresh?: boolean): Promise<VersionManifest>;
      detectJava(): Promise<JavaInstallation[]>;
      testJavaPath(path: string): Promise<JavaInstallation | null>;
      ensureJavaRuntime(majorVersion: number): Promise<JavaInstallation>;
      listInstances(): Promise<InstanceRecord[]>;
      createInstance(input: CreateInstanceInput): Promise<InstanceRecord>;
      updateInstance(id: string, patch: UpdateInstanceInput): Promise<InstanceRecord>;
      deleteInstance(id: string): Promise<void>;
      duplicateInstance(id: string, newName: string): Promise<InstanceRecord>;
      openInstanceFolder(id: string): Promise<void>;
      listBackups(instanceId: string): Promise<BackupRecord[]>;
      createBackup(instanceId: string, label: string): Promise<BackupRecord>;
      restoreBackup(backupId: string): Promise<void>;
      deleteBackup(backupId: string): Promise<void>;
      getStorageBreakdown(): Promise<StorageBreakdown>;
      clearStorageCache(categoryId: string): Promise<StorageBreakdown>;
      listAccounts(): Promise<AccountRecord[]>;
      createOfflineProfile(username: string): Promise<AccountRecord>;
      setActiveAccount(id: string): Promise<void>;
      removeAccount(id: string): Promise<void>;
      startMicrosoftLogin(): Promise<MicrosoftDeviceCodeInfo>;
      completeMicrosoftLogin(deviceCode: string, pollIntervalSeconds: number, expiresInSeconds: number): Promise<AccountRecord>;
      openExternal(url: string): Promise<void>;
      refreshAccountProfile(accountId: string): Promise<AccountRecord>;
      launchInstance(id: string, extraGameArgs?: string[]): Promise<{ started: boolean }>;
      listRunningInstances(): Promise<string[]>;
      killInstance(instanceId: string): Promise<void>;
      getForgeVersions(mcVersion: string): Promise<ForgeVersion[]>;
      getNeoForgeVersions(mcVersion: string): Promise<NeoForgeVersion[]>;
      getFabricLoaderVersions(mcVersion: string, forceRefresh?: boolean): Promise<FabricLoaderVersion[]>;
      getQuiltLoaderVersions(mcVersion: string, forceRefresh?: boolean): Promise<QuiltLoaderVersion[]>;
      searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult>;
      getModCategories(): Promise<ModrinthCategory[]>;
      getModVersions(projectId: string, loader?: ModLoader, gameVersion?: string): Promise<ModrinthVersion[]>;
      installMod(instanceId: string, projectId: string, versionId: string): Promise<InstalledMod>;
      listInstalledMods(instanceId: string): Promise<InstalledMod[]>;
      removeMod(instanceId: string, modId: string): Promise<void>;
      checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]>;
      getModDependencies(instanceId: string, versionId: string): Promise<ModDependenciesResult>;
      installContent(instanceId: string, versionId: string, category: ContentCategory): Promise<InstalledContent>;
      listInstalledContent(instanceId: string, category: ContentCategory): Promise<InstalledContent[]>;
      removeContent(instanceId: string, itemId: string, category: ContentCategory): Promise<void>;
      setContentEnabled(instanceId: string, itemId: string, category: ContentCategory, enabled: boolean): Promise<void>;
      checkModpackUpdates(instanceId: string): Promise<ModpackUpdateInfo[]>;
      checkContentUpdates(instanceId: string, category: ContentCategory): Promise<ModpackUpdateInfo[]>;
      pickModpackFile(): Promise<string | null>;
      importModpackFromFile(mrpackPath: string, input: ModpackImportInput): Promise<InstanceRecord>;
      pickModpackSavePath(defaultFileName: string): Promise<string | null>;
      exportModpack(instanceId: string, destPath: string): Promise<{ exported: boolean }>;
      listDownloadTasks(): Promise<DownloadTaskInfo[]>;
      cancelDownload(taskId: string): Promise<void>;
      retryDownload(taskId: string): Promise<void>;
      listActivities(): Promise<ActivityListPayload>;
      cancelActivity(activityId: string): Promise<void>;
      retryActivity(activityId: string): Promise<void>;
      clearCompletedActivities(): Promise<void>;
      checkInstanceHealth(instanceId: string): Promise<InstanceHealthReport>;
      repairInstance(instanceId: string): Promise<InstanceHealthReport>;
      listServers(instanceId?: string | null): Promise<ServerRecord[]>;
      addServer(input: ServerInput): Promise<ServerRecord>;
      updateServer(id: string, input: Partial<ServerInput>): Promise<ServerRecord>;
      removeServer(id: string): Promise<void>;
      pingServer(address: string, port: number): Promise<ServerPingResult>;
      getSettings(): Promise<LauncherSettings>;
      setSettings(partial: Partial<LauncherSettings>): Promise<LauncherSettings>;
      getSystemInfo(): Promise<SystemInfo>;
      pickFolder(title: string): Promise<string | null>;
      pickJavaExecutable(): Promise<string | null>;
      openDataDirectory(): Promise<void>;
      listSkins(): Promise<SkinRecord[]>;
      uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): Promise<SkinRecord>;
      deleteSkin(id: string): Promise<void>;
      renameSkin(id: string, name: string): Promise<SkinRecord>;
      getAccountSkin(accountId: string): Promise<SkinRecord | null>;
      applySkin(accountId: string, skinId: string): Promise<void>;
      getAccountSkinTexture(accountId: string): Promise<AccountSkinTexture | null>;
      windowMinimize(): void;
      windowMaximize(): void;
      windowClose(): void;
      onDownloadProgress(cb: (p: DownloadProgressPayload) => void): () => void;
      onDownloadComplete(cb: (p: DownloadCompletePayload) => void): () => void;
      onGameOutput(cb: (p: GameOutputPayload) => void): () => void;
      onGameStarted(cb: (p: GameStartedPayload) => void): () => void;
      onGameExit(cb: (p: GameExitPayload) => void): () => void;
      onModDownloadProgress(cb: (p: ModDownloadProgressPayload) => void): () => void;
      onModDownloadComplete(cb: (p: ModDownloadCompletePayload) => void): () => void;
      onContentDownloadProgress(cb: (p: ContentDownloadProgressPayload) => void): () => void;
      onContentDownloadComplete(cb: (p: ContentDownloadCompletePayload) => void): () => void;
      onForgeInstallProgress(cb: (p: ForgeInstallProgressPayload) => void): () => void;
      onDownloadTasksChanged(cb: (p: DownloadTasksChangedPayload) => void): () => void;
      onActivityUpdated(cb: (p: ActivityUpdatedPayload) => void): () => void;
      onActivityRemoved(cb: (p: ActivityRemovedPayload) => void): () => void;
    };
  }
}

export {};
