import { readFile } from "node:fs/promises";
export function checkStaging(config, requireProvisioned = false) {
  const stage = config.env?.staging;
  const budget = Number(stage?.vars?.OPERATION_DAILY_LIMIT);
  if (!stage || stage.name !== "fresh402-staging" || stage.vars?.ENVIRONMENT !== "staging" || !stage.vars.TARGET_HOST_ALLOWLIST?.trim() || !Number.isSafeInteger(budget) || budget > 1000 || budget < 0) throw new Error("Unsafe staging identity or budget");
  if (stage.d1_databases?.length !== 1 || stage.d1_databases[0].binding !== "DB" || stage.d1_databases[0].database_name !== "fresh402-staging-db" || config.d1_databases.some(db=>db.database_id === stage.d1_databases[0].database_id)) throw new Error("Staging must use its own D1 database");
  if (requireProvisioned && stage.d1_databases[0].database_id === "00000000-0000-0000-0000-000000000000") throw new Error("Staging database has not been provisioned with owner approval");
  const names = ["REQUEST_LIMITER","REGISTER_TARGET_LIMITER","REGISTER_GLOBAL_LIMITER"];
  if (names.some(name=>!stage.ratelimits?.some(limit=>limit.name===name)) || stage.ratelimits.some(limit=>config.ratelimits.some(prod=>prod.namespace_id===limit.namespace_id))) throw new Error("Staging rate limit bindings must be separate");
  if (stage.preview_urls !== false || !Number.isSafeInteger(stage.limits?.cpu_ms) || stage.limits.cpu_ms < 1 || stage.limits.cpu_ms > 1000 || !Number.isSafeInteger(stage.limits?.subrequests) || stage.limits.subrequests < 1 || stage.limits.subrequests > 50 || stage.services || stage.vpc_services || stage.vpc_networks || !stage.triggers?.crons.length) throw new Error("Unsafe staging egress, preview or execution settings");
}
if (process.argv[1]?.replaceAll("\\","/").endsWith("/staging-check.mjs")) {
  const raw = await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8");
  checkStaging(JSON.parse(raw.slice(raw.indexOf("{"))),process.argv.includes("--provisioned"));
  process.stdout.write("Staging configuration is isolated. No cloud resources were changed.\n");
}
