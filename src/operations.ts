import { BodyReadError } from "./body";
import { ServiceError, SERVICES, type ServiceId, extractSchema, smartDiffSchema } from "./contracts";
import { extract, digest } from "./extract";
import { handleCoreRequest, type FreshnessEnv } from "./freshness";
import { TargetNotAllowedError } from "./safe-fetch";
import { prepareSmartDiff } from "./smart-diff";

export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError || error instanceof BodyReadError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
  if (error instanceof TargetNotAllowedError) return Response.json({ error: "target_not_allowed", message: error.message }, { status: 400 });
  console.error("fresh402_operation_failed");
  return Response.json({ error: "service_unavailable", message: "Unable to complete the operation. Retry later." }, { status: 503 });
}
export interface PreparedOperation { response: Response; commit?: () => Promise<void> }
function boundedResult(value: unknown): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > 524288) throw new ServiceError("result_too_large", "Result exceeds the 512 KiB output budget. Use a narrower scope.", 413);
  return new Response(body, { headers: { "content-type": "application/json" } });
}

/** Capacity leases are global in D1, unlike the per-location rate limiter. */
export async function acquireCapacity(db: D1Database, input?: unknown): Promise<() => Promise<void>> {
  const owner = crypto.randomUUID(), now = Date.now();
  let key: string | null = null;
  if (input && typeof input === "object") {
    const fields = input as Record<string, unknown>;
    let url = typeof fields.url === "string" ? fields.url : null;
    if (!url && typeof fields.watch_id === "string") url = await db.prepare("SELECT url FROM watches WHERE watch_id = ?").bind(fields.watch_id).first<string>("url");
    if (url) {
      try { const normalized = new URL(url); normalized.hash = ""; key = await digest(normalized.href); } catch { /* Core reports invalid URLs. */ }
    }
  }
  // Only expired coordination metadata is removed, never user snapshots.
  await db.prepare("DELETE FROM operation_leases WHERE expires_at <= ?").bind(now).run();
  const result = await db.prepare(`WITH slots(slot) AS (VALUES (0),(1),(2),(3),(4),(5),(6),(7))
    INSERT INTO operation_leases(slot, owner, resource_key, expires_at)
    SELECT slot, ?, ?, ? FROM slots
    WHERE slot NOT IN (SELECT slot FROM operation_leases WHERE expires_at > ?) LIMIT 1
    ON CONFLICT DO NOTHING`)
    .bind(owner, key, now + 120000, now).run();
  if (!result.meta.changes) throw new ServiceError("capacity_exceeded", "Service or target is busy. Retry later.", 429);
  return async () => {
    try { await db.prepare("DELETE FROM operation_leases WHERE owner = ?").bind(owner).run(); }
    catch { console.error("fresh402_capacity_release_failed"); }
  };
}

export async function prepareOperation(service: ServiceId, input: unknown, env: FreshnessEnv): Promise<PreparedOperation> {
  try {
    if (service === "extract") return { response: boundedResult(await extract(extractSchema.parse(input))) };
    if (service === "smart_diff") {
      const prepared = await prepareSmartDiff(env.DB, smartDiffSchema.parse(input));
      return { response: boundedResult(prepared.result), commit: prepared.commit };
    }
    const writes: D1PreparedStatement[][] = [];
    const response = await handleCoreRequest(new Request(`https://fresh402.internal${SERVICES.check.path}`, {
      method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" },
    }), { ...env, deferWrites: statements => { writes.push(statements); } });
    return { response, commit: async () => { if (writes.length) await env.DB.batch(writes.flat()); } };
  } catch (error) { return { response: errorResponse(error) }; }
}
