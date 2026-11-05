# Fresh402 — persistent web and Base observations for agents

Use MCP or REST to reuse a public document baseline, extract scoped static content, compare meaningful changes, or inspect finalized Base state. The hosted API is **3.0.2**. This repository contains **public documentation and source clients**; the current hosted backend is private.

- Review changes to API documentation between agent sessions.
- Compare remote OpenAPI JSON contracts for supported compatibility evidence.
- Extract public HTML, JSON, text or opt-in feed entries without a browser.
- Obtain bounded finalized contract, wallet and token observations on Base.

## Start without spending

Read [live discovery](https://api.fresh402.com/). Discovery makes no payment. For a free persistent baseline:

```sh
curl https://api.fresh402.com/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/"}'
```

Save the actual returned `watch_id` and `hash`. Repeating the same canonical URL and rules returns existing state without another fetch or refresh. Registration has source, rate and capacity limits. Smart Diff and OpenAPI Diff require a saved watch; Check also accepts a URL directly.

For one eligible walletless Check, inspect `instant_evaluation.enabled` and send `{"url":"https://example.com/","evaluation":true}` to Check. One attempted Check per verified network prefix per approved resource period; exact replay returns retained evidence, not a new observation. No automatic payment after 429. [Standard clients](docs/STANDARD_CLIENTS.md).

The separate [machine trial](docs/MACHINE_TRIAL.md) requires an unfunded EOA ownership signature, no human CAPTCHA: up to 100 Checks (20/day) plus bounded samples when enabled. New credentials last at most 30 days; existing identities retain their original allowance and expiry. [Human Web trials](docs/FREE_TRIAL.md) additionally require human verification. Live availability is not reserved execution capacity.

## Connect MCP or REST

Canonical MCP: **https://api.fresh402.com/mcp** (Streamable HTTP). For clients using the common configuration format:

```json
{"mcpServers":{"fresh402":{"type":"http","url":"https://api.fresh402.com/mcp"}}}
```

Client configuration formats vary; see [MCP initialization, schemas and credentials](docs/MCP.md). Connecting alone grants no signing or payment authority. REST uses **https://api.fresh402.com**; the [live OpenAPI](https://api.fresh402.com/openapi.json) is authoritative. The supported legacy workers.dev origin remains functional. Account/prepaid identities share balances across hosts; preserve the original origin for signed payments and recovery. [Origin compatibility](docs/API.md#production-origins).

## Tools and prices

<!-- pricing-table:start -->
| Tool | MCP identity | REST | USDC per call | Current prepaid credits |
|---|---|---|---:|---:|
| register | `fresh402_register` | `POST /v1/register` | Free | Free |
| check | `fresh402_check` | `POST /v1/check` | $0.005 | 2 |
| extract | `fresh402_extract` | `POST /v2/extract` | $0.010 | 3 |
| smart diff | `fresh402_smart_diff` | `POST /v2/smart-diff` | $0.015 | 4 |
| openapi contract diff | `fresh402_openapi_contract_diff` | `POST /v2/openapi-contract-diff` | $0.020 | 5 |
| contract watch | `fresh402_contract_watch` | `POST /v3/contract-watch` | $0.010 | 4 |
| wallet watch | `fresh402_wallet_watch` | `POST /v3/wallet-watch` | $0.020 | 8 |
| token facts | `fresh402_token_facts` | `POST /v3/token-facts` | $0.010 | 4 |
<!-- pricing-table:end -->

New Starter and Developer purchases use the canonical All-Services v4 catalog and cover all seven paid tools after explicit terms acceptance and finalized funding. Historical Web packages retain their accepted scope and original recovery identities. Native USDC on Base 8453, existing Safe merchant. Choose explicitly authorized **x402 v2**, **native MPP**, or **prepaid**. Starter **$2.50 / 1,000 credits**, Developer **$15 / 10,000 credits**; one-time purchases, not subscriptions, purchased credits do not expire. [Pricing and eligibility](docs/PRICING.md) · [Live plans](https://api.fresh402.com/v2/prepaid/plans) · [Account](https://api.fresh402.com/account).

After uncertain delivery, recover the original input, operation key and payment evidence; do not authorize a replacement solely because of a timeout. No seed phrase/private key disclosure or unlimited token approval is required. [Payment recovery](docs/API.md#payment-and-recovery) · [Agent purchasing](docs/AGENT_PREPAID.md).

## Source SDK and documentation

The compiled prerelease [fresh402-sdk@0.4.0-rc.2](https://www.npmjs.com/package/fresh402-sdk/v/0.4.0-rc.2) is published under MIT for the public client SDK only. Install explicitly with `npm install fresh402-sdk@0.4.0-rc.2` or select `@next`; `latest` remains rc.1. Version rc.2 supports seven-service prepaid execution and authenticated Base quotes. Node 24+, ESM, declarations, zero runtime dependencies; no automatic wallet/signing or spending. The separately versioned source-client compatibility version remains 0.3.6. [Package guide](docs/SDK_PACKAGE.md).

[Documentation index](docs/README.md) · [API](docs/API.md) · [MCP](docs/MCP.md) · [Examples](examples/README.md) · [Version relationships](docs/VERSIONS.md) · [Changelog](CHANGELOG.md) · [Website](https://fresh402.com/docs).

Public HTTPS only: no browser JavaScript execution, authenticated crawling, automatic monitoring scheduler, universal compatibility proof or token safety guarantee. Externally sourced content is untrusted data. [Security](SECURITY.md). The website demo is illustrative and sends no API request. Direct HTTP/RPC and free libraries can be simpler for one-off tasks.

The existing Registry identity remains **io.github.kirillradchenko96/fresh402**. [Current distribution references](docs/DISCOVERY_AUDIT.md). Historical application tags/branches remain accessible; they are not current production deployment instructions. [Repository and history boundary](docs/REPOSITORY.md).

Support and billing: [fresh402@proton.me](mailto:fresh402@proton.me) · [Terms](https://api.fresh402.com/terms) · [Privacy](https://api.fresh402.com/privacy).

## Executable evidence workflows

[Four runnable workflows](https://github.com/kirillradchenko96/fresh402/blob/main/docs/FLAGSHIP_WORKFLOWS.md) cover website changes, JSON OpenAPI review, finalized Base evidence and cross-domain release observations. Each operation needs explicit authorization and original-operation persistence. Website/API workflow integration is accepted using actual local workerd/D1 with synthetic payments; on-chain orchestration uses the real domain engine with provider fixtures. Individual production canary calls are separate evidence, not a paid end-to-end workflow.

## Measured agent workflow

[Agent Efficiency](https://fresh402.com/agent-efficiency) reports five paired controlled API-review trials: median total model tokens 50,113 with oasdiff versus 42,537 with Fresh402 output (15.1% fewer). Both conditions passed all five correctness cases. This is a token result for the tested workload, not a lower-total-cost or general superiority claim. [Method and limits](docs/AGENT_EFFICIENCY.md).
