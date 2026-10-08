import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkStaging } from "./staging-check.mjs";
const raw=await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8");
const config=JSON.parse(raw.slice(raw.indexOf("{")));
test("provisioned staging is isolated and an unprovisioned sentinel is still rejected",()=>{
  checkStaging(config,true);
  const unprovisioned=structuredClone(config);
  unprovisioned.env.staging.d1_databases[0].database_id="00000000-0000-0000-0000-000000000000";
  assert.throws(()=>checkStaging(unprovisioned,true),/not been provisioned/);
});
for(const [name,mutate] of [
  ["production database",c=>{c.env.staging.d1_databases[0].database_id=c.d1_databases[0].database_id;}],
  ["production limiter",c=>{c.env.staging.ratelimits[0].namespace_id=c.ratelimits[0].namespace_id;}],
  ["missing allowlist",c=>{delete c.env.staging.vars.TARGET_HOST_ALLOWLIST;}],
  ["public preview",c=>{c.env.staging.preview_urls=true;}],
  ["private binding",c=>{c.env.staging.vpc_services=[];}],
  ["excessive CPU",c=>{c.env.staging.limits.cpu_ms=10000;}],
]) test("staging guard rejects "+name,()=>{const copy=structuredClone(config);mutate(copy);assert.throws(()=>checkStaging(copy));});
