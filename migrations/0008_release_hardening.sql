-- Financial operation journal. No signatures or recovery bearer tokens are stored.
CREATE TABLE payment_operations (
  claim_hash TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  recovery_hash TEXT,
  service TEXT NOT NULL,
  transport TEXT NOT NULL,
  payer TEXT NOT NULL,
  asset TEXT NOT NULL,
  nonce TEXT NOT NULL,
  amount_atomic INTEGER NOT NULL,
  resource_key TEXT,
  state TEXT NOT NULL CHECK(state IN ('preparing','prepared','settling','settled','completed','failed')),
  owner TEXT NOT NULL,
  lease_owner TEXT,
  authorization_expires INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  result_expires INTEGER NOT NULL,
  response_json TEXT,
  writes_json TEXT,
  receipt_json TEXT
);
CREATE INDEX idx_payment_operations_cleanup ON payment_operations(state, result_expires);
CREATE INDEX idx_payment_operations_resource ON payment_operations(resource_key, state);
-- A concurrent/repeated finalizer rolls back its entire D1 batch, including writes.
CREATE TRIGGER payment_operations_complete_once
BEFORE UPDATE OF state ON payment_operations
WHEN NEW.state = 'completed' AND OLD.state != 'settled'
BEGIN SELECT RAISE(ABORT, 'payment_operation_already_finalized'); END;

CREATE TABLE operation_budget (
  day TEXT PRIMARY KEY,
  started INTEGER NOT NULL CHECK(started >= 0)
);
