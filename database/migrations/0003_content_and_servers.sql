-- Content items (resource packs, shaders, modpacks) tracked per instance, plus
-- per-instance scope for the existing servers table. Additive only.

CREATE TABLE IF NOT EXISTS content_items (
    id                 TEXT PRIMARY KEY,
    instance_id        TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
    category           TEXT NOT NULL CHECK (category IN ('resourcepack', 'shader', 'modpack')),
    name               TEXT NOT NULL,
    version            TEXT NOT NULL,
    source             TEXT NOT NULL DEFAULT 'modrinth', -- 'modrinth' | 'local'
    source_id          TEXT,
    source_version_id  TEXT,
    filename           TEXT NOT NULL,
    enabled            INTEGER NOT NULL DEFAULT 1,
    sha1               TEXT,
    game_version       TEXT,
    loader             TEXT,
    manifest           TEXT
);

CREATE INDEX IF NOT EXISTS idx_content_items_instance ON content_items(instance_id);
CREATE INDEX IF NOT EXISTS idx_content_items_category ON content_items(category);

-- Servers may be scoped to a single instance (NULL = available everywhere).
ALTER TABLE servers ADD COLUMN instance_id TEXT;
