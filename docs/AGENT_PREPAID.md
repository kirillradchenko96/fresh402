# Browserless agent purchasing and prepaid execution

Fresh402 3.0.2 exposes eight MCP tools: free Register and seven paid products. Its four Web Intelligence products (Check, Extract, Smart Diff and OpenAPI Contract Diff) fetch public static HTTPS documents. Contract Watch, Wallet Watch and Token Facts provide bounded Base observations. All seven paid products support REST and MCP. It does not render JavaScript, execute described API operations, crawl linked pages or run LLM inference. Fetching and parsing remain bounded by the live schemas, quotas and security policy.

Base Mainnet only: chain `8453` / `eip155:8453`; native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`; merchant `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`. Use a distinct payer EOA. Contract wallets / ERC-1271 are unsupported. Bring your own compatible EIP-712 signer with explicit owner-approved spending limits and enough native USDC. An ordinary MCP installation or wallet connection grants no payment authority. The facilitator submits the exact authorization; this client does not broadcast a transaction. ETH is required only if your separate wallet integration performs gas-paying transactions. No unlimited approval is requested.

| Product | One x402/MPP call, USDC | Credits (tariff) | Prepaid REST route |
|---|---:|---:|---|
| Check | 0.005 | 2 | `/v2/prepaid/check` |
| Extract | 0.010 | 3 | `/v2/prepaid/extract` |
| Smart Diff | 0.015 | 4 | `/v2/prepaid/smart-diff` |
| OpenAPI Contract Diff | 0.020 | 5 (3) | `/v2/prepaid/openapi-contract-diff` |
| Contract Watch | 0.010 | 4 (4) | `/v3/prepaid/contract-watch` |
| Wallet Watch | 0.020 | 8 (4) | `/v3/prepaid/wallet-watch` |
| Token Facts | 0.010 | 4 (4) | `/v3/prepaid/token-facts` |

The exported `PrepaidClient` and `purchaseAgentPackage` tutorial below cover the original four Web products and Web-only candidate packages. They do not silently upgrade an account. For a new all-seven-tools purchase, read `/v3/prepaid/all-services`, explicitly accept its exact `terms_digest`, and use `CustomerClient.preparePurchase` with `starter-all-services-v4` or `developer-all-services-v4`. These cost the same $2.50/1000 or $15/10000; finality is required for all-service credit eligibility. Submit blockchain operations with tariff4 and the exact maximum4/8/4. An old Web-only balance needs its original explicit service grant or newly accepted eligible credits. See [the Base tools and full contracts](API.md#separately-gated-agent-access-and-all-service-packages).

| Canonical package ID | USDC | Credits | Maximum early tranche |
|---|---:|---:|---:|
| `candidate-starter-v3` | 2.50 (2500000 atomic) | 1000 | 50 |
| `candidate-developer-v3` | 15.00 (15000000 atomic) | 10000 | 100 |

These are one-time purchases, not subscriptions. Purchased credits do not expire under the [terms](https://api.fresh402.com/terms); keys and durable result retention have separate lifetimes. Starter buys up to 500 Checks at $0.005 each; Developer up to 5000 at $0.003 each if entirely spent on Check. Use x402 for occasional use without a prepaid account. Prepaid suits repeated usage and uses different authentication. Existing account tariffs retain their original terms.

## 1. Discover; authenticate the agent's EOA

The service origin below is `https://api.fresh402.com`. Never send keys/signatures in URLs or logs. Keep all private state outside Git and encrypted at rest. No private key or seed phrase ever goes to Fresh402.

