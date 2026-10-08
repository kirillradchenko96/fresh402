# Roadmap to 2.1

## 2.0 Beta exit criteria

Review the Draft PR, keep the complete offline workerd suite green, rehearse additive migration/rollback in isolated staging, inspect real target extraction quality, and assess payment timeout/reconciliation behavior. Independently verify production outbound DNS isolation before broad untrusted traffic. Any mainnet transaction test requires a separate owner-approved budget.

## 2.1 priorities

1. Durable operation receipts and paid response replay: address crash-after-settlement recovery without reusing signatures for free work. Define retention and encryption before storing response bodies.
2. Explicit account/watch ownership and keyed billing interface. Add an append-only credit ledger only after atomic reserve/commit/reversal invariants are tested.
3. Improve extraction quality on a public benchmark corpus; report measurable precision and latency rather than a semantic-accuracy claim. Add structural free baselines without changing v1 fingerprints.
4. Batch Check with bounded queue/concurrency and per-item billing/failure semantics. No unlimited fan-out.
5. Price Track with explicit schemas, currency/units and ambiguity; preserve evidence instead of guessing values.
6. Opt-in Smart Alerts with authenticated subscriptions, verified recipients, signed webhooks, deduplicated delivery and unsubscribe controls.
7. Revalidate SDK upgrades and remove the Bazaar patch only when upstream replacement passes workerd regression tests. Update remaining development dependency advisories.

Browser rendering and model-based semantic interpretation remain optional future products requiring explicit unit economics, privacy policy and reliability justification. Neither is silently enabled in 2.0.
