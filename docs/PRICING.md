# Fresh402 2.0 pricing and product comparison

| Product | MCP tool | Price | Atomic USDC | Use it when |
|---|---|---:|---:|---|
| Persistent baseline | fresh402_register | Free | 0 | Establish a watch once; repeat registration retrieves its baseline |
| Freshness Check | fresh402_check | $0.005 USDC | 5000 | Decide whether to reuse a source or run more expensive downstream work |
| Web Extract | fresh402_extract | $0.01 USDC | 10000 | Get bounded text, titles, metadata, headings, links and structured data |
| Smart Diff | fresh402_smart_diff | $0.015 USDC | 15000 | Inspect structured changes and significance with explainable deterministic rules |

Network: **Base mainnet**, chain ID **8453** (`eip155:8453`). Payment: **native USDC**, x402 v2 **exact** authorization. These are per-call service prices, not subscriptions or an unlimited monitoring plan. Cached Check results remain paid. Any client/facilitator transaction costs are separate from these service prices; no free-gas promise is made.

Metadata, OpenAPI, MCP tool discovery and legacy stored history/diff reads are free. Existing baseline registration does not refresh a watch. Public history/diff is not a free route to paid Smart Diff results.

The price table was checked against live production requirements and schemas. Always read the current [OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json) and unsigned x402 challenge before signing. A 402 challenge is a quote, not proof of payment or catalog indexing. The [client payment contract](API.md#payment-and-recovery) covers receipts and private recovery.
