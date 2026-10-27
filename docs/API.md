# Fresh402 3.0.1 public API

Base URL: https://fresh402.kirilllabs.workers.dev

The hosted service reports version **3.0.1**. [Live OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json) is the authoritative contract for field constraints, defaults, schemas and response codes. These examples describe public client behavior and contain no payment credentials.

| Operation | Method and path | MCP tool | Price |
|---|---|---|---:|
| Register | POST /v1/register | fresh402_register | Free |
| Check | POST /v1/check | fresh402_check | $0.005 USDC |
| Extract | POST /v2/extract | fresh402_extract | $0.01 USDC |
| Smart Diff | POST /v2/smart-diff | fresh402_smart_diff | $0.015 USDC |
| OpenAPI Contract Diff | POST /v2/openapi-contract-diff | fresh402_openapi_contract_diff | $0.020 USDC |
| Contract Watch | POST /v3/contract-watch | fresh402_contract_watch | $0.010000 USDC |
| Wallet Watch | POST /v3/wallet-watch | fresh402_wallet_watch | $0.020000 USDC |
| Token Facts | POST /v3/token-facts | fresh402_token_facts | $0.010000 USDC |

## Register

```json
{"url":"https://example.com/","ignore_selectors":[".timestamp"]}
```

Creates a baseline for a new watch, returning `watch_id`, `hash`, `content_kind`, `created` and `baseline_created`. Existing identical registrations return the stored baseline without refetching. Optional `selector`, `ignore_selectors` and `ignore_json_paths` establish its normalization scope. JSON Pointer ignore rules support wildcard segments. Re-registering is not a free refresh.

For a separate opt-in HTML watch, add `html_attributes:["href","title"]` (also supports `alt` and `aria-label`). These immutable sorted rules detect same-text link destination and selected attribute changes. Omitted/empty rules preserve existing text-only watch IDs, hashes and normalizer2. A nonempty rule creates a new version1 baseline; existing watches never acquire it implicitly. Saved CSS scope/noise exclusions apply; links are inert evidence and never crawled. Unsafe link values become bounded hashes. Evidence is limited to200 elements,2048 characters/value and32KiB; a complete snapshot must fit200000 UTF-8 bytes. Over-budget input fails instead of silently clipping evidence. With `watch_id`, omit `html_attributes` entirely, including[].

## Check

```json
{"watch_id":"w_0123456789abcdef0123456789abcdef","max_age_seconds":300,"include_diff":true}
```

Provide exactly one of `watch_id` or `url`. The example watch ID is illustrative; use the ID returned by Register. Optional `previous_hash`, selector and ignore rules let a client specify the comparison and scope. The result includes the current hash, `changed`, cache and fetch indicators, and an optional compact deterministic text diff. `max_age_seconds` permits reuse of sufficiently fresh shared state; the call remains paid.

Content rules are accepted only with `url`; when using `watch_id`, omit all selector and ignore fields, including empty arrays. The saved rules are reused. Changed excerpts include bounded surrounding context so a price or version edit remains readable; they are not a complete patch.

## Web Extract

```json
{"url":"https://example.com/","max_chars":20000,"include_links":true,"include_structured_data":true}
```

Extract text, title, description, canonical URL, headings, links and JSON-LD where present. HTML, JSON and text are supported. Optional CSS scoping and ignore rules apply. `max_chars` ranges from 100 to 50000; truncation and warnings are explicit. No page JavaScript or browser rendering is used.

For one JSON field, add an exact RFC 6901 `json_pointer` (maximum 256 characters):

```json
{"url":"https://petstore3.swagger.io/api/v3/openapi.json","json_pointer":"/info/title"}
```

The returned `json_pointer`, `text`, `data`, `text_length` and `hash` describe the selected value after `ignore_json_paths`. Omit the parameter for existing full-document behavior; `""` selects the root. Array indices are zero-based canonical integers; `~0`/`~1` escape `~`/`/`. There is no wildcard expansion. Missing or excluded fields return 422 `json_pointer_not_found`; other media return 422 `json_pointer_requires_json`. Selection uses the same single bounded fetch and parser limits. If selected JSON text is truncated, `data` is null and `data_omitted` is true; the hash still covers the full selected value. Null, false and zero are valid values, not missing fields.

