CREATE TABLE IF NOT EXISTS resources (
    url TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    normalized_content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    check_count INTEGER NOT NULL DEFAULT 1
);