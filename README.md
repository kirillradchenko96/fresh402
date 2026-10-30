# Fresh402 — website change detection and extraction API for agents

[![Smithery](https://smithery.ai/badge/kirillradchenko96/fresh402)](https://smithery.ai/servers/kirillradchenko96/fresh402)

Check whether a source changed, extract useful content, and compare structured snapshots through **MCP or REST**. The hosted production API is **3.0.2**.

Fresh402 keeps a hosted observation workflow across agent sessions: reusable watch IDs and content rules, conditional revalidation, scoped change evidence and recovery of original results. A fetch-and-hash script is easy; if you already manage that state—or need a one-off read—direct HTTP and local libraries can be simpler and cheaper. No automatic monitoring or browser rendering is implied. [Documentation Guardian and separate call fees](https://fresh402.com/docs#workflows). [Task guide: persistent documentation observations, remote OpenAPI comparison, extraction and Base state](https://fresh402.com/use-cases).

- [Try one walletless Check](docs/STANDARD_CLIENTS.md#walletless-check) when root `instant_evaluation.enabled` is true; ordinary MCP or REST, no wallet/key/custom header. One attempt per verified network prefix per approved period, sharing existing capacity; no automatic payment.
- [Start free as an agent](https://fresh402.com/docs#machine-trial) · [Source SDK 0.3.6 (Node 24+, not npm)](https://fresh402.com/docs#sdk). Machine enrollment requires an unfunded EOA ownership signature; an ordinary MCP connection cannot sign for you. Eligible new identities: up to 100 Checks (20/day) plus bounded samples, subject to shared capacity and the October 30–November 29, 2026 UTC operating window. Credentials last at most 30 days and are clipped to November 29; late joins get fewer days. Existing identities retain original quotas and expiry. Read live availability before enrollment.
- [Developer quickstart](https://fresh402.com/docs) · [Tool reference](https://fresh402.com/docs/tools) · [Pricing](https://fresh402.com/pricing) · [Security and limits](https://fresh402.com/security)
- API: https://api.fresh402.com/
- MCP: https://api.fresh402.com/mcp
- [Live OpenAPI](https://api.fresh402.com/openapi.json) · [Account and billing](https://api.fresh402.com/account)

| Product | MCP tool | REST endpoint | x402 / MPP USDC | Current prepaid credits |
|---|---|---|---:|---:|
| Register baseline | `fresh402_register` | POST /v1/register | Free | Free |
| Check | `fresh402_check` | POST /v1/check | $0.005 | 2 |
| Extract | `fresh402_extract` | POST /v2/extract | $0.010 | 3 |
| Smart Diff | `fresh402_smart_diff` | POST /v2/smart-diff | $0.015 | 4 |
| OpenAPI Contract Diff | `fresh402_openapi_contract_diff` | POST /v2/openapi-contract-diff | $0.020 | 5 |
| Contract Watch | `fresh402_contract_watch` | POST /v3/contract-watch | $0.010 | 4, eligible all-service credits or original grant |
| Wallet Watch | `fresh402_wallet_watch` | POST /v3/wallet-watch | $0.020 | 8, eligible all-service credits or original grant |
| Token Facts | `fresh402_token_facts` | POST /v3/token-facts | $0.010 | 4, eligible all-service credits or original grant |

## Try one eligible Check without a wallet

Inspect [root discovery](https://api.fresh402.com/) for `instant_evaluation.enabled`, then send `{"url":"https://example.com/","evaluation":true}` to `POST /v1/check` or MCP `fresh402_check`. No key or signing is required. One shared network attempt per approved period; exact replay returns retained evidence, not a fresh fetch. A 429 never authorizes a payment. [Ordinary-client examples and unsigned quotes](docs/STANDARD_CLIENTS.md).

## Save a free baseline for later sessions

```sh
curl https://api.fresh402.com/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/"}'
```

Save the actual returned `watch_id` and `hash`. Repeating the same canonical URL and rules returns existing state without fetching or refreshing it. Check can also accept a URL directly; Smart Diff and OpenAPI Diff require a real saved watch. Registration is bounded by network, source, rate and capacity limits.

**Documentation Guardian:** Register → Check → optional Smart Diff / Extract → act on evidence. Keep the same watch across sessions. Register is free; a paid Check is $0.005 / 2 Web credits, optional Smart Diff $0.015 / 4 credits and optional Extract $0.010 / 3 credits, with separate authorizations. Extract fetches independently. Use compatible retained comparison evidence and inspect fidelity warnings; this is not a bundled endpoint or scheduler. [Workflow, reference selection and recovery](docs/AGENT_WORKFLOWS.md#documentation-guardian--persistent-documentation-and-api-change-intelligence).

The [website demo](https://fresh402.com/#demo) is explicitly illustrative and runs locally in the browser without an API call or payment.

## Free-trial pilot status

Authenticated Web free trials are enabled in 3.0.2 within finite shared capacity. Inspect root `free_trial.enabled` or [GET /v2/trial](https://api.fresh402.com/v2/trial) for live availability. One-time allowances are Check 20, Extract 10, Smart Diff 5 and OpenAPI Diff 3. Shared network, daily and runtime limits can reject work before these allowances are exhausted.

An unfunded EOA ownership message plus human verification obtains a separate trial key. No funding, token approval or transaction is needed. Trial REST/MCP requests use `X-Fresh402-Trial-Key` and a persisted per-operation `Idempotency-Key`. Quota exhaustion never initiates payment. [Trial guide](docs/FREE_TRIAL.md).

For autonomous agents, the separate [machine trial](docs/MACHINE_TRIAL.md) is currently enabled: an unfunded EOA signs the exact ownership message, with no human CAPTCHA or automatic payment. Network/global admission and shared quotas apply. Standalone x402/MPP need neither signup nor a trial.

## Choose payment deliberately

Native USDC on **Base mainnet, chain ID 8453**. Choose x402 v2 exact pay-per-call, enabled native MPP EVM charge, or prepaid. Adding the MCP endpoint alone does not authorize payments.

- Starter: **$2.50 / 1,000 credits**; Developer: **$15 / 10,000 credits**. Both have Web-only and all-service variants.
- The [wallet checkout](https://api.fresh402.com/account) offers Web-only packages. All-service packages cover the seven paid tools and are purchased through the [agent API flow](https://fresh402.com/docs#all-service-purchase), with explicit terms acceptance. Inspect the live quote for canonical IDs and eligibility.
- Packages are one-time purchases, not subscriptions. Purchased credits do not expire. Legacy accounts retain their accepted terms.
- Inspect live [plans and purchasing availability](https://api.fresh402.com/v2/prepaid/plans) and your authenticated prepaid quote.
- Preserve original input, proof/funding intent and private recovery token or idempotency key. After uncertainty, recover the original operation; never authorize a replacement payment just because a response was delayed.

An unsigned HTTP 402 challenge is metadata, **not a charge, customer or revenue**. Use an appropriate payment client and explicit limits. Never disclose seed phrases or private keys. No unlimited token approval is required by Fresh402's exact flow.

## Protocols and boundaries

[MCP guide](docs/MCP.md), [API guide](docs/API.md), [agent prepaid](docs/AGENT_PREPAID.md), [MPP](docs/MPP.md), [examples](examples/README.md), [release notes](CHANGELOG.md).

The existing Official MCP Registry identity remains **io.github.kirillradchenko96/fresh402**. Existing production API/MCP URLs and Glama ownership verification remain intact. Public documentation does not deploy infrastructure or merge the backend release PR.

Public HTTPS documents only. No browser JavaScript execution, authenticated crawling, continuous watch polling, universal semantic compatibility proof or token safety guarantees. Watch IDs and legacy history are shared public service data; never put secrets in target URLs. The [security page](https://fresh402.com/security) explains supported protections and limitations.

**Contract Watch ($0.010), Wallet Watch ($0.020) and Token Facts ($0.010) are available in a bounded finalized Base observation pilot. Circle Gateway remains disabled.** Use x402/MPP per call. Prepaid costs 4/8/4 credits with eligible finalized all-service purchases or original explicit grants; old Web packages are not silently upgraded. The separate machine trial may admit one bounded blockchain observation within its shared 18 RPC/day cap; human Web trials do not cover these tools. Historical owner-controlled financial acceptance is distinct from new independent customer acceptance. [Inputs, limits and recovery](docs/API.md#finalized-base-observation-pilot).

This repository provides public client documentation and retains its existing legacy files/history. Current hosted backend source, credentials, customer financial data and operational reports remain private.

Support and billing: [fresh402@proton.me](mailto:fresh402@proton.me). [Terms](https://api.fresh402.com/terms) · [Privacy](https://api.fresh402.com/privacy).

Current customer source is in `examples/efficiency` and `examples/knowledge-base`; [the versioned agent quickstart](docs/AGENT_WORKFLOWS.md) is the supported entry point. The root application source in this public repository is historical, not the private hosted 3.0.2 backend. Do not deploy it over the service. New HTTPS client defaults pin the current Safe; archived/loopback legacy fixtures and original-operation recovery remain distinct.
Canonical API: **https://api.fresh402.com** · MCP: **https://api.fresh402.com/mcp**. The original `https://fresh402.kirilllabs.workers.dev` remains supported without payment redirects. Existing prepaid keys share the same account and balance on both production hosts; preserve the original origin for signed payments and recovery. See [origin compatibility](docs/API.md#production-origins).
