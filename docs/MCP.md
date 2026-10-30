# Fresh402 3.0 MCP integration

Canonical endpoint: **https://api.fresh402.com/mcp**.
Transport: **Streamable HTTP**. Official Registry identity: **io.github.kirillradchenko96/fresh402**.

Add the canonical URL through your client's remote HTTP MCP connector. A client configuration that supports URL-based remote servers can use:

```json
{"mcpServers":{"fresh402":{"url":"https://api.fresh402.com/mcp"}}}
```

Clients that accept only local stdio commands need a compatible HTTP connector. Discovery and Register are free; paid calls require a configured x402 payment client, a native MPP client when enabled, or an existing prepaid API key with per-call metadata. MCP support alone does not provide a wallet or spending permission.

## Nonpaying handshake and discovery

Send JSON-RPC POST requests with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. A response may be JSON or SSE; parse the JSON-RPC envelope rather than relying only on the HTTP code.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0.0"}}}
```

Inspect the negotiated protocol version and `serverInfo.version`. The official MCP TypeScript SDK handshake and discovery were verified against the hosted service. Use the MCP client's normal initialization and notification sequence.

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

The service is sessionless. GET/HEAD `/mcp` return HTTP 405; this server does not offer a standalone SSE session. Nonpaying discovery and JSON-RPC execution use POST with the required Accept headers. Unsupported content negotiation can legitimately return 406. Follow the live tool schemas, including any metadata required by your negotiated MCP version.

| Tool | Purpose | Price |
|---|---|---:|
| fresh402_register | Create/retrieve a persistent baseline; existing watches do not refetch | Free |
| fresh402_check | URL/watch freshness, filtering and optional compact text diff | $0.005 USDC |
| fresh402_extract | Text, metadata, headings, links and JSON-LD extraction | $0.01 USDC |
| fresh402_smart_diff | Structural changes and explained deterministic significance | $0.015 USDC |
| fresh402_openapi_contract_diff | Bounded JSON OpenAPI changes, classifications and provenance | $0.020 USDC |
| fresh402_contract_watch | Selected finalized Base contract/proxy/storage/event observations | $0.010 USDC |
| fresh402_wallet_watch | Bounded finalized Base balance/selected ERC-20 transfer pages | $0.020 USDC |
| fresh402_token_facts | Contract-reported token identity, supply and selected controls | $0.010 USDC |

There are eight tools: free Register and seven paid products. The current new-payment merchant is Safe `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`, Base 8453/native USDC. Validate this pinned policy against the challenge; do not silently accept another recipient. A separate [machine trial](MACHINE_TRIAL.md) is enabled under finite quotas and expiry, with an EOA ownership message and no CAPTCHA; it is not the human Turnstile trial.

## Walletless first Check

Read root `instant_evaluation.enabled`. When true, call `fresh402_check` with `{"url":"https://example.com/","evaluation":true}` through an ordinary MCP client. No wallet, API key, custom header or Fresh402 SDK is required. This is one attempted Check per verified network prefix per approved period, not per unique agent; shared admission may deny earlier. Identical input from that network replays its retained result for at most seven days. Default Check remains paid, and free exhaustion never initiates payment. [Official-client examples and recovery limits](STANDARD_CLIENTS.md).

## Calls

Free registration:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"fresh402_register","arguments":{"url":"https://example.com/"}}}
```

