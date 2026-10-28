# Native MPP EVM payments

Read `GET https://api.fresh402.com/` first. `mpp_payments.enabled` controls new per-call MPP payments. Package purchases additionally require `mpp_payments.prepaid_purchases`, `prepaid_packages.enabled` and the availability in `/v2/prepaid/plans`. A disabled method is not an invitation to sign. The existing x402 and prepaid contracts remain available under their own flags.

Fresh402 accepts only **MPP `evm/charge`, Base Mainnet (8453), native USDC** `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, recipient `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`. Use an authorized EOA/external EIP-712 signer with sufficient USDC and explicit spending permission. ERC-1271 contract-wallet verification is not supported. Ownership and payments require compatible 65-byte ECDSA/EIP-712 signatures; an EIP-7702 delegated EOA is not automatically a contract-wallet signing mode. Historical delegated-EOA acceptance does not establish every smart-wallet implementation. The existing facilitator submits the exact EIP-3009 authorization. No unlimited allowance, token approval, browser checkout or payer private key sent to Fresh402 is required. Use a payer distinct from the recipient for package funding.

| Product | x402 or MPP per call, USDC | Prepaid tariff 3 credits | REST per-call route |
|---|---:|---:|---|
| Check | 0.005 | 2 | `/v1/check` |
| Extract | 0.010 | 3 | `/v2/extract` |
| Smart Diff | 0.015 | 4 | `/v2/smart-diff` |
| OpenAPI Contract Diff | 0.020 | 5 | `/v2/openapi-contract-diff` |
| Contract Watch | 0.010 | 4 (separate tariff4 grant) | `/v3/contract-watch` |
| Wallet Watch | 0.020 | 8 (separate tariff4 grant) | `/v3/wallet-watch` |
| Token Facts | 0.010 | 4 (separate tariff4 grant) | `/v3/token-facts` |

Register and discovery remain free. Generic MCP clients without a wallet or prepaid credential can discover tools and register baselines, but cannot pay. x402 suits existing x402 clients; MPP suits native Payment-auth clients; prepaid suits repeated use and shares the existing REST/MCP execution balance. Choose one billing method per operation. Never combine their credentials or fall back to a new payment after an uncertain response.

## HTTP exchange and durable recovery

A valid unpaid per-call request offers both the unchanged x402 `PAYMENT-REQUIRED` and native MPP `WWW-Authenticate: Payment` challenge. Existing x402 SDK clients continue sending `PAYMENT-SIGNATURE` and receiving `PAYMENT-RESPONSE`. Native MPP clients send `Authorization: Payment ...` and receive `Payment-Receipt`. Follow the challenge's advertised alternate credential field if application authentication occupies `Authorization`.

Native HTTP payment failures use RFC 9457 Problem Details. A failure after an attempted payment does not advertise a new challenge that could cause automatic repayment.

The MPP challenge binds the original resource, transport and exact REST body bytes. Do not reformat JSON after obtaining the challenge. The official SDK derives the EIP-3009 nonce from that challenge. Validate network, asset, recipient, price, expiry and the intended operation before invoking your signer. Bodyless x402 discovery quotes remain informational; supply complete operation inputs to obtain a payable MPP challenge.

Install the tested official SDKs in your client project:

```sh
npm install mppx@0.13.5 viem@2.57.1
```

Use the [exported TypeScript example](../examples/knowledge-base/mpp.ts). It has no automatic payment entry point. Supply your already authorized external signer and an encrypted private store outside Git:

```ts
import {authorizeMppRequest, resumeMppRequest} from '../examples/knowledge-base/mpp.ts';
const url = origin + '/v2/extract';
const body = JSON.stringify({url: 'https://example.com/', max_chars: 20000});
const quote = await fetch(url, {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body
});
const operation = await authorizeMppRequest(quote, {
  url, resource: url, body, account: authorizedAccount,
  maximumAtomicUSDC: 10000n, // exactly $0.010, not an unlimited allowance
  store: {
    reserve: marker => privateStore.reserveAtomicBudgetAndSave(marker),
    save: saved => privateStore.save('original-mpp-operation', saved)
  }
});
const {response, receipt} = await resumeMppRequest(operation);
const result = await response.json();
```

`privateStore`, `origin` and `authorizedAccount` are caller-provided dependencies. `reserve` must atomically persist the **cumulative** owner budget and a signing-request marker before the SDK signs. The example saves the original credential and a random 32-byte private recovery token before submission. A signing timeout is uncertain too: retain its marker and investigate; do not automatically sign again. Neither `maxAmount` nor a per-call maximum replaces a cumulative budget across restarts.

For recovery call `resumeMppRequest(originalSavedOperation)`. It has no signer and cannot create a replacement authorization. Reuse the exact body, credential, transport and `X-Fresh402-Recovery-Token`. Durable results are retained for seven days; accounting tombstones prevent a second capture. The token is essential for private recovery because payment signatures become public onchain. HTTP 409/503 means preserve evidence and reconcile the original operation; HTTP 410 is not permission to pay again. A failed fetch/parse produces no settlement receipt. A receipt's transaction reference is not a bearer credential or proof of package finality.

## MCP

The canonical endpoint exposes eight tools: free Register and seven paid products. Use the official MCP SDK (tested `@modelcontextprotocol/sdk@1.31.0`) and `mppx/mcp/client`. Install the MCP SDK in addition to the two packages above: `npm install @modelcontextprotocol/sdk@1.31.0`.

```ts
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {evm} from 'mppx/client';
import {McpClient} from 'mppx/mcp/client';
import {Credential} from 'mppx';

