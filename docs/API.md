# Fresh402 2.5.1 public API

Base URL: https://fresh402.kirilllabs.workers.dev

The hosted service reports version **2.5.1**. [Live OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json) is the authoritative contract for field constraints, defaults, schemas and response codes. These examples describe public client behavior and contain no payment credentials.

| Operation | Method and path | MCP tool | Price |
|---|---|---|---:|
| Register | POST /v1/register | fresh402_register | Free |
| Check | POST /v1/check | fresh402_check | $0.005 USDC |
| Extract | POST /v2/extract | fresh402_extract | $0.01 USDC |
| Smart Diff | POST /v2/smart-diff | fresh402_smart_diff | $0.015 USDC |
| OpenAPI Contract Diff | POST /v2/openapi-contract-diff | fresh402_openapi_contract_diff | $0.020 USDC |

## Register

```json
{"url":"https://example.com/","ignore_selectors":[".timestamp"]}
```

Creates a baseline for a new watch, returning `watch_id`, `hash`, `content_kind`, `created` and `baseline_created`. Existing identical registrations return the stored baseline without refetching. Optional `selector`, `ignore_selectors` and `ignore_json_paths` establish its normalization scope. JSON Pointer ignore rules support wildcard segments. Re-registering is not a free refresh.

## Check

```json
{"watch_id":"w_0123456789abcdef0123456789abcdef","max_age_seconds":300,"include_diff":true}
```

Provide exactly one of `watch_id` or `url`. The example watch ID is illustrative; use the ID returned by Register. Optional `previous_hash`, selector and ignore rules let a client specify the comparison and scope. The result includes the current hash, `changed`, cache and fetch indicators, and an optional compact deterministic text diff. `max_age_seconds` permits reuse of sufficiently fresh shared state; the call remains paid.

## Web Extract

```json
{"url":"https://example.com/","max_chars":20000,"include_links":true,"include_structured_data":true}
```

Extract text, title, description, canonical URL, headings, links and JSON-LD where present. HTML, JSON and text are supported. Optional CSS scoping and ignore rules apply. `max_chars` ranges from 100 to 50000; truncation and warnings are explicit. No page JavaScript or browser rendering is used.

## Smart Diff

```json
{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"baseline"}
```

Requires a registered watch. `compare_to` is `previous` (default) or `baseline`; an optional `previous_hash` selects a retained comparison. Results expose structured added, removed and modified changes, counts, truncation, comparison quality and significance with score, level, reasons and rules version. The algorithm uses deterministic structural and significance rules, with no LLM inference. Legacy comparisons can have lower fidelity; inspect `comparison_quality` and warnings.

## Free reads and discovery

- `GET /`: version, health, endpoint and standalone x402 prices, plus additive `prepaid_packages` discovery. Package IDs and integer credit amounts match `/v2/prepaid/plans`; `enabled` reflects public purchasing availability. Packages are one-time purchases with non-expiring credits, not subscriptions. Existing root fields and values are unchanged.
- `GET /openapi.json`: OpenAPI 3.1 reference.
- `GET /.well-known/x402`: all four paid REST resource URLs.
- `GET /v1/history?watch_id=...`: retained legacy snapshot metadata.
- `GET /v1/diff?watch_id=...`: a legacy deterministic diff of retained v1 snapshots, without a target fetch.
- `GET /v1/stats`: public confirmed-settlement statistics.
- `POST /mcp`: free protocol and tool discovery, free Register, and the four paid tools.

Legacy public history/diff is separate from paid Smart Diff results. MCP uses POST; GET /mcp returns 405.

## OpenAPI Contract Diff

Register an external supported JSON OpenAPI document without content rules, for example:

```json
{"url":"https://petstore3.swagger.io/api/v3/openapi.json"}
```

Fresh402's own `/openapi.json` describes this service for discovery; it cannot be registered as a target. Use the real returned watch ID in `{"watch_id":"YOUR_RETURNED_WATCH_ID","compare_to":"baseline"}` at `/v2/openapi-contract-diff`. The result reports bounded contract changes, classifications, warnings and source provenance. Classifications are descriptive; remote `$ref` documents are not fetched. Inspect live limits and schemas before paying.

