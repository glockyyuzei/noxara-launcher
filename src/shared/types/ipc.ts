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

export type InstanceLoader = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";

export interface InstanceRecord {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: InstanceLoader;
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

/** A snapshot of an instance's folder, restorable onto the same instance later. */
export interface BackupRecord {
  id: string;
  instanceId: string;
  label: string;
  /** Absolute path to the `.zip` archive on disk. */
  path: string;
  sizeBytes: number;
  createdAt: string;
}

/** Mutable per-instance settings (everything else is immutable once created). */
export interface UpdateInstanceInput {
  name?: string;
  /** Absolute path to a pinned Java executable, or null to revert to auto-detection. */
  javaPath?: string | null;
  minRamMb?: number;
  maxRamMb?: number;
  /** Star on the library/home cards; drives sort order (favorites first). */
  favorite?: boolean;
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

/** A single-file download (mod / content) that the user can Cancel or Retry. Only
 * mod and content downloads register here — core batch downloads (client jars,
 * libraries, assets, loader installers) are part of atomic launch/install operations
 * and are intentionally not user-interruptible. */
export interface DownloadTaskInfo {
  taskId: string;
  kind: "mod" | "content";
}

export interface DownloadTasksChangedPayload {
  tasks: DownloadTaskInfo[];
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

/** Quilt Loader builds from Quilt's meta API (same shape as Fabric's). */
export interface QuiltLoaderVersion {
  version: string;
  stable: boolean;
  build: number | null;
  maven: string;
  separator?: string | null;
}

/** NeoForge builds, mirroring Forge's shape exactly (installation uses the same
 * Forge-style installer/processor pipeline). */
export interface NeoForgeVersion {
  minecraftVersion: string;
  forgeVersion: string;
  /** The exact "<mc>-<forge>" / "<neoforge>" string used in installer URLs — pass
   * this back as `loaderVersion` when creating a NeoForge instance. */
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

export type ModLoader = "fabric" | "forge" | "neoforge" | "quilt";

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

/** Where a mod is allowed to run. Maps to Modrinth's client_side/server_side facets. */
export type ModEnvironment = "all" | "client" | "server" | "both";

/** A Modrinth project category (e.g. "performance", "technology"), from /tag/category. */
export interface ModrinthCategory {
  name: string;
  slug: string;
  /** Modrinth's category icon URL. */
  icon: string;
}

export interface ModSearchQuery {
  query: string;
  loader?: ModLoader;
  gameVersion?: string;
  sort?: ModSearchSort;
  offset?: number;
  limit?: number;
  /** Which Modrinth project type to search for. Defaults to "mod". */
  projectType?: "mod" | ContentCategory;
  /** Single category slug (e.g. "performance") to narrow results to. */
  category?: string;
  /** Environment (client/server) filter. */
  environment?: ModEnvironment;
}

export interface ModrinthVersionFile {
  filename: string;
  url: string;
  sha1: string;
  size: number;
  primary: boolean;
}

export type ModrinthDependencyType = "required" | "optional" | "incompatible" | "embedded";

export interface ModrinthVersionDependency {
  projectId: string;
  /** Specific pinned version, when the mod pins one; null otherwise. */
  versionId: string | null;
  dependencyType: ModrinthDependencyType;
  fileName: string | null;
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
  dependencies: ModrinthVersionDependency[];
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
  category?: string;
  environment?: ModEnvironment;
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

/** A newer version of an installed Modrinth modpack, for the pack update check. */
export interface ModpackUpdateInfo {
  contentId: string;
  currentVersion: string;
  latestVersion: ModrinthVersion;
}

/** User-facing options when importing a .mrpack from disk into a brand-new instance. */
export interface ModpackImportInput {
  name: string;
  minRamMb: number;
  maxRamMb: number;
}

/* -------------------------------------------------------------------------- */
/* Global Activity system                                                      */
/* -------------------------------------------------------------------------- */

/** What kind of work an activity represents. Every long-running operation Noxara
 * performs (downloads, installs, imports/exports, repairs, backups, launches)
 * reports its real progress through this single global channel. */
export type ActivityType =
  | "minecraft" // Minecraft version download, libraries, assets, client files
  | "java" // Mojang bundled Java runtime download/install
  | "mod" // mod download / install / update
  | "content" // resource pack / shader download / install
  | "modpack" // modpack download / install / import / export
  | "loader" // Fabric / Forge / NeoForge / Quilt install
  | "instance" // create / duplicate / repair / launch / kill
  | "backup"; // backup / restore

/** Lifecycle of an activity. Not every stage is used by every operation — the
 * system only emits stages that reflect real work (no fake "Loading..." states). */
export type ActivityStatus =
  | "queued"
  | "preparing"
  | "downloading"
  | "verifying"
  | "installing"
  | "importing"
  | "exporting"
  | "repairing"
  | "launching"
  | "stopping"
  | "completed"
  | "failed"
  | "cancelled";

/** Numeric progress for an activity. Every field is optional and only present when
 * the backend actually knows the value — the renderer must never invent progress. */
export interface ActivityProgress {
  /** 0..1 overall progress. Absent/undefined = indeterminate (no total known). */
  progress?: number;
  /** Bytes transferred so far (for downloads/installs). */
  currentBytes?: number;
  /** Total bytes to transfer, when the server reports a size. */
  totalBytes?: number;
  /** Transfer rate in bytes/sec, when derivable from real byte deltas. */
  speedBytesPerSec?: number;
  /** Estimated seconds remaining, when a rate is known. */
  etaSeconds?: number;
  /** The file currently being downloaded/processed. */
  currentFile?: string;
  /** Files completed so far (batch operations). */
  completedFiles?: number;
  /** Total number of files (batch operations). */
  totalFiles?: number;
}

export interface ActivityRecord {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  /** Short human title, e.g. "Sodium". */
  title: string;
  /** Secondary line, e.g. "Installing mod" or the current operation name. */
  description?: string;
  instanceId?: string;
  progress: ActivityProgress;
  /** Human-readable failure message (status === "failed"). */
  error?: string;
  /** True when the backend can safely cancel this operation. */
  cancellable: boolean;
  /** True when the backend can retry this operation under the same id. */
  retryable: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Full snapshot of the backend's activity registry (active + recent history). */
export interface ActivityListPayload {
  activities: ActivityRecord[];
}

/** A single activity changed. `terminal` is true when it just entered a finished
 * state (completed/failed/cancelled) so the UI can move it into Recent. */
export interface ActivityUpdatedPayload {
  activity: ActivityRecord;
  terminal: boolean;
}

/** An activity was removed (e.g. recent history cleared or pruned). */
export interface ActivityRemovedPayload {
  id: string;
}

/* -------------------------------------------------------------------------- */
/* Instance Health                                                            */
/* -------------------------------------------------------------------------- */

export type InstanceHealthStatus = "healthy" | "attention" | "broken";

export interface InstanceHealthCheck {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail?: string;
}

export interface InstanceHealthReport {
  status: InstanceHealthStatus;
  checks: InstanceHealthCheck[];
}

/* -------------------------------------------------------------------------- */
/* Instance lifecycle + crash detection                                       */
/* -------------------------------------------------------------------------- */

/** The real lifecycle state of an instance, derived from backend signals (launch
 * events, the process registry, and the global activity manager). The UI reacts to
 * this instead of assuming "Play" vs "not Play". */
export type InstanceState =
  | "READY"
  | "CREATING"
  | "DOWNLOADING"
  | "INSTALLING"
  | "LAUNCHING"
  | "RUNNING"
  | "STOPPING"
  | "CRASHED"
  | "ERROR";

/** Deterministic crash diagnosis attached to an instance after the game exits
 * unexpectedly. `reason`/`hint` are user-facing; `patternId` is a stable key for
 * debugging and future automation. */
export interface CrashInfo {
  exitCode: number | null;
  /** User-facing explanation ("Minecraft stopped unexpectedly."). */
  reason: string;
  /** Suggested next step ("Increase allocated RAM in the instance settings."). */
  hint: string;
  /** Stable pattern id, e.g. "out_of_memory" | "missing_dependency" | ... */
  patternId: string;
  /** Matched technical detail (exception class / message) for the log viewer. */
  detail?: string;
  occurredAt: string;
}

/* -------------------------------------------------------------------------- */
/* Mod dependencies (Modrinth)                                                */
/* -------------------------------------------------------------------------- */

export type ModDependencyKind = "required" | "optional" | "incompatible" | "embedded";

export interface ModDependency {
  projectId: string;
  versionId: string | null;
  dependencyType: ModDependencyKind;
  /** Best-effort display metadata resolved from the project (may be absent if the
   * project lookup fails). */
  name?: string;
  iconUrl?: string | null;
}

export interface ModDependenciesResult {
  /** Required dependencies that are already installed for this instance. */
  present: Array<{ dependency: ModDependency; installed: boolean }>;
  /** Required dependencies that are missing and would need installing. */
  missing: ModDependency[];
  /** Dependencies that conflict with this mod; `installed` is true when the conflict
   * is real (the project is already installed in this instance) and the UI should
   * block the install rather than just inform. */
  incompatible: Array<{ dependency: ModDependency; installed: boolean }>;
  optional: ModDependency[];
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

/** Result of the Minecraft Server List Ping protocol probe. */
export interface ServerPingResult {
  online: boolean;
  /** Round-trip time of the ping packet in ms, when the server answered it. */
  latencyMs: number | null;
  versionName: string | null;
  protocol: number | null;
  playersOnline: number | null;
  playersMax: number | null;
  /** MotD: either a plain string or the chat component JSON rendered as text. */
  description: string | null;
  /** Base64 data URL rendered by the client; present when the server exposes one. */
  favicon: string | null;
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
/* Storage management                                                         */
/* -------------------------------------------------------------------------- */

export interface StorageCategory {
  id: string;
  label: string;
  /** Absolute path this category covers (display + clear target). */
  path: string;
  sizeBytes: number;
  /** True when the data is regenerable (caches/temp) and safe to wipe. */
  clearable: boolean;
  /** One-line explanation shown in the UI. */
  hint: string;
}

export interface StorageBreakdown {
  categories: StorageCategory[];
  totalBytes: number;
  /** Free / total bytes on the volume hosting the launcher data. */
  diskFreeBytes: number;
  diskTotalBytes: number;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface SystemInfo {
  /** Total system RAM in MB (round( os.totalmem() / MB )). */
  totalRamMb: number;
}

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