const client = new Client({name: 'my-agent', version: '1.0.0'});
await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp')));
const originalCallTool = client.callTool.bind(client);
const method = evm.charge({
  account: authorizedAccount, currencies: [evm.assets.base.USDC],
  networks: [8453], maxAmount: '0.010'
});
const trackedMethod = {...method, createCredential: async parameters => {
  const value = await method.createCredential(parameters);
  await privateStore.save('original-mpp-credential', value);
  return value;
}};
McpClient.wrap(client, {
  methods: [trackedMethod],
  onPaymentRequired: async challenge => {
    if (challenge.method !== 'evm' || challenge.intent !== 'charge' ||
        challenge.realm !== new URL(origin).host ||
        challenge.request.methodDetails?.chainId !== 8453 ||
        String(challenge.request.currency).toLowerCase() !==
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' ||
        challenge.request.amount !== '10000' ||
        String(challenge.request.recipient).toLowerCase() !==
          '0xfac492a8d7843c9afcca6a1691bccb5425ab14f3') return false;
    await privateStore.reserveAtomicBudgetAndSave({amount: '10000', signing_requested: true});
    return true;
  }
});
// Persist arguments and a fresh random 32-byte recoveryToken before this call.
const result = await client.callTool({
  name: 'fresh402_extract', arguments: savedArguments,
  _meta: {'fresh402/recovery-token': recoveryToken}
});
// Inspect result.isError, result.structuredContent and result.receipt.
// After a lost response, use the saved credential with the original method:
await originalCallTool({name: 'fresh402_extract', arguments: savedArguments,
  _meta: {'org.paymentauth/credential': Credential.deserialize(savedCredential),
          'fresh402/recovery-token': recoveryToken}});
