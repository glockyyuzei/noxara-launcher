/**
 * Installs/removes/enables resource packs, shaders, and modpacks for an instance.
 *
 * Resource packs and shaders are single downloaded files dropped into the
 * instance's `resourcepacks` / `shaderpacks` folders (created at instance-creation
 * time) and tracked in the `content_items` SQLite table. Enable/disable renames the
 * file to a `.disabled` suffix so the game ignores it without deleting it.
 *
 * Modpacks are `.mrpack` archives from Modrinth: the archive is downloaded, extracted
 * with noxara-core's `modpack.extract` (path-traversal safe), its `overrides/`
 * contents are merged into the instance directory, and every client-supported mod
 * listed in the pack's manifest is installed into the instance's `mods` folder and
 * recorded in the existing `mods` table with source='modpack' so it shows up (and can
 * be uninstalled) alongside normally-installed mods. Uninstalling a modpack removes
 * exactly the files it installed — verified by sha1 so user changes are never deleted.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { getDb } from "./database";
import { getInstanceDirById, listInstances, createInstance } from "./instances";
import { assertWithin, rootDir } from "../filesystem/paths";
import { registerDownload, unregisterDownload, signalFor } from "./download-control";
import { coreBridge } from "./core-bridge";
import * as modrinth from "./modrinth";
import type {
  ContentCategory,
  InstanceRecord,
  InstalledContent,
  ModLoader,
  ModpackImportInput,
  ModpackUpdateInfo,
  ModrinthVersion,
} from "../../shared/types/ipc";

/** Emits "progress" / "complete" for the IPC layer to forward to the renderer. */
export const contentDownloadEvents = new EventEmitter();

interface ContentRow {
  id: string;
  instance_id: string;
  category: ContentCategory;
  name: string;
  version: string;
  source: "modrinth" | "local";
  source_id: string | null;
  source_version_id: string | null;
  filename: string;
  enabled: number;
  sha1: string | null;
  game_version: string | null;
  loader: string | null;
  manifest: string | null;
}

