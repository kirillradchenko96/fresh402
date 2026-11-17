# Analytics and conversion

Daily D1 aggregates use only `day`, `service`, `transport`, `event`, `traffic_class`, `count`. There are no request bodies, target URLs, page contents, payment signatures, cookies, IP addresses, raw user agents or API secrets in these counters. Request admission uses Cloudflare's trusted connecting-IP header in the platform rate limiter; this is not persisted in analytics.

| Event | Meaning |
|---|---|
| `discovery` | Root/manifest or MCP initialize/tools-list discovery |
| `documentation` | OpenAPI retrieval |
| `registration_created` | A new successful free baseline |
| `registration_existing` | Repeat registration served from storage without fetching |
| `initial_402` | Unpaid REST challenge or unpaid MCP payment-required result |
| `payment_attempt` | A payment header/meta value was supplied, including malformed/invalid attempts |
| `payment_verified` | Facilitator verified and D1 admitted a fresh authorization identity |
| `payment_settled` | Successful SDK settlement recorded with a unique transaction hash |
| `paid_result` | Operation succeeded and settlement was confirmed |
| `repeat_paid_call` | Settlement from a payer with an earlier recorded settlement |
| `operation_failed` | Work was prepared but failed or did not settle |

`technical` means an explicit `X-Fresh402-Purpose: probe`, or a user-agent containing healthcheck, uptime, probe, monitoring, test/ or vitest (case-insensitive). Everything else is `unclassified`, not a claim of human intent or commercial value. These labels are spoofable. Count externally settled paid use separately when evaluating useful traffic. Do not exclude ordinary AI-agent traffic simply because it is automated.

The existing settlement table retains on-chain transaction ID, payer, network, route, amount and known-test-wallet flag for financial deduplication. It contains no signed payment payload. Repeat counts refer to repeated paying wallets across the service, not identified people or cohorts. Simultaneous first-time payments can undercount repeat events; use the ledger for exact retrospective analysis. Aggregates are best effort and may undercount on crashes/D1 outages. They are not an accounting ledger.

## New product telemetry and voluntary feedback

Structured existing Workers Logs record controlled stage/tool/transport/traffic dimensions. Discovery and claimed framework/crawler labels are sampled at5%; supplied identities remain unverified. No raw User-Agent, IP, query, prompt, target body, wallet signature, key or client identifier is added. A sampled discovery is not a unique agent; unknown automated traffic remains unknown. Tool delivery is based on explicit completion events, not HTTP200. Existing authoritative journal entries still define actual financial settlement. Quote-to-completion ratios are aggregate indicators, not identified customer conversion or abandonment.

Optional `/v1/agent-feedback` stores enum-only aggregate signals, capped globally at100 accepted submissions perUTCday plus request rate limits. These counters expire after30days through bounded existing maintenance batches; no raw submissions or free text are retained. The endpoint never interrupts a tool or changes eligibility, billing or priority. The self-selected, unverified sample is vulnerable to subjective or adversarial feedback and does not prove demand.

Owner analytics uses an authenticated local read-only report rather than a public administration endpoint. It separates operational traffic, confirmed settlements, known test-buyer flags, repeated paying wallets and voluntary feedback. Wallet counts are not people, and missing test attribution must not be called organic adoption. Historical financial aggregates and customer evidence are not deleted by feedback cleanup. Billed infrastructure spending cannot be derived from request counters.

Workers Analytics Engine was evaluated as a future event backend. This release adds no dataset, billable resource, credential or account limit; existing Logs/counters support the implemented bounded reporting. No per-client tracking cohort or private framework/model identity is inferred.
