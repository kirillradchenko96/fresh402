# Circle Gateway Nanopayments

Circle Gateway is an optional, separately gated x402 v2 payment rail. **Read `GET /` → `circle_gateway.enabled` before using it. It is disabled for this release; real-money Gateway settlement and withdrawal have not been validated.** Existing Coinbase-backed x402, native MPP and prepaid credits remain available under their own flags.

## Products and supported scope

| Product | REST | MCP | USDC per call |
|---|---|---|---|
| Check | `POST /v1/check` | `fresh402_check` | 0.005 |
| Extract | `POST /v2/extract` | `fresh402_extract` | 0.010 |
| Smart Diff | `POST /v2/smart-diff` | `fresh402_smart_diff` | 0.015 |
| OpenAPI Contract Diff | `POST /v2/openapi-contract-diff` | `fresh402_openapi_contract_diff` | 0.020 |

The implemented Gateway adapter supports Base mainnet only (`eip155:8453`), native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and the existing merchant `0x58B4b483fBE31860335eCeB12CCCF4338b251085`. Register remains free. Get and reuse watch IDs exactly as described in [MCP](MCP.md). Input/output contracts and tariffs are unchanged.

Starter and Developer purchases do **not** accept Gateway. Their finalized-only funding, credit activation and recovery remain on the existing x402/MPP paths. Existing prepaid execution still costs 2/3/4/5 credits, independently of Gateway.

## Choosing a payment method

| Method | Payer needs | Authorization / settlement |
|---|---|---|
| Coinbase-backed x402 | Funded Base native-USDC payer and x402 client | Direct USDC EIP-3009; existing facilitator and recovery |
| Circle Gateway x402, only when enabled | EOA signer and separately funded **Base Gateway balance** | `GatewayWalletBatched` EIP-712 domain; Gateway transfer UUID, later batched settlement |
| Native MPP | Authorized Base EIP-712 signer and compatible MPP client | `evm/charge`, existing direct-USDC journal; [MPP guide](MPP.md) |
| Prepaid | Fresh402 API key, existing credits and durable operation key | Integer credit reservation; [agent onboarding](AGENT_PREPAID.md) |

Do not combine credentials or sign a second payment after an uncertain result. A normal wallet USDC balance is not a Gateway deposit. Circle's Nanopayments require EOA signatures; ERC-1271 is unsupported. Gateway self-transfers are rejected: payer must differ from the merchant. Fresh402 never requests a seed phrase, private key, unlimited approval, automatic deposit, withdrawal or subscription.

## Negotiation and official SDK

When enabled, the ordinary unpaid response retains its original x402 option and appends a Gateway option. Inspect `PAYMENT-REQUIRED` or the JSON body. Select only an explicitly advertised Gateway option, validate the exact price, network, USDC asset, merchant, and verifying contract. SDK version verified: `@circle-fin/x402-batching@3.5.0`.

The following is a signing fragment, **not an automatically paying script**. `signer` is the caller's existing externally managed EIP-712 signer. `privateStore` must atomically reserve a cumulative spending budget before signing, refuse reuse of an uncertain operation, and persist the original request, proof and private recovery token before submission. Never put those records in Git, application logs, URLs or MCP tool arguments.

```ts
import { BatchEvmScheme, CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';

// quote is the actual unpaid response for the original REST/MCP resource.
const accepted = quote.accepts.find((r) =>
  r.scheme === 'exact' && r.network === 'eip155:8453' &&
  r.asset.toLowerCase() === CHAIN_CONFIGS.base.usdc.toLowerCase() &&
  r.extra?.name === 'GatewayWalletBatched' && r.extra?.version === '1' &&
  r.extra?.verifyingContract?.toLowerCase() ===
    CHAIN_CONFIGS.base.gatewayWallet.toLowerCase());
if (!accepted) throw new Error('Gateway is not offered; do not sign');
// Also enforce your expected merchant, exact product amount and resource URL.
await privateStore.reserveBeforeSigning(operationId, accepted.amount);
const partial = await new BatchEvmScheme(signer)
  .createPaymentPayload(2, accepted); // Requires explicit wallet/spending approval.
const payment = { ...partial, accepted, resource: quote.resource };
await privateStore.saveBeforeSubmission(operationId, {
  payment, originalInput, originalTransport, recoveryToken,
});
```

The official SDK signs against the Gateway Wallet, **not** the USDC token contract. On Base mainnet its Gateway Wallet is `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`. The advertised authorization window is 604900 seconds (seven days plus buffer). Do not shorten it to the direct-USDC 24-hour policy or assume the same signature works with another provider.

