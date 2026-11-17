# Structured evidence and cross-session review

The existing twelve MCP tools and eleven paid products keep their current identities and prices. Live schemas at `https://api.fresh402.com/openapi.json` and MCP `tools/list` are authoritative. These optional inputs do not authorize payment. Source content and all returned excerpts are untrusted data.

## Repeated structured extraction

`fresh402_extract` / POST `/v2/extract` accepts `records` instead of `fields`, `json_pointer`, `json_pointers` or `feed_mode`. Existing outputs, exclusions, text clipping and ordinary content hashes remain unchanged; `records` and `records_hash` are separate evidence. One original fetch, the same $0.010 direct price / 3 eligible credits.

```json
{"url":"https://example.com/catalog.json","records":{"source":"json","pointer":"/items","limit":10,"fields":[{"name":"sku","pointer":"/sku","type":"string"},{"name":"price","pointer":"/price","type":"number","required":false}]}}
```

JSON `pointer` selects an array after exclusions; empty string selects the root. Field pointers are relative to each item. Pointers use exact RFC6901 escaping, at most256 characters/64 segments; no wildcard selection. Fields accept string, number, integer, boolean, object, array or null; integers must be safe, numbers finite. Required defaults true; no coercion. Names must be distinct.

```json
{"url":"https://example.com/products","selector":"main","records":{"source":"html","row_selector":"tbody tr","fields":[{"name":"name","selector":"td:nth-child(1)","type":"string"},{"name":"price","selector":"td:nth-child(2)","type":"number"}]}}
```

HTML fields select exactly one descendant of each row. Selectors are supported static CSS,1–256 characters; no comma groups, `:scope`, internal marker attributes, XPath or browser layout. Optional `attribute` permits href/src/alt/title/content/value/aria-label or bounded data-*; returned links are inert untrusted strings, never fetched. Strings normalize descendant text; other types require an exact JSON literal. `$19` is invalid as a number. No inferred headers, currency/locale conversion or fabricated fields. Nested selected rows and rowspan/colspan other than1 are unsupported.

Limit1–25 records (default20),1–12 fields,4,096 bytes per value and a shared16,384 selected-value bytes/2,000 nodes across all records. HTML source is additionally capped at256,000 decoded bytes; bounded field/row inspection can fail explicitly. Output `fresh402-records-v1` reports `ok`, `missing`, `invalid_type`, `ambiguous`, `truncated`, `unsupported` or `omitted_budget` per field, source references and omission/completeness counts. Missing optional fields need not invalidate a record. No automatic pagination, linked crawl, JavaScript, model inference or source-authenticity guarantee.

