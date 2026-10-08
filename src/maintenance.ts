/** Bounded cron batches. Authorization expiry is in seconds; leases/results in ms. */
export async function cleanupTemporaryData(db: D1Database, now = Date.now()) {
  const results = await db.batch([
    db.prepare("DELETE FROM payment_claims WHERE claim_hash IN (SELECT claim_hash FROM payment_claims WHERE expires_at <= ? ORDER BY expires_at LIMIT 500)").bind(Math.floor(now/1000)),
    db.prepare("DELETE FROM operation_leases WHERE expires_at <= ?").bind(now),
    db.prepare(`DELETE FROM payment_operations WHERE claim_hash IN (SELECT claim_hash FROM payment_operations
      WHERE state IN ('preparing','prepared','failed') AND authorization_expires + 300 <= ? ORDER BY authorization_expires LIMIT 500)`).bind(Math.floor(now/1000)),
    db.prepare(`UPDATE payment_operations SET response_json = NULL, writes_json = NULL
      WHERE claim_hash IN (SELECT claim_hash FROM payment_operations WHERE state = 'completed' AND result_expires <= ? AND response_json IS NOT NULL ORDER BY result_expires LIMIT 100)`).bind(now),
    db.prepare("DELETE FROM operation_budget WHERE day < ?").bind(new Date(now - 30*86400000).toISOString().slice(0,10)),
  ]);
  return results.map(result => result.meta.changes);
}