/** The staging folder a modpack's files are extracted into before merging. */
function modpackStagingDir(instanceDir: string): string {
  const dir = path.join(instanceDir, ".noxara", "modpacks");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function dirForCategory(instanceId: string, category: ContentCategory): string {
  const instanceDir = getInstanceDirById(instanceId);
  const sub = category === "resourcepack" ? "resourcepacks" : category === "shader" ? "shaderpacks" : "mods";
  const dir = path.join(instanceDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rowToRecord(row: ContentRow): InstalledContent {
  const dir = dirForCategory(row.instance_id, row.category);
  const fileExists = row.category === "modpack"
    ? fs.existsSync(path.join(modpackStagingDir(getInstanceDirById(row.instance_id)), `${row.id}.mrpack`))
    : fs.existsSync(path.join(dir, row.filename));
  return {
    id: row.id,
    instanceId: row.instance_id,
    category: row.category,
    name: row.name,
    version: row.version,
    source: row.source,
    sourceId: row.source_id,
    sourceVersionId: row.source_version_id,
    filename: row.filename,
    enabled: Boolean(row.enabled),
    fileExists,
    manifest: row.manifest ?? undefined,
  };
}

export function listInstalledContent(instanceId: string, category: ContentCategory): InstalledContent[] {
  const rows = getDb()
    .prepare("SELECT * FROM content_items WHERE instance_id = ? AND category = ? ORDER BY name COLLATE NOCASE ASC")
    .all(instanceId, category) as ContentRow[];
  return rows.map(rowToRecord);
}

function instanceLoaderAndVersion(instanceId: string): { loader: ModLoader | null; gameVersion: string } {
  const instance = listInstances().find((i) => i.id === instanceId);
  if (!instance) throw new Error(`instance ${instanceId} not found`);
  const loader = ["fabric", "forge", "neoforge", "quilt"].includes(instance.loader)
    ? (instance.loader as ModLoader)
    : null;
  return { loader, gameVersion: instance.minecraftVersion };
}

function sha1Of(filePath: string): string {
  const hash = createHash("sha1");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function downloadWithProgress(
  url: string,
  destPath: string,
  taskId: string,
  name: string,
  category: ContentCategory,
  instanceId: string
): Promise<void> {
  // When the user hits Cancel on the Downloads page this signal aborts mid-stream.
  const res = await fetch(url, { signal: signalFor(taskId) });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${res.statusText}`);
  }
  const totalBytes = Number(res.headers.get("content-length") ?? 0);
  const reader = res.body.getReader();
  const tmpPath = `${destPath}.part`;
  const fileHandle = fs.createWriteStream(tmpPath);

  let bytesDownloaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await new Promise<void>((resolve, reject) => {
          fileHandle.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()));
        });
        bytesDownloaded += value.byteLength;
        contentDownloadEvents.emit("progress", {
          taskId,
          name,
          category,
          instanceId,
          bytesDownloaded,
          totalBytes,
        });
      }
    }
    await new Promise<void>((resolve, reject) =>
      fileHandle.close((err) => (err ? reject(err) : resolve()))
    );
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    fileHandle.close();
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

/** Installs a single downloaded mod file from a modpack into the instance's mods dir
 * and records it in the `mods` table so it's tracked like any installed mod. */

async function downloadPackFile(url: string, destPath: string, sha1: string | null): Promise<void> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha1 && sha1OfTmp(buf) !== sha1.toLowerCase()) {
    throw new Error("Downloaded modpack file failed checksum verification.");
  }
  fs.writeFileSync(destPath, buf);
}

function sha1OfTmp(buf: Buffer): string {
  const hash = createHash("sha1");
  hash.update(buf);
  return hash.digest("hex");
}

async function installModpack(instanceId: string, version: ModrinthVersion): Promise<InstalledContent> {
  const { loader } = instanceLoaderAndVersion(instanceId);
  if (!loader) {
    throw new Error("Modpacks require a Fabric or Forge instance.");
  }
  if (!version.loaders.includes(loader)) {
    throw new Error(
      `This modpack doesn't support the ${loader} loader (supports: ${version.loaders.join(", ") || "none"}).`
    );
  }

  const contentId = randomUUID();
  const taskId = randomUUID();
  // Register so the Downloads page can Cancel the .mrpack download / Retry the whole
  // pack install under the SAME taskId.
  registerDownload(taskId, {
    kind: "content",
    run: () => installModpackCore(instanceId, version, contentId, taskId).then(() => undefined),
  });
  try {
    const result = await installModpackCore(instanceId, version, contentId, taskId);
    unregisterDownload(taskId);
    return result;
  } catch (err) {
    // Keep the handles registered so a failed install can be Retried from the UI.
    throw err;
  }
}

async function installModpackCore(
  instanceId: string,
  version: ModrinthVersion,
  contentId: string,
  taskId: string
): Promise<InstalledContent> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);
  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error("This modpack version has no downloadable file.");

  const mrpackPath = path.join(modpackStagingDir(getInstanceDirById(instanceId)), `${contentId}.mrpack`);
  try {
    await downloadWithProgress(file.url, mrpackPath, taskId, version.name, "modpack", instanceId);
    const result = await installMrpackContents(instanceId, mrpackPath, {
      contentId,
      gameVersion,
      loader,
      meta: {
        taskId,
        packName: version.name,
        versionNumber: version.versionNumber,
        source: "modrinth",
        sourceId: version.projectId,
        sourceVersionId: version.id,
      },
    });
    contentDownloadEvents.emit("complete", { taskId, category: "modpack", success: true });
    return result;
  } catch (err) {
    fs.rmSync(mrpackPath, { force: true });
    contentDownloadEvents.emit("complete", {
      taskId,
      category: "modpack",
      success: false,
      error: err instanceof Error ? err.message : "Modpack install failed",
    });
    throw err;
  }
}

interface MrpackInstallOptions {
  contentId: string;
  gameVersion: string;
  loader: ModLoader | null;
  meta: {
    taskId: string;
    packName: string;
    versionNumber: string;
    source: "modrinth" | "local";
    sourceId: string | null;
    sourceVersionId: string | null;
  };
}

/** Installs a .mrpack archive that is already on disk: extracts it (path-traversal
 * safe via noxara-core), merges `overrides/` into the instance, downloads every
 * client-supported mod listed in the manifest, and records the pack in `content_items`
 * (upserting by source_id so reinstalling/updating a pack replaces its old files). */
