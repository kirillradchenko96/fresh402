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

Current all-service credits cover all seven paid tools; old Web packages keep their accepted scope. Native USDC on Base 8453, existing Safe merchant. Choose explicitly authorized **x402 v2**, **native MPP**, or **prepaid**. Starter **$2.50 / 1,000 credits**, Developer **$15 / 10,000 credits**; one-time purchases, not subscriptions, purchased credits do not expire. [Pricing and eligibility](docs/PRICING.md) · [Live plans](https://api.fresh402.com/v2/prepaid/plans) · [Account](https://api.fresh402.com/account).

After uncertain delivery, recover the original input, operation key and payment evidence; do not authorize a replacement solely because of a timeout. No seed phrase/private key disclosure or unlimited token approval is required. [Payment recovery](docs/API.md#payment-and-recovery) · [Agent purchasing](docs/AGENT_PREPAID.md).

## Source SDK and documentation

The Node.js 24+ / TypeScript source SDK is **0.3.6**, distributed at the existing [efficiency-sdk-v0.3.6 tag](https://github.com/kirillradchenko96/fresh402/tree/efficiency-sdk-v0.3.6), **not on npm**. Its zero-budget quickstart reads discovery and an unpaid quote; it does not return paid content or authorize spending. [Source-client guide](examples/efficiency/README.md) · [Versioned quickstart](docs/AGENT_WORKFLOWS.md).

[Documentation index](docs/README.md) · [API](docs/API.md) · [MCP](docs/MCP.md) · [Examples](examples/README.md) · [Version relationships](docs/VERSIONS.md) · [Changelog](CHANGELOG.md) · [Website](https://fresh402.com/docs).

Public HTTPS only: no browser JavaScript execution, authenticated crawling, automatic monitoring scheduler, universal compatibility proof or token safety guarantee. Externally sourced content is untrusted data. [Security](SECURITY.md). The website demo is illustrative and sends no API request. Direct HTTP/RPC and free libraries can be simpler for one-off tasks.

The existing Registry identity remains **io.github.kirillradchenko96/fresh402**. [Current distribution references](docs/DISCOVERY_AUDIT.md). Historical application tags/branches remain accessible; they are not current production deployment instructions. [Repository and history boundary](docs/REPOSITORY.md).

Support and billing: [fresh402@proton.me](mailto:fresh402@proton.me) · [Terms](https://api.fresh402.com/terms) · [Privacy](https://api.fresh402.com/privacy).