```

Credentials use `params._meta['org.paymentauth/credential']`; receipts use `result._meta['org.paymentauth/receipt']`. Explicit `Accept-Payment: evm/charge` requests receive the official `-32042` JSON-RPC challenge. Native malformed/verification/internal payment errors use `-32602`/`-32043`/`-32603`, with an HTTP-equivalent status for recovery decisions. Ordinary legacy x402 challenges keep their existing tool-error shape and additionally expose the official `org.paymentauth/payment-required` metadata consumed by `McpClient.wrap`. HTTP 200 alone never establishes successful tool execution or payment.

## Starter and Developer through MPP

Follow [EOA enrollment and session recovery](AGENT_PREPAID.md) first. Use a management session, not an operation API key, for the purchase. Check all live purchasing flags before signing.

1. Persist one purchase idempotency key. `POST /v2/prepaid/customer/funding` with that key, the session header and `{"package_id":"candidate-starter-v3","payment_protocol":"mpp"}`. Developer uses `candidate-developer-v3`. Omission of `payment_protocol` retains x402 behavior. Package/protocol substitution under an existing key is rejected.
2. Persist the returned intent. Starter is exactly 2500000 atomic USDC / 1000 credits; Developer is 15000000 / 10000. These are one-time, nonrecurring purchases; purchased credits do not expire under the terms.
3. `POST /v2/prepaid/customer/funding/{intent_id}` with exact body `{}` and your session to obtain `WWW-Authenticate: Payment`. Use the official example with the session header, the intent's canonical `resource` and your explicitly approved package maximum. The resource is `/v2/prepaid/funding/{intent_id}`. Do not override the SDK-derived nonce or switch this intent to x402.
4. Save the original credential, then submit once. A 202 response can expose up to 50 Starter / 100 Developer early credits after at least three L2 confirmations and independent corroboration. This is not finality. Existing exposure ceilings, freezing/revocation and canonical finality requirements apply unchanged. A receipt or transaction hash alone grants no credits.
5. Poll the original account-scoped status. Recover with `POST` `{}` **without any payment credential**; no second settlement is submitted. After session loss authenticate the same EOA again. For an unsubmitted saved credential, `/funding/{intent_id}/inspect` accepts `{"credential": ORIGINAL_SERIALIZED_PAYMENT_CREDENTIAL}` for read-only inspection. Never authorize a replacement because of delay, 409 or 503.
6. After usable early credits or finality, claim and privately save an API key once. Use the existing [prepaid REST/MCP contract](AGENT_PREPAID.md#4-claim-a-key-and-spend-using-rest-or-mcp), tariff 3 and costs 2/3/4/5. Top-ups do not require replacing a working key. Full credits are posted once only after canonical finality, net of previously granted early credits.

The MPP and x402 paths share durable nonce claims, payment preparation, settlement, funding journal, uniqueness checks and prepaid ledger. New MPP payments can be disabled independently; unsigned recovery of existing package submissions and existing finalized credit balances remain available.

## Validation and supported scope

The public HTTPS adapters default to the current Safe and reject a substituted recipient. Original saved legacy authorizations remain recoverable without changing their recipient or creating a new signature. Explicit legacy fixture/recovery policy is not a new-production-purchase recommendation.

This integration is tested with official `mppx` and x402 SDKs, local workerd/D1 and isolated Cloudflare staging fixtures. Synthetic acceptance is **not a new real-money mainnet settlement validation**. No owner wallet signature or new USDC payment was made for this release.

Tempo, Stripe SPT, other chains/assets, swaps, subscriptions and payment sessions are not accepted. Future Tempo support would require an explicitly approved chain/asset/merchant and equally strong transaction/finality/replay verification. Stripe would require an approved merchant account, applicable activation/KYC, credentials and a separate proof/accounting review. None is activated or provisioned here.

Official references: [EVM charge](https://mpp.dev/payment-methods/evm/charge), [x402 coexistence](https://mpp.dev/guides/use-mpp-with-x402), [MCP transport](https://mpp.dev/protocol/transports/mcp), [mppx](https://github.com/wevm/mppx).

Circle Gateway is a separate optional x402 rail, not an MPP method. It is disabled pending acceptance; consult root `circle_gateway.enabled` and the [Circle Gateway guide](CIRCLE_GATEWAY.md). A Gateway transfer UUID is not a direct onchain receipt.
