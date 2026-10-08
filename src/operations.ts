import { BodyReadError } from "./body";
import { ServiceError, SERVICES, type ServiceId, extractSchema, smartDiffSchema } from "./contracts";
import { extract } from "./extract";
import { handleCoreRequest, type FreshnessEnv } from "./freshness";
import { TargetNotAllowedError } from "./safe-fetch";
import { prepareSmartDiff } from "./smart-diff";
import type { SqlWrite } from "./sql";
import { resourceKey } from "./payment-journal";

export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError || error instanceof BodyReadError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof TargetNotAllowedError) return Response.json({ error: "target_not_allowed", message: error.message }, { status: 400 });
  console.error("fresh402_operation_failed");
  return Response.json({ error: "service_unavailable", message: "Unable to complete the operation. Retry later." }, { status: 503 });
}
export interface PreparedOperation { response: Response; writes?: SqlWrite[] }
export type CapacityRelease = (() => Promise<void>) & { owner: string };
function boundedResult(value: unknown): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > 524288) throw new ServiceError("result_too_large", "Result exceeds the 512 KiB output budget. Use a narrower scope.", 413);
  return new Response(body, { headers: { "content-type": "application/json" } });
}

/** Capacity leases are global in D1, unlike the per-location rate limiter. */
export async function acquireCapacity(db: D1Database, input?: unknown, dailyLimit = 10000): Promise<CapacityRelease> {
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 10000) throw new ServiceError("invalid_operation_budget", "Operator budget is invalid.", 503);
  const owner = crypto.randomUUID(), now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const key = await resourceKey(db, input);
  // Only expired coordination metadata is removed, never user snapshots.
  await db.prepare("DELETE FROM operation_leases WHERE expires_at <= ?").bind(now).run();
  const results = await db.batch([db.prepare(`WITH slots(slot) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7))
    INSERT INTO operation_leases(slot, owner, resource_key, expires_at)
    SELECT slot, ?, ?, ? FROM slots
    WHERE slot NOT IN (SELECT slot FROM operation_leases WHERE expires_at > ?)
    AND NOT EXISTS (SELECT 1 FROM payment_operations WHERE resource_key = ? AND state IN ('settling','settled'))
    AND COALESCE((SELECT started FROM operation_budget WHERE day = ?), 0) < ? LIMIT 1
    ON CONFLICT DO NOTHING`)
    .bind(owner, key, now + 120000, now, key, day, dailyLimit),
    db.prepare(`INSERT INTO operation_budget(day, started) SELECT ?, 1 WHERE EXISTS (SELECT 1 FROM operation_leases WHERE owner = ?)
      ON CONFLICT(day) DO UPDATE SET started = started + 1`).bind(day, owner),
  ]);
  if (!results[0].meta.changes) throw new ServiceError("capacity_exceeded", "Service, target or daily budget is exhausted. Retry later.", 429);
  return Object.assign(async () => {
    try { await db.prepare("DELETE FROM operation_leases WHERE owner = ?").bind(owner).run(); }
    catch { console.error("fresh402_capacity_release_failed"); }
  }, { owner });
}

export async function prepareOperation(service: ServiceId, input: unknown, env: FreshnessEnv): Promise<PreparedOperation> {
  try {
    if (service === "extract") return { response: boundedResult(await extract(extractSchema.parse(input), env.TARGET_HOST_ALLOWLIST)) };
    if (service === "smart_diff") {
      const prepared = await prepareSmartDiff(env.DB, smartDiffSchema.parse(input), env.TARGET_HOST_ALLOWLIST);
      return { response: boundedResult(prepared.result), writes: prepared.writes };
    }
    const writes: SqlWrite[][] = [];
    const response = await handleCoreRequest(new Request(`https://fresh402.internal${SERVICES.check.path}`, {
      method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" },
    }), { ...env, deferWrites: statements => { writes.push(statements); } });
    return { response, writes: writes.flat() };
  } catch (error) { return { response: errorResponse(error) }; }
}
