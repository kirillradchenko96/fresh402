# Fresh402 — Web Intelligence for agents

[![Smithery](https://smithery.ai/badge/kirillradchenko96/fresh402)](https://smithery.ai/servers/kirillradchenko96/fresh402)

Check whether a source changed, extract useful content, and compare structured snapshots through **MCP or REST**. The hosted production API is **3.0.1**.

- [Developer quickstart](https://fresh402.com/docs) · [Tool reference](https://fresh402.com/docs/tools) · [Pricing](https://fresh402.com/pricing) · [Security and limits](https://fresh402.com/security)
- API: https://fresh402.kirilllabs.workers.dev/
- MCP: https://fresh402.kirilllabs.workers.dev/mcp
- [Live OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json) · [Account and billing](https://fresh402.kirilllabs.workers.dev/account)

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

## Start with a free baseline

```sh
curl https://fresh402.kirilllabs.workers.dev/v1/register \\
  -H 'Content-Type: application/json' \\
  -d '{"url":"https://example.com/"}'
```

Save the actual returned `watch_id` and `hash`. Repeating the same canonical URL and rules returns existing state without fetching or refreshing it. Check can also accept a URL directly; Smart Diff and OpenAPI Diff require a real saved watch. Registration is bounded by network, source, rate and capacity limits.

The [website demo](https://fresh402.com/#demo) is explicitly illustrative and runs locally in the browser without an API call or payment.

## Free-trial pilot status

Authenticated Web free trials are enabled in 3.0.1 within finite shared capacity. Inspect root `free_trial.enabled` or [GET /v2/trial](https://fresh402.kirilllabs.workers.dev/v2/trial) for live availability. One-time allowances are Check 20, Extract 10, Smart Diff 5 and OpenAPI Diff 3. Shared network, daily and runtime limits can reject work before these allowances are exhausted.

An unfunded EOA ownership message plus human verification obtains a separate trial key. No funding, token approval or transaction is needed. Trial REST/MCP requests use `X-Fresh402-Trial-Key` and a persisted per-operation `Idempotency-Key`. Quota exhaustion never initiates payment. [Trial guide](docs/FREE_TRIAL.md).

For autonomous agents, the separate [machine trial](docs/MACHINE_TRIAL.md) is currently enabled: an unfunded EOA signs the exact ownership message, with no human CAPTCHA or automatic payment. Network/global admission and shared quotas apply. Standalone x402/MPP need neither signup nor a trial.

## Choose payment deliberately

Native USDC on **Base mainnet, chain ID 8453**. Choose x402 v2 exact pay-per-call, enabled native MPP EVM charge, or prepaid. Adding the MCP endpoint alone does not authorize payments.

- Starter: **$2.50 / 1,000 credits**, canonical ID `candidate-starter-v3`.
- Developer: **$15 / 10,000 credits**, canonical ID `candidate-developer-v3`.
- Packages are one-time purchases, not subscriptions. Purchased credits do not expire. Legacy accounts retain their accepted terms.
- Inspect live [plans and purchasing availability](https://fresh402.kirilllabs.workers.dev/v2/prepaid/plans) and your authenticated prepaid quote.
- Preserve original input, proof/funding intent and private recovery token or idempotency key. After uncertainty, recover the original operation; never authorize a replacement payment just because a response was delayed.

An unsigned HTTP 402 challenge is metadata, **not a charge, customer or revenue**. Use an appropriate payment client and explicit limits. Never disclose seed phrases or private keys. No unlimited token approval is required by Fresh402's exact flow.

## Protocols and boundaries

[MCP guide](docs/MCP.md), [API guide](docs/API.md), [agent prepaid](docs/AGENT_PREPAID.md), [MPP](docs/MPP.md), [examples](examples/README.md), [release notes](CHANGELOG.md).

The existing Official MCP Registry identity remains **io.github.kirillradchenko96/fresh402**. Existing production API/MCP URLs and Glama ownership verification remain intact. Public documentation does not deploy infrastructure or merge the backend release PR.

Public HTTPS documents only. No browser JavaScript execution, authenticated crawling, continuous watch polling, universal semantic compatibility proof or token safety guarantees. Watch IDs and legacy history are shared public service data; never put secrets in target URLs. The [security page](https://fresh402.com/security) explains supported protections and limitations.

**Contract Watch ($0.010), Wallet Watch ($0.020) and Token Facts ($0.010) are available in a bounded finalized Base observation pilot. Circle Gateway remains disabled.** Use x402/MPP per call. Prepaid costs4/8/4 credits with eligible finalized all-service purchases or original explicit grants; old Web packages are not silently upgraded. The separate machine trial may admit one bounded blockchain observation within its shared18RPC/day cap; human Web trials do not cover these tools. Historical owner-controlled financial acceptance is distinct from new independent customer acceptance. [Inputs, limits and recovery](docs/API.md#finalized-base-observation-pilot).

This repository provides public client documentation and retains its existing legacy files/history. Current hosted backend source, credentials, customer financial data and operational reports remain private.

Support and billing: [fresh402@proton.me](mailto:fresh402@proton.me). [Terms](https://fresh402.kirilllabs.workers.dev/terms) · [Privacy](https://fresh402.kirilllabs.workers.dev/privacy).

Current customer source is in `examples/efficiency` and `examples/knowledge-base`; [the versioned agent quickstart](docs/AGENT_WORKFLOWS.md) is the supported entry point. The root application source in this public repository is historical, not the private hosted3.0.1 backend. Do not deploy it over the service. New HTTPS client defaults pin the current Safe; archived/loopback legacy fixtures and original-operation recovery remain distinct.
