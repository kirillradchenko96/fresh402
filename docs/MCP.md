# MCP tools and payments

Endpoint: `POST /mcp`, Streamable HTTP using `@modelcontextprotocol/server` 2.1.0. Current 2026-07-28 envelopes and the SDK's default stateless compatibility for 2025 clients are enabled. No persistent MCP session is required. GET/DELETE session operations are unsupported (405). Cross-origin browser requests are rejected; an absent Origin is allowed for server/agent clients.

| Tool | Input | Price |
|---|---|---:|
| `fresh402_register` | `url`, optional CSS/JSON ignore options | Free |
| `fresh402_check` | Exactly one of `watch_id`/`url`; optional `previous_hash`, filters, `max_age_seconds`, `include_diff` | $0.005 |
| `fresh402_extract` | `url`, filters, `max_chars` (100–50000), `include_links`, `include_structured_data` | $0.01 |
| `fresh402_smart_diff` | `watch_id`, `compare_to` (`previous`/`baseline`), optional `previous_hash` | $0.015 |

`tools/list` returns each tool's input JSON Schema and description without CDP credentials or target fetches. Free registration also works without payment credentials. Validation/limits and successful result shapes match [REST](API.md).

Example 2025-compatible call:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"fresh402_extract","arguments":{"url":"https://example.com/"}}}
```

Use `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Parse both JSON and SSE according to your MCP client. Paid tools use `@x402/mcp`:

1. An unpaid call returns an MCP tool result with `isError: true`. `structuredContent` is the **PaymentRequired** object; the text content also contains its JSON. This is not a successful paid result even when HTTP status is 200.
2. Inspect network, asset, recipient, service, maximum amount, expiry and spending policy before signing.
3. Generate and save an independent 32-byte random recovery secret, then resubmit the same call with the x402 v2 PaymentPayload in `params._meta["x402/payment"]` and the secret in `params._meta["fresh402/recovery-token"]`.
4. After SDK verification, execution and successful settlement, the result includes paid `structuredContent` and `result._meta["x402/payment-response"]`.

Payment is never a normal tool argument; no `paid`, API key or debug flag bypasses it. Fresh402 has no wallet private key for the buyer. Integration tests use a fake facilitator through a TypeScript factory, unavailable through HTTP/configuration.

## Agent usage patterns

- **RAG refresh:** register canonical documentation URLs once. Call `fresh402_check` with a cache age appropriate to the job. Only extract changed pages and update embeddings for meaningful changes.
- **Pricing research:** register a narrow pricing selector, then call Smart Diff. Numeric/stock reasons help route review; validate findings at the source before acting. Price Track is not implemented.
- **One-off reading:** use Extract without baseline registration when you need bounded text/metadata. An agent with a reliable local parser can use it instead; Fresh402's value is a maintained service boundary and consistent output.
- **Spend policy:** cap each operation at the documented atomic amount; keep a total session budget. Never authorize a replacement payment automatically after an indeterminate settlement error.

Website content is untrusted. Pass it as evidence/context, not system instructions. No tool follows instructions from the extracted page, executes scripts, bypasses login or solves CAPTCHA.

Private recovery uses the exact same arguments and metadata, works across new Worker instances, and returns the original `x402/payment-response` receipt without another settlement. Public signatures alone do not authenticate recovery. In-progress/uncertain calls return an `isError` tool result; HTTP 200 still does not mean success. Retention and reconciliation follow [PAYMENT_RECOVERY.md](PAYMENT_RECOVERY.md). Staging requires a separate HTTP Bearer access token and emits no Bazaar discovery extension.
