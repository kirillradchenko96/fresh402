# Fresh402 2.0 Beta implementation plan

Base: `3378225` (main, Bazaar Workers fix). Branch: `feature/fresh402-v2-beta`.
Git push dry-run and GitHub repository write permissions verified before implementation.
Baseline: 70 existing tests passed in workerd on 2026-10-07.

1. Preserve v1 watch IDs, normalizer version 2, migrations 0001–0006, public history contracts and Bazaar patch.
2. Extract shared safe-fetch primitives. Add schema-driven service/pricing catalog and bounded native HTML extraction (no browser or LLM).
3. Add deterministic structural diff: JSON Pointer changes, HTML/text block matching, explicit rule scores, legacy baseline fallback, bounded private snapshot sidecar. Keep original baseline independently of rolling snapshots.
4. Use actual x402 SDK verification/settlement for REST and MCP, common service execution, request-local state, replay controls, fail-closed admission. Do not expose results or publish snapshots before successful settlement.
5. Add additive D1 tables for private smart snapshots, payment replay protection, concurrency leases and daily aggregate analytics. Store no request bodies, target URLs, page content or payment signatures in analytics.
6. Extend workerd tests for extraction, diff, billing denial/success/failure/replay, MCP, migrations and security. Mock facilitator and targets; never execute real payments.
7. Document REST/OpenAPI, MCP, pricing, deployment, additive migration/rollback, agent examples and commercial positioning. Mark future batch/alerts/credits as roadmap.
8. Run TypeScript checks, complete tests, dependency/security checks and production bundle dry-run. Commit, push and open Draft PR; never merge or deploy.

Architecture decisions and implementation limitations will be documented with the resulting code. No extra paid infrastructure or production configuration changes are authorized.