  /* General */
  /** Register Noxara to start when the user signs in to Windows. */
  startOnBoot: boolean;
  /** Minimize to the system tray instead of the taskbar when the window is minimized. */
  minimizeToTray: boolean;
  /** Ask for confirmation before closing the window while instances are running. */
  confirmBeforeCloseRunningInstances: boolean;

  /* Appearance */
  /** Root font-size multiplier (0.9 / 1 / 1.1 / 1.25). Applied as a CSS scale. */
  uiScale: number;
  /** Tighter paddings/gaps across the UI. */
  compactMode: boolean;
  /** Enables CSS transitions/animations. */
  uiAnimations: boolean;

  /* Downloads */
  /** Per-file retry attempts for batch downloads (1..5). */
  downloadRetryCount: number;
  /** Per-file request timeout in seconds for batch downloads (30..600). */
  downloadTimeoutSec: number;

  /* Advanced */
  /** Verbose noxara-core logging (applied on the next core restart). */
  debugMode: boolean;
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

/** The texture the 3D skin viewer should render for an account: for Microsoft accounts
 * this is the account's real current Mojang skin (fetched fresh); for offline accounts
 * it's their locally stored skin. `null` from the API means no skin is available and the
 * viewer shows its default placeholder. */
export interface AccountSkinTexture {
  dataUrl: string;
  model: "classic" | "slim";
  source: "library" | "mojang";
}

/** Request/response shape for every invoke-style channel. */
export interface NoxaraApi {
  // Minecraft metadata
  getVersionManifest(forceRefresh?: boolean): Promise<VersionManifest>;

