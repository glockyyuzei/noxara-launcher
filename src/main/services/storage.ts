/**
 * Storage management: measures how much disk each launcher data category uses and
 * lets the user clear the regenerable caches (versions, libraries, assets, managed
 * Java runtimes, metadata, temp leftovers). Never clearable: instance folders,
 * backups, the database, or user data like skins.
 *
 * Byte counts are computed recursively in the main process; the renderer only ever
 * sees numbers + labels (no fabricated values).
 */
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  rootDir,
  instancesDir,
  librariesDir,
  assetsDir,
  versionsDir,
  javaDir,
} from "../filesystem/paths";
import { backupsDir } from "./backups";
import type { StorageBreakdown, StorageCategory } from "../../shared/types/ipc";

/** The metadata cache noxara-core writes under the OS cache dir. */
function metadataCacheDir(): string {
  let base: string;
  switch (process.platform) {
    case "darwin":
      base = path.join(app.getPath("home"), "Library", "Caches", "NoxaraLauncher");
      break;
    case "linux":
      base = path.join(
        process.env.XDG_CACHE_HOME || path.join(app.getPath("home"), ".cache"),
        "NoxaraLauncher"
      );
      break;
    default:
      base = path.join(
        process.env.LOCALAPPDATA || path.join(app.getPath("appData"), "..", "Local"),
        "NoxaraLauncher"
      );
  }
  return path.join(base, "meta");
}

/** Transient scratch dirs that should not accumulate (installs, exports, restores). */
function leftoverDirs(): string[] {
  const base = rootDir();
  return [
    path.join(base, "forge-install"),
    path.join(base, "neoforge-install"),
    path.join(base, ".noxara", "imports"),
    path.join(base, ".noxara", "exports"),
    path.join(base, ".noxara", "restore"),
  ];
}

/** Recursively sums the bytes of every file under `dir` (0 when absent). */
function folderSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += folderSize(p);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(p).size;
      } catch {
        // file vanished mid-scan (e.g. a concurrent download) — skip it
      }
    }
  }
  return total;
}

export function getStorageBreakdown(): StorageBreakdown {
  const categories: StorageCategory[] = [
    {
      id: "instances",
      label: "Instances",
      path: instancesDir(),
      sizeBytes: folderSize(instancesDir()),
      clearable: false,
      hint: "Your instance folders (mods, saves, config). Deleted from the Instances page.",
    },
    {
      id: "versions",
      label: "Minecraft versions",
      path: versionsDir(),
      sizeBytes: folderSize(versionsDir()),
      clearable: true,
      hint: "Downloaded client jars. Re-downloaded automatically when you launch or repair.",
    },
    {
      id: "libraries",
      label: "Libraries",
      path: librariesDir(),
      sizeBytes: folderSize(librariesDir()),
      clearable: true,
      hint: "Shared library jars. Re-downloaded when you launch or repair an instance.",
    },
    {
      id: "assets",
      label: "Assets",
      path: assetsDir(),
      sizeBytes: folderSize(assetsDir()),
      clearable: true,
      hint: "Game asset files. Re-downloaded when you launch or repair an instance.",
    },
    {
      id: "javaRuntimes",
      label: "Managed Java",
      path: javaDir(),
      sizeBytes: folderSize(javaDir()),
      clearable: true,
      hint: "Mojang-bundled Java runtimes. Re-downloaded when a Minecraft version needs one.",
    },
    {
      id: "metadataCache",
      label: "Metadata cache",
      path: metadataCacheDir(),
      sizeBytes: folderSize(metadataCacheDir()),
      clearable: true,
      hint: "Version and Java manifests. Refreshed automatically as needed.",
    },
    {
      id: "backups",
      label: "Backups",
      path: backupsDir(),
      sizeBytes: folderSize(backupsDir()),
      clearable: false,
      hint: "Instance backups. Managed from each instance's Backups tab.",
    },
    {
      id: "leftovers",
      label: "Temp leftovers",
      path: leftoverDirs()[0],
      sizeBytes: leftoverDirs().reduce((sum, dir) => sum + folderSize(dir), 0),
      clearable: true,
      hint: "Scratch files from installs, exports and restores. Always safe to remove.",
    },
  ];

  const totalBytes = categories.reduce((sum, c) => sum + c.sizeBytes, 0);

  // Free/total on the volume hosting the launcher data (Node 18.15+ statfs).
  let diskFreeBytes = 0;
  let diskTotalBytes = 0;
  try {
    const s = fs.statfsSync(rootDir());
    diskFreeBytes = Number(s.bavail) * Number(s.bsize);
    diskTotalBytes = Number(s.blocks) * Number(s.bsize);
  } catch {
    // statfs unavailable on this platform — UI hides the disk gauge
  }

  return { categories, totalBytes, diskFreeBytes, diskTotalBytes };
}

/** Wipes a clearable category (the folder itself, recreated empty). The "leftovers"
 * category spans several scratch dirs, so those are all removed together. */
export function clearStorageCache(categoryId: string): StorageBreakdown {
  const breakdown = getStorageBreakdown();
  const category = breakdown.categories.find((c) => c.id === categoryId);
  if (!category) throw new Error(`Unknown storage category: ${categoryId}`);
  if (!category.clearable) {
    throw new Error("This storage category can't be cleared — it holds user data.");
  }

  if (categoryId === "leftovers") {
    for (const dir of leftoverDirs()) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
    }
  } else {
    fs.rmSync(category.path, { recursive: true, force: true });
    fs.mkdirSync(category.path, { recursive: true });
  }

  return getStorageBreakdown();
}
