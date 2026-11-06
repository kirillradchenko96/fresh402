# Prices and prepaid credits

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
| website change intelligence | `fresh402_website_change_intelligence` | `POST /v4/workflows/website-change-intelligence` | $0.005 | 2 |
| api compatibility review | `fresh402_api_compatibility_review` | `POST /v4/workflows/api-compatibility-review` | $0.010 | 4 |
| onchain evidence brief | `fresh402_onchain_evidence_brief` | `POST /v4/workflows/onchain-evidence-brief` | $0.025 | 10 |
| cross domain release evidence | `fresh402_cross_domain_release_evidence` | `POST /v4/workflows/cross-domain-release-evidence` | $0.040 | 16 |
<!-- pricing-table:end -->

This table is generated from the reviewed public discovery contract. Standalone calls use native USDC on Base mainnet (8453), x402 v2 exact or enabled native MPP EVM charge. A compatible, explicitly authorized payment client is required. Quotes are not charges; any client/facilitator costs are separate. Cached Check results remain paid.

Starter is **$2.50 / 1,000 credits**; Developer is **$15 / 10,000 credits**. Packages are one-time purchases, not subscriptions; purchased credits do not expire. The account page and agent flow offer the canonical All-Services packages after explicit terms acceptance and finalized funding. The four server workflows additionally require exact tariff-5 quotes and constituent rights; no internal substep charge. Old Web balances retain their original rights. Always read [live plans](https://api.fresh402.com/v2/prepaid/plans), [all-service eligibility](https://api.fresh402.com/v3/prepaid/all-services) and your authenticated quote.

Free discovery, Register and eligible walletless/trial access are separate from purchased credits. Capacity can be unavailable before a free allowance is exhausted; no automatic paid fallback is authorized. [Free access](FREE_TRIAL.md), [machine trial](MACHINE_TRIAL.md), [agent purchase and recovery](AGENT_PREPAID.md), [current availability](RELEASE_AVAILABILITY.md).
