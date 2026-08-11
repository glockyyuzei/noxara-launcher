/**
 * Typed IPC contract between the renderer (untrusted UI) and the main process
 * (privileged). The renderer NEVER touches Node/filesystem/child_process directly —
 * every privileged operation goes through one of these named, validated channels.
 */

export interface JavaInstallation {
  path: string;
  version: string;
  majorVersion: number;
  vendor: string | null;
  is64bit: boolean;
}

export interface InstanceRecord {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: "vanilla" | "fabric" | "forge";
  loaderVersion: string | null;
  javaPath: string | null;
  minRamMb: number;
  maxRamMb: number;
  jvmArgs: string;
  gameArgs: string;
  iconPath: string | null;
  createdAt: string;
  lastPlayedAt: string | null;
  favorite: boolean;
}

export interface CreateInstanceInput {
  name: string;
  minecraftVersion: string;
  loader: InstanceRecord["loader"];
  loaderVersion?: string | null;
  javaPath?: string | null;
  minRamMb: number;
  maxRamMb: number;
  iconPath?: string | null;
}

export interface AccountRecord {
  id: string;
  kind: "microsoft" | "offline";
  username: string;
  uuid: string;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface MicrosoftDeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
}

export interface VersionManifestEntry {
  id: string;
  type: "release" | "snapshot" | "old_beta" | "old_alpha";
  releaseTime: string;
}

export interface VersionManifest {
  latest: { release: string; snapshot: string };
  versions: VersionManifestEntry[];
}

export interface DownloadProgressPayload {
  taskId: string;
  label: string;
  bytesDownloaded: number;
  totalBytes: number;
  fileIndex: number;
  fileCount: number;
}

export interface DownloadCompletePayload {
  taskId: string;
  failed: string[];
}

export interface GameOutputPayload {
  instanceId: string;
  stream: "stdout" | "stderr";
  line: string;
}

export interface GameExitPayload {
  instanceId: string;
  code: number | null;
  crashed: boolean;
}

/* -------------------------------------------------------------------------- */
/* Forge                                                                       */
/* -------------------------------------------------------------------------- */

export interface ForgeVersion {
  minecraftVersion: string;
  forgeVersion: string;
  /** The exact "<mc>-<forge>" string used in installer URLs — pass this back as
   * `loaderVersion` when creating a Forge instance. */
  fullVersion: string;
  recommended: boolean;
  latest: boolean;
}

export interface ForgeInstallProgressPayload {
  taskId: string;
  stage: "download" | "libraries" | "processing" | "finalizing" | "complete" | string;
  message: string;
}

/* -------------------------------------------------------------------------- */
/* Modrinth / mods                                                             */
/* -------------------------------------------------------------------------- */

export type ModLoader = "fabric" | "forge";

export interface ModrinthSearchHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  loaders: string[];
  latestVersionId: string | null;
  projectType: string;
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[];
  totalHits: number;
  offset: number;
  limit: number;
}

export type ModSearchSort = "relevance" | "downloads" | "newest" | "updated";

export interface ModSearchQuery {
  query: string;
  loader?: ModLoader;
  gameVersion?: string;
  sort?: ModSearchSort;
  offset?: number;
  limit?: number;
}

export interface ModrinthVersionFile {
  filename: string;
  url: string;
  sha1: string;
  size: number;
  primary: boolean;
}

export interface ModrinthVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  changelog: string | null;
  gameVersions: string[];
  loaders: string[];
  versionType: "release" | "beta" | "alpha";
  datePublished: string;
  downloads: number;
  files: ModrinthVersionFile[];
}

export interface InstalledMod {
  id: string;
  instanceId: string;
  name: string;
  version: string;
  source: "modrinth" | "local";
  sourceId: string | null;
  sourceVersionId: string | null;
  filename: string;
  enabled: boolean;
  fileExists: boolean;
}

export interface ModUpdateInfo {
  modId: string;
  currentVersion: string;
  latestVersion: ModrinthVersion;
}

