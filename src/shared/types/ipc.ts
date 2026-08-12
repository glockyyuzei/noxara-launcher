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

export interface GameStartedPayload {
  instanceId: string;
  pid: number;
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

/* -------------------------------------------------------------------------- */
/* Fabric                                                                     */
/* -------------------------------------------------------------------------- */

export interface FabricLoaderVersion {
  version: string;
  stable: boolean;
  build: number | null;
  maven: string;
  separator?: string | null;
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
  /** Which Modrinth project type to search for. Defaults to "mod". */
  projectType?: "mod" | ContentCategory;
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
  /** "modpack" marks mods that were installed as part of a modpack (uninstalling the
   * pack removes them together). */
  source: "modrinth" | "modpack" | "local";
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
/* Content (resource packs, shaders, modpacks)                                 */
/* -------------------------------------------------------------------------- */

export type ContentCategory = "resourcepack" | "shader" | "modpack";

export interface ContentSearchQuery {
  query: string;
  projectType: "mod" | ContentCategory;
  loader?: ModLoader;
  gameVersion?: string;
  sort?: ModSearchSort;
  offset?: number;
  limit?: number;
}

export interface InstalledContent {
  id: string;
  instanceId: string;
  category: ContentCategory;
  name: string;
  version: string;
  source: "modrinth" | "local";
  sourceId: string | null;
  sourceVersionId: string | null;
  filename: string;
  enabled: boolean;
  fileExists: boolean;
  /** Present for modpacks: JSON describing the files the pack installed so they
   * can be uninstalled individually. */
  manifest?: string;
}

export interface ContentDownloadProgressPayload {
  taskId: string;
  name: string;
  category: ContentCategory;
  instanceId: string;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface ContentDownloadCompletePayload {
  taskId: string;
  category: ContentCategory;
  success: boolean;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Servers                                                                    */
/* -------------------------------------------------------------------------- */

export interface ServerRecord {
  id: string;
  name: string;
  address: string;
  port: number;
  iconData: string | null;
  favorite: boolean;
  /** Null means the server appears in every instance's list. */
  instanceId: string | null;
  createdAt: string;
}

export interface ServerInput {
  name: string;
  address: string;
  port?: number;
  iconData?: string | null;
  instanceId?: string | null;
  /** Toggles whether the server is starred. (addServer always records false.) */
  favorite?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface LauncherSettings {
  /** Absolute directory new instances are created under. Empty = default. */
  gameDir: string;
  /** Optional default Java executable used when an instance has none pinned. */
  defaultJavaPath: string;
  /** When true (default) the launcher auto-detects the best Java; when false it uses
   * `defaultJavaPath` (when set) instead. */
  autoDetectJava: boolean;
  defaultMinRamMb: number;
  defaultMaxRamMb: number;
  launchWidth: number;
  launchHeight: number;
  minimizeOnLaunch: boolean;
  closeOnLaunch: boolean;
  startMinimized: boolean;
  showSnapshots: boolean;
  maxConcurrentDownloads: number;
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
  /** Re-fetches a Microsoft account's profile (gamertag, UUID, avatar) and returns the
   * freshest stored record. Offline accounts are returned unchanged. */
  refreshAccountProfile(accountId: string): Promise<AccountRecord>;

  // Launch
  /**
   * Starts an instance. `extraGameArgs` (e.g. `["--server", "mc.example.com", "--port", "25565"]`
   * to join a multiplayer server on launch) are appended to the game arguments verbatim.
   */
  launchInstance(instanceId: string, extraGameArgs?: string[]): Promise<{ started: boolean }>;
  listRunningInstances(): Promise<string[]>;
  killInstance(instanceId: string): Promise<void>;

  // Forge
  getForgeVersions(mcVersion: string): Promise<ForgeVersion[]>;

  // Fabric
  getFabricLoaderVersions(mcVersion: string, forceRefresh?: boolean): Promise<FabricLoaderVersion[]>;

  // Mods (Modrinth)
  searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult>;
  getModVersions(projectId: string, loader?: ModLoader, gameVersion?: string): Promise<ModrinthVersion[]>;
  installMod(instanceId: string, projectId: string, versionId: string): Promise<InstalledMod>;
  listInstalledMods(instanceId: string): Promise<InstalledMod[]>;
  removeMod(instanceId: string, modId: string): Promise<void>;
  checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]>;

  // Content (resource packs / shaders / modpacks via Modrinth)
  installContent(instanceId: string, versionId: string, category: ContentCategory): Promise<InstalledContent>;
  listInstalledContent(instanceId: string, category: ContentCategory): Promise<InstalledContent[]>;
  removeContent(instanceId: string, itemId: string, category: ContentCategory): Promise<void>;
  setContentEnabled(instanceId: string, itemId: string, category: ContentCategory, enabled: boolean): Promise<void>;

  // Servers
  listServers(instanceId?: string | null): Promise<ServerRecord[]>;
  addServer(input: ServerInput): Promise<ServerRecord>;
  updateServer(id: string, input: Partial<ServerInput>): Promise<ServerRecord>;
  removeServer(id: string): Promise<void>;

  // Settings
  getSettings(): Promise<LauncherSettings>;
  setSettings(partial: Partial<LauncherSettings>): Promise<LauncherSettings>;

  // Native pickers (used by Settings to choose a game directory / Java executable)
  pickFolder(title: string): Promise<string | null>;
  pickJavaExecutable(): Promise<string | null>;

  // Skins (local only — see skins.ts for what is/isn't actually applied in-game)
  listSkins(): Promise<SkinRecord[]>;
  uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): Promise<SkinRecord>;
  deleteSkin(id: string): Promise<void>;
  renameSkin(id: string, name: string): Promise<SkinRecord>;
  getAccountSkin(accountId: string): Promise<SkinRecord | null>;
  setAccountSkin(accountId: string, skinId: string | null): Promise<void>;
  applySkin(accountId: string, skinId: string): Promise<void>;

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
  refreshAccountProfile: "noxara:accounts:refreshProfile",
  launchInstance: "noxara:launch:start",
  getForgeVersions: "noxara:forge:getVersions",
  getFabricLoaderVersions: "noxara:fabric:getLoaderVersions",
  searchMods: "noxara:mods:search",
  getModVersions: "noxara:mods:getVersions",
  installMod: "noxara:mods:install",
  listInstalledMods: "noxara:mods:listInstalled",
  removeMod: "noxara:mods:remove",
  checkModUpdates: "noxara:mods:checkUpdates",
  installContent: "noxara:content:install",
  listInstalledContent: "noxara:content:listInstalled",
  removeContent: "noxara:content:remove",
  setContentEnabled: "noxara:content:setEnabled",
  listServers: "noxara:servers:list",
  addServer: "noxara:servers:add",
  updateServer: "noxara:servers:update",
  removeServer: "noxara:servers:remove",
  getSettings: "noxara:settings:get",
  setSettings: "noxara:settings:set",
  pickFolder: "noxara:shell:pickFolder",
  pickJavaExecutable: "noxara:shell:pickJavaExecutable",
  listRunningInstances: "noxara:launch:running",
  killInstance: "noxara:launch:kill",
  listSkins: "noxara:skins:list",
  uploadSkin: "noxara:skins:upload",
  deleteSkin: "noxara:skins:delete",
  renameSkin: "noxara:skins:rename",
  getAccountSkin: "noxara:skins:getForAccount",
  setAccountSkin: "noxara:skins:setForAccount",
  applySkin: "noxara:skins:apply",
  windowMinimize: "noxara:window:minimize",
  windowMaximize: "noxara:window:maximize",
  windowClose: "noxara:window:close",
  // Events (main -> renderer, one-way)
  eventDownloadProgress: "noxara:event:downloadProgress",
  eventDownloadComplete: "noxara:event:downloadComplete",
  eventGameOutput: "noxara:event:gameOutput",
  eventGameExit: "noxara:event:gameExit",
  eventGameStarted: "noxara:event:gameStarted",
  eventModDownloadProgress: "noxara:event:modDownloadProgress",
  eventModDownloadComplete: "noxara:event:modDownloadComplete",
  eventContentDownloadProgress: "noxara:event:contentDownloadProgress",
  eventContentDownloadComplete: "noxara:event:contentDownloadComplete",
  eventForgeInstallProgress: "noxara:event:forgeInstallProgress",
} as const;
