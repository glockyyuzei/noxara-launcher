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
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const dir = migrationsDir();
  const applied = new Set(
    (db.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name)
  );

  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    : [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    const run = db.transaction(() => {
      db!.exec(sql);
      db!.prepare("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        new Date().toISOString()
      );
    });
    run();
    console.log(`[database] applied migration ${file}`);
  }

  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