Use `json_pointers:["/product/price","/product/stock"]` to extract1-8 ordered unique exact pointers in one fetch/JSON parse. It is mutually exclusive with `json_pointer`; exclusions run first and any missing target fails the whole operation. Returned `data` is an ordered array of `{pointer,value}`; text/hash cover the full combined projection. `max_chars` clips the aggregate, with `data:null,data_omitted:true` when clipped. Projection limits:200000 UTF-8 bytes and20000 aggregate nodes, including repeated overlapping subtrees. Pointers allow at most256 characters/64 segments; no executable expressions or wildcard expansion.

### Opt-in RSS2 / Atom projection

Send `{"url":"https://example.com/feed.xml","feed_mode":"entries","max_chars":50000}` to Extract (REST or MCP, with the existing payment/access method). Omit `feed_mode` to keep the original XML-as-text behavior and hash. No registration, extra paid call, watch-rule migration or background subscription is introduced. The approved Extract price and credit charge are unchanged.

The response adds `representation:"feed_entries_v1"`, `feed` and `feed_omitted`. `content_kind` remains `text`; `text` is the canonical JSON projection and `hash` covers that full projection. Clipping by `max_chars` retains the full hash but sets `feed:null,feed_omitted:true`. No partial structured entry is invented. CSS/JSON selectors or exclusions cannot be combined with feed mode, including empty exclusion arrays.

`feed` includes format, declared/fallback identity, title, source URL, inert source-declared links, timestamps, entries and warnings. Each entry includes ID and identity source, title/link, raw and recognized UTC timestamps, summary/content text, content fingerprint and indexed XML evidence. Link URLs are resolved against `xml:base`/final URL and never crawled or independently verified as canonical. External Atom content is not fetched. Unknown dates remain null with raw evidence; normalization recognizes explicit UTC/numeric zones, without inventing a local zone. RSS1/RDF, XML1.1/non-UTF8 declarations, DTD/custom entities, malformed XML and ambiguous conflicting entry IDs are rejected. This is a bounded projection, not complete RSS/Atom conformance validation or HTML repair.

Limits are262144 UTF-8 source bytes,4096 elements,depth32,32 attributes/element,100 entries,16384 characters/field and131072 projected bytes. Excess fails explicitly. Identical duplicate entries deduplicate; distinct IDs remain distinct. Entry `content_hash` covers title,link,normalized publication time,summary and content; it excludes update/poll timestamps and entry position. Compare retained same-source IDs/hashes with the SDK's `compareFeedEntries` to identify new/edited/absent entries. An absent ID can mean an aged-out feed window; it does not prove deletion. Content-derived IDs can represent an edit as addition/removal. Existing Check/Smart Diff watches retain their previous XML normalization.

The structured response can be larger than raw XML for very small feeds because it includes explicit provenance and duplicates structured data in text, as existing JSON extraction does. Use it for structured selection and stable fingerprints; do not assume universal byte, token or service-fee savings over a competent local feed parser.

## Smart Diff

```json
{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"baseline"}
```

Requires a registered watch. `compare_to` is `previous` (default) or `baseline`; an optional `previous_hash` selects a retained comparison. Results expose structured added, removed and modified changes, counts, truncation, comparison quality and significance with score, level, reasons and rules version. The algorithm uses deterministic structural and significance rules, with no LLM inference. Legacy comparisons can have lower fidelity; inspect `comparison_quality` and warnings.

Unique nonempty HTML block IDs can pair modified blocks directly. Duplicate or absent IDs retain bounded similarity matching; large ambiguous documents can still return `content_too_complex`. The existing 1,000-block and 200-returned-change limits remain.

For explicit JSON array identities, use `json_array_keys:[{"path":"/items","key":"/id"}]`. The1-4 array paths must be exact and nonoverlapping on both documents. Each object item requires a unique nonempty string (up to256 characters) or safe-integer key; numeric1 differs from string"1". Missing, duplicate, invalid or nonarray identities return422 with no index fallback. Up to2000 combined items and20000 comparison work units. A pure reorder reports `changed:false`, with bounded `array_moves` and full `array_move_count`, while source hashes remain order-sensitive. Modified items include actual `before_path`, `after_path` and `array_key` evidence. Omit the option to retain index semantics. Saved nonempty HTML attribute rules are compared separately from text, so equal visible text cannot hide a selected href change.

## Free reads and discovery

