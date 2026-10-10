# Fresh402 2.0 MCP integration

Canonical endpoint: **https://fresh402.kirilllabs.workers.dev/mcp**.
Transport: **Streamable HTTP**. Official Registry identity: **io.github.kirillradchenko96/fresh402**.

Add the canonical URL through your client's remote HTTP MCP connector. A client configuration that supports URL-based remote servers can use:

```json
{"mcpServers":{"fresh402":{"url":"https://fresh402.kirilllabs.workers.dev/mcp"}}}
```

Clients that accept only local stdio commands need a compatible HTTP connector. Discovery and Register are free; paid calls require x402 support as well as MCP support.

## Nonpaying handshake and discovery

Send JSON-RPC POST requests with `Content-Type: application/json` and `Accept: application/json, text/event-stream`. A response may be JSON or SSE; parse the JSON-RPC envelope rather than relying only on the HTTP code.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0.0"}}}
```

Inspect the negotiated protocol version and `serverInfo.version`. This compatibility handshake was verified against the hosted 2.0.0 service. Use the MCP client's normal initialization and notification sequence.

```json
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
```

The service is sessionless; GET /mcp is not supported. Follow the live tool schemas, including any metadata required by your negotiated MCP version.

| Tool | Purpose | Price |
|---|---|---:|
| fresh402_register | Create/retrieve a persistent baseline; existing watches do not refetch | Free |
| fresh402_check | URL/watch freshness, filtering and optional compact text diff | $0.005 USDC |
| fresh402_extract | Text, metadata, headings, links and JSON-LD extraction | $0.01 USDC |
| fresh402_smart_diff | Structural changes and explained deterministic significance | $0.015 USDC |

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

Validate exact USDC amounts, Base mainnet, recipient and resource before a payer-controlled wallet signs. The client retries the same `tools/call` with the PaymentPayload in `params._meta["x402/payment"]`, preserving advertised resource and extensions. Put the pre-persisted private recovery token in `params._meta["fresh402/recovery-token"]`.

Successful settlement exposes `result._meta["x402/payment-response"]`; inspect the structured result and receipt. Retrying identical input/payment/token recovers a retained result without a second settlement. If settlement is pending, retain those same values and do not sign a replacement. Never log the token or authorization signature.

The API processes public HTTPS HTML, JSON and text on demand. Extraction does not render a browser or execute JavaScript, and Smart Diff uses deterministic rules rather than an LLM. See [API.md](API.md) and [PRICING.md](PRICING.md).
