/**
 * Modpack export: packages an instance's mods + config/overrides into a Modrinth
 * `.mrpack` archive. The manifest (`modrinth.index.json`) is built here in the main
 * process, then handed to noxara-core's `modpack.create` (which owns the zip-writing
 * via the Rust `zip` crate, keeping the lone dependency in native code).
 *
 * Files placed under `overrides/` are the instance's config-ish folders (config,
 * options, scripts, kubejs, …) minus directories the launcher or game manage
 * themselves (mods, logs, screenshots, crash reports). A pack exported this way can be
 * re-imported on any machine with `modpack.import`.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { listInstances, getInstanceDirById } from "./instances";
import { listInstalledMods } from "./mods";
import { coreBridge } from "./core-bridge";
import { rootDir, assertWithin } from "../filesystem/paths";
import { startActivity, progressActivity, succeedActivity, failActivity } from "./activity";
import * as modrinth from "./modrinth";
import type { InstanceRecord, ModrinthVersionFile } from "../../shared/types/ipc";

/** Top-level instance folders that never belong in a pack's overrides. */
const EXCLUDED_OVERRIDE_DIRS = new Set(["mods", "logs", "crash-reports", "screenshots", ".noxara"]);

function sha1Of(filePath: string): string {
  const hash = createHash("sha1");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_ ]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40) || "modpack"
  );
}

/** Best-effort: the primary download URL for the version a mod was installed from. The
 * mrpack spec leaves `downloads` empty when the URL is unknown; importers that can't
 * fetch still have the hash + the filename and skip the file. */
async function downloadUrlFor(mod: { sourceId: string | null; sourceVersionId: string | null }): Promise<string[]> {
  if (mod.sourceId && mod.sourceVersionId) {
    try {
      const version = await modrinth.getVersion(mod.sourceVersionId);
      const file: ModrinthVersionFile | undefined = version.files.find((f) => f.primary) ?? version.files[0];
      if (file?.url) return [file.url];
    } catch {
      // offline or project removed — leave downloads empty
    }
  }
  return [];
}

export async function exportModpack(instanceId: string, destPath: string): Promise<{ exported: boolean }> {
  const instance: InstanceRecord | undefined = listInstances().find((i) => i.id === instanceId);
  if (!instance) throw new Error(`instance ${instanceId} not found`);

  const activityId = randomUUID();
  startActivity(activityId, {
    type: "modpack",
    title: instance.name,
    instanceId: instance.id,
    description: "Exporting modpack",
    status: "exporting",
  });

  const target = destPath.toLowerCase().endsWith(".mrpack") ? destPath : `${destPath}.mrpack`;
  const instanceDir = getInstanceDirById(instanceId);

  const tmp = path.join(rootDir(), ".noxara", "exports", randomUUID());
  const overridesDir = path.join(tmp, "overrides");
  fs.mkdirSync(overridesDir, { recursive: true });

  try {
    progressActivity(activityId, {}, "exporting", { description: "Collecting mods and overrides" });

    // 1. The mods this instance actually has files for.
    const mods = listInstalledMods(instanceId).filter((m) => m.fileExists && m.filename);
    const files: Array<Record<string, unknown>> = [];
    for (const mod of mods) {
      const src = assertWithin(path.join(instanceDir, "mods"), path.basename(mod.filename));
      if (!fs.existsSync(src)) continue;
      files.push({
        path: `mods/${mod.filename.replace(/\\/g, "/")}`,
        hashes: { sha1: sha1Of(src) },
        env: { client: "required", server: "optional" },
        downloads: await downloadUrlFor(mod),
        fileSize: fs.statSync(src).size,
      });
    }

    // 2. Game/loader dependency pins from the instance itself.
    const dependencies: Record<string, string> = { minecraft: instance.minecraftVersion };
    if (instance.loader === "fabric" && instance.loaderVersion) dependencies["fabric-loader"] = instance.loaderVersion;
    if (instance.loader === "quilt" && instance.loaderVersion) dependencies["quilt-loader"] = instance.loaderVersion;
    if (instance.loader === "forge" && instance.loaderVersion) dependencies["forge"] = instance.loaderVersion;
    if (instance.loader === "neoforge" && instance.loaderVersion) dependencies["neoforge"] = instance.loaderVersion;

    const indexJson = JSON.stringify(
      {
        formatVersion: 1,
        game: "minecraft",
        versionId: `${slugify(instance.name)}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
        name: instance.name,
        summary: "Exported from Noxara Launcher",
        files,
        dependencies,
      },
      null,
      2
    );
    const indexPath = path.join(tmp, "modrinth.index.json");
    fs.writeFileSync(indexPath, indexJson, "utf-8");

    // 3. overrides/ — instance folders the pack should own, excluding what the launcher
    // manages (mods) or the game regenerates (logs, crash reports, screenshots).
    copyOverrides(instanceDir, overridesDir);

    // 4. Hand the two to noxara-core which writes the zip.
    progressActivity(activityId, {}, "exporting", { description: "Writing .mrpack archive" });
    await coreBridge.call<{ created: boolean }>(
      "modpack.create",
      { zipPath: target, indexPath, overridesDir },
      120_000
    );

    succeedActivity(activityId, { description: "Modpack exported" });
    return { exported: true };
  } catch (err) {
    failActivity(activityId, err instanceof Error ? err.message : "Export failed");
    throw err;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function copyOverrides(instanceDir: string, overridesDir: string): void {
  for (const entry of fs.readdirSync(instanceDir, { withFileTypes: true })) {
    if (EXCLUDED_OVERRIDE_DIRS.has(entry.name)) continue;
    if (entry.name.endsWith(".disabled")) continue;
    const src = path.join(instanceDir, entry.name);
    const dest = assertWithin(overridesDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      walkCopy(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}

function walkCopy(srcDir: string, destDir: string): void {
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (entry.name.endsWith(".disabled")) continue;
    const src = path.join(srcDir, entry.name);
    const dest = assertWithin(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      walkCopy(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
  }
}