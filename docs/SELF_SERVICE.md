# Self-service prepaid customer API

Fresh402 2.3 adds wallet-authenticated customer onboarding alongside the independent x402 pay-per-call API. Public signup and package purchasing remain **gated pending genuine funding acceptance and approved commercial terms**. Read `GET /v2/prepaid/plans` and OpenAPI `x-customer-onboarding` before proceeding. A deployed endpoint, an HTTP 402, and a simulated settlement are not proof of a customer purchase.

The five established MCP tool names and `/mcp` URL are unchanged. MCP supports standalone x402 operations without signup. Customer management and prepaid credit execution use REST; MCP discovery does not grant a prepaid credential or spend credits.

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

These IDs preserve the existing immutable package catalog. Earlier account tariffs retain their purchased terms. Native USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base mainnet chain 8453 (`eip155:8453`), receiver `0x58B4b483fBE31860335eCeB12CCCF4338b251085`. The payer must differ from the receiver. There are no unlimited approvals or subscriptions.

## Authenticate and fund without an administrator

Use HTTPS and persist idempotency keys and pending operations confidentially. Never place credentials, sessions, payment signatures or wallet keys in URLs or logs. Supply wallet signatures locally through an external wallet adapter; never upload wallet private keys or seed phrases.

1. `GET /v2/prepaid/plans`: inspect availability, exact package terms and product costs.
2. `POST /v2/prepaid/customer/challenge` with `{"wallet":"YOUR_EOA_ADDRESS"}` and a persisted `Idempotency-Key` (16–128 letters, digits, `_`, `-`). Inspect the returned EIP-712 typed data: Fresh402 Account, chain 8453, exact origin/environment, action, random nonce and five-minute expiry. Supported: 65-byte EOA signatures. Contract-wallet/ERC-1271 signatures are not supported.
3. Sign this **ownership challenge**, then `POST /v2/prepaid/customer/sessions` with `challenge_id` and `signature`. The challenge is single-use. Keep the returned `session_token` confidential; use `X-Fresh402-Customer-Session` for 15-minute account management. Lost session response: obtain and sign a fresh ownership challenge. The same wallet and service origin recover the same account. No email or payment is required to establish ownership; no credits or execution key are created yet.
4. `POST /v2/prepaid/customer/funding` with `{"package_id":"candidate-starter-v3"}`, the session header, and one persisted idempotency key for this intentional purchase. Repeating that key recovers the same intent. A different package under the same key returns 409. Inspect payer, receiver, nonce, immutable credit count, amount, network, asset, resource and expiry.
5. `POST /v2/prepaid/customer/funding/{intent_id}` with `{}` and the session header returns HTTP 402 and `PAYMENT-REQUIRED`. Its signed x402 resource remains `/v2/prepaid/funding/{intent_id}`. Inspect all terms before explicitly confirming an exact wallet-side USDC authorization. The example `prepareFundingAuthorization` enforces Base, native USDC, receiver, intent nonce and caller's amount cap. It never signs automatically.
6. Persist the original authorization privately **before** submitting it in `PAYMENT-SIGNATURE` to that same customer funding route. No credits are issued merely because verification succeeds. The service verifies finalized canonical Base settlement, the direct native USDC EIP-3009 calldata and matching AuthorizationUsed/Transfer events. Indirect/batched contract calls are not supported by this proof checker.
7. On 409, 503, timeout or lost response, **do not sign or pay again**. Recover the same intent with the same session and `{}` without a payment header. `GET .../funding/{intent_id}` inspects state without settlement. A bounded durable finalized-log scan locates a lost facilitator response by the original authorization nonce; delayed finality/RPC outages remain pending. An expired, never-submitted intent can be replaced after inspection. Submitted intents remain recoverable after quote expiry.
8. When state is `credited`, `finalized=true`, and `settlement_kind=real`, `POST /v2/prepaid/customer/credentials/claim` with `{}` and the session. Save the returned `api_key` securely. Only its SHA-256 verifier is stored. **Each claim replaces all prior account keys**. If the response is lost, repeat wallet authentication and claim/rotate without another payment; credits stay on the same account.
9. Use `X-Fresh402-API-Key` with the existing `/v2/prepaid/*` execution routes, explicit tariff 3, `X-Fresh402-Max-Credits`, and persisted operation idempotency keys. A Check consumes two credits: a fresh Starter balance becomes 998. Recover the original operation with the same input and idempotency key; durable replay does not debit again. Do not combine prepaid credentials and x402 signatures for tool execution.
10. Inspect `/v2/prepaid/customer/account`, `/usage`, `/purchases`, `/credentials`. Top up through the same funding process with a new intentional-purchase key. `/credentials/rotate` replaces keys; `/credentials/revoke` accepts an account-owned `credential_id`. A compromised API key cannot authenticate wallet management. All keys lost: prove the same wallet again and rotate.

## Client examples and failure handling

Use [CustomerClient](../examples/knowledge-base/onboarding.ts), [complete purchase/Check/Developer/top-up examples](../examples/knowledge-base/onboarding-example.ts) and [PrepaidClient](../examples/knowledge-base/prepaid.ts). Examples have no executable payment entry point. Wallet connection, identity signing and each exact purchase confirmation are explicit caller-supplied actions. Persist confidential state outside Git. For protected staging, obtain owner-provided access separately; public documentation contains no staging access material.

Unauthenticated requests are denied; ownership proofs, sessions, account status, credential revocation and global prepaid controls are checked independently. Challenges, empty identities, pending intents, sessions, claims and operations have bounded quotas. Account state is isolated; credentials never authorize another customer's history. Failed target execution releases reserved credits. Pending payment recovery never falls back to a new charge. Product fetching remains subject to all existing SSRF, TLS, pinned-peer and capacity guards.

Balances use integer credits and do not automatically expire in the current implementation. API keys expire independently after one year and can be replaced through wallet ownership. Durable tool results are retained for seven days; financial tombstones remain. Refund, closure and any future balance-expiry terms require owner approval before public sales; this engineering document does not establish approved sale terms.