- `GET /`: version, health, endpoint and standalone x402 prices, plus additive `prepaid_packages` discovery. Package IDs and integer credit amounts match `/v2/prepaid/plans`; `enabled` reflects public purchasing availability. Packages are one-time purchases with non-expiring credits, not subscriptions. Existing root fields and values are unchanged.
- `GET /openapi.json`: OpenAPI 3.1 reference.
- `GET /.well-known/x402`: all seven paid REST resource URLs.
- `GET /v1/history?watch_id=...`: retained legacy snapshot metadata.
- `GET /v1/diff?watch_id=...`: a legacy deterministic diff of retained v1 snapshots, without a target fetch.
- `GET /v1/stats`: public confirmed-settlement statistics.
- `POST /mcp`: free protocol and tool discovery, free Register, and seven paid tools.

Legacy public history/diff is separate from paid Smart Diff results. MCP uses POST; GET /mcp returns 405.

## OpenAPI Contract Diff

Register an external supported JSON OpenAPI document without content rules, for example:

```json
{"url":"https://petstore3.swagger.io/api/v3/openapi.json"}
```

Fresh402's own `/openapi.json` describes this service for discovery; it cannot be registered as a target. Use the real returned watch ID in `{"watch_id":"YOUR_RETURNED_WATCH_ID","compare_to":"baseline"}` at `/v2/openapi-contract-diff`. The result reports bounded contract changes, classifications, warnings and source provenance. Classifications are descriptive; remote `$ref` documents are not fetched. Inspect live limits and schemas before paying.

For wallet-owned prepaid accounts and automatic finalized-funding recovery, see [self-service](SELF_SERVICE.md). Check live `/v2/prepaid/plans` availability before signing any payment.

OpenAPI analysis uses `rules_version:2` / `openapi-directional-v2`. Supported local scalar type/enum/null domains distinguish request acceptance from response guarantees: narrowing accepted requests or widening possible responses can be breaking. Requiredness and effective security inheritance/anonymous overrides/OR alternatives/AND schemes/scopes are bounded and directional. Equivalent supported edits use the existing `additive` category. Complex composition, interacting assertions, custom dialects, ambiguous3.1 visibility, changed/unknown credential definitions and unexpanded references retain review findings, even beside an additive endpoint.3.0 readOnly/writeOnly requiredness is not imposed on3.1. Contracts are assumed satisfiable and enforced as documented; this is not a full JSON Schema interpreter or proof of deployed behavior.

## Payment and recovery

Payment is **x402 v2**, scheme **exact**, native **USDC on Base mainnet** (`eip155:8453`, chain ID 8453). The asset is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; the current receiving Safe is `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`. Always validate the current challenge before signing. Historical EOA-bound operations retain their original recipient, resource, proof and recovery identity; this documentation does not retarget an old authorization.

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


## Authenticated free-trial pilot