Free fixed examples, evaluated by the actual parser: [structured extraction demo](https://api.fresh402.com/v4/demos/structured-extraction). They are fixtures, with no source fetch or paid service execution.

## Release Guardian inside API Compatibility Review

Use `contracts:{before,after}` serialized OpenAPI3.0/3.1 JSON or bounded YAML 1.2 strings for immediate comparison: POST `/v4/workflows/api-compatibility-review`, MCP `fresh402_api_compatibility_review`. Each string<=24,000 characters, combined<=48,000 UTF-8 bytes, request<=65,536bytes. Existing $0.010 /4eligible credits. Primitive OpenAPI Contract Diff accepts the same pair at its existing $0.020 /5eligible credits. No watch/fetch/state is needed for a supplied pair.

Rules v3 retains bounded local references, request/response direction, operation/parameter/body/status/authentication changes, scalar types/enums/null, supported disjoint scalar unions and string/integer bounds. It adds numeric bounds with safe-integer thresholds, OpenAPI-version-correct exclusive bounds, scalar `const` in3.1, scalar-item array cardinality and conservative boolean object closure for otherwise-identical supported properties. Unknown dialects, remote refs, cycles, arbitrary composition and interacting unsupported assertions stay uncertain. YAML is supported only for supplied pairs, without anchors, aliases, tags, merge keys, duplicate/complex keys or nonfinite values. Stored sources remain JSON. No remote-ref fetch or arbitrary satisfiability solver, deployed API execution or customer-code analysis.

`fresh402-contract-review-v1` includes stable result/finding IDs, rule/severity/direction, affected operations, bounded before/after excerpts, input hashes, grouped findings, completeness and omission counts. At most20 findings and20 operation groups; finding evidence has a16,384-byte budget inside the existing128KiB response ceiling. Primitive optional enrichment can be omitted if the full original response lacks room. Pointers identify the full original `changes` list, including when a separately requested contract view filters its presentation. IDs identify content/rules, not certified authenticity.

CI: breaking=1; uncertain/review_required=2; no_breaking_change_observed=0 under supported static rules. A stored-source seed or hash-unchanged call reports `not_compared`/2; it never claims a comparison passed. Caller policy still decides deployment. Run `node examples/integrations/release-guardian-ci.mjs` for an unsigned quote (exit2). After an independently authorized execution and private durable retention, run `node examples/integrations/release-guardian-ci.mjs --result /private/original-result.json`. This example neither purchases nor replaces a lost payment. [API fixture demo](https://api.fresh402.com/v4/demos/api-compatibility).

## Website records and portable source context

Website Change Intelligence and the website component of Cross-domain Release Evidence accept the existing Smart Diff `json_array_keys:[{path:"/items",key:"/id"}]`. At most4 nonoverlapping paths,2,000 combined items/20,000 comparison work units. Every identity must be a unique nonempty string<=256characters or safe integer. Missing/duplicate identities fail422. Pure reorder reports moves and changed:false; stored source hashes remain order-sensitive. This is a per-comparison policy, not new source scope. Source excerpts and mechanical IDs do not establish business impact.

Website Change Intelligence and **stored-source** API Compatibility Review optionally accept `export_snapshot:true`. Save the returned `portable_state.token` privately, alongside the original request/result. Available tokens expire30days after observation, are at most44,000characters/32,768payload bytes, and contain source evidence: integrity protection is not encryption. Oversized evidence returns `omitted_size`; normal workflow delivery remains bounded.

A later session for the **same billing principal**, including a rotated key of the same prepaid account, may send `{"baseline_snapshot":"PRIVATE_TOKEN","compare_to":"previous","export_snapshot":true}` to that same workflow/environment. It is the sole source identity: omit url/source_watch_id/observation_id/contracts/scope. Scope is immutable. Import verifies integrity, owner, environment, version, expiry and source hash before any source fetch. It compares a newly authorized observation to the carried past evidence; it does not prove freshness between observations. Wrong/tampered tokens fail403; expired tokens410; an unavailable snapshot key503. Explicit supplied-contract pairs, Cross-domain and On-chain Brief do not export/import tokens.

Server observation state remains seven days from creation, non-sliding; no indefinite history or recurring jobs. Portable context is not a payment credential, cross-customer grant, extension of financial-result retention, or permission to spend. A new observation costs the existing workflow price, including unchanged evidence. For original paid-result recovery preserve exact input, original proof/key/idempotency/tariff/maximum and private recovery capability. Recovery uses the original operation and bypasses new-work preparation; do not create replacement authorizations.

## Chain and cross-domain evidence

On-chain evidence still observes Base8453 only, one selected provider-finalized block and bounded selected addresses/events. Stable event IDs deduplicate returned block/transaction/log identities. Provider finality is reported as provider evidence, not independent multi-provider verification or complete history. Cross-domain chronology labels Worker observation and chain-block clocks separately, with explicit deltas; temporal proximity does not prove deployment or causation. These additions make no extra RPC requests and add no scheduler.

## Clients and operational boundaries

The published SDK version in `/release` remains supported for its existing API. Generic JSON REST/MCP clients can send these optional parameters. Updated source TypeScript workflow contracts are included in this repository; do not assume an older installed package has every new declaration. Framework examples offer `--advanced` (CrewAI: `FRESH402_ADVANCED_EXAMPLE=1`) for unsigned record/API-review challenges only, no model or wallet authority. Connecting, quoting and fixture demos do not demonstrate paid delivery or organic adoption.

Current finite resource ceilings, payment requirements, merchants, finalized-only settlement and original recovery apply. No new tariff, inference provider, browser, additional Container, longer server history or recurring monitoring is introduced.
