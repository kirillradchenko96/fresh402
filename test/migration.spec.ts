import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { handleCoreRequest } from "../src/freshness";

vi.mock("../src/dns",()=>({assertPublicDns:vi.fn(async()=>{})}));
declare global { namespace Cloudflare { interface Env { TEST_MIGRATIONS:D1Migration[]; MIGRATION_DB:D1Database } } }

it("upgrades an existing 0006 database without changing any legacy watch or snapshot",async()=>{
  const db=env.MIGRATION_DB;
  await applyD1Migrations(db,env.TEST_MIGRATIONS.slice(0,6));
  const mocked=vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response('{"price":10}',{headers:{"content-type":"application/json"}}));
  try {
    const response=await handleCoreRequest(new Request("https://service.example/v1/register",{method:"POST",body:JSON.stringify({url:"https://public.example/"})}),{
      DB:db,REGISTER_TARGET_LIMITER:{limit:async()=>({success:true})},REGISTER_GLOBAL_LIMITER:{limit:async()=>({success:true})},
    });
    expect(response.status).toBe(200);
    const watch=await db.prepare("SELECT * FROM watches").first();
    const snapshot=await db.prepare("SELECT * FROM watch_snapshots").first();
    const payments=await db.prepare("SELECT * FROM payment_events ORDER BY id").all();
    await applyD1Migrations(db,env.TEST_MIGRATIONS);
    expect(await db.prepare("SELECT * FROM watches").first()).toEqual(watch);
    expect(await db.prepare("SELECT * FROM watch_snapshots").first()).toEqual(snapshot);
    expect((await db.prepare("SELECT * FROM payment_events ORDER BY id").all()).results).toEqual(payments.results);
    for(const table of ["smart_baselines","smart_snapshots","payment_claims","operation_leases","analytics_daily"]) {
      expect(await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first("n")).toBe(0);
    }
    // Old-code rollback reads the same original columns and normalizer data.
    expect(await db.prepare("SELECT normalizer_version FROM watches").first("normalizer_version")).toBe(2);
  } finally {mocked.mockRestore();}
});
