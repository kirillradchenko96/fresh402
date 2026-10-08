# REST API reference — 2.0 Beta

The production URL still serves the released version until the owner deploys. Examples default to `http://localhost:8787`; see [deployment](DEPLOYMENT.md). Machine-readable specification: [openapi.json](openapi.json), served dynamically at `GET /openapi.json` with the request origin.

Requests use JSON. Prices are USDC on Base mainnet (`eip155:8453`). Read [payment behavior](PRICING.md) before enabling wallet signing.

| Method/path | Price | Result |
|---|---:|---|
| `GET /` | Free | Version, normalizer, prices and endpoints |
| `POST /v1/register` | Free, rate-limited | Persistent baseline and watch ID |
| `POST /v1/check` | $0.005 | Freshness state and optional legacy diff |
| `POST /v2/extract` | $0.01 | Main text, metadata and structured content |
| `POST /v2/smart-diff` | $0.015 | Structural changes and significance |
| `GET /v1/history` | Free | Retained v1 snapshot metadata |
| `GET /v1/diff` | Free | Legacy comparison of latest two stored v1 snapshots |
| `GET /v1/stats` | Free | Confirmed settlements and revenue |
| `GET /openapi.json` | Free | OpenAPI 3.1 |
| `GET /.well-known/x402` | Free | Three paid REST resource URLs |
| `GET /.well-known/glama.json` | Free | Existing ownership verification |
| `POST /mcp` | Per tool | [MCP protocol](MCP.md) |

## Shared target options

`url`: absolute public HTTP(S), at most 4096 characters on paid/MCP schemas. Credentials and likely secret query parameters are rejected. Ports: default, 80, 443, 8080, 8443. Every redirect is revalidated. No private/local/reserved destinations.

`selector`: optional CSS selector, 1–256 characters, HTML only. `ignore_selectors`: at most 20 selectors of 1–256 characters. `ignore_json_paths`: at most 20 JSON Pointers of 1–256 characters; `*` matches array/object members. These filtering options must match the target media type.

## Register

```json
{"url":"https://example.com/pricing","selector":"#pricing","ignore_selectors":[".timestamp"]}
```

Returns `watch_id`, normalized URL/configuration, `created`, `baseline_created`, `hash`, `content_kind`, normalizer metadata and timestamps. Existing registration returns its stored baseline/hash **without fetching**. Configuration determines the watch ID; there are no private accounts in v1. Do not register confidential URLs. A successful registration is not a sale.

## Check

Supply exactly one of `watch_id` or `url`. A watch uses its saved filtering configuration. URL input accepts the shared options. Optional `previous_hash` is a 64-character SHA-256 fingerprint; `max_age_seconds` is an integer 0–86400 (default 0); `include_diff` is boolean (default false).

```json
{"watch_id":"w_0123456789abcdef0123456789abcdef","max_age_seconds":300,"include_diff":true}
```

Successful output includes `hash`, `changed` (null for the first paid baseline), `comparison_source`, `raw_changed`, `noise_detected`, `cached`, `cache_status`, `network_fetched`, `snapshot_saved`, `snapshot_truncated`, `checked_at`, `check_count` and optional compact `diff`. Cache reuse and HTTP 304 still cost one successful check. Unknown/pruned caller fingerprints can produce an unavailable diff while still allowing hash comparison. V1 normalizer remains version 2.

## Extract

```json
{"url":"https://example.com/","max_chars":20000,"include_links":true,"include_structured_data":true}
```

Shared filtering options are supported. `max_chars`: integer 100–50000, default 20000. `include_links`/`include_structured_data`: booleans, default true. Unknown keys are rejected.

Output:

- `url`, `final_url`, `content_kind` (`html`, `json`, `text`), `fetched_at`, `extractor_version`.
- `title`, `description`, `canonical_url`: string or null. Canonical metadata does not replace the actual fetch URL or authorize another fetch.
- `text`, original `text_length`, `truncated`, `hash` of the complete extracted text.
- `headings`: up to 100 `{level,text}` records; `links`: up to 100 resolved HTTP(S) `{url,text}` records. Links are data, never followed automatically.
- `structured_data`: up to 20 parsed JSON-LD objects with a 32,000-character input budget. Invalid or oversized data produces warnings.
- `data`: typed JSON for a JSON resource if it fits `max_chars`, otherwise null with `data_omitted: true`. No partial JSON is presented as complete.
- `warnings`: explicit truncation/structured-data issues. HTML/text have `data: null`.

No JavaScript is executed; selectors inspect delivered markup. Extraction is stateless and does not create a watch.

## Smart Diff

