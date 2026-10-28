# Current service availability

Production reports **3.0.1** at [the established API origin](https://fresh402.kirilllabs.workers.dev/). The unchanged /mcp endpoint exposes eight tools: free Register plus seven paid products.

| Paid product | Standalone x402/MPP USDC | Prepaid credits |
|---|---:|---:|
| Check | 0.005 | 2 |
| Extract | 0.010 | 3 |
| Smart Diff | 0.015 | 4 |
| OpenAPI Contract Diff | 0.020 | 5 |
| Contract Watch | 0.010 | 4 |
| Wallet Watch | 0.020 | 8 |
| Token Facts | 0.010 | 4 |

New payments use Base Mainnet (8453), native USDC, and Safe merchant 0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3. A compatible externally authorized ECDSA/EIP-712 signer is required; ERC-1271 contract-wallet signatures are unsupported. A delegated EIP-7702 EOA is not automatically a contract-wallet signing mode. Standalone x402/MPP require neither signup nor a trial. Circle Gateway remains disabled and has no real-money acceptance.

Public wallet ownership signup and one-time Starter ($2.50/1000 credits) and Developer ($15/10000) purchasing are enabled. These are not subscriptions; finalized purchased credits do not expire under the approved terms. Use [live plans](https://fresh402.kirilllabs.workers.dev/v2/prepaid/plans) for canonical package IDs, current flags, accepted terms and eligible products. New all-service purchases require explicit terms acceptance; old Web-only balances are not automatically blockchain entitlements. The Web client example supports four Web products; the blockchain guide documents the additional routes and tariff4 metadata. [Agent purchasing and recovery](AGENT_PREPAID.md) explains both cohorts.

The separate [machine trial](MACHINE_TRIAL.md) is enabled and requires a bounded wallet-control signature, not a funded wallet, purchase or human CAPTCHA. Admission, per-tool quotas, network/global budgets and credential expiry apply; availability is not a promise of capacity. Root discovery and /v3/agent-trial are authoritative. Current operating authorization expires November14,2026 at09:00UTC; this publication does not extend it or activate a90-day experiment.

Historical owner-controlled staging acceptance verified a finalized Starter purchase and all seven paid products (x402 for six products, official MPP for Extract), durable delivery and original-operation replay. This is not organic demand or new financial acceptance. Developer purchasing and all protocol/tool combinations have not each received independent real-money acceptance. Current unpaid production challenges and local synthetic SDK/D1 tests must be distinguished from settlement on Base. No new payment is authorized by these examples.

JavaScript/browser rendering remains unavailable. Public static HTTPS fetching, provider/resource budgets and other documented security limits remain enforced. Private backend, credentials and operational/payment evidence are not published. Historical repository application source is not the current hosted backend: do not deploy it over the service. Existing MCP URLs, Registry identity and ownership verification remain unchanged.
