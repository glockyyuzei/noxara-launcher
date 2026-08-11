-- Adds Modrinth version tracking (for update checks) to the existing mods table,
-- and a table for locally-managed skin files. Additive only — never touches
-- accounts/auth tables.

ALTER TABLE mods ADD COLUMN source_version_id TEXT;
ALTER TABLE mods ADD COLUMN game_version TEXT;
ALTER TABLE mods ADD COLUMN loader TEXT;

CREATE TABLE IF NOT EXISTS skins (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    file_path   TEXT NOT NULL,
    model       TEXT NOT NULL DEFAULT 'classic', -- 'classic' | 'slim'
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_skins (
    account_id  TEXT PRIMARY KEY,
    skin_id     TEXT NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
    applied_at  TEXT NOT NULL
);