  // Java
  detectJava(): Promise<JavaInstallation[]>;
  testJavaPath(path: string): Promise<JavaInstallation | null>;
  /** Downloads/installs Mojang's official bundled Java runtime for a major version
   * (e.g. 8/17/21) into the launcher's managed Java directory. Progress is reported
   * through the global activity system. Returns the detected installation. */
  ensureJavaRuntime(majorVersion: number): Promise<JavaInstallation>;

  // Instances
  listInstances(): Promise<InstanceRecord[]>;
  createInstance(input: CreateInstanceInput): Promise<InstanceRecord>;
  updateInstance(id: string, patch: UpdateInstanceInput): Promise<InstanceRecord>;
  deleteInstance(id: string): Promise<void>;
  duplicateInstance(id: string, newName: string): Promise<InstanceRecord>;
  openInstanceFolder(id: string): Promise<void>;

  // Instance backups
  listBackups(instanceId: string): Promise<BackupRecord[]>;
  createBackup(instanceId: string, label: string): Promise<BackupRecord>;
  restoreBackup(backupId: string): Promise<void>;
  deleteBackup(backupId: string): Promise<void>;

  // Storage management
  getStorageBreakdown(): Promise<StorageBreakdown>;
  /** Clears a clearable storage category and returns the fresh breakdown. */
  clearStorageCache(categoryId: string): Promise<StorageBreakdown>;

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

