CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_hash TEXT NOT NULL UNIQUE,
    payer TEXT NOT NULL,
    network TEXT NOT NULL,
    route TEXT NOT NULL,
    amount_atomic INTEGER NOT NULL,
    is_test_buyer INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payment_events_created_at
ON payment_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_events_external_created_at
ON payment_events (is_test_buyer, created_at DESC);
