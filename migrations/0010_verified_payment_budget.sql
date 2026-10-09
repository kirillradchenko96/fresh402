-- Bound durable reservations for verified but unsettled authorizations.
-- Initial 402 offers, invalid proofs and completed recovery never consume this.
CREATE TABLE verified_payment_budget (
  day TEXT PRIMARY KEY,
  started INTEGER NOT NULL CHECK(started >= 0)
);
CREATE TABLE gateway_runtime_budget (
  window TEXT PRIMARY KEY,
  reserved_ms INTEGER NOT NULL CHECK(reserved_ms >= 0),
  expires_at INTEGER NOT NULL
);