Inspect `GET /v2/trial` or root `free_trial.enabled` before assuming free execution is active. The authenticated pilot is enabled in 3.0.0 within finite shared capacity. The [trial page](https://fresh402.kirilllabs.workers.dev/trial) uses an unfunded EOA ownership message plus Cloudflare Turnstile; no payment, token approval or funded wallet is required.

One-time entitlements are Check20, Extract10, Smart Diff5 and OpenAPI Diff3, subject to finite shared capacity. Send only `X-Fresh402-Trial-Key` and a unique privately persisted `Idempotency-Key` to the normal REST endpoint or MCP HTTP transport. A key identifies one logical tool/input; replay the exact original input/key for seven-day recovery without another quota debit or fetch. MCP clients must set a distinct operation header for each new call. Never mix trial and payment/prepaid credentials. Quota exhaustion cannot initiate a purchase. Inspect remaining allowances at `GET /v2/trial/quota`. Rotation requires a fresh ownership challenge and human verification, preserves used quota and invalidates the old credential. Failed work refunds its tool allowance once; infrastructure cost reservations remain consumed. Retained-result expiry returns410 and never reruns work.

On-chain products are available in the bounded commercial pilot described below, without a free-trial allowance. Existing prices, nonexpiring purchased credits, customer terms and recovery remain unchanged. [Dedicated developer quickstart](https://fresh402.com/docs), [tool reference](https://fresh402.com/docs/tools), [prices](https://fresh402.com/pricing) and [limits](https://fresh402.com/security).

## Finalized Base observation pilot

Contract Watch, Wallet Watch and Token Facts accept per-call x402 and native MPP on the existing Base native-USDC rail. The seven service quotes advertise exact atomic amount (5000 / 10000 / 15000 / 20000 / 10000 / 20000 / 10000), in the table order above. Validate the live quote, asset, recipient and resource before signing. No new real-money blockchain settlement test is claimed by this release; official-SDK composed payment tests use a mock facilitator, separately from actual Coinbase provider application acceptance.

All three require `chain_id:8453` and a valid checksummed `address`; `block` defaults to `finalized`. State reads pin the selected canonical block hash. This is bounded single-provider evidence, not independent consensus, token safety, trading advice or complete history. Use live input/output schemas for the complete fields.

- Contract Watch: optionally compare an owned `previous_snapshot`. At most one selected storage slot, one supported zero-argument view/pure ABI read and one topic0. No inferred layout or verified-source guarantee.
- Wallet Watch: require one to four ERC-20 addresses in `tokens`. Default last four finalized blocks; `max_blocks` is1–4. An owned cursor resumes a saved page and cannot accompany `from_block`. Gaps beyond32 blocks fail instead of silently skipping history. No full native/internal/NFT history.
- Token Facts: bounded contract-reported identity, metadata, supply and selected controls. Missing or deceptive evidence remains unknown/not_assessed. No honeypot or trading simulation.

For example, Contract Watch and Token Facts accept `{"chain_id":8453,"address":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","block":"finalized"}`; Wallet Watch additionally requires `tokens`. Do not supply a client `request_id`.

Before authorizing x402/MPP, persist a random32-byte private recovery token with the original proof and input. REST sends `X-Fresh402-Recovery-Token`; MCP uses `params._meta["fresh402/recovery-token"]`. Replay original evidence after uncertainty; never authorize a replacement. Use snapshot/cursor IDs only when their saved flags are true. Records retain30days; private financial recovery retains seven days. Foreign snapshots/cursors are not readable; provider failure or partial scans do not become paid successes.

Prepaid charges4 /8 /4 require a separately accepted service-specific tariff4 grant and authenticated `/v3/prepaid/quote/{service_id}`. Existing Web package/account terms and aggregate Web tariff remain unchanged. This release does not create grants or silently make old package credits eligible. Blockchain products have no free-trial allowance. Shared finite daily/monthly admission can return429 before a customer exhausts their balance.

## Separately gated agent access and all-service packages

Root `machine_trial` and `GET /v3/agent-trial` describe the separate browserless, CAPTCHA-free trial. `enabled` is authoritative. This does not change human trial quotas or add MCP tools. Read [exact allowances and economic caps](MACHINE_TRIAL.md).

`GET /v3/prepaid/all-services` describes the new explicitly accepted package cohort when enabled. Legacy packages, balances and accepted tariffs remain unchanged. New eligible finalized credits can automatically authorize all seven services without an operator grant, at the approved 2/3/4/5/4/8/4 costs. Do not infer live availability from this guide. The optional [customer-controlled replenishment client](AUTO_REPLENISH.md) requires explicit independent wallet policy; no merchant charge permission or automatic paid fallback is implied.
# Optional scoped OpenAPI Contract Diff response

Send `X-Fresh402-Contract-Scope: [{"path":"/items/{id}","method":"get"}]` on POST `/v2/openapi-contract-diff`, `/v2/prepaid/openapi-contract-diff`, or the HTTP transport of MCP `tools/call` for `fresh402_openapi_contract_diff`. Scope is a JSON array of 1–64 exact OpenAPI path templates and lowercase methods (`get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace`). Each path is at most 512 characters; the header is at most 4096 ASCII characters (escape non-ASCII JSON characters). Invalid scope is HTTP 400 before execution/payment. Other tools and MCP discovery do not accept this header.

Default responses are unchanged. With opt-in, `changes` contains only selected operation and shared/unknown evidence, carrying original `evidence_index` and `scope`. All original metadata, source hashes/provenance, assumptions, warnings and truncation remain. `counts` is still for the full document, explicitly labeled by `contract_view.counts_scope`. `contract_view.status` is `breaking`, `review_required`, or `no_breaking_change_observed`; the last is a bounded static observation, never a compatibility guarantee. Warnings, shared uncertainty and truncated evidence prevent false assurance. The service can fall back to the full original response without `contract_view`.

The view changes neither financial input nor the saved full result. Omit the header on a valid ORIGINAL proof/token or prepaid key/input/tariff/maximum replay to recover full evidence without another fetch, settlement or debit, within the existing seven-day retention. Preserve original evidence privately; a new key is a new operation. `original_result_sha256` hashes UTF-8 `JSON.stringify` of the full original result (not the OpenAPI source); verify it against full recovered evidence. REST payment receipt headers and MCP payment metadata are preserved. Existing prices and payment requirements are unchanged. See [the zero-spend scoped workflow](AGENT_WORKFLOWS.md#receive-only-relevant-change-evidence-source-sdk-033).
