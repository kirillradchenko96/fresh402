# Fresh402 2.0 Release Candidate architecture

Fresh402 serves bounded web intelligence over REST and MCP with per-operation x402 billing. Version 2.0.0-rc.1 extends the v1 core; normalizer version 2 and deterministic `w_` identifiers remain unchanged.

## Request lifecycle

1. Read at most 65,536 request bytes with a 10-second deadline before cloning/parsing.
2. Apply edge admission limits and validate the operation schema. No target or DNS fetch at this stage.
3. The x402 SDK constructs the service-specific challenge or verifies the supplied EIP-3009 authorization through CDP.
4. Atomically claim the verified payer/asset/nonce identity in D1. A concurrent replay is rejected before execution. The private journal also binds canonical arguments, transport, a proof digest and an optional independent recovery-token hash. Signatures and bearer secrets are never stored.
5. Acquire one of eight global D1 capacity leases. Load target data through the shared safe-fetch implementation.
6. Persist the bounded result and server-generated SQL write plan BEFORE settlement. A compare-and-set moves prepared to settling before exactly one facilitator submission; SDK retries cannot cross that gate. Upstream errors are not settled.
7. Persist the confirmed receipt and financial ledger in one D1 batch. Finalize snapshots plus completed state in another atomic D1 batch, protected against duplicate finalization by a database trigger. Settlement uncertainty returns no paid content and quarantines the target.
8. Release capacity and increment privacy-limited aggregate counters. Analytics failures do not fail a successful customer response.

REST and MCP call the same [operation dispatcher](../src/operations.ts), [service catalog](../src/contracts.ts), [payment adapter](../src/payments.ts), and [analytics counters](../src/analytics.ts). SDK instances and hooks are request-local, avoiding cached closures over stale D1 bindings or credentials.

## Modules

| Module | Responsibility |
|---|---|
| [index.ts](../src/index.ts) | Hono and MCP adapters, input validation, admission and result delivery |
| [freshness.ts](../src/freshness.ts) | Existing watch/normalizer/history/cache/conditional-HTTP behavior, deferred paid writes |
| [safe-fetch.ts](../src/safe-fetch.ts), [dns.ts](../src/dns.ts), [body.ts](../src/body.ts) | Target policy, DNS preflight, redirects, bounded streams, deadlines |
| [extract.ts](../src/extract.ts) | Native HTMLRewriter extraction, entities, JSON complexity guard |
| [smart-diff.ts](../src/smart-diff.ts) | Structural comparison, significance and private snapshot retention |
| [cdp.ts](../src/cdp.ts) | Existing Ed25519 CDP JWT authentication with bounded facilitator timeouts |
| [discovery.ts](../src/discovery.ts) | REST specification and x402 resource manifest |

## Data compatibility

Migrations 0001–0006 are untouched. Legacy `resources`, `snapshots`, `watches`, `watch_snapshots`, and `payment_events` retain their columns and semantics. V1 history/diff remain public, shared, stored-data endpoints. They never perform new fetches and never expose v2 private Smart Diff documents.

[Migration 0007](../migrations/0007_v2_beta.sql) adds:

- `smart_baselines`: one fixed comparison baseline per watch, initialized after the first successful Smart Diff payment from the earliest retained compatible v1 snapshot.
- `smart_snapshots`: up to 20 most recent paid Smart Diff documents per watch. Independent of v1 retention.
- `payment_claims`: authorization replay digests and expirations; no signatures.
- `operation_leases`: eight global capacity slots, expiring after 120 seconds if the request crashes.
- `analytics_daily`: bounded-dimension daily counters, with no per-request payloads or URLs.

The fixed baseline is the earliest **retained** snapshot on first Smart Diff use, not a promise to recover a v1 baseline already pruned before upgrade. Explicit `previous_hash` can address either retained v1 or Smart Diff snapshots; the field overrides `compare_to`. Watch IDs identify shared configuration, not accounts or secrets.

Migration 0008 adds `payment_operations`, a completion trigger, and the global daily `operation_budget`. An indexed Cron cleanup handles temporary claims/leases and scrubs completed recovery payloads after seven days without removing payment history. Ambiguous/settled-but-unfinalized operations remain for reconciliation. See [retention policy](PAYMENT_RECOVERY.md).

