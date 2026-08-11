-- Yuzei Launcher initial schema.
-- Sensitive auth tokens are NEVER stored here — see src/main/auth (OS credential store).

CREATE TABLE IF NOT EXISTS instances (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    minecraft_version TEXT NOT NULL,
    loader          TEXT NOT NULL DEFAULT 'vanilla',
    loader_version  TEXT,
    java_path       TEXT,
    min_ram_mb      INTEGER NOT NULL DEFAULT 2048,
    max_ram_mb      INTEGER NOT NULL DEFAULT 4096,
    jvm_args        TEXT NOT NULL DEFAULT '',
    game_args       TEXT NOT NULL DEFAULT '',
    icon_path       TEXT,
    instance_dir    TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    last_played_at  TEXT,
    favorite        INTEGER NOT NULL DEFAULT 0
);

-- Non-secret account metadata only. `kind = 'microsoft'` rows have their tokens in the
-- OS secure credential store, keyed by this row's id. `kind = 'offline'` rows have no
-- token at all, by design.
CREATE TABLE IF NOT EXISTS accounts (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('microsoft', 'offline')),
    username    TEXT NOT NULL,
    uuid        TEXT NOT NULL,
    avatar_url  TEXT,
    is_active   INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    address     TEXT NOT NULL,
    port        INTEGER NOT NULL DEFAULT 25565,
    icon_data   TEXT,
    favorite    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mods (
    id              TEXT PRIMARY KEY,
    instance_id     TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    version         TEXT NOT NULL,
    source          TEXT NOT NULL DEFAULT 'local', -- 'modrinth' | 'curseforge' | 'local'
    source_id       TEXT,
    filename        TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    sha1            TEXT
);

CREATE TABLE IF NOT EXISTS backups (
    id          TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    path        TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mods_instance ON mods(instance_id);
CREATE INDEX IF NOT EXISTS idx_backups_instance ON backups(instance_id);
