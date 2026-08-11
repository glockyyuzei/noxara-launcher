import type {
  CreateInstanceInput,
  InstanceRecord,
  AccountRecord,
  JavaInstallation,
  VersionManifest,
  DownloadProgressPayload,
  DownloadCompletePayload,
  ForgeVersion,
  ForgeInstallProgressPayload,
  GameOutputPayload,
  GameExitPayload,
  ModSearchQuery,
  ModrinthSearchResult,
  ModrinthVersion,
  ModLoader,
  InstalledMod,
  ModUpdateInfo,
  ModDownloadProgressPayload,
  ModDownloadCompletePayload,
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
      launchInstance(id: string): Promise<{ started: boolean }>;
      getForgeVersions(mcVersion: string): Promise<ForgeVersion[]>;
      searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult>;
      getModVersions(projectId: string, loader?: ModLoader, gameVersion?: string): Promise<ModrinthVersion[]>;
      installMod(instanceId: string, projectId: string, versionId: string): Promise<InstalledMod>;
      listInstalledMods(instanceId: string): Promise<InstalledMod[]>;
      removeMod(instanceId: string, modId: string): Promise<void>;
      checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]>;
      listSkins(): Promise<SkinRecord[]>;
      uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): Promise<SkinRecord>;
      deleteSkin(id: string): Promise<void>;
      renameSkin(id: string, name: string): Promise<SkinRecord>;
      getAccountSkin(accountId: string): Promise<SkinRecord | null>;
      setAccountSkin(accountId: string, skinId: string | null): Promise<void>;
      windowMinimize(): void;
      windowMaximize(): void;
      windowClose(): void;
      onDownloadProgress(cb: (p: DownloadProgressPayload) => void): () => void;
      onDownloadComplete(cb: (p: DownloadCompletePayload) => void): () => void;
      onGameOutput(cb: (p: GameOutputPayload) => void): () => void;
      onGameExit(cb: (p: GameExitPayload) => void): () => void;
      onModDownloadProgress(cb: (p: ModDownloadProgressPayload) => void): () => void;
      onModDownloadComplete(cb: (p: ModDownloadCompletePayload) => void): () => void;
      onForgeInstallProgress(cb: (p: ForgeInstallProgressPayload) => void): () => void;
    };
  }
}

export {};
