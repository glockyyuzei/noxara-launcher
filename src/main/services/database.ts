/**
 * SQLite persistence layer. Runs versioned migrations from database/migrations on
 * startup, tracked in a `_migrations` table, so upgrades never destroy user data
 * (spec section 66).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

let db: Database.Database | null = null;

function migrationsDir(): string {
  // In dev, migrations live in the repo; when packaged they're copied alongside
  // extraResources. Fall back to the app path either way.
  const packaged = path.join(process.resourcesPath ?? "", "database", "migrations");
  const dev = path.join(app.getAppPath(), "database", "migrations");
  return app.isPackaged && fs.existsSync(packaged) ? packaged : dev;
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(app.getPath("userData"), "noxara.db");
  try {
    db = openAndMigrate(dbPath);
    return db;
  } catch (err) {
    // A corrupt database (power loss, partial write, manual tampering) used to make
    // startup fail silently — the throw inside app.whenReady() meant no window and no
    // core. Recover instead: preserve the bad file for forensics and start fresh so
    // the launcher still boots. Only the launcher's own metadata is lost, never the
    // (file-based) instances themselves.
    closeDb();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${dbPath}.corrupt-${stamp}`;
    try {
      fs.renameSync(dbPath, backupPath);
    } catch {
      // Even renaming failed; leave the original in place and let the open below fail
      // loudly rather than silently retrying against the same broken file.
      throw err;
    }
    for (const suffix of ["-wal", "-shm"]) {
      try {
        fs.renameSync(`${dbPath}${suffix}`, `${backupPath}${suffix}`);
      } catch {
        // WAL/SHM files are optional; ignore if absent.
      }
    }
    console.warn(`[database] corrupt database recovered; backed up to ${backupPath}`);
    db = openAndMigrate(dbPath);
    return db;
  }
}

function openAndMigrate(dbPath: string): Database.Database {
  const instance = new Database(dbPath);
  try {
    instance.pragma("journal_mode = WAL");
    instance.pragma("foreign_keys = ON");

    instance.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`);

    const dir = migrationsDir();
    const applied = new Set(
      (instance.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
    );

    const files = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      : [];

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf-8");
      const run = instance.transaction(() => {
        instance!.exec(sql);
        instance!.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
          file,
          new Date().toISOString()
        );
      });
      run();
      console.log(`[database] applied migration ${file}`);
    }

    return instance;
  } catch (err) {
    // Close the handle before the caller tries to rename the corrupt file aside;
    // an open connection would hold a lock and make the rename fail.
    try {
      instance.close();
    } catch {
      // Already closed/failed to open; nothing to do.
    }
    throw err;
  }
}

export function closeDb(): void {
  db?.close();
  db = null;
}