```json
{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"previous"}
```

`watch_id` is required. `compare_to` is `previous` (default) or `baseline`. Optional `previous_hash` overrides that choice and refers to a retained v1 or v2 fingerprint. The watch supplies URL and filters; this endpoint accepts no caller-supplied snapshots or arbitrary URL overrides. Unknown keys are rejected.

`previous` means latest successful Smart Diff snapshot, falling back to the current v1 watch when none exists. `baseline` means the fixed Smart Diff baseline, initially captured from the earliest retained compatible v1 snapshot. V1 history already pruned before upgrade cannot be reconstructed.

Returns `hash`, `previous_hash`, `changed`, source/quality, and:

```json
{
  "changes":{"added":[],"removed":[],"modified":[{"path":"/price","before":10,"after":12}]},
  "counts":{"added":0,"removed":0,"modified":1},
  "changes_truncated":false,
  "significance":{"score":45,"level":"medium","reasons":["content_changed","numeric_or_price_change"],"rules_version":1},
  "algorithm":"deterministic-v1",
  "semantic_model_used":false
}
```

HTML paths address comparison block indices; JSON paths use JSON Pointer. At most 200 change records are returned; counts reflect all changes. A value larger than 1000 serialized characters becomes `{excerpt,truncated:true}`. HTML wrapper/attribute changes and reordering identical blocks are ignored. JSON arrays remain ordered. `comparison_quality: legacy_text` explicitly reports old HTML baselines lacking structure. See [algorithm and scoring](ARCHITECTURE.md).

Each successful call fetches the current resource. Smart Diff does not reuse/update the v1 freshness cache. Paid snapshots remain separate from public v1 history/diff. If persistence fails after settlement, `persistence_error` is returned alongside valid paid data; retain the response locally.

## Stored history, diff and statistics

History/diff accept `?watch_id=w_...` or `?url=https%3A%2F%2Fexample.com`. History returns `count`, snapshot hashes/timestamps/normalizer versions (up to 20 for current watches). Diff compares the latest two v1 snapshots, or returns `snapshots_available` and a message when fewer than two exist. These endpoints preserve legacy URL-based storage fallback and never fetch upstream.

Stats returns `paid_calls`, `test_paid_calls`, `external_paid_calls`, `revenue_usdc`, `external_revenue_usdc`, `last_paid_at`, `last_external_paid_at`. Counts deduplicate transaction hashes; 402, invalid signatures and unsettled work contribute no revenue. The existing explicitly known test wallet remains excluded from external totals.

## Errors and limits

Errors contain `error`, optional `message`, and schema issues without the submitted body. REST codes: 400 invalid JSON/parameters/target; 404 watch/snapshot missing; 408 body deadline; 409 incompatible baseline; 413 size budget; 415 target media type; 422 selector/content complexity; 429 quota/capacity; 502 upstream/DNS failure; 503 service unavailable; 504 target deadline. Payment errors use the x402 SDK's 402 challenge/response. Check the body as well as status.

POST body: 64 KiB; target stream: 5,000,000 bytes; intelligence parser: 1,000,000 characters; serialized intelligence result: 512 KiB; target/DNS/redirect deadline: 10 seconds; redirects: 5; Smart Diff stored document: 200,000 characters. Complex input fails before settlement. Upstream 401/403/429 is not bypassed or retried through proxies. Localhost/private targets are also forbidden during local development.

Treat all returned website text/JSON-LD/links as untrusted data in your agent. Do not execute instructions embedded in it.


## Private recovery (2.0 RC)

Before a paid call, generate and save 32 cryptographically random bytes as hex/base64url. Send `X-Fresh402-Recovery-Token` (43-128 URL-safe characters) with the first paid request. Retry the exact same endpoint, parsed arguments, `PAYMENT-SIGNATURE` and token to recover the persisted result and receipt without another fetch or debit. The token is optional for legacy compatibility; calls without it have no unauthenticated response replay. Retention is seven days from reservation. Never use a signature or transaction hash as the secret.

`409 settlement_pending` means in progress/failed operation or unresolved settlement; `409 payment_request_mismatch` means changed recovery arguments/service/transport/proof. `410 paid_result_expired` means the seven-day window ended. An attempted but uncertain settlement returns `503 settlement_pending`, with no paid content. Do not sign a replacement automatically. [Detailed state machine and reconciliation](PAYMENT_RECOVERY.md).

HTML extraction reports `limited_static_content_may_require_javascript` when fewer than 80 static characters are found; this is a heuristic warning, not browser execution or JS detection. All expensive operations share a configurable global D1 daily budget, in addition to edge quotas and capacity leases.