  // NeoForge
  getNeoForgeVersions(mcVersion: string): Promise<NeoForgeVersion[]>;

  // Fabric
  getFabricLoaderVersions(mcVersion: string, forceRefresh?: boolean): Promise<FabricLoaderVersion[]>;

  // Quilt
  getQuiltLoaderVersions(mcVersion: string, forceRefresh?: boolean): Promise<QuiltLoaderVersion[]>;

  // Mods (Modrinth)
  searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult>;
  getModCategories(): Promise<ModrinthCategory[]>;
  getModVersions(projectId: string, loader?: ModLoader, gameVersion?: string): Promise<ModrinthVersion[]>;
  installMod(instanceId: string, projectId: string, versionId: string): Promise<InstalledMod>;
  listInstalledMods(instanceId: string): Promise<InstalledMod[]>;
  removeMod(instanceId: string, modId: string): Promise<void>;
  checkModUpdates(instanceId: string): Promise<ModUpdateInfo[]>;
  /** Resolves a version's Modrinth dependencies against what's installed in an
   * instance — used to show "This mod requires…" and gate installs. */
  getModDependencies(instanceId: string, versionId: string): Promise<ModDependenciesResult>;

  // Content (resource packs / shaders / modpacks via Modrinth)
  installContent(instanceId: string, versionId: string, category: ContentCategory): Promise<InstalledContent>;
  listInstalledContent(instanceId: string, category: ContentCategory): Promise<InstalledContent[]>;
  removeContent(instanceId: string, itemId: string, category: ContentCategory): Promise<void>;
  setContentEnabled(instanceId: string, itemId: string, category: ContentCategory, enabled: boolean): Promise<void>;
  checkModpackUpdates(instanceId: string): Promise<ModpackUpdateInfo[]>;
  /** Checks installed resource packs / shaders for a newer published version. */
  checkContentUpdates(instanceId: string, category: ContentCategory): Promise<ModpackUpdateInfo[]>;

  // Modpacks (import/export .mrpack files)
  pickModpackFile(): Promise<string | null>;
  importModpackFromFile(mrpackPath: string, input: ModpackImportInput): Promise<InstanceRecord>;
  pickModpackSavePath(defaultFileName: string): Promise<string | null>;
  exportModpack(instanceId: string, destPath: string): Promise<{ exported: boolean }>;

  // Download control (cancel/retry for single-file mod/content downloads)
  listDownloadTasks(): Promise<DownloadTaskInfo[]>;
  cancelDownload(taskId: string): Promise<void>;
  retryDownload(taskId: string): Promise<void>;

  // Global activities (progress/status for every long-running operation)
  listActivities(): Promise<ActivityListPayload>;
  cancelActivity(activityId: string): Promise<void>;
  retryActivity(activityId: string): Promise<void>;
  clearCompletedActivities(): Promise<void>;

  // Instance health
  checkInstanceHealth(instanceId: string): Promise<InstanceHealthReport>;
  repairInstance(instanceId: string): Promise<InstanceHealthReport>;

  // Servers
  listServers(instanceId?: string | null): Promise<ServerRecord[]>;
  addServer(input: ServerInput): Promise<ServerRecord>;
  updateServer(id: string, input: Partial<ServerInput>): Promise<ServerRecord>;
  removeServer(id: string): Promise<void>;
  pingServer(address: string, port: number): Promise<ServerPingResult>;

  // Settings
  getSettings(): Promise<LauncherSettings>;
  setSettings(partial: Partial<LauncherSettings>): Promise<LauncherSettings>;

  /** Basic host info (total RAM) used by UI validation that mirrors core-side rules. */
  getSystemInfo(): Promise<SystemInfo>;

  // Native pickers (used by Settings to choose a game directory / Java executable)
  pickFolder(title: string): Promise<string | null>;
  pickJavaExecutable(): Promise<string | null>;

