import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { checkStaging } from "./staging-check.mjs";
const raw=await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8");
const config=JSON.parse(raw.slice(raw.indexOf("{")));
test("staging is isolated and a sentinel D1 cannot pass the provisioned check",()=>{checkStaging(config);assert.throws(()=>checkStaging(config,true),/not been provisioned/);});
for(const [name,mutate] of [
  ["production database",c=>{c.env.staging.d1_databases[0].database_id=c.d1_databases[0].database_id;}],
  ["production limiter",c=>{c.env.staging.ratelimits[0].namespace_id=c.ratelimits[0].namespace_id;}],
  ["missing allowlist",c=>{delete c.env.staging.vars.TARGET_HOST_ALLOWLIST;}],
  ["public preview",c=>{c.env.staging.preview_urls=true;}],
  ["private binding",c=>{c.env.staging.vpc_services=[];}],
  ["excessive CPU",c=>{c.env.staging.limits.cpu_ms=10000;}],
]) test("staging guard rejects "+name,()=>{const copy=structuredClone(config);mutate(copy);assert.throws(()=>checkStaging(copy));});