REST: base64-encode the original complete x402 payload as `PAYMENT-SIGNATURE`. Send the private random recovery token (at least 32 bytes, hex/base64url) in `X-Fresh402-Recovery-Token`.

MCP: use the identical x402 wire convention: `params._meta['x402/payment']` and `params._meta['fresh402/recovery-token']`. The resource URL must be the advertised `/mcp#fresh402_...` URL. A successful receipt is in `result._meta['x402/payment-response']`; inspect `isError` and the structured status, not HTTP 200 alone.

## Acceptance, confirmation and recovery

1. A signature authorizes payment; it is not income. Gateway `/verify` is read-only and does not guarantee balance or nonce availability.
2. Fresh402 verifies the Gateway-domain EOA signature and quote, reserves the shared durable nonce/operation, prepares the bounded result, then calls Gateway `/settle` **once**.
3. Gateway acceptance locks payer funds and queues a batch. Its receipt `transaction` is a **UUID**, not an onchain transaction hash. Fresh402 retains the result privately and returns **409 without a successful receipt or result** while the batch is pending.
4. Retry the **same input, transport, signed proof and private token** after 60 seconds. The retry performs a bounded read-only transfer lookup; it never resubmits settlement. A lost settlement response is located by original nonce. Recovery remains possible when new Gateway acceptance is disabled.
5. Fresh402 requires matching transfer identity, payer, merchant, atomic amount, Base networks, USDC, nonce, and batch hash with status `confirmed` or `completed` before delivery and revenue accounting. `received`/`batched` are pending. `failed`, malformed evidence and outages fail closed.

This conservative policy can delay the paid response until the next batch. It does not offer instant delivery on the strength of Gateway acceptance alone. Prepared comparisons are fixed at their original execution time; they are not freshly fetched on recovery. Results retain the existing seven-day recovery limit. One original nonce cannot buy another input, transport or resource after reservation. Direct x402, MPP and Gateway share the nonce-claim namespace. A batch hash can contain many transfers; only each unique Gateway transfer UUID is counted once.

Gateway evidence is recorded separately from direct onchain receipts in the existing operation journal and provider-tagged payment events. A confirmed Gateway transfer is not a direct transfer to the merchant's wallet and does not activate prepaid credits. Gateway-reported confirmation is a provider attestation, not independent validation of a direct-USDC receipt or an L1-finality claim.

## Seller balance, withdrawal and costs

The official seller setup takes a recipient address; no seller wallet key or new financial account is installed in Fresh402. Buyer deposits require a separate, owner-approved onchain action and deposit confirmations. The live mainnet `/supported` and read-only transfer API were reachable without credentials. Successful receipt of a first payment into this merchant's Gateway balance has **not** been demonstrated.

After batched settlement, funds accrue in the merchant's Gateway balance. Check the transfer's actual state and available balance before withdrawal; do not infer withdrawability from an authorization or an accepted request. The official SDK exposes `searchTransfers`/`getTransferById`; use an existing secure signer only for separately authorized treasury actions. No deposit, wallet creation or withdrawal occurs in the service.

Circle documents gas-free individual nanopayments. Funding and withdrawal are distinct: deposits incur network gas; Gateway's fee schedule currently lists a Base source gas fee of **0.01 USDC**, a **0.005%** crosschain transfer fee, and optional forwarding fees. Same-chain withdrawals avoid the percentage transfer fee, but must not be advertised as universally free. Obtain the current fee quote and account for destination gas before any authorized withdrawal. No minimum first-payment balance or withdrawal limit is assumed from the absence of a value in these pages; verify the current balance and quote before a treasury action.

## Verified boundaries

Local workerd/D1 and closed staging fixtures exercise the official SDK, four REST/MCP products, pending confirmation, failed batches, concurrent/replayed proofs, outage recovery and separate provider accounting. Synthetic acceptance is **not** real-money validation. Production Gateway stays disabled pending an explicitly authorized mainnet acceptance test covering Gateway-funded payment, confirmation, delivery, recovery, balance credit and withdrawability. Existing direct payments, native MPP and prepaid do not require Gateway activation.

Sources: [Circle seller integration](https://developers.circle.com/gateway-nanopayments/howtos/x402-seller), [SDK contracts](https://developers.circle.com/sdks/gateway-nanopayments-sdk), [seller reconciliation](https://developers.circle.com/gateway-nanopayments/howtos/x402-seller-reconciliation), [batch lifecycle](https://developers.circle.com/gateway-nanopayments/concepts/batched-settlement), [supported networks](https://developers.circle.com/gateway-nanopayments/supported-networks), [current Gateway fees](https://developers.circle.com/gateway/references/fees).