  // Skins (local only — see skins.ts for what is/isn't actually applied in-game)
  listSkins(): Promise<SkinRecord[]>;
  uploadSkin(name: string, base64Png: string, model: "classic" | "slim"): Promise<SkinRecord>;
  deleteSkin(id: string): Promise<void>;
  renameSkin(id: string, name: string): Promise<SkinRecord>;
  getAccountSkin(accountId: string): Promise<SkinRecord | null>;
  applySkin(accountId: string, skinId: string): Promise<void>;
  /** Resolves the account's actual current skin texture for the 3D viewer (Mojang's
   * current skin for Microsoft accounts, the stored skin for offline accounts). */
  getAccountSkinTexture(accountId: string): Promise<AccountSkinTexture | null>;

  // Window controls
  windowMinimize(): void;
  windowMaximize(): void;
  windowClose(): void;
}

export const IPC_CHANNELS = {
  getVersionManifest: "noxara:mojang:getVersionManifest",
  detectJava: "noxara:java:detectAll",
  testJavaPath: "noxara:java:testPath",
  ensureJavaRuntime: "noxara:java:ensureRuntime",
  listInstances: "noxara:instances:list",
  createInstance: "noxara:instances:create",
  updateInstance: "noxara:instances:update",
  deleteInstance: "noxara:instances:delete",
  duplicateInstance: "noxara:instances:duplicate",
  openInstanceFolder: "noxara:instances:openFolder",
  listBackups: "noxara:backups:list",
  createBackup: "noxara:backups:create",
  restoreBackup: "noxara:backups:restore",
  deleteBackup: "noxara:backups:delete",
  getStorageBreakdown: "noxara:storage:breakdown",
  clearStorageCache: "noxara:storage:clear",
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
  getNeoForgeVersions: "noxara:neoforge:getVersions",
  getFabricLoaderVersions: "noxara:fabric:getLoaderVersions",
  getQuiltLoaderVersions: "noxara:quilt:getLoaderVersions",
  searchMods: "noxara:mods:search",
  getModCategories: "noxara:mods:getCategories",
  getModVersions: "noxara:mods:getVersions",
  installMod: "noxara:mods:install",
  listInstalledMods: "noxara:mods:listInstalled",
  removeMod: "noxara:mods:remove",
  checkModUpdates: "noxara:mods:checkUpdates",
  getModDependencies: "noxara:mods:getDependencies",
  installContent: "noxara:content:install",
  listInstalledContent: "noxara:content:listInstalled",
  removeContent: "noxara:content:remove",
  setContentEnabled: "noxara:content:setEnabled",
  checkModpackUpdates: "noxara:content:checkModpackUpdates",
  checkContentUpdates: "noxara:content:checkContentUpdates",
  pickModpackFile: "noxara:modpacks:pickFile",
  importModpackFromFile: "noxara:modpacks:import",
  pickModpackSavePath: "noxara:modpacks:pickSavePath",
  exportModpack: "noxara:modpacks:export",
  listDownloadTasks: "noxara:downloads:listTasks",
  cancelDownload: "noxara:downloads:cancel",
  retryDownload: "noxara:downloads:retry",
  listActivities: "noxara:activities:list",
  cancelActivity: "noxara:activities:cancel",
  retryActivity: "noxara:activities:retry",
  clearCompletedActivities: "noxara:activities:clearCompleted",
  checkInstanceHealth: "noxara:instances:health",
  repairInstance: "noxara:instances:repair",
  listServers: "noxara:servers:list",
  addServer: "noxara:servers:add",
  updateServer: "noxara:servers:update",
  removeServer: "noxara:servers:remove",
  pingServer: "noxara:servers:ping",
  getSettings: "noxara:settings:get",
  setSettings: "noxara:settings:set",
  getSystemInfo: "noxara:system:info",
  pickFolder: "noxara:shell:pickFolder",
  pickJavaExecutable: "noxara:shell:pickJavaExecutable",
  openDataDirectory: "noxara:shell:openDataDirectory",
  listRunningInstances: "noxara:launch:running",
  killInstance: "noxara:launch:kill",
  listSkins: "noxara:skins:list",
  uploadSkin: "noxara:skins:upload",
  deleteSkin: "noxara:skins:delete",
  renameSkin: "noxara:skins:rename",
  getAccountSkin: "noxara:skins:getForAccount",
  applySkin: "noxara:skins:apply",
  getAccountSkinTexture: "noxara:skins:getTexture",
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
  eventDownloadTasksChanged: "noxara:event:downloadTasksChanged",
  eventForgeInstallProgress: "noxara:event:forgeInstallProgress",
  // Global activity events (main -> renderer, one-way)
  eventActivityUpdated: "noxara:event:activityUpdated",
  eventActivityRemoved: "noxara:event:activityRemoved",
} as const;