async function installMrpackContents(
  instanceId: string,
  mrpackPath: string,
  opts: MrpackInstallOptions
): Promise<InstalledContent> {
  const instanceDir = getInstanceDirById(instanceId);
  const staging = modpackStagingDir(instanceDir);
  const extractDir = path.join(staging, `${opts.contentId}.extracted`);
  const createdModIds: string[] = [];
  let contentId = opts.contentId;

  try {
    await coreBridge.call<{ entries: string[] }>(
      "modpack.extract",
      { zipPath: mrpackPath, destDir: extractDir },
      120_000
    );

    const indexPath = path.join(extractDir, "modrinth.index.json");
    if (!fs.existsSync(indexPath)) {
      throw new Error("This .mrpack is missing its modrinth.index.json manifest.");
    }
    const manifest = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as {
      name?: string;
      versionId?: string;
      dependencies?: Record<string, { version_id?: string; project_id?: string }>;
      files: Array<{
        path: string;
        hashes?: { sha1?: string };
        downloads?: string[];
        fileSize?: number;
        env?: { client?: string; server?: string };
      }>;
    };

    // Merge `overrides/` into the instance directory (configs, resource packs, saves…).
    const overridesDir = path.join(extractDir, "overrides");
    if (fs.existsSync(overridesDir)) {
      copyDirInto(overridesDir, instanceDir, (rel) => ["mods"].includes(rel.split("/")[0]));
    }

    const db = getDb();

    // Updating/reinstalling a pack that's already present (same source_id) must first
    // remove its tracked files so an update never leaves stale mods or overrides behind.
    if (opts.meta.sourceId) {
      const existing = db
        .prepare("SELECT * FROM content_items WHERE instance_id = ? AND category = 'modpack' AND source_id = ?")
        .get(instanceId, opts.meta.sourceId) as ContentRow | undefined;
      if (existing) {
        uninstallModpack(instanceId, existing);
        contentId = existing.id;
        const wanted = path.join(staging, `${contentId}.mrpack`);
        if (path.resolve(mrpackPath) !== path.resolve(wanted)) {
          fs.renameSync(mrpackPath, wanted);
        }
        mrpackPath = wanted;
      }
    }

    const installedFiles: Array<{ path: string; sha1: string | null; size: number }> = [];

    for (const entry of manifest.files ?? []) {
      const clientEnv = entry.env?.client;
      if (clientEnv === "unsupported") continue;
      const relPath = entry.path.replace(/\\/g, "/");
      if (!relPath.startsWith("mods/")) continue;

      const fileName = path.basename(relPath);
      const safeFilename = path.basename(fileName);
      const destPath = assertWithin(path.join(instanceDir, "mods"), safeFilename);
      const url = entry.downloads?.[0];
      if (!url) continue;

      await downloadPackFile(url, destPath, entry.hashes?.sha1 ?? null);
      const actualSha1 = sha1Of(destPath);
      installedFiles.push({ path: relPath, sha1: actualSha1, size: entry.fileSize ?? 0 });

      const modId = randomUUID();
      createdModIds.push(modId);
      db.prepare(
        `INSERT INTO mods (id, instance_id, name, version, source, source_id, source_version_id, filename, enabled, sha1, game_version, loader)
         VALUES (?, ?, ?, ?, 'modpack', ?, ?, ?, 1, ?, ?, ?)`
      ).run(
        modId,
        instanceId,
        entry.path.split("/").pop()?.replace(/\.(jar|zip)$/i, "") || "pack mod",
        opts.meta.versionNumber,
        opts.meta.sourceId,
        entry.hashes?.sha1 ?? null,
        safeFilename,
        actualSha1,
        opts.gameVersion,
        opts.loader
      );
    }

    const packName = manifest.name || opts.meta.packName;
    const row: ContentRow = {
      id: contentId,
      instance_id: instanceId,
      category: "modpack",
      name: packName,
      version: opts.meta.versionNumber,
      source: opts.meta.source,
      source_id: opts.meta.sourceId,
      source_version_id: opts.meta.sourceVersionId,
      filename: path.basename(mrpackPath),
      enabled: 1,
      sha1: null,
      game_version: opts.gameVersion,
      loader: opts.loader,
      manifest: JSON.stringify({ files: installedFiles, overrides: relativeTree(overridesDir) }),
    };

    db.prepare(
      `INSERT INTO content_items
        (id, instance_id, category, name, version, source, source_id, source_version_id,
         filename, enabled, sha1, game_version, loader, manifest)
       VALUES (@id, @instance_id, @category, @name, @version, @source, @source_id, @source_version_id,
               @filename, @enabled, @sha1, @game_version, @loader, @manifest)
       ON CONFLICT(id) DO UPDATE SET
         name = @name, version = @version, source = @source, source_id = @source_id,
         source_version_id = @source_version_id, filename = @filename, enabled = @enabled,
         sha1 = @sha1, game_version = @game_version, loader = @loader, manifest = @manifest`
    ).run(row);

    // Keep the mrpack around so `fileExists` stays accurate; the extracted tree is temporary.
    fs.rmSync(extractDir, { recursive: true, force: true });

    return rowToRecord(row);
  } catch (err) {
    fs.rmSync(extractDir, { recursive: true, force: true });
    // Remove any mod rows we created before failing (never rows from an earlier run).
    if (createdModIds.length > 0) {
      const db = getDb();
      for (const modId of createdModIds) {
        db.prepare("DELETE FROM mods WHERE id = ? AND source = 'modpack'").run(modId);
      }
    }
    throw err;
  }
}

