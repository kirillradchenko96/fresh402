# Fresh402 2.0 Release Candidate

**Web Intelligence API for AI Agents — public web extraction, persistent freshness and structured change detection.**

This branch is release candidate 2.0.0-rc.1, ready for owner-approved isolated staging; public production release is still gated. Production remains at the owner's deployed version until a separate release. No browser rendering, LLM API or live-payment test is required to run the test suite.

| Service | REST | MCP tool | Price (USDC on Base) |
|---|---|---|---:|
| Free baseline | POST /v1/register | fresh402_register | Free |
| Freshness Check | POST /v1/check | fresh402_check | $0.005 |
| Web Extract | POST /v2/extract | fresh402_extract | $0.01 |
| Smart Diff | POST /v2/smart-diff | fresh402_smart_diff | $0.015 |

## Why would an agent pay?

An agent can fetch a page itself. Fresh402 handles the recurring work around that fetch: persisted baselines, safe loading, noise filtering, conditional HTTP, bounded extraction and structured comparisons. Agents receive compact typed results and can choose when to spend downstream context or browser resources. A mature in-house pipeline may already provide this value; basic URL access alone is not the product's differentiation.

Smart Diff adds JSON Pointer changes, HTML/text block matching and explainable significance rules. It is deterministic and does not claim semantic understanding. Extract returns main text, metadata, headings, links and JSON-LD without executing site JavaScript.

## Local verification

Node.js 24 is recommended. On Windows PowerShell use npm.cmd/npx.cmd if script execution is restricted.

```sh
npm ci
npm run cf-typegen
npm run typecheck
npm run test:run
npm run build
npm audit --omit=dev --audit-level=high
```

Build is a Wrangler production-bundle **dry-run**, not deployment. Workerd tests mock the facilitator and target network: they never move money. The Bazaar validation patch must remain applied.

For local HTTP discovery, apply D1 migrations locally and start Wrangler:

```sh
npx wrangler d1 migrations apply fresh402-db --local
npm run dev
```

Open http://localhost:8787/openapi.json. MCP tools/list and free registration need no CDP credentials. Paid calls fail closed if payment configuration is missing. See the [local review and deployment guide](docs/DEPLOYMENT.md) for safe staging and future owner-run release steps.

## Documentation

- [Технический отчёт на русском](docs/REPORT_RU.md)
- [Complete REST reference](docs/API.md) and [OpenAPI specification](docs/openapi.json)
- [MCP tools and agent workflows](docs/MCP.md)
- [curl, TypeScript and Python examples](examples/README.md)
- [Pricing and payment retry behavior](docs/PRICING.md)
- [Architecture and extension seams](docs/ARCHITECTURE.md)
- [Analytics and conversion definitions](docs/ANALYTICS.md)
- [Security and limits](docs/SECURITY.md)
- [Deployment, migration and rollback](docs/DEPLOYMENT.md)
- [Commercial positioning](docs/POSITIONING.md), [2.1 roadmap](docs/ROADMAP.md), [changelog](CHANGELOG.md)
- [Original v1 usage documentation](docs/API_V1_LEGACY.md)

## Compatibility and boundaries

Existing /v1 endpoints, watch IDs, normalizer version 2 and D1 tables remain supported. Migrations 0007 and 0008 only add tables and a journal finalization trigger. V1 history/diff continue to expose shared stored v1 data; they never fetch a fresh paid result or expose v2 structural documents. Rolling back the Worker does not require deleting data or reverting the additive migration.

All paid results require SDK-verified payment and confirmed settlement. A 402 response is not a sale. New state is committed only after settlement. Free registrations have quotas; all operations have bounded streams/deadlines and D1 capacity leases.

Release limits matter: JS-only and authenticated pages are unsupported; HTML main-content selection and significance are heuristic; old HTML baselines lack DOM structure; private seven-day recovery requires a client-generated token saved before paying; ambiguous settlement requires operator reconciliation. DNS answers and redirect destinations are checked, but Workers cannot pin arbitrary-host TLS peers: see the [network boundary](docs/SECURITY.md). Batch, Price Track, Alerts and prepaid credits are architecture/roadmap only.

Repository: https://github.com/kirillradchenko96/fresh402

Existing production: https://fresh402.kirilllabs.workers.dev (new 2.0 endpoints are not advertised as deployed).

Release review: [payment recovery](docs/PAYMENT_RECOVERY.md), [isolated staging](docs/STAGING.md), [Russian audit report](docs/RELEASE_REPORT_RU.md).