```sh
curl -sS https://api.fresh402.com/
curl -sS https://api.fresh402.com/v2/prepaid/plans
curl -sS https://api.fresh402.com/openapi.json
curl -sS https://api.fresh402.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"prepaid-agent","version":"1.0"}}}'
curl -sS https://api.fresh402.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Follow your MCP client's initialization/initialized notification sequence and negotiated protocol. The server is stateless; it does not offer a GET SSE session. Check `availability.account_creation`, `package_purchasing` and `provisional.enabled` in plans before signing. Root `prepaid_packages` links to this guide and the same authoritative catalog.

`POST /v2/prepaid/customer/challenge` takes `{"wallet":"YOUR_EOA_ADDRESS"}` and a persisted `Idempotency-Key` of 16–128 letters/digits/`_`/`-`. It returns `challenge_id`, `expires_at`, `typed_data`. Sign exactly that EIP-712 object locally after validation:

- Domain: `name=Fresh402 Account`, `version=1`, `chainId=8453`, `salt=keccak256(UTF8(origin + "|" + environment))`.
- Primary type `CustomerOwnership`; fields in order: `wallet:address`, `action:string`, `origin:string`, `environment:string`, `nonce:bytes32`, `issuedAt:uint256`, `expiresAt:uint256`.
- Message: your wallet, action `Authenticate Fresh402 customer`, exact HTTPS origin, `production` for production, returned random nonce, issue and expiry in **milliseconds**. Lifetime five minutes. This ownership signature is separate from payment authorization.

`POST /v2/prepaid/customer/sessions` takes `{"challenge_id":CHALLENGE_ID,"signature":LOCAL_SIGNATURE}`. The EOA signature is 65 bytes, hex `0x` plus 130 characters. Successful proof returns `session_token` and `account_id`; send the token as `X-Fresh402-Customer-Session`. Sessions last 15 minutes and cannot execute products. A fresh challenge/signature recovers the same wallet/origin account and all existing funds; replaying a consumed challenge fails. A zero-balance signup does not receive an operation key yet. Lost session response: authenticate again; do not reuse its consumed challenge.

## 2. Quote and authorize exactly one purchase

All routes in this section require the management session header and JSON. Use [CustomerClient](../examples/knowledge-base/onboarding.ts) and the [signer-injected agent example](../examples/knowledge-base/agent-prepaid.ts) to avoid putting secrets in shell arguments.

1. `POST /v2/prepaid/customer/funding`, body `{"package_id":"candidate-starter-v3"}`, with one **persisted purchase** `Idempotency-Key`. Repeat that key only for this intentional purchase; package substitution returns 409. Persist the returned intent **before signing**.
2. Inspect `intent_id`, `package_id`, `credits`, `amount_atomic`, `payer`, `network`, `asset`, `pay_to`, `nonce`, `expires_at` and `resource`. The signed resource is deliberately `/v2/prepaid/funding/{intent_id}`, although customer submission uses the customer route below.
3. `POST /v2/prepaid/customer/funding/{intent_id}`, body `{}`, without a payment header obtains HTTP **402**, `PAYMENT-REQUIRED` and the same x402 v2 JSON requirements. Validate the quote against your selected package, payer, chain, asset, merchant and local amount budget. A quote is not a payment.
4. Use `CustomerClient.preparePayment(intent, quote, {chainId:8453,payer:signer.address,authorizedAtomicUSDC:2500000n})`. For Developer authorize exactly `15000000n`. It prepares EIP-712 `TransferWithAuthorization` with domain `USD Coin`, version `2`, chain `8453`, native USDC verifying contract. Message fields in order: `from:address`, `to:address`, `value:uint256`, `validAfter:uint256`, `validBefore:uint256`, `nonce:bytes32`. Values: your payer, exact merchant/atomic amount, `0`, `floor(intent.expires_at/1000)-1` **seconds**, and the intent nonce.
5. Persist a signing-request marker first. Invoke your existing EOA/external signer's `signTypedData` only under its owner's explicit purchase budget. Persist the returned original payload privately **before** submission. `payloadForSignature(signature)` constructs `{x402Version:2,resource,accepted,payload:{signature,authorization}}` from the exact quote.
6. Submit once to `POST /v2/prepaid/customer/funding/{intent_id}`, body `{}`, with `PAYMENT-SIGNATURE=base64(JSON.stringify(originalPayload))`. Never log the header. Use `CustomerClient.submitAuthorizedPayment`; the server never needs wallet keys.

The exported example functions have **no automatic payment entry point**. Supply your already authorized signer and private store. For a viem WalletClient backed by an approved external signer, adapt `signTypedData: data => walletClient.signTypedData({...data,account:walletClient.account})`; obtain `address`/chain from that signer and verify chain 8453. Fresh402 does not configure or fund that signer for you. Ownership `uint256` strings must be converted to bigint before strongly typed SDK signing, as the example does. Do not use a newly pasted private key, unlimited token approval or a server-held owner wallet.

## 3. Early credits, finality and recovery

Signatures, transaction hashes, broadcast acknowledgements and mempool observations create **no spendable credits**. Early access requires independent authenticated Base RPC verification and separate fixed public-RPC corroboration of a successful canonical direct native-USDC EIP-3009 transaction, exact payer/merchant/amount/nonce and matching `AuthorizationUsed`/`Transfer` logs. At least **three included L2 confirmations**, a fresh head and a recent included block are required. This is **not L1 finality** and does not guarantee eventual finality.

When enabled, a new eligible Starter purchase may unlock 50 credits, Developer 100. One unresolved early grant per account **or payer**, project ceiling 500 credits including unresolved consumed losses, evidence freshness, finite verification attempts and existing execution budgets can deny or freeze early access. These limits are maximums, not a promise. Historical purchases are never retroactively early-credited. Unused early credits can be frozen or revoked; finalized credits retain their nonexpiration terms. Verification is request-triggered plus bounded existing background recovery, without continuous Container execution. Network conditions determine timing; no exact activation/finality time is guaranteed.

Use `GET /v2/prepaid/customer/funding/{intent_id}` (read-only) every 15–30 seconds, backing off on 429/503. Or call `CustomerClient.awaitSpendable` for bounded read-only polling; `awaitFunding` retains its default **finalized-only** behavior. Background recovery continues after process/session loss. `POST` to the same funding route with `{}` and **no payment header** requests recovery of the existing submission; it never resettles it.

Additive status fields:

| Field | Meaning |
|---|---|
| `state` | Original journal state: `intent`, `settling`, `confirmed`, `credited`; `confirmed` alone is not finalized |
| `purchase_status` | `pending`, `included`, `provisional`, `provisional_frozen`, `revoked`, `invalid`, `finalized` |
| `inclusion_status` / `included_at` | `pending`, `verified`, `uncertain`, `invalid`; last corroboration timestamp in ms |
| `provisional_granted/spent/remaining/reserved/revoked` | Integer provenance of the bounded early tranche |
| `provisional_available` | Currently usable early balance for this purchase; zero when disabled/frozen |
| `finalized` / `finality_pending` | Whether full canonical finality was established / remains pending |
| `recovery_status` | Existing bounded recovery code; preserve the same intent |

An early submission can return **202** with `purchase_status=provisional`; this is not a full credited purchase. GET status is the complete account-scoped projection. Successful finalization returns 200, then GET shows `state=credited`, `finalized=true`, `settlement_kind=real`. Synthetic staging receipts are never evidence of a real payment.

`GET /v2/prepaid/customer/account` and API-key `GET /v2/prepaid/balance` retain `available`/`reserved` and add `finalized_available`, `provisional_available`, `provisional_unspent`, `provisional_reserved`, `provisional_spent`, **`spendable`**. Use `spendable` for admission; legacy `available` can include frozen unused early credits. Confirmed available credits are spent first. Starter early50, spend12, finalization => **988 remaining**, never1050.

Uncertain RPC evidence freezes early spending. Corroborated definitive invalidity/reorganization revokes only unused early credits, releases tied reservations and records already consumed credits as bounded merchant risk. It does not debit unrelated finalized funds or create customer debt. The same intent remains eligible for legitimate later canonical finality, with only the correct remaining package credited. A revoked transaction cannot obtain another early grant. Do not replace an authorization because a timeout, reorg or long delay occurred.

On timeout/409/503 or a lost signing/submission response, retain the intent and original authorization. **Never call the purchase/sign function again as a retry.** Reauthenticate the same EOA when a session expires and inspect/recover the original intent. For an apparently unsubmitted saved authorization, `POST .../funding/{intent_id}/inspect` with `{"payment":ORIGINAL_SAVED_PAYLOAD}` is read-only; only trusted finalized `safe_to_replace=true` establishes that the old authorization cannot settle. Any replacement purchase still needs a separate budget decision. A canceled/used/uncertain nonce is not permission to pay again.

## 4. Claim a key and spend using REST or MCP

After a finalized purchase **or a verified currently spendable early tranche**, `POST /v2/prepaid/customer/credentials/claim` with `{}` returns `api_key`, `credential_id`, `expires_at`. Save privately. Only a verifier is persisted server-side. **Claim/rotate replaces all prior account keys**; do not claim on every status poll or top-up. Lost key response: prove the same EOA again, inspect credentials and explicitly claim/rotate. Keys last one year; wallet recovery preserves the same funds. Revoke one account-owned `credential_id` through `/credentials/revoke`. Stolen operation keys cannot manage the wallet account.

A REST Check takes `{"url":"https://example.com/"}` at `/v2/prepaid/check` with HTTP headers `X-Fresh402-API-Key`, `Idempotency-Key`, `X-Fresh402-Tariff-Version: 3`, `X-Fresh402-Max-Credits: 2`. Use 3/4/5 maximums for the other products. Register is free; obtain `watch_id` through `/v1/register` or `fresh402_register` before Smart Diff/OpenAPI Diff. Check accepts exactly one `url` or saved `watch_id`; a watch reuses saved rules. OpenAPI requires a JSON 3.0/3.1 contract registered without content rules; no YAML or remote references. Follow all live input schemas.

MCP uses the **same HTTP key**, never a key in tool arguments/metadata. Pass per-call metadata:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"fresh402_check","arguments":{"url":"https://example.com/"},
  "_meta":{"fresh402/prepaid":{"idempotency_key":"persisted-operation-0001","tariff_version":3,"max_credits":2}}
}}
```