/** Checks whether any installed Modrinth modpack has a newer published version for the
 * instance's loader + game version, mirroring the mods update check. */
export async function checkModpackUpdates(instanceId: string): Promise<ModpackUpdateInfo[]> {
  const { loader, gameVersion } = instanceLoaderAndVersion(instanceId);

  const installed = listInstalledContent(instanceId, "modpack").filter(
    (c) => c.source === "modrinth" && c.sourceId && c.sourceVersionId
  );

  const updates: ModpackUpdateInfo[] = [];
  for (const pack of installed) {
    try {
      const versions = await modrinth.getProjectVersions(pack.sourceId!, loader ?? undefined, gameVersion);
      const latest = versions[0]; // Modrinth returns newest-first.
      if (latest && latest.id !== pack.sourceVersionId) {
        updates.push({ contentId: pack.id, currentVersion: pack.version, latestVersion: latest });
      }
    } catch {
      // Skip packs whose project lookup fails (e.g. removed from Modrinth).
      continue;
    }
  }
  return updates;
}

/** Reads a dependency's pinned version from an mrpack manifest, normalizing wildcards
 * ("*" / "latest") to null so the instance resolves the loader's recommended build. */
function normalizeDependency(value: string | undefined): string | null {
  if (!value || value === "*" || value === "latest") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function loaderFromDependencies(deps: Record<string, string>): {
  loader: InstanceRecord["loader"];
  loaderVersion: string | null;
} {
  if (deps["fabric-loader"]) return { loader: "fabric", loaderVersion: normalizeDependency(deps["fabric-loader"]) };
  if (deps["quilt-loader"]) return { loader: "quilt", loaderVersion: normalizeDependency(deps["quilt-loader"]) };
  if (deps["neoforge"]) return { loader: "neoforge", loaderVersion: normalizeDependency(deps["neoforge"]) };
  if (deps["forge"]) return { loader: "forge", loaderVersion: normalizeDependency(deps["forge"]) };
  return { loader: "vanilla", loaderVersion: null };
}

/**
 * Imports a .mrpack file picked from disk: reads its manifest to learn the Minecraft
 * version + loader, creates a brand-new instance, then installs the pack into it the
 * same way an online Modrinth modpack install does. The source file is copied into the
 * instance's staging area so uninstalling the pack later removes exactly its files.
 */
export async function importModpackFromFile(
  mrpackPath: string,
  input: ModpackImportInput
): Promise<InstanceRecord> {
  if (!fs.existsSync(mrpackPath) || !mrpackPath.toLowerCase().endsWith(".mrpack")) {
    throw new Error("Please choose a valid .mrpack file.");
  }

  const contentId = randomUUID();
  const probeDir = path.join(rootDir(), ".noxara", "imports", contentId);
  fs.mkdirSync(probeDir, { recursive: true });

  let manifest: {
    name?: string;
    versionId?: string;
    dependencies?: Record<string, string>;
    files?: Array<{ path: string }>;
  };
  try {
    await coreBridge.call<{ entries: string[] }>("modpack.extract", { zipPath: mrpackPath, destDir: probeDir }, 120_000);
    const indexPath = path.join(probeDir, "modrinth.index.json");
    if (!fs.existsSync(indexPath)) {
      throw new Error("This .mrpack is missing its modrinth.index.json manifest.");
    }
    manifest = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : "Couldn't read this modpack archive.");
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }

  const deps = manifest.dependencies ?? {};
  const minecraftVersion = deps.minecraft;
  if (!minecraftVersion) {
    throw new Error("This modpack doesn't declare its Minecraft version, so the launcher can't create an instance for it.");
  }
  const { loader, loaderVersion } = loaderFromDependencies(deps);

  const packName = input.name.trim() || manifest.name?.trim() || "Imported Modpack";
  const baseInput = {
    name: packName,
    minecraftVersion,
    loader,
    minRamMb: input.minRamMb,
    maxRamMb: input.maxRamMb,
  };

  // `createInstance` validates pinned Forge/NeoForge builds against published versions;
  // if a pack pins something the registry no longer lists, fall back to the recommended
  // build rather than failing the whole import.
  let instance: InstanceRecord;
  try {
    instance = await createInstance({
      ...baseInput,
      loaderVersion: loaderVersion ?? (loader === "vanilla" ? null : "latest"),
    });
  } catch (err) {
    if (loader === "forge" || loader === "neoforge") {
      instance = await createInstance({ ...baseInput, loaderVersion: "latest" });
    } else {
      throw err;
    }
  }

  const instancePath = getInstanceDirById(instance.id);
  const staging = modpackStagingDir(instancePath);
  const target = path.join(staging, `${contentId}.mrpack`);
  fs.copyFileSync(mrpackPath, target);

  await installMrpackContents(instance.id, target, {
    contentId,
    gameVersion: instance.minecraftVersion,
    loader: loader === "vanilla" ? null : loader,
    meta: {
      taskId: randomUUID(),
      packName: manifest.name ?? packName,
      versionNumber: manifest.versionId ?? "unknown",
      source: "local",
      sourceId: null,
      sourceVersionId: null,
    },
  });

  return instance;
}

