import { BodyReadError } from "./body";
import { ServiceError, SERVICES, type ServiceId, extractSchema, smartDiffSchema } from "./contracts";
import { extract } from "./extract";
import { handleCoreRequest, type FreshnessEnv } from "./freshness";
import { TargetNotAllowedError } from "./safe-fetch";
import { prepareSmartDiff } from "./smart-diff";
import {gatewayFromBindings} from "./egress";
import type { SqlWrite } from "./sql";
import { resourceKey } from "./payment-journal";
import {capacityConfiguration,type CapacityBindings} from './capacity-config';

export function errorResponse(error: unknown): Response {
  if (error instanceof ServiceError || error instanceof BodyReadError) return Response.json({ error: error.code, message: error.message }, { status: error.status,headers:error.status===429?{'retry-after':'5'}:undefined });
  if (error instanceof TargetNotAllowedError) return Response.json({ error: "target_not_allowed", message: error.message }, { status: 400 });
  console.error("fresh402_operation_failed");
  return Response.json({ error: "service_unavailable", message: "Unable to complete the operation. Retry later." }, { status: 503 });
}
export interface PreparedOperation { response: Response; writes?: SqlWrite[] }
export type CapacityRelease = (() => Promise<void>) & { owner: string; slot:number };
function boundedResult(value: unknown): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > 524288) throw new ServiceError("result_too_large", "Result exceeds the 512 KiB output budget. Use a narrower scope.", 413);
  return new Response(body, { headers: { "content-type": "application/json" } });
}

/** Capacity leases are global in D1, unlike the per-location rate limiter. */
export async function acquireCapacity(db: D1Database, input?: unknown, dailyLimit = 10000, options:{concurrency?:number;freeLimit?:number;registration?:boolean;slotsPerInstance?:number}={}): Promise<CapacityRelease> {
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 10_000_000) throw new ServiceError("invalid_operation_budget", "Operator budget is invalid.", 503);
  const capacity=options.concurrency??8,freeLimit=options.freeLimit??dailyLimit;
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>4096||!Number.isSafeInteger(freeLimit)||freeLimit<0||freeLimit>10_000_000)throw new ServiceError('invalid_operation_budget','Operator budget is invalid.',503);
  const free=options.registration?1:0;
  const group=options.slotsPerInstance??capacity,freeSlots=options.slotsPerInstance===undefined?group:Math.max(1,group-1);
  if(!Number.isInteger(group)||group<1||group>4096)throw new ServiceError('invalid_operation_budget','Operator budget is invalid.',503);
  const owner = crypto.randomUUID(), now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const key = await resourceKey(db, input);
  // Only expired coordination metadata is removed, never user snapshots.
  await db.prepare("DELETE FROM operation_leases WHERE expires_at <= ?").bind(now).run();
  const results = await db.batch([db.prepare(`WITH RECURSIVE slots(slot) AS (SELECT 0 UNION ALL SELECT slot + 1 FROM slots WHERE slot + 1 < ?)
    INSERT INTO operation_leases(slot, owner, resource_key, expires_at)
    SELECT slot, ?, ?, ? FROM slots
    WHERE slot NOT IN (SELECT slot FROM operation_leases WHERE expires_at > ?)
    AND NOT EXISTS (SELECT 1 FROM payment_operations WHERE resource_key = ? AND state IN ('settling','settled'))
    AND COALESCE((SELECT started FROM operation_budget WHERE day = ?), 0) < ?
    AND (? = 0 OR COALESCE((SELECT free_started FROM operation_budget WHERE day = ?),0) < ?)
    AND (? = 0 OR slot % ? < ?) ORDER BY slot LIMIT 1
    ON CONFLICT DO NOTHING`)
    .bind(capacity,owner, key, now + 120000, now, key, day, dailyLimit,free,day,freeLimit,free,group,freeSlots),
    db.prepare(`INSERT INTO operation_budget(day, started,free_started) SELECT ?, 1,? WHERE EXISTS (SELECT 1 FROM operation_leases WHERE owner = ?)
      ON CONFLICT(day) DO UPDATE SET started = started + 1,free_started=free_started+excluded.free_started`).bind(day,free,owner),
  ]);
  if (!results[0].meta.changes) throw new ServiceError("capacity_exceeded", "Service, target or daily budget is exhausted. Retry later.", 429);
  const slot=await db.prepare('SELECT slot FROM operation_leases WHERE owner=?').bind(owner).first<number>('slot');
  if(slot===null)throw new ServiceError('capacity_exceeded','Operation capacity lease expired. Retry later.',429);
  return Object.assign(async () => {
    try { await db.prepare("DELETE FROM operation_leases WHERE owner = ?").bind(owner).run(); }
    catch { console.error("fresh402_capacity_release_failed"); }
  }, { owner,slot });
}

// This number bounds temporary buffers in one isolate, not global throughput or
// financial state. Global leases and every payment state remain durable in D1.
let isolateActive=0;
export async function admitOperation(env:FreshnessEnv&CapacityBindings,input:unknown,registration=false):Promise<CapacityRelease> {
  const config=capacityConfiguration(env);
  if(isolateActive>=config.isolateConcurrency)throw new ServiceError('capacity_exceeded','This execution instance is busy. Retry later.',429);
  isolateActive++;
  try {
    const lease=await acquireCapacity(env.DB,input,config.dailyLimit,{concurrency:config.concurrency,freeLimit:config.freeDailyLimit,registration,slotsPerInstance:env.TARGET_FETCH_MODE==='container'?config.perInstance:undefined});
    let released=false;
    return Object.assign(async()=>{if(released)return;released=true;try{await lease();}finally{isolateActive--;}},{owner:lease.owner,slot:lease.slot});
  }catch(error){isolateActive--;throw error;}
}
export function admittedBindings<T extends FreshnessEnv&CapacityBindings>(env:T,lease:CapacityRelease):T {
  return {...env,egressLeaseOwner:lease.owner,egressInstance:Math.floor(lease.slot/capacityConfiguration(env).perInstance)};
}

export async function prepareOperation(service: ServiceId, input: unknown, env: FreshnessEnv): Promise<PreparedOperation> {
  try {
    if (service === "extract") return { response: boundedResult(await extract(extractSchema.parse(input), env.TARGET_HOST_ALLOWLIST, gatewayFromBindings(env), env.requestSignal)) };
    if (service === "smart_diff") {
      const prepared = await prepareSmartDiff(env.DB, smartDiffSchema.parse(input), env.TARGET_HOST_ALLOWLIST, gatewayFromBindings(env), env.requestSignal);
      return { response: boundedResult(prepared.result), writes: prepared.writes };
    }
    const writes: SqlWrite[][] = [];
    const response = await handleCoreRequest(new Request(`https://fresh402.internal${SERVICES.check.path}`, {
      method: "POST", body: JSON.stringify(input), headers: { "content-type": "application/json" },
    }), { ...env, deferWrites: statements => { writes.push(statements); } });
    return { response, writes: writes.flat() };
  } catch (error) { return { response: errorResponse(error) }; }
}