export interface ModDownloadProgressPayload {
  taskId: string;
  modName: string;
  instanceId: string;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface ModDownloadCompletePayload {
  taskId: string;
  success: boolean;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Skins                                                                       */
/* -------------------------------------------------------------------------- */

export interface SkinRecord {
  id: string;
  name: string;
  model: "classic" | "slim";
  dataUrl: string;
  createdAt: string;
}

/** Request/response shape for every invoke-style channel. */
export interface NoxaraApi {
  // Minecraft metadata
  getVersionManifest(forceRefresh?: boolean): Promise<VersionManifest>;
  getRecommendedJava(versionId: string): Promise<{ majorVersion: number }>;

  // Java
  detectJava(): Promise<JavaInstallation[]>;
  testJavaPath(path: string): Promise<JavaInstallation | null>;

  // Instances
  listInstances(): Promise<InstanceRecord[]>;
  createInstance(input: CreateInstanceInput): Promise<InstanceRecord>;
  deleteInstance(id: string): Promise<void>;
  duplicateInstance(id: string, newName: string): Promise<InstanceRecord>;
  openInstanceFolder(id: string): Promise<void>;

  // Accounts
  listAccounts(): Promise<AccountRecord[]>;
  createOfflineProfile(username: string): Promise<AccountRecord>;
  setActiveAccount(id: string): Promise<void>;
  removeAccount(id: string): Promise<void>;
  startMicrosoftLogin(): Promise<MicrosoftDeviceCodeInfo>;
  completeMicrosoftLogin(deviceCode: string, pollIntervalSeconds: number, expiresInSeconds: number): Promise<AccountRecord>;
  openExternal(url: string): Promise<void>;

  // Launch
  launchInstance(instanceId: string): Promise<{ started: boolean }>;

  // Forge
  getForgeVersions(mcVersion: string): Promise<ForgeVersion[]>;

  // Mods (Modrinth)
  searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult>;
  getModVersions(projectId: string, loader?: ModLoader, gameVersion?: string): Promise<ModrinthVersion[]>;
  installMod(instanceId: string, projectId: string, versionId: string): Promise<InstalledMod>;
  listInstalledMods(instanceId: string): Promise<InstalledMod[]>;
  removeMod(instanceId: string, modId: string): Promise<void>;
  checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]>;

  // Skins (local only — see skins.ts for what is/isn't actually applied in-game)
  listSkins(): Promise<SkinRecord[]>;
  uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): Promise<SkinRecord>;
  deleteSkin(id: string): Promise<void>;
  renameSkin(id: string, name: string): Promise<SkinRecord>;
  getAccountSkin(accountId: string): Promise<SkinRecord | null>;
  setAccountSkin(accountId: string, skinId: string | null): Promise<void>;

  // Window controls
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
}

export const IPC_CHANNELS = {
  getVersionManifest: "noxara:mojang:getVersionManifest",
  getRecommendedJava: "noxara:mojang:getRecommendedJava",
  detectJava: "noxara:java:detectAll",
  testJavaPath: "noxara:java:testPath",
  listInstances: "noxara:instances:list",
  createInstance: "noxara:instances:create",
  deleteInstance: "noxara:instances:delete",
  duplicateInstance: "noxara:instances:duplicate",
  openInstanceFolder: "noxara:instances:openFolder",
  listAccounts: "noxara:accounts:list",
  createOfflineProfile: "noxara:accounts:createOffline",
  setActiveAccount: "noxara:accounts:setActive",
  removeAccount: "noxara:accounts:remove",
  startMicrosoftLogin: "noxara:accounts:startMicrosoftLogin",
  completeMicrosoftLogin: "noxara:accounts:completeMicrosoftLogin",
  openExternal: "noxara:shell:openExternal",
  launchInstance: "noxara:launch:start",
  getForgeVersions: "noxara:forge:getVersions",
  searchMods: "noxara:mods:search",
  getModVersions: "noxara:mods:getVersions",
  installMod: "noxara:mods:install",
  listInstalledMods: "noxara:mods:listInstalled",
  removeMod: "noxara:mods:remove",
  checkModUpdates: "noxara:mods:checkUpdates",
  listSkins: "noxara:skins:list",
  uploadSkin: "noxara:skins:upload",
  deleteSkin: "noxara:skins:delete",
  renameSkin: "noxara:skins:rename",
  getAccountSkin: "noxara:skins:getForAccount",
  setAccountSkin: "noxara:skins:setForAccount",
  windowMinimize: "noxara:window:minimize",
  windowMaximize: "noxara:window:maximize",
  windowClose: "noxara:window:close",
  // Events (main -> renderer, one-way)
  eventDownloadProgress: "noxara:event:downloadProgress",
  eventDownloadComplete: "noxara:event:downloadComplete",
  eventGameOutput: "noxara:event:gameOutput",
  eventGameExit: "noxara:event:gameExit",
  eventModDownloadProgress: "noxara:event:modDownloadProgress",
  eventModDownloadComplete: "noxara:event:modDownloadComplete",
  eventForgeInstallProgress: "noxara:event:forgeInstallProgress",
} as const;