function copyDirInto(src: string, dest: string, skipTop: (rel: string) => boolean): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Skip folders we manage separately (mods are installed via the manifest).
      if (skipTop(entry.name)) continue;
      fs.mkdirSync(path.join(dest, entry.name), { recursive: true });
      copyDirInto(path.join(src, entry.name), path.join(dest, entry.name), () => false);
    } else {
      const target = assertWithin(dest, entry.name);
      fs.copyFileSync(path.join(src, entry.name), target);
    }
  }
}

function relativeTree(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), entryRel);
      } else {
        out.push(entryRel);
      }
    }
  };
  walk(root, "");
  return out;
}

/** Uninstalls a modpack: deletes every mod file and override the pack recorded as
 * installing, but only when the current file still matches the recorded sha1 — a file
 * the user has since edited is left alone. */
function uninstallModpack(instanceId: string, row: ContentRow): void {
  const instanceDir = getInstanceDirById(instanceId);
  const db = getDb();

  let manifest: { files: Array<{ path: string; sha1: string | null }>; overrides: string[] } | null = null;
  try {
    manifest = row.manifest ? JSON.parse(row.manifest) : null;
  } catch {
    manifest = null;
  }

  if (manifest) {
    for (const f of manifest.files ?? []) {
      if (!f.path.startsWith("mods/")) continue;
      const filePath = assertWithin(path.join(instanceDir, "mods"), path.basename(f.path));
      try {
        if (!f.sha1 || sha1Of(filePath) === f.sha1) fs.rmSync(filePath, { force: true });
      } catch {
        // file already gone or unreadable — nothing to do
      }
    }
    for (const rel of manifest.overrides ?? []) {
      try {
        const filePath = assertWithin(instanceDir, rel);
        fs.rmSync(filePath, { force: true });
      } catch {
        // traversal guarded by assertWithin; skip anything outside the instance
      }
    }
  }

  db.prepare("DELETE FROM mods WHERE instance_id = ? AND source = 'modpack' AND source_id = ?").run(
    instanceId,
    row.source_id ?? row.id
  );
  fs.rmSync(path.join(modpackStagingDir(instanceDir), `${row.id}.mrpack`), { force: true });
}

export async function installContent(
  instanceId: string,
  versionId: string,
  category: ContentCategory
): Promise<InstalledContent> {
  const version = await modrinth.getVersion(versionId);

  if (category === "modpack") {
    return installModpack(instanceId, version);
  }

  const taskId = randomUUID();
  // Register so the Downloads page can Cancel/Retry the single-file download.
  registerDownload(taskId, {
    kind: "content",
    run: () => installSingleFileCore(instanceId, version, category, taskId).then(() => undefined),
  });
  try {
    const result = await installSingleFileCore(instanceId, version, category, taskId);
    unregisterDownload(taskId);
    return result;
  } catch (err) {
    // Keep the handles registered so a failed download can be Retried from the UI.
    throw err;
  }
}