The other names are unchanged: `fresh402_extract`, `fresh402_smart_diff`, `fresh402_openapi_contract_diff`. The same key covers all authorized tools and both transports. Successful/durably released MCP results include `result._meta["fresh402/prepaid"]` with `access_method`, `credits`, `durable`. Inspect `result.isError` and `structuredContent.status`; HTTP 200 alone is insufficient. Clients must support a custom HTTP `X-Fresh402-API-Key` header and per-call `_meta` (or matching per-request idempotency/tariff/maximum headers). Clients without those controls cannot execute prepaid calls. Discovery itself remains free; generic MCP clients do not acquire wallet signing.

Never combine prepaid credentials with `PAYMENT-SIGNATURE`, `x-payment` or MCP `x402/payment`; mixed billing returns 400. Prepaid failures never fall back to x402. Repeat the original **operation** key with identical tool, input, tariff and maximum after a timeout. REST/MCP share the same durable operation identity and debit, so a replay through the other transport does not fetch or debit again. Input/maximum changes under one key return 409. Released failures consume zero credits; seven-day durable result retention does not erase accounting tombstones.

```ts
import {CustomerClient} from '../examples/knowledge-base/onboarding.ts';
import {PrepaidClient} from '../examples/knowledge-base/prepaid.ts';
// Restore confidential values from your private store; do not print them.
const customer = new CustomerClient(origin, {sessionToken: savedSession});
const status = await customer.awaitSpendable(savedIntent, {intervalMs:15000});
// Reuse savedKey. Claim only if a new funded account has no active key.
const prepaid = new PrepaidClient(origin, savedKey, {
  transport:'mcp', tariffVersion:3, maxCredits:12,
  persist: op => privateStore.save('operation', op)
});
await prepaid.quoteRemote();
const result = await prepaid.execute('check', {url:'https://example.com/'});
// After timeout/process restart restore the ORIGINAL operation and cumulative
// reserved credit budget; call prepaid.recover(savedOperation), not execute().
const balance = await customer.balance(); // use balance.spendable
```