## Extraction

Public HTTP(S), no browser, no JavaScript execution, cookies, authentication forwarding or interaction. Prefer `main`, then `article`, then body; explicit CSS scope wins. Native HTMLRewriter removes scripts/styles/navigation/noise, captures headings and text blocks, and extracts bounded metadata/links/JSON-LD. `entities` decodes character references without code generation. JSON is parsed and canonicalized with the existing ignore-path implementation; text is whitespace-normalized.

Main-content selection is heuristic. CSS support follows HTMLRewriter, not a browser DOM. JS-only pages, authentication gates and challenges are not bypassed. A successful HTML response can still be a challenge page; callers must inspect the extracted text.

## Smart Diff

- JSON: recursively compare own properties by JSON Pointer; object key order is ignored, arrays remain ordered. Values are typed; large change values become marked excerpts.
- HTML/text: normalize whitespace/typographic variants, match unchanged blocks even if reordered, then pair changed blocks using an exact HTML ID or word-set overlap (>0.45). Report unmatched blocks as added/removed.
- Legacy HTML snapshots have only flattened text. Compare both versions through the existing v1 normalizer and sentence segmentation, reporting `comparison_quality: legacy_text`. Subsequent previous-snapshot comparisons use v2 structure.
- Score: 20 for any change, +25 numeric/price field, +30 availability/stock language or field, +10 removal, +20 for at least ten changes; cap 100. Content-type change has score at least 80. Levels: none=0, low=1–29, medium=30–59, high=60–100.
- No semantic equivalence, factual inference, translated-text matching or product-specific truth claims. Reordering HTML blocks is deliberately ignored; JSON array reordering is significant. Scores are routing hints, never probabilities.

Limits are explicit: 200 returned changes with total counts, 1,000 blocks, 250,000 word comparisons, 10,000 JSON nodes, depth 64, 200,000 serialized snapshot characters. Excess complexity fails before settlement instead of silently returning an incomplete answer.

## Reliability boundaries

On-chain settlement and D1 cannot be one transaction. [The durable payment journal](PAYMENT_RECOVERY.md) keeps the result before settlement, recovers completed/settled operations with a separate private token, and quarantines settling operations until operator reconciliation. Public signatures/transaction hashes never authorize recovery. Failed snapshot finalization can return paid content with a persistence warning while remaining safely retryable. There is no automatic refund, universal facilitator idempotency promise or indefinite response retention.

The facilitator `/supported` call currently happens per paid request (including challenge); no cross-request I/O promise cache is used. This favors isolation and correctness over latency. CDP request deadlines are 15 seconds; upstream loading has a separate 10-second deadline.

## Extension seams (not shipped endpoints)

| Next service | Design |
|---|---|
| Batch Check | A bounded job manifest with per-item status and exact per-item pricing, limited fan-out through the existing loader and capacity policy. Decide partial settlement before implementing. |
| Price Track | Versioned extraction rules on a watch (CSS/JSON Pointer, currency and units), provenance and explicit missing/ambiguous values. Do not infer arbitrary prices from prose. |
| Smart Alerts | Owned subscriptions, scheduler/queue, signed webhooks with replay window, recipient verification and egress checks. Alert delivery idempotency separate from fetch billing. |
| API keys / credits | Introduce authenticated principals and a `BillingAuthorizer` interface alongside x402. Hash API keys; use an append-only credit ledger with atomic reservations/settlement. Never trust a client balance. |

Do not publish these names as implemented tools, route requests to stubs, or install extra paid services for them.

## References checked during implementation

- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [limits](https://developers.cloudflare.com/workers/platform/limits/), [compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/).
- [D1 database/batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- [x402 v2 HTTP headers](https://docs.x402.org/core-concepts/http-402), [seller integration](https://docs.x402.org/getting-started/quickstart-for-sellers), [MCP guide](https://docs.x402.org/guides/mcp-server-with-x402).
- [MCP current transport specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) and installed `@modelcontextprotocol/server` type declarations.

The tested existing x402 2.27.0 / MCP server 2.1.0 dependency versions are retained deliberately; upgrading x402 must rebase and revalidate the Bazaar patch. Registry latest versions observed during review were 2.28.0 / 2.3.1; they are not claimed as tested here.
