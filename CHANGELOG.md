# Changelog

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
