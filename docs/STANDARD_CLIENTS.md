# Standard agent clients

Connect → try free → explicitly authorize a payment → inspect the result and receipt. No Fresh402 SDK is required. Live discovery is authoritative: https://api.fresh402.com/ and https://api.fresh402.com/openapi.json.

## Walletless Check

Read root `instant_evaluation.enabled` first. When enabled, this ordinary REST request performs one actual Check:

```sh
curl https://api.fresh402.com/v1/check \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","evaluation":true}'
```

Equivalent ordinary MCP SDK usage, with no wallet, key or custom header:

```js
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({name: 'my-agent', version: '1.0.0'});
await client.connect(new StreamableHTTPClientTransport(
  new URL('https://api.fresh402.com/mcp')));
try {
  const result = await client.callTool({name: 'fresh402_check', arguments: {
    url: 'https://example.com/', evaluation: true
  }});
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent));
  console.log(result.structuredContent); // actual hash, watch_id and freshness evidence
} finally { await client.close(); }
```

One attempted Check per verified IPv4 /24 or IPv6 /64 per approved B1 period; networks do not identify unique agents. Shared admission can deny earlier. This uses the existing finite pool, paid-priority capacity and operating expiry, not a new allocation. Exact input replay from the same network returns its retained original result for at most seven days. It does not perform a new check. Changed input after use is 429 `evaluation_exhausted`; unavailable access is 503, exhausted shared capacity is 429. A failed admitted attempt cannot be rerun as new work. No automatic payment occurs. Omit `evaluation` to obtain the existing paid Check challenge. Free Register remains separate; expanded [machine trials](MACHINE_TRIAL.md) retain their signed EOA enrollment and original quotas.

## Payment-capable clients

The client needs its own compatible authorized signer, native Base USDC and spending permission. Merely connecting an MCP server supplies none of these. Do not put private keys in prompts, source, URLs or logs. Obtain signer objects through your wallet provider's protected integration.

Current client acceptance: MCP SDK 1.32.2, `@x402/core`, `@x402/evm`, `@x402/mcp` and `@x402/fetch` 2.29.0; `agents` 0.32.0; `mppx` 0.17.0. All seven products completed isolated synthetic server tests with unmodified clients. This is not fresh mainnet settlement proof. Older tracked examples remain documented separately.

Use the exact current quote. Pin Base `eip155:8453`, native USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, Safe `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`, original resource URL and per-tool amount. Check/Extract/Smart Diff/OpenAPI Diff/Contract Watch/Wallet Watch/Token Facts cost 5000/10000/15000/20000/10000/20000/10000 atomic USDC. A per-call maximum is not a cumulative spending budget. Persist operation inputs and enforce a caller-approved cumulative budget before permitting any signing.

Official x402 MCP wrapper (caller supplies `authorizedSigner` and a policy/approval function; do not automatically approve arbitrary quotes):

```js
import {x402Client} from '@x402/core/client';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import {wrapMCPClientWithPayment} from '@x402/mcp';
const payments = new x402Client().register('eip155:8453',
  new ExactEvmScheme(authorizedSigner));
const paid = wrapMCPClientWithPayment(client, payments, {
  autoPayment: true, // only after the approval callback accepts the exact quote
  onPaymentRequested: async ({paymentRequired}) =>
    approveExactQuoteAndReserveBudget(paymentRequired)
});
const result = await paid.callTool('fresh402_extract', {
  url: 'https://example.com/', max_chars: 1000
});
// Inspect result.isError, content and paymentResponse; HTTP 200 alone is insufficient.
```

`client` is the connected standard MCP client above. The official wrapper API is `callTool(name, arguments)`, unlike the raw MCP SDK. It reads the standard structured challenge. Cloudflare's maintained `withX402Client(client, {account, network, maxPaymentValue})` instead uses `callTool(confirmPayment, {name, arguments})`. Fresh402 additionally supports its `_meta["x402/error"]` quote and encoded `_meta["x402/payment"]` envelope without changing the standard object form. See [Cloudflare's official client guide](https://developers.cloudflare.com/agents/tools/payments/x402/pay-from-agents-sdk/).

For ordinary REST x402, use `wrapFetchWithPayment(fetch, payments)` from `@x402/fetch`; install a blocking approval/budget policy on your payment client before calling it. It obtains `PAYMENT-REQUIRED` and retries with `PAYMENT-SIGNATURE`. Inspect `PAYMENT-RESPONSE` and the result. For native MPP, use `Mppx` with `evm.charge` from `mppx/client`, or `McpClient.wrap` from `mppx/mcp/client`, configured for Base USDC, exact amount and explicit approval. MPP uses its original challenge and `Authorization: Payment` / `org.paymentauth/credential`, not an x402 payload. [MPP contract and examples](MPP.md).

## Private recovery is optional before first purchase

A standard first purchase needs no Fresh402 token or signup. Successful REST responses can return `X-Fresh402-Recovery-Token`; raw MCP exposes `_meta["fresh402/recovery-token"]`. Save that private capability with the original input, proof, origin and transport. The official x402 MCP wrapper returns a simplified result: its `onAfterPayment` callback receives the raw result for optional private metadata storage. Do not assume every wrapper preserves custom metadata.

For recovery even when the **entire response is lost**, pre-generate and privately persist a random 32-byte hex/base64url secret and supply `X-Fresh402-Recovery-Token` (REST) or `params._meta["fresh402/recovery-token"]` (MCP). It is an optional stronger guarantee, not a purchase prerequisite. Exact original proof/input/token replay recovers the retained outcome within seven days without another settlement. An identical recorded operation with no private token returns 409 `recovery_authorization_required`, no private result and no new settlement. Unknown/pending settlement remains fail-closed. Never authorize a replacement just because delivery is uncertain.

An on-chain signature, nonce or transaction hash is public evidence, not private recovery authorization. If the complete response and private token are lost, private-result recovery is unavailable through proof alone; preserve evidence and contact support. A new authorization may identify a new paid operation. No universal exactly-once promise is made.

## Wallet and error boundaries

Signed human/machine trial enrollment and account ownership use the exact returned EIP-191 EOA message. This does not require a funded wallet. Per-call payments use EIP-3009 USDC authorization through a compatible EIP-712 signer and the facilitator. EOA, delegated EOA and provider-managed EOA signers must expose the required signing interface; provider integration itself was not independently certified by the synthetic tests. Do not infer ERC-1271 contract-wallet support, an arbitrary smart-account signature mode or every delegated-wallet extension from SDK support alone. Fresh402 native MPP currently requires its supported 65-byte ECDSA signature form. The receiving Safe is independent of payer-wallet support.

MCP errors must be read through `isError` and structured `error`, `message`, `status` where present; native MPP also has its standard payment errors. Wallet-not-configured, owner-denied approval and insufficient local wallet funds can originate in the client before Fresh402 receives a request. Do not mislabel them server outages. Server errors distinguish invalid input (400), payment rejection (402), original-operation conflict/pending (409), expired result (410), bounded rate/capacity denial (429), upstream failure (502/504) and service/reconciliation unavailable (503). Preserve original evidence after any payment uncertainty; neither 409 nor 503 authorizes a new payment.

For repeated use, [prepaid accounts](AGENT_PREPAID.md) share existing REST/MCP balances. Optional Fresh402 convenience clients are distributed as versioned source, not as an advertised published npm package. They are not required for the standard integrations above.
