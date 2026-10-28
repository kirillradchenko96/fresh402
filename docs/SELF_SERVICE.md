# Self-service prepaid customer API

Fresh402 3.0.1 provides wallet-authenticated customer onboarding alongside the independent x402 pay-per-call API. Discover one-time, non-expiring credit packages through `GET /` → `prepaid_packages`. Read `GET /v2/prepaid/plans` and OpenAPI `x-customer-onboarding` for current public signup and purchasing availability before proceeding. A deployed endpoint, an HTTP 402, and a simulated settlement are not proof of a customer purchase.

The canonical `/mcp` URL exposes eight tools: free Register and seven paid products. MCP supports standalone x402 operations without signup. Customer management uses REST; prepaid execution works through REST and the same seven paid MCP tools (blockchain execution requires eligible all-service credits or the account's original explicit service grant). MCP discovery alone does not grant credentials or payment authority. See the complete [browserless agent purchasing guide](AGENT_PREPAID.md).

| Product | x402 USDC | Prepaid credits, tariff 3 |
|---|---:|---:|
| Check | $0.005 | 2 |
| Extract | $0.010 | 3 |
| Smart Diff | $0.015 | 4 |
| OpenAPI Contract Diff | $0.020 | 5 |

| Package ID | Native Base USDC | Credits |
|---|---:|---:|
| `candidate-starter-v3` | $2.50 / 2500000 atomic | 1000 |
| `candidate-developer-v3` | $15 / 15000000 atomic | 10000 |

These IDs preserve the existing immutable package catalog. Earlier account tariffs retain their purchased terms. Native USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base mainnet chain 8453 (`eip155:8453`), receiver `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`. The payer must differ from the receiver. There are no unlimited approvals or subscriptions.

## Authenticate and fund without an administrator

Use HTTPS and persist idempotency keys and pending operations confidentially. Never place credentials, sessions, payment signatures or wallet keys in URLs or logs. Supply wallet signatures locally through an external wallet adapter; never upload wallet private keys or seed phrases.

1. `GET /v2/prepaid/plans`: inspect availability, exact package terms and product costs.
2. `POST /v2/prepaid/customer/challenge` with `{"wallet":"YOUR_EOA_ADDRESS"}` and a persisted `Idempotency-Key` (16–128 letters, digits, `_`, `-`). Inspect the returned EIP-712 typed data: Fresh402 Account, chain 8453, exact origin/environment, action, random nonce and five-minute expiry. Supported: 65-byte EOA signatures. Contract-wallet/ERC-1271 signatures are not supported.
3. Sign this **ownership challenge**, then `POST /v2/prepaid/customer/sessions` with `challenge_id` and `signature`. The challenge is single-use. Keep the returned `session_token` confidential; use `X-Fresh402-Customer-Session` for 15-minute account management. Lost session response: obtain and sign a fresh ownership challenge. The same wallet and service origin recover the same account. No email or payment is required to establish ownership; no credits or execution key are created yet.
4. `POST /v2/prepaid/customer/funding` with `{"package_id":"candidate-starter-v3"}`, the session header, and one persisted idempotency key for this intentional purchase. Repeating that key recovers the same intent. A different package under the same key returns 409. Inspect payer, receiver, nonce, immutable credit count, amount, network, asset, resource and expiry.
5. `POST /v2/prepaid/customer/funding/{intent_id}` with `{}` and the session header returns HTTP 402 and `PAYMENT-REQUIRED`. Its signed x402 resource remains `/v2/prepaid/funding/{intent_id}`. Inspect all terms before explicitly confirming an exact wallet-side USDC authorization. The example `prepareFundingAuthorization` enforces Base, native USDC, receiver, intent nonce and caller's amount cap. It never signs automatically.
6. Persist the original authorization privately **before** submitting it in `PAYMENT-SIGNATURE` to that same customer funding route. No credits are issued merely because verification succeeds. The service may release a bounded early tranche only after independently corroborated recent successful L2 inclusion with at least three confirmations. The remainder still requires finalized canonical Base settlement, the direct native USDC EIP-3009 calldata and matching AuthorizationUsed/Transfer events. Indirect/batched contract calls are not supported by this proof checker.
7. On 409, 503, timeout or lost response, **do not sign or pay again**. Cloudflare automatically reconciles submitted payments, including after this page closes or your session expires. Use `GET .../funding/{intent_id}` or `CustomerClient.awaitFunding` for bounded read-only polling; reconnect the same wallet when a management session expires. Recovery uses the original nonce and saved transaction references without another settlement. An unsubmitted saved authorization is uncertain until the finalized chain proves the entire quote expired unused. `POST .../funding/{intent_id}/inspect` with `{ "payment": ORIGINAL_SAVED_PAYLOAD }` performs read-only inspection of that exact original authorization; only `safe_to_replace=true` permits a separately confirmed new purchase. A used/canceled/uncertain nonce never authorizes replacement. Submitted intents remain recoverable after quote expiry.
8. After either a verified spendable early tranche or `state=credited`, `finalized=true`, `settlement_kind=real`, `POST /v2/prepaid/customer/credentials/claim` with `{}` and the session. Save the returned `api_key` securely. Only its SHA-256 verifier is stored. **Each claim replaces all prior account keys**. If the response is lost, repeat wallet authentication and claim/rotate without another payment; credits stay on the same account.
9. Use `X-Fresh402-API-Key` with the existing `/v2/prepaid/*` execution routes, explicit tariff 3, `X-Fresh402-Max-Credits`, and persisted operation idempotency keys. A Check consumes two credits: a fresh Starter balance becomes 998. Recover the original operation with the same input and idempotency key; durable replay does not debit again. Do not combine prepaid credentials and x402 signatures for tool execution.
10. Ordinary top-ups preserve active keys. Inspect `/v2/prepaid/customer/account`, `/usage`, `/purchases`, `/credentials`. Top up through the same funding process with a new intentional-purchase key. `/credentials/rotate` replaces keys; `/credentials/revoke` accepts an account-owned `credential_id`. A compromised API key cannot authenticate wallet management. All keys lost: prove the same wallet again and rotate.

## Client examples and failure handling

The [same-origin account page](https://fresh402.kirilllabs.workers.dev/account) supports EOA wallet browsers, explicit ownership/payment confirmations, encrypted local evidence and key download. Check live availability before signing. Never clear saved evidence during an uncertain payment.

Use [CustomerClient](../examples/knowledge-base/onboarding.ts), [complete purchase/Check/Developer/top-up examples](../examples/knowledge-base/onboarding-example.ts) and [PrepaidClient](../examples/knowledge-base/prepaid.ts). Examples have no executable payment entry point. Wallet connection, identity signing and each exact purchase confirmation are explicit caller-supplied actions. Persist confidential state outside Git. For protected staging, obtain owner-provided access separately; public documentation contains no staging access material.

Unauthenticated requests are denied; ownership proofs, sessions, account status, credential revocation and global prepaid controls are checked independently. Challenges, empty identities, pending intents, sessions, claims and operations have bounded quotas. Account state is isolated; credentials never authorize another customer's history. Failed target execution releases reserved credits. Pending payment recovery never falls back to a new charge. Product fetching remains subject to all existing SSRF, TLS, pinned-peer and capacity guards.

Purchased balances use integer credits and do not expire under the [published terms](https://fresh402.kirilllabs.workers.dev/terms). API keys expire independently after one year and can be replaced through wallet ownership. Durable tool results are retained for seven days; financial tombstones remain. Refunds and account closure follow the published terms and applicable mandatory rights.

Early inclusion is not finality. Limits, frozen/revoked status, precise machine-readable balance fields and prepaid MCP metadata are specified in [AGENT_PREPAID.md](AGENT_PREPAID.md). Use `spendable`, not legacy `available`, to exclude frozen early credits. No credits arise from a signature, broadcast or client transaction hash alone.

MPP-capable agents may opt a **new** purchase into `payment_protocol: "mpp"` when live flags allow it. Omission defaults to x402. Persist the immutable protocol and original credential; use the same account, funding journal and unsigned recovery, not a second purchase. See [native MPP packages](MPP.md#starter-and-developer-through-mpp).