Unsigned extraction challenge (no payment is made):

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"fresh402_extract","arguments":{"url":"https://example.com/","max_chars":20000}}}
```

All tool names, input schemas and descriptions are returned by `tools/list`. Use a real Register result for a `watch_id`; do not treat example IDs as existing watches.

## x402 tool payments

An unpaid call returns a tool error: `result.isError` is true and `result.structuredContent` contains x402 PaymentRequired. **HTTP 200 does not prove payment or success.**

Validate exact USDC amounts, Base mainnet, recipient and resource before a payer-controlled wallet signs. The client retries the same `tools/call` with the PaymentPayload in `params._meta["x402/payment"]`, preserving advertised resource and extensions. No Fresh402-specific token is required for first execution. Optional recovery protection is described below.

Successful settlement exposes `result._meta["x402/payment-response"]`; inspect the structured result and receipt. Retrying identical input/payment/token recovers a retained result without a second settlement. If settlement is pending, retain those same values and do not sign a replacement. Never log the token or authorization signature.

Nonpayment tool errors include their numeric HTTP-equivalent `status` in `structuredContent`, alongside `error` and `message`; for example a changed recovery request is 409. x402 challenges retain the standard PaymentRequired shape. Inspect `isError` and the structured status instead of treating every HTTP 200 tool response as success or every tool error as temporary. A runnable [TypeScript customer integration](../examples/knowledge-base/README.md) demonstrates both transports and safe recovery.

The API processes public HTTPS HTML, JSON and text on demand. Extraction does not render a browser or execute JavaScript, and Smart Diff uses deterministic rules rather than an LLM. See [API.md](API.md) and [PRICING.md](PRICING.md).


## Native MPP

When root `mpp_payments.enabled` is true, the seven enabled paid tools accept official MPP EVM charge on Base native USDC at the same prices. Use `mppx/mcp/client`, `org.paymentauth/credential` and `org.paymentauth/receipt`; the existing x402 challenge envelope remains compatible. Explicit MPP selection uses standard JSON-RPC payment errors. Persist the original credential, input and private recovery token before submission; never mix billing credentials or sign another payment after uncertainty. See [MPP setup, tested SDKs and recovery](MPP.md).

## Optional prepaid customer accounts

The canonical MCP URL exposes eight tools; the five established Web tool identities remain unchanged. Standalone x402 needs no customer signup. Wallet ownership, package funding, API-key claim/recovery and credit execution use the [REST self-service contract](SELF_SERVICE.md) and [CustomerClient](../examples/knowledge-base/onboarding.ts). Public signup and one-time purchasing are available when enabled in the live `/v2/prepaid/plans` response. For prepaid MCP calls, pass X-Fresh402-API-Key in HTTP and params._meta["fresh402/prepaid"] containing idempotency_key, tariff_version and max_credits. Use the same 2/3/4/5 Web tariff and durable operation identity as REST. Blockchain products cost 4/8/4 under explicit tariff 4 metadata and eligible all-service credits or original grants. Never combine prepaid and x402 or automatically fall back to a new payment. See [the complete agent guide](AGENT_PREPAID.md) for signing, early-credit limits, key recovery and exact examples.


## 2.8 compatibility and gated trials

The live service supports modern protocol discovery and legacy Streamable HTTP clients. Tools are static: `tools.listChanged=false`. An honored empty subscription subset acknowledges `notifications:{}` and completes; it does not retain an open subscription. Unsupported filters and real capacity errors remain errors.

A normal client can list all eight released tools and register a baseline. Paid execution requires x402, enabled native MPP or authenticated prepaid metadata. HTTP200 alone is not a successful paid result: inspect `isError` and structured content.

The separate Web free-trial pilot is enabled in 3.0.0 within finite shared capacity. Read root `free_trial.enabled` or `GET /v2/trial` before use. Send `X-Fresh402-Trial-Key` and a persisted per-call `Idempotency-Key` in HTTP transport headers. Exact input/key replay shares the REST result and quota; there is no automatic payment fallback. Do not mix trial and financial credentials. [Trial guide](FREE_TRIAL.md).

## Finalized Base observation pilot

`fresh402_contract_watch`, `fresh402_wallet_watch` and `fresh402_token_facts` add three paid tools, for eight total including free Register. Prices are $0.010 / $0.020 / $0.010 USDC. Read their live schemas and the [API pilot reference](API.md#finalized-base-observation-pilot). They use finalized, hash-pinned single-provider observations with bounded scope; no safety score, trading or full-history guarantee. Native-provider application acceptance and mocked official-SDK financial tests are separate evidence; no fresh mainnet blockchain settlement is claimed.

Standard first purchases need no Fresh402 recovery header or preflight. On success, save the optional private capability from `X-Fresh402-Recovery-Token` (REST) or `result._meta["fresh402/recovery-token"]` (raw MCP). For protection if the **entire response is lost**, generate and privately persist a random 32-byte hex/base64url token before submission and send it as that header/metadata. Recover using the exact original input, proof, transport, origin and private token for at most seven days. A public signature/nonce/transaction hash is not recovery authorization. Proof-only replay of the same recorded operation returns 409 without another settlement or private result. If both the response and the private capability are lost, automatic private-result recovery is unavailable; preserve the evidence and contact support rather than signing a replacement. This is not a universal exactly-once guarantee across new authorizations. Provider failure/partial scans are not paid successes. Existing prepaid packages do not automatically grant these services: eligible all-service credits or separate original tariff 4 grants cost 4/8/4. The separate machine trial can admit bounded blockchain work; the human Web trial does not. Existing Web tool names, paths, prices and credits are unchanged.

Separate machine-agent trial access is advertised by root `machine_trial.enabled` and `/v3/agent-trial`. When enabled, use its privately stored `fm_` credential in the existing trial HTTP header and one persisted `Idempotency-Key` per logical operation; the same eight tool names remain. See [machine trial](MACHINE_TRIAL.md). [All-service packages and controlled replenishment](AUTO_REPLENISH.md) are independently gated; existing package rights and payment safeguards remain unchanged.

## Maintained third-party clients

Verified in an isolated synthetic server: `@x402/mcp@2.29.0`, `agents@0.32.0` `withX402Client`, `@x402/fetch@2.29.0`, `mppx@0.17.0`, and MCP SDK `1.32.2`, across all seven services. This is not fresh mainnet settlement evidence. The standard object PaymentPayload remains accepted; the Agents encoded envelope and `_meta["x402/error"]` quote alias are additionally supported. The official x402 wrapper uses `callTool(name, arguments)` and returns its payment receipt separately; its `onAfterPayment` callback exposes the raw result metadata for optional recovery storage. Generic MCP clients can use free evaluation but need a payment-capable wallet/client and spending authorization to pay.