For wallet-owned prepaid accounts and automatic finalized-funding recovery, see [self-service](SELF_SERVICE.md). Check live `/v2/prepaid/plans` availability before signing any payment.

## Payment and recovery

Payment is **x402 v2**, scheme **exact**, native **USDC on Base mainnet** (`eip155:8453`, chain ID 8453). The asset is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; the receiving address currently advertised is `0x58B4b483fBE31860335eCeB12CCCF4338b251085`. Always validate the current challenge before signing.

An empty unsigned POST to any of the four paid REST resources returns a discovery challenge without executing the operation. The challenge's schema still requires the actual application input. Supplied malformed or unsafe input can be rejected before payment. A signed request requires valid input and existing watch/comparison prerequisites before settlement; completed private recovery retains its original result semantics. Smart Diff clients must register first and use the returned watch ID.

1. Submit the intended request without payment and read its HTTP 402 `PAYMENT-REQUIRED` header (Base64 JSON).
2. Check resource URL, network, asset, recipient, exact atomic amount (5000 / 10000 / 15000 / 20000), expiry and input. Preserve the advertised `resource` and `extensions`, including `bazaar`, in the payment payload as specified by x402.
3. Persist a private recovery token generated from 32 cryptographically random bytes, encoded as hex or Base64url. Follow the live OpenAPI length and format constraints; send it in `X-Fresh402-Recovery-Token` on the payment attempt and retries.
4. Let an x402-compatible wallet client sign the exact USDC authorization. Never export or send the wallet seed phrase or private key, and do not request unlimited approvals.
5. Retry identical input with `PAYMENT-SIGNATURE` (Base64 x402 PaymentPayload JSON). A confirmed paid result carries a Base64 `PAYMENT-RESPONSE` receipt.
6. For recovery, keep the original request, payment and token. Retained results can be recovered for seven days without another settlement. HTTP 503 settlement-pending responses require retry/reconciliation with the original authorization, not a replacement payment. An expired retained result can return 410.

Do not place a recovery token in a URL or log. A public transaction hash or payment signature alone is not a private recovery credential. For MCP transport and metadata keys, see [MCP.md](MCP.md).

## Limits and errors

Targets must be external public HTTPS URLs on port 443 without embedded credentials. Fresh402's own service URLs, private addresses and unsafe redirects are rejected. Requests are on demand; there is no continuous monitoring, authenticated-site access or push alert service. Payload, target, stored-content and output limits apply.

HTML UI pruning applies automatically without an explicit scope. An explicit CSS selector preserves its visible scope; use ignore rules for noise inside it. Scripts, styles and hidden content remain excluded. JSON processing is bounded to 64 nesting levels and 10,000 nodes before normalization/storage. Corrected pruning may make previously omitted content visible to an existing watch on its next check; watch IDs, retained snapshots and previously paid responses are preserved.

Use the documented error code and message: 400/422 invalid input or comparison; 404 missing watch; 408/504 timeout; 413 oversized data; 415 unsupported media; 429 rate, concurrency or operation budget; 409 pending or mismatched recovery; 503 unavailable service or pending settlement. Do not automatically create a new payment in response to uncertainty.

For browserless EOA enrollment, exact package purchase, bounded early credits, finalized recovery and shared REST/MCP credit execution, use the [agent purchasing guide](AGENT_PREPAID.md). Follow live availability; early inclusion is not finality.

## Native MPP option

Read root `mpp_payments` for current enablement. The four existing per-call routes additionally offer `WWW-Authenticate: Payment`, accept native Base USDC EVM `Authorization: Payment` credentials and return `Payment-Receipt`. Existing x402 and prepaid schemas/prices are preserved. Never combine credentials. See [MPP](MPP.md) for exact body/resource binding, SDK examples, package opt-in and recovery.

Circle Gateway is a separate optional x402 rail, not an MPP method. It is disabled pending acceptance; consult root `circle_gateway.enabled` and the [Circle Gateway guide](CIRCLE_GATEWAY.md). A Gateway transfer UUID is not a direct onchain receipt.
