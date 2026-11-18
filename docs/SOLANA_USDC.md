# Native USDC on Base and Solana

Fresh402 uses the same eleven paid REST resources and MCP tools for both payment networks. Prices, prepaid credit costs and product outputs are unchanged. The payment network selects how the service is paid; blockchain intelligence products continue to inspect **finalized Base**, including when paid with Solana USDC.

Read the live root `payment_networks`, the actual unpaid x402 challenge and `/v2/prepaid/plans` before authorizing anything. A missing Solana offer means new Solana payment admission is unavailable. Do not sign a replacement on another network after an uncertain submission.

| Policy | Base | Solana Mainnet |
|---|---|---|
| x402 network | `eip155:8453` | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Native Circle USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Current merchant | `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3` | `9apNBNbDHZZ2isBEq9ZCnipvRdxAh6ZCBRJPqWQ5Rwuj` |
| Precision | 6 decimals | 6 decimals |
| Authorization | Exact EIP-3009 native-USDC authorization | Exact/SVM native-USDC `TransferChecked`, ordinary payer signature and pinned facilitator fee payer |
| MPP | Existing EVM charge flow | Not offered; use x402 |
| Package credits | Existing finalized policy; separately disclosed early-credit policy where enabled | Finalized only; no provisional Solana credits |

Base remains the first x402 offer. Compatible clients select one accepted option and echo the original resource, requirements and extensions. Existing standard Base clients that select their supported offer keep using Base. Strict older Fresh402 SDK versions that require exactly one offer should upgrade to `fresh402-sdk@0.6.1-rc.1`; no blanket compatibility with arbitrary one-offer-only clients is claimed. Existing original payment proofs and private recovery capabilities remain usable at their original origin.

The current Solana facilitator is Coinbase CDP. Its advertised fee payer is `BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP`. Pin the value in the actual accepted challenge; a changed fee payer requires reviewed client configuration, not silent acceptance. The facilitator signs/pays the network-fee portion. A normal payer does not need SOL for this supported transfer. **SOL is not a price asset.** There is no token approval, bridge, swap, native-SOL payment or automatic network fallback. General-purpose Solana wallet signing must not be treated as authorization for arbitrary programs or amounts.

## Agents and the SDK

Use Node.js 24+ and an explicitly authorized payer-controlled x402 signer. Importing the SDK never connects a wallet, signs, makes a payment or fetches a target.

```js
import {createProductionClient, SOLANA_NETWORK} from 'fresh402-sdk';

// No signer and a zero spending allowance: this does not execute a paid call.
const solana = createProductionClient({paymentNetwork: SOLANA_NETWORK});
const base = createProductionClient(); // unchanged Base default
```

For execution, supply your reviewed exact/SVM x402 client through `signerFromX402Client`, a finite `maxAtomicUSDC` and a private durable `persist` callback. Only the explicitly selected accepted requirement reaches the signer. Use the official compatible `@x402/svm` client and a payer-controlled Solana Kit signer; Fresh402's dependency-free SDK does not supply a wallet or a secret store. Never use console output as persistence. Original proof/input/resource/network/private recovery capability must be saved before dispatch. The REST header is `PAYMENT-SIGNATURE`; MCP uses `params._meta["x402/payment"]`. Read `PAYMENT-RESPONSE` or `result._meta["x402/payment-response"]`; HTTP 200 alone is not MCP success.

## Account ownership and packages

Solana customers do not need a Base wallet. Use `new CustomerClient(origin, {paymentNetwork: SOLANA_NETWORK})`, or the same public customer REST API:

1. Read `/v2/prepaid/plans?network=solana%3A5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` and the matching `/v3/prepaid/all-services?network=...` terms. Public purchasing may be disabled independently of account recovery.
2. POST `/v2/prepaid/customer/challenge` with `wallet`, explicit `network` and a privately persisted `Idempotency-Key`. Base remains the default when `network` is omitted.
3. Inspect and sign exactly the returned UTF-8 `message` with an ordinary Solana wallet's `signMessage`. Submit the canonical Base64 64-byte Ed25519 signature to `/sessions`. This single-use, five-minute proof binds wallet, origin, environment, action, challenge, nonce and expiry. It authenticates ownership only; it is not a payment, approval or an EVM typed-data request. No SIWS compatibility beyond this documented message is claimed.
4. Create the original package intent with its exact accepted terms digest, explicit network and stable purchase key. Starter remains `starter-all-services-v4`, $2.50 / 1,000 credits; Developer remains `developer-all-services-v4`, $15 / 10,000. One-time purchases; purchased credits do not expire.
5. Review the exact x402 requirement and intent-specific funding memo before a separately authorized payment. `prepareSolanaFundingAuthorization` validates the original payer/package/amount/terms/mint/merchant/fee payer/resource/memo and returns a bounded preparation object. It never signs or submits. The account page uses Wallet Standard connection, ownership signing and exact native-USDC transaction signing; it never calls `signAndSendTransaction`.
6. Keep the original intent and proof after any timeout. Poll status or use original funding recovery; do not create a replacement purchase. No credits or API key are issued from an unverified or merely confirmed Solana transaction. A credential may be claimed after finalized eligible funding.

Base and Solana funding use the same financial journal and product-credit ledger. Credentials are opaque prepaid execution keys; their funded rights are not a separate chain currency. Distinct Base and Solana wallet addresses represent distinct owners/accounts; automatic linking is not supported. The canonical and legacy production API aliases share the same account for the **same** wallet, while each ownership challenge and payment resource remains bound to its issuing origin.

## Original-operation recovery

Keep a pre-persisted random 32-byte private recovery capability with the exact original input, proof, accepted network and absolute resource. No public signature or transaction ID alone authorizes access to a private result. A completed original can be replayed through supported REST/MCP recovery without fresh work, another settlement, another credit debit or a new signature. New-payment feature disablement does not disable completed original recovery.

Uncertain Solana settlement is reconciled against finalized Mainnet evidence for the original message and exact native-USDC mint, token program, account owners, amount and merchant balance delta. Partial, unavailable or pruned history never proves an authorization unused and never authorizes replacement signing. Result retention remains seven days; financial receipts are retained. Use the original `workers.dev` origin for old origin-bound payments, and the original custom-domain resource for custom-domain payments. Paid POSTs are not redirected and signed URLs are not rewritten.

Rate limits, source security, provider quotas, capacity limits and finite operating budgets still apply. Solana payment support does not add Solana-chain intelligence, JavaScript rendering, background monitoring, an unlimited service guarantee or a new credit entitlement.

The legacy `tools` cost map in `/v2/prepaid/plans` lists the original Web tariff projection; it is not the complete All-Services entitlement inventory. `/v3/prepaid/all-services` describes the seven primitive costs. The four server workflows publish their own tariff and eligibility in live discovery and authenticated SDK `quote(product, input)` responses. Use those current quotes for exact workflow credits and the maximum you authorize; do not infer that a shorter legacy map disables a published workflow. The shared provisional-credit availability object applies to Base purchases only; Solana funding always requires finalized settlement.

## Native MPP standalone option

Standalone Solana MPP is separately available when root `mpp_payments.additional_methods` and the live unpaid challenge advertise `solana/charge`. It uses the same native USDC mint, existing merchant and per-tool amounts, but the client pays an explicitly authorized SOL fee; this is not the x402 sponsored-fee flow. Prepaid MPP funding remains Base-only. See [official-client requirements and original recovery](MPP.md#native-solana-mpp-standalone-charges).
