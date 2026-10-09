-- Preserve existing leases while expanding configurable coordination capacity.
-- No paid journal, receipt, watch, snapshot or financial event is modified.
ALTER TABLE operation_leases RENAME TO operation_leases_initial_capacity;
CREATE TABLE operation_leases (
  slot INTEGER PRIMARY KEY CHECK(slot >= 0 AND slot < 4096),
  owner TEXT NOT NULL,
  resource_key TEXT UNIQUE,
  expires_at INTEGER NOT NULL
);
INSERT INTO operation_leases SELECT * FROM operation_leases_initial_capacity;
CREATE INDEX idx_operation_leases_expiry ON operation_leases(expires_at);
ALTER TABLE operation_budget ADD COLUMN free_started INTEGER NOT NULL DEFAULT 0 CHECK(free_started >= 0);