async function installSingleFileCore(
  instanceId: string,
  version: ModrinthVersion,
  category: ContentCategory,
  taskId: string
): Promise<InstalledContent> {
  const { gameVersion } = instanceLoaderAndVersion(instanceId);

  const file = version.files.find((f) => f.primary) ?? version.files[0];
  if (!file) throw new Error("This version has no downloadable file.");

  const dir = dirForCategory(instanceId, category);
  const safeFilename = path.basename(file.filename);
  const destPath = assertWithin(dir, safeFilename);

  try {
    await downloadWithProgress(file.url, destPath, taskId, version.name, category, instanceId);
  } catch (err) {
    contentDownloadEvents.emit("complete", {
      taskId,
      category,
      success: false,
      error: err instanceof Error ? err.message : "Download failed",
    });
    throw err;
  }

  const actualSha1 = sha1Of(destPath);
  if (file.sha1 && actualSha1.toLowerCase() !== file.sha1.toLowerCase()) {
    fs.rmSync(destPath, { force: true });
    contentDownloadEvents.emit("complete", { taskId, category, success: false, error: "Checksum mismatch" });
    throw new Error("Downloaded file failed checksum verification and was removed.");
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM content_items WHERE instance_id = ? AND category = ? AND source_id = ?")
    .get(instanceId, category, version.projectId) as { id: string } | undefined;
  const id = existing?.id ?? randomUUID();

  const row: ContentRow = {
    id,
    instance_id: instanceId,
    category,
    name: version.name.split(" ")[0] || version.name,
    version: version.versionNumber,
    source: "modrinth",
    source_id: version.projectId,
    source_version_id: version.id,
    filename: safeFilename,
    enabled: 1,
    sha1: actualSha1,
    game_version: gameVersion,
    loader: null,
    manifest: null,
  };

  db.prepare(
    `INSERT INTO content_items
      (id, instance_id, category, name, version, source, source_id, source_version_id,
       filename, enabled, sha1, game_version, loader, manifest)
     VALUES (@id, @instance_id, @category, @name, @version, @source, @source_id, @source_version_id,
             @filename, @enabled, @sha1, @game_version, @loader, @manifest)
     ON CONFLICT(id) DO UPDATE SET
       name = @name, version = @version, filename = @filename, sha1 = @sha1,
       source_version_id = @source_version_id, game_version = @game_version`
  ).run(row);

  contentDownloadEvents.emit("complete", { taskId, category, success: true });
  return rowToRecord(row);
}

export function removeContent(instanceId: string, itemId: string, category: ContentCategory): void {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM content_items WHERE id = ? AND instance_id = ? AND category = ?")
    .get(itemId, instanceId, category) as ContentRow | undefined;
  if (!row) throw new Error("Item not found for this instance.");

  if (category === "modpack") {
    uninstallModpack(instanceId, row);
  } else {
    const dir = dirForCategory(instanceId, category);
    const filePath = assertWithin(dir, path.basename(row.filename));
    fs.rmSync(filePath, { force: true });
    // Also clear the `.disabled` twin if present.
    fs.rmSync(`${filePath}.disabled`, { force: true });
  }

  db.prepare("DELETE FROM content_items WHERE id = ?").run(itemId);
}

export function setContentEnabled(
  instanceId: string,
  itemId: string,
  category: ContentCategory,
  enabled: boolean
): void {
  if (category === "modpack") {
    // A modpack isn't a single toggleable file — its individual mods are.
    getDb().prepare("UPDATE content_items SET enabled = ? WHERE id = ? AND instance_id = ?").run(
      enabled ? 1 : 0,
      itemId,
      instanceId
    );
    return;
  }

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM content_items WHERE id = ? AND instance_id = ? AND category = ?")
    .get(itemId, instanceId, category) as ContentRow | undefined;
  if (!row) throw new Error("Item not found for this instance.");

  const dir = dirForCategory(instanceId, category);
  const filePath = assertWithin(dir, path.basename(row.filename));
  const disabledPath = `${filePath}.disabled`;

  const fileExists = fs.existsSync(filePath);
  const disabledExists = fs.existsSync(disabledPath);
  if (enabled) {
    if (disabledExists) {
      fs.renameSync(disabledPath, filePath);
    } else if (!fileExists) {
      // Nothing to enable — the file is gone from the instance folder entirely.
      throw new Error("This item's file is missing from the instance folder — reinstall it.");
    }
  } else {
    if (fileExists) {
      fs.renameSync(filePath, disabledPath);
    } else if (!disabledExists) {
      throw new Error("This item's file is missing from the instance folder — reinstall it.");
    }
  }
  db.prepare("UPDATE content_items SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, itemId);
}