The example is an integration fragment: `origin`, signer/session/key and encrypted persistence are caller-provided. [Executable exported functions](../examples/knowledge-base/agent-prepaid.ts) require those dependencies and have no top-level signing/payment action. Persist cumulative client spending across restarts (`restoredCredits`), reserve a purchase budget before invoking a signer, and never refund that local payment budget after an uncertain signature or response. The server's quoted costs remain authoritative.

Common errors: 401/403 authenticate or recover/revoke the correct key; 402 insufficient spendable credits or missing explicit tariff/maximum, with no x402 fallback; 409 original operation still pending or mismatched; 410 expired challenge/unsubmitted intent/result retention, not permission to replace a submitted payment; 429 back off for quota/capacity; 503 provider/finality/recovery pending, preserve evidence and poll. Fetch/security/parse failures follow the existing zero-credit release policy. Support and billing: fresh402@proton.me. See [self-service](SELF_SERVICE.md), [MCP](MCP.md), [API](API.md) and the [account page](https://api.fresh402.com/account).

## Optional native MPP purchases

When root `mpp_payments.prepaid_purchases` and public purchasing availability are true, select `payment_protocol: "mpp"` when creating a new intent. The official MPP SDK signs its immutable challenge-derived nonce; this intent cannot switch to x402. Prices, 50/100 early-credit ceilings, three-confirmation corroboration, finality, ledger and prepaid REST/MCP spending remain the same. Follow the [MPP package exchange and original-credential recovery](MPP.md#starter-and-developer-through-mpp). The existing tutorial above and omitted protocol continue to use x402.
