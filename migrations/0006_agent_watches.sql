CREATE TABLE IF NOT EXISTS watches (
    watch_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    final_url TEXT NOT NULL,
    selector TEXT,
    ignore_selectors_json TEXT NOT NULL DEFAULT '[]',
    ignore_json_paths_json TEXT NOT NULL DEFAULT '[]',
    content_kind TEXT NOT NULL,
    hash TEXT NOT NULL,
    raw_hash TEXT,
    normalized_content TEXT NOT NULL,
    content_truncated INTEGER NOT NULL DEFAULT 0,
    etag TEXT,
    last_modified TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    checked_at TEXT NOT NULL,
    check_count INTEGER NOT NULL DEFAULT 1,
    normalizer_version INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watches_url
ON watches (url);

CREATE INDEX IF NOT EXISTS idx_watches_checked_at
ON watches (checked_at DESC);

CREATE TABLE IF NOT EXISTS watch_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id TEXT NOT NULL,
    hash TEXT NOT NULL,
    raw_hash TEXT,
    normalized_content TEXT NOT NULL,
    content_truncated INTEGER NOT NULL DEFAULT 0,
    content_kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    normalizer_version INTEGER NOT NULL,
    FOREIGN KEY (watch_id) REFERENCES watches(watch_id)
);

CREATE INDEX IF NOT EXISTS idx_watch_snapshots_watch_id_id
ON watch_snapshots (watch_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_watch_snapshots_watch_id_hash
ON watch_snapshots (watch_id, hash);
