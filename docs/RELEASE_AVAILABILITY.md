# Current service availability

The hosted service reports **2.5.0** at [the established endpoint](https://fresh402.kirilllabs.workers.dev/). All five MCP tool identities remain unchanged: free Register and paid Check ($0.005 USDC), Extract ($0.010), Smart Diff ($0.015), OpenAPI Contract Diff ($0.020). The same four paid products accept prepaid credits over REST and MCP.

Public EOA signup and one-time Starter ($2.50/1000 credits) and Developer ($15/10000) purchasing are enabled. Current tariff costs are 2/3/4/5. Read live [plans and availability](https://fresh402.kirilllabs.workers.dev/v2/prepaid/plans), [OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json) and exact quotes before signing. Purchased finalized credits do not expire under the published terms.

When enabled, independently corroborated successful recent Base L2 inclusion may release up to 50 Starter or 100 Developer early credits; the full package still requires canonical finality. Evidence freshness and account/payer/project caps apply. Early inclusion is not finality and unused early access may freeze or be revoked. See [the complete agent purchasing and recovery contract](AGENT_PREPAID.md).

Examples have no automatic payment entry point. A compatible EOA/external signer, explicit caller cap, native Base USDC and private durable state are required for a real purchase. MCP installation alone does not provide signing authority. Prepaid never falls back to x402. The release was verified with synthetic staging receipts; no new real USDC transaction was initiated for this release.

Private backend source and operational/payment evidence are not included in these public changes. Historical repository code is not the current deployment source; do not deploy it over the hosted service. Existing MCP URLs, registry identity and ownership verification remain unchanged.
