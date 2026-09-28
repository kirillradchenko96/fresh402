ALTER TABLE resources ADD COLUMN raw_hash TEXT;
ALTER TABLE resources ADD COLUMN normalizer_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE snapshots ADD COLUMN raw_hash TEXT;
ALTER TABLE snapshots ADD COLUMN normalizer_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_snapshots_url_version_id
ON snapshots (url, normalizer_version, id DESC);
