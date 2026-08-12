import type {
  CreateInstanceInput,
  InstanceRecord,
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
  ServerRecord,
  ServerInput,
  LauncherSettings,
  SkinRecord,
  MicrosoftDeviceCodeInfo,
} from "@shared/types/ipc";

declare global {
  interface Window {
    noxara: {
      getVersionManifest(forceRefresh?: boolean): Promise<VersionManifest>;
      getRecommendedJava(versionId: string): Promise<{ majorVersion: number }>;
      detectJava(): Promise<JavaInstallation[]>;
      testJavaPath(path: string): Promise<JavaInstallation | null>;
      listInstances(): Promise<InstanceRecord[]>;
      createInstance(input: CreateInstanceInput): Promise<InstanceRecord>;
      deleteInstance(id: string): Promise<void>;
      duplicateInstance(id: string, newName: string): Promise<InstanceRecord>;
      openInstanceFolder(id: string): Promise<void>;
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
      getModVersions(projectId: string, loader?: ModLoader, gameVersion?: string): Promise<ModrinthVersion[]>;
      installMod(instanceId: string, projectId: string, versionId: string): Promise<InstalledMod>;
      listInstalledMods(instanceId: string): Promise<InstalledMod[]>;
      removeMod(instanceId: string, modId: string): Promise<void>;
      checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]>;
      installContent(instanceId: string, versionId: string, category: ContentCategory): Promise<InstalledContent>;
      listInstalledContent(instanceId: string, category: ContentCategory): Promise<InstalledContent[]>;
      removeContent(instanceId: string, itemId: string, category: ContentCategory): Promise<void>;
      setContentEnabled(instanceId: string, itemId: string, category: ContentCategory, enabled: boolean): Promise<void>;
      listServers(instanceId?: string | null): Promise<ServerRecord[]>;
      addServer(input: ServerInput): Promise<ServerRecord>;
      updateServer(id: string, input: Partial<ServerInput>): Promise<ServerRecord>;
      removeServer(id: string): Promise<void>;
      getSettings(): Promise<LauncherSettings>;
      setSettings(partial: Partial<LauncherSettings>): Promise<LauncherSettings>;
      pickFolder(title: string): Promise<string | null>;
      pickJavaExecutable(): Promise<string | null>;
      listSkins(): Promise<SkinRecord[]>;
      uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): Promise<SkinRecord>;
      deleteSkin(id: string): Promise<void>;
      renameSkin(id: string, name: string): Promise<SkinRecord>;
      getAccountSkin(accountId: string): Promise<SkinRecord | null>;
      setAccountSkin(accountId: string, skinId: string | null): Promise<void>;
      applySkin(accountId: string, skinId: string): Promise<void>;
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
    };
  }
}

export {};
