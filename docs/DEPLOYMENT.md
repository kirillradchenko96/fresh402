# Local review, deployment and rollback

This branch is a beta. It does not deploy automatically. Do not publish `server.json` to a directory as a beta service until the corresponding runtime is actually available. Main/production remain owner-controlled.

## Prerequisites

Node.js 24, npm, Git; supported Wrangler platform. On Windows PowerShell with script restrictions use `npm.cmd`/`npx.cmd` (no execution-policy change required).

```sh
git fetch origin
git switch feature/fresh402-v2-beta
npm ci
npm run cf-typegen
npm run typecheck
npm run test:run
npm run openapi:generate
npm run build
npm audit --omit=dev --audit-level=high
```

`build` is **only** `wrangler deploy --dry-run --outdir dist`; it never publishes. `npm ci` must show the Bazaar 2.27.0 patch applied. Tests use local D1 migrations, fake targets/DNS and fake facilitator verification/settlement. They never require a wallet, CDP secrets or network transactions. The runtime is workerd rather than jsdom/Node emulation.

## Local API

```sh
npx wrangler d1 migrations apply fresh402-db --local
npm run dev
```

Open `http://localhost:8787/` and `/openapi.json`; call MCP `tools/list`. These discovery paths do not need payment credentials. Target registration uses public-network DNS/fetch and local D1; private targets remain blocked. The local explorer printed by Wrangler can inspect local watches, private smart tables and analytics.

Without CDP credentials, paid calls return a service-unavailable error instead of fabricated challenges or free output. Full no-money billing/MCP tests are in [v2.spec.ts](../test/v2.spec.ts). There is deliberately no publicly reachable mock-payment mode.

## Future staging/production deployment (owner action)

1. Review the Draft PR, [security limits](SECURITY.md), [payment failure semantics](PRICING.md) and CI results.
2. Create an isolated staging Worker/D1 through the normal account workflow. Give it its own configuration and database ID; do not reuse the production database accidentally. No such resources were created by this change.
3. Verify existing `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` bindings. Format remains the existing 64-byte Ed25519 secret. This mission does not change secrets. Do not copy them into git or chat.
4. Back up/export the production database using the account's approved backup procedure. Record current deployed version and migration state. Exported files can contain public watch URLs/content; store outside git.
5. Apply migrations **before** deploying the Worker. Production already on 0006 needs only additive 0007. Verify with D1's migration list; never replay 0001–0006 manually.
6. Confirm three rate-limit bindings: existing `REGISTER_TARGET_LIMITER` and `REGISTER_GLOBAL_LIMITER`, plus `REQUEST_LIMITER` (namespace 4022001, 120/60s). Run `wrangler types` after any binding edit.
7. Preserve `global_fetch_strictly_public`, compatibility date 2026-09-26, D1 binding `DB`, existing payment recipient and mainnet network. No Node compatibility flag is required by this tested Worker bundle.
8. Review account CPU/request limits, D1 capacity, cost alerts and observability privacy. Beta traffic should remain bounded; no autoscaling claim or paid-service addition is implied.
9. Deploy only after owner approval using the usual production process. Verify discovery, free registration reuse, validation failures, x402 challenge amounts, MCP schemas, no leaked paid output, and aggregate/ledger distinction. Any live-payment acceptance test is a separately authorized action.

The repository CI only installs, tests, checks and creates a dry-run bundle. It does not deploy, merge, set secrets or contact production D1.

## Migration verification

The automatic suite applies 0001–0007 in local D1 and exercises existing watches, old snapshots, replay claims, retention and aggregate counters. For manual checks use Wrangler's `--local` mode or Local Explorer; inspect table names/counts before and after migration. Baseline hashes/IDs and normalizer version must match. V1 continues to read its original tables.

## Rollback

Roll back the Worker to the previously recorded 1.1.1 deployment. **Leave migration 0007 tables in place.** They are additive and unused by 1.1.1. Do not delete snapshots, watches, claims or ledger rows to roll back code. Leave the additional rate-limit binding unused, or remove it later through a reviewed configuration change. Old secrets/recipient do not change.

Historical payments/new v1 checks remain in the existing tables; never restore an old database backup merely to undo a code release, because it would discard customer activity. Old v1 stats already aggregate all routes' recorded amounts. V2-only Smart Diff documents remain stored for a future re-upgrade. A rollback restores old behavior, including the old payment-write timing; use admission controls if rolling back to investigate a payment incident.

Expired metadata cleanup is a separate reviewed operator procedure. No destructive down migration or production cleanup is supplied or executed.
