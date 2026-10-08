# Pricing and billing — Beta

| Service | USDC | Atomic amount (6 decimals) |
|---|---:|---:|
| Register baseline | Free | 0 |
| Freshness Check | 0.005 | 5000 |
| Web Extract | 0.010 | 10000 |
| Smart Diff | 0.015 | 15000 |

Network: Base mainnet, `eip155:8453`. Scheme: x402 v2 `exact`, USDC. Recipient remains `0x58B4b483fBE31860335eCeB12CCCF4338b251085`. SDK asset selection and facilitator support checks are authoritative. Prices are configured once in [the service catalog](../src/contracts.ts) and used by REST, MCP, discovery and accounting.

An initial HTTP 402 is a challenge, **not a sale**. A payment header is an attempt, **not revenue**. Successful verification authorizes work; confirmed settlement records a sale. The result is withheld if settlement fails. Error results from the target/operation are not settled. A successful cached check and a successful unchanged diff still incur their service price.

No subscriptions, API keys, prepaid credits, LLM fees or browser-rendering charges are implemented. The service does not sign buyer payments or initiate real transactions without a client-provided authorization.

The beta accepts the default USDC EIP-3009 authorization shape with `validBefore` at most 24 hours in the future. Verified authorization identities are single-use across endpoints and transports. Permit2/custom authorization formats are explicitly unsupported in this beta, even if another facilitator supports them.

## Retries and uncertain outcomes

The SDK settles after successful computation. An authorization is claimed before the target fetch and stays claimed even when the operation or settlement fails. This bounds unpaid repeated work. Use a new authorization only after verifying the previous attempt did not settle; never blindly retry with a newly signed payment after a timeout.

Settlement and D1/delivery cannot be atomic. A process crash or disconnect after settlement can lose the response. There is no automatic refund or response-replay guarantee yet. Preserve transaction receipts and contact the operator for reconciliation. If only snapshot persistence fails, the service returns paid data plus `persistence_error` and `snapshot_saved: false`.

The historical test-wallet classification is bookkeeping, not a payment exemption. `X-Fresh402-Purpose: probe` classifies analytics only; it never changes billing.
