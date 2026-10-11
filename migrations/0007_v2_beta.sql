-- Additive only. Rolling back the Worker does not require removing these tables.
CREATE TABLE smart_baselines (
  watch_id TEXT PRIMARY KEY REFERENCES watches(watch_id),
  hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE smart_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_id TEXT NOT NULL REFERENCES watches(watch_id),
  hash TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_smart_snapshots_watch ON smart_snapshots(watch_id, id DESC);
CREATE INDEX idx_smart_snapshots_hash ON smart_snapshots(watch_id, hash);
CREATE TABLE operation_leases (
  slot INTEGER PRIMARY KEY CHECK(slot >= 0 AND slot < 8),
  owner TEXT NOT NULL,
  resource_key TEXT UNIQUE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE payment_claims (
  claim_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_payment_claims_expiry ON payment_claims(expires_at);
CREATE TABLE analytics_daily (
  day TEXT NOT NULL,
  service TEXT NOT NULL,
  transport TEXT NOT NULL,
  event TEXT NOT NULL,
  traffic_class TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, service, transport, event, traffic_class)
);
