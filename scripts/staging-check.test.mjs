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
  ["missing secure gateway mode",c=>{delete c.env.staging.vars.TARGET_FETCH_MODE;}],
  ["legacy hostname restriction",c=>{c.env.staging.vars.TARGET_HOST_ALLOWLIST="example.com";}],
  ["public preview",c=>{c.env.staging.preview_urls=true;}],
  ["private binding",c=>{c.env.staging.vpc_services=[];}],
  ["excessive CPU",c=>{c.env.staging.limits.cpu_ms=10000;}],
  ["unbounded Container pool",c=>{c.env.staging.containers[0].max_instances=100;}],
  ["unbounded Container runtime",c=>{c.env.staging.vars.GATEWAY_RUNTIME_BUDGET_SECONDS='100000';}],
  ["unreviewed gateway image",c=>{c.env.staging.containers[0].image='docker.io/unreviewed/public:latest';}],
  ["production Container class binding",c=>{c.env.staging.durable_objects.bindings[0].script_name='fresh402';}],
  ["missing release metadata",c=>{delete c.env.staging.version_metadata;}],
  ["deferred Durable Object activation",c=>{c.env.staging.durable_objects.code_update_strategy={mode:'deferred',max_delay:300};}],
]) test("staging guard rejects "+name,()=>{const copy=structuredClone(config);mutate(copy);assert.throws(()=>checkStaging(copy));});
