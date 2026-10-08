# Changelog

## 2.0.0-rc.1 ? unreleased

- Persist bounded paid results and write plans before settlement; atomically record receipts and revenue, then finalize snapshots with a completion trigger.
- Add private seven-day REST/MCP recovery using a client-generated bearer token. Public payment signatures and transaction hashes never authorize replay.
- Quarantine ambiguous settlements and target writes; fence SDK settlement retries. Add offline finalized-USDC proof validation and guarded operator SQL generation.
- Add migration 0008, bounded Cron cleanup, global daily operation budgets and isolated authenticated staging with separate D1/limiters, target allowlist and CPU/subrequest ceilings.
- Fix nested HTML scope leakage, duplicate text, block boundaries and sparse static content warnings; replace quadratic exact block matching with indexed matching.
- Preserve v1 IDs/history/normalizer and existing services/prices. No 2.1 services, deployment, live payments or production data changes.
- Production remains gated on actual Cloudflare staging, owner-approved payment validation and the unresolved arbitrary-host DNS TOCTOU boundary. See RELEASE_REPORT_RU.md.


## 2.0.0-beta.1 — unreleased

- Add Web Extract REST/MCP service ($0.01) for HTML, JSON and text, metadata, headings, links, JSON-LD and CSS scope.
- Add deterministic Smart Diff ($0.015): typed JSON Pointer changes, HTML/text block comparison, explicit significance rules, fixed/previous/hash baselines and private bounded history.
- Preserve Freshness Check ($0.005), free registration, existing watch IDs, normalizer version 2, v1 endpoints and migrations 0001–0006.
- Share pricing, validation, discovery and operation execution across REST and MCP; preserve Bazaar's Workers-compatible schema patch.
- Defer paid v1/v2 state writes until successful settlement; reject concurrent/repeated authorizations before loading targets.
- Add request limits, global D1 capacity leases, per-target serialization, DNS/redirect validation and bounded extraction/diff complexity.
- Add additive migration 0007 and daily privacy-limited conversion counters. Keep challenges distinct from confirmed revenue.
- Add REST/OpenAPI, MCP, deployment/rollback/security/analytics/positioning/roadmap documentation and safe client examples.
- Extend workerd regression/integration tests with simulated payments; no live transaction or production deployment performed.

Known beta limitations: no browser rendering or model-based semantics; legacy HTML comparison has reduced structure; no durable paid-response replay/refund; DNS preflight cannot pin arbitrary-host fetch connections; remaining development-only braces advisory; future batch/price/alerts/credits are not implemented.

## 1.1.1

- Fix Bazaar validation in Cloudflare Workers with `@cfworker/json-schema` and `patch-package` (PR #7).

## 1.1

- Persistent watch IDs, free baseline registration, HTML/JSON/text normalization and filters, caller hashes, shared cache, conditional HTTP and bounded snapshot history.
