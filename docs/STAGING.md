# Isolated staging plan

`wrangler.jsonc` defines `env.staging` for **fresh402-staging**, a distinct **fresh402-staging-db**, separate rate-limit namespaces, a 1,000 ms CPU ceiling, 50 subrequests, a 1,000/day UTC global expensive-operation budget, no version preview URLs, a maintenance Cron and the exact target allowlist `example.com`. A client-specific Bearer token protects every application route; missing staging credentials fail closed. `/.well-known/*` returns 404 even to authorized callers, and payment challenges omit Bazaar extensions. No staging directory registration is performed.

The owner-provisioned staging D1 UUID is `ba10c4f4-d845-4f6f-9494-b0592dcaf19b`. Migrations 0001-0008 are applied remotely, and the authenticated staging Worker is deployed at https://fresh402-staging.kirilllabs.workers.dev. No mainnet payment has been performed. See [the staging verification report](STAGING_REPORT_RU.md). Staging configuration never falls back to the production binding. Staging requires independent credentials; production CDP secrets must not be copied. Without CDP configuration, paid routes return unavailable while authenticated free registration/MCP discovery can be reviewed.

## Fully local checks

```sh
npm ci
npm run cf-typegen
npm run typecheck
npm run test:run
npm run test:tools
npm run staging:check
npm run build
npm run build:staging
npx wrangler d1 migrations apply fresh402-staging-db --env staging --local --persist-to .wrangler/rc-staging
npx wrangler dev --env staging --port 8789 --test-scheduled --persist-to .wrangler/rc-staging
```

For authenticated local HTTP checks, create an ignored `.dev.vars.staging` containing an independently generated local-only `STAGING_ACCESS_TOKEN`. Never use production secrets. The test suite injects a fake facilitator through code-only dependency injection, with no remotely reachable free-payment mode. Local migration and dry-run commands cannot publish a Worker.

Use the Local Explorer URL printed by Wrangler to inspect local Worker bindings and D1 databases. Query captured logs/traces with the read-only explorer observability endpoint. Assert that only the staging/local D1 is bound and no private-network/service binding exists. The `--test-scheduled` endpoint can exercise cleanup locally; inspect active claims and watches afterward.

## Owner-approved cloud steps (prepared, not executed)

1. Record the intended Cloudflare account, independent credential issuance plan, target allowlist, account spending alerts and rollback version. Approve staging resource creation. Approve actual USDC payments separately; this configuration still uses the existing Base mainnet product, not a fabricated testnet payment service.
2. Create only the staging D1:

```sh
npx wrangler d1 create fresh402-staging-db
```

3. Put the returned **new** UUID into `env.staging.d1_databases[0].database_id`. Validate it differs from production:

```sh
npm run staging:check
node scripts/staging-check.mjs --provisioned
npm run cf-typegen
npm run build:staging
```

4. Issue a separate staging access secret and separate CDP key credentials. Configure only staging:

```sh
npx wrangler secret put STAGING_ACCESS_TOKEN --env staging
npx wrangler secret put CDP_API_KEY_ID --env staging
npx wrangler secret put CDP_API_KEY_SECRET --env staging
```

5. Apply migrations to the explicitly provisioned staging D1 and deploy only the staging Worker, after owner approval:

```sh
node scripts/staging-check.mjs --provisioned
npx wrangler d1 migrations apply fresh402-staging-db --env staging --remote
npx wrangler deploy --env staging
```

## Cloud acceptance checklist

- Unauthenticated `/`, `/mcp`, registration and paid calls: 403; authorized `/.well-known/x402`/Glama: 404; no Bazaar extension.
- REST and modern/stateless MCP discovery work with the staging access token. Missing CDP credentials cannot bypass billing.
- Controlled owned fixtures cover HTML nested scope/entities/Unicode, JSON arrays/objects and text. Adjust the exact allowlist only to owner-controlled fixture hosts; redirect destinations must also be allowlisted.
- Migrations 0006 -> 0008 and 0007 -> 0008 preserve legacy IDs, snapshots and payment events. Record backups/counts; do not import production secrets or customer data.
- With separately approved real payments: verify recipient/asset/amount, receipt finality, one financial event, one snapshot commit, private recovery after disconnect/restart, concurrent replay denial and no automatic payment replacement.
- Indeterminate-settlement drills keep payloads private and targets quarantined. Validate the reconciliation checker against real finalized receipts before trusting it for an incident.
- Cron removes expired metadata/payloads while retaining active claims, watches/snapshots and all financial records. Inspect backlog and unresolved-state age.
- Measure actual Cloudflare CPU/memory, latency, cancellation behavior and D1 usage. Local workerd tests and dry-runs do not measure deployed CPU or prove real chain settlement.
- Account-level alerts and admission controls cover total HTTP/D1 costs. The daily operation counter bounds admitted expensive work, not every billed platform request.

## Rollback and production gate

Keep additive migrations 0007/0008 and all user/financial data. Disable expensive admission (`OPERATION_DAILY_LIMIT=0`) during an incident, record and resolve all `settling`/`settled` operations, and retain a recovery-capable deployment. Rolling back to 1.1.1 removes journal-aware recovery and quarantine checks; do not route paid traffic to it while unresolved 2.0 operations exist.

An unrestricted public launch is blocked until the DNS TOCTOU boundary has a verified egress policy/gateway or an explicitly scoped trusted-host launch design. `global_fetch_strictly_public` documents Internet routing and same-zone security behavior, not arbitrary-host peer pinning. Staging's owned-host allowlist is a controlled-test boundary, not a general DNS-rebinding proof. Production additionally needs successful cloud acceptance, owner-approved real payment evidence, reconciliation operations, account cost/log controls and a release/rollback approval. No merge or production deploy is part of this task.


## Owner access to the deployed staging

The existing access token is encrypted using Windows CurrentUser DPAPI in `%LOCALAPPDATA%\Fresh402\staging\access-token.dpapi`, with owner-only filesystem permissions. It is not in the repository and is never printed. Run from this checkout on the owner's Windows profile:

```powershell
.\scripts\staging-access.ps1 -CopyToClipboard
.\scripts\staging-access.ps1 -Smoke -Url https://fresh402-staging.kirilllabs.workers.dev
```

Clipboard mode is an explicit owner action; smoke mode supplies the token only in process memory. The remote Worker has the token as `secret_text`, with no CDP secrets. The historical provisioning instructions above apply to a future replacement environment; do not recreate the existing database or rotate the current access token automatically.
