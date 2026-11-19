# Server-executed intelligence workflows

API 3.1.0 adds four separately billed operations alongside the original seven paid tools and free Register. Inspect live root discovery and the exact quote before authorizing work; disabled products are unavailable. Each operation has one financial parent and one fixed charge. Internal stages do not call separately billed public endpoints.

| Workflow ID | Direct USDC | Eligible prepaid credits | Maximum source fetches / Base RPC reads |
|---|---:|---:|---:|
| `website_change_intelligence` | 0.005 | 2 | 1 / 0 |
| `api_compatibility_review` | 0.010 | 4 | 1 / 0 |
| `onchain_evidence_brief` | 0.025 | 10 | 0 / 18 |
| `cross_domain_release_evidence` | 0.040 | 16 | 2 / 18 |

Direct REST paths are `/v4/workflows/` followed by the hyphenated workflow ID. Prepaid paths use `/v4/prepaid/workflows/`. MCP names are `fresh402_` followed by the unchanged underscored ID. Canonical origin: `https://api.fresh402.com`; MCP: `/mcp`. The supported legacy workers.dev origin remains functional. Recover origin-bound signed operations at their original origin; do not rewrite signed URLs or redirect paid POSTs.

## First observation and reuse

Website and API operations accept exactly one of `url`, `source_watch_id` and the returned owned `observation_id`. A new URL source identity seeds its baseline within the first charged operation: no comparison exists yet and `changed` is null. A compatible `source_watch_id` instead adopts retained public Register evidence, with its original immutable scope and timestamp, for a genuine first comparison against one new authorized fetch. It grants no private ownership and makes no extra internal charge. Later operations compare against `previous` by default, or `baseline`. Every new observation, including unchanged evidence, carries the quoted fixed price. Exact original-operation replay returns the saved result without fresh work or another charge. See [curl, JavaScript, Python and MCP baseline-continuation examples](BASELINE_CONTINUITY.md).

`wf_` observation IDs are not primitive `watch_id` values. They belong to the authenticated billing principal and the same workflow; a prepaid-account identity is not automatically interchangeable with an x402 payer identity. Save the ID and original financial recovery material privately. Saved source URLs and normalization rules are immutable. Supply no URL or scope overrides with an observation ID. State expires seven days after creation; an expired ID fails rather than silently seeding a new baseline. Missing/foreign IDs are rejected. Global and per-principal storage/capacity ceilings can deny new work.

```json
{"url":"https://example.com/docs","scope":{"selector":"main","ignore_selectors":[".timestamp"]}}
```

This Website Change Intelligence example fetches static public HTTPS content once, normalizes it and retains comparison state. Supported HTML attributes default to `href`, `title`, `alt`, `aria-label`; an explicit empty list means text-only comparison and reports that limitation. JSON and text use their supported structural/text comparisons. Exclusions are outside the observed scope. No browser rendering, linked-page crawling or authenticated/private fetching.

```json
{"observation_id":"YOUR_RETURNED_WF_ID","compare_to":"previous","detail":"compact"}
```

`detail` defaults to `compact` (at most 20 evidence items per section). `expanded` permits at most 200 document findings or 100 Base events within the same output/work ceiling. Findings counts, omissions and uncertainty remain explicit. Identical normalized evidence skips downstream comparison, not fetching or the fixed charge.

## Website comparison evidence and limits

Website observations are on demand. They do not schedule monitoring or send alerts. The first observation is `baseline_seeded` with `changed:null`; an unchanged new observation still costs the quoted 2 eligible credits or $0.005 USDC. Exact original-operation replay performs no new fetch or charge, even when the source has since changed.

New static HTML observations report `scope.normalizer:structural-v2-html-context`. Retained unique block IDs take precedence over equal text in another record. For nested blocks without their own IDs, bounded `div`, `section` and `article` container IDs plus per-tag ordinals provide versioned context. Whole records can move without exchanging their values. This does not infer product identities for arbitrary unkeyed markup or guarantee matching after layout changes. Repeated container contexts fail explicitly; narrow the CSS scope rather than accepting ambiguous record matching.

Text-only record movement can be suppressed. Selected attribute arrays retain positional semantics: moving different links can still report attribute changes. A container ID is source evidence, not proof that its publisher kept the same real-world product identity.

`before_path` and `after_path` locate each side in normalized evidence: JSON value pointers, `/blocks/N` text or `/html_attributes/N/...` attributes. They are not raw HTML selectors or source line numbers. JSON root pointers are the empty string; legacy `path` remains `/` for root changes. Excerpts may be truncated, and compact output returns at most 20 findings. Inspect omitted counts and completeness. Rule-based significance describes mechanical features, not business importance.

Website JSON rejects duplicate object names (including escaped aliases), unsafe integers, nonfinite numbers and numeric spellings that lose decimal identity during parsing. Encode large exact numeric identifiers as strings. Ordinary equivalent decimal spellings remain supported. These restrictions apply to fetched website evidence, not payment credentials. Existing source state is preserved. If a legacy JSON baseline lacks original literal validation, or legacy HTML lacks container context, ambiguous equality can return `review_required` with `changed:null` instead of claiming unchanged. The next validated observation becomes the previous observation without resetting the original baseline or extending retention.

For standalone Website Change Intelligence, the decoded source limits are 448,000 UTF-8 bytes for supported text, 320,000 for HTML, and 256,000 for JSON. Register-compatible observations and the website component of Cross-domain Release Evidence retain their 256,000-byte limit. HTML still applies the 10,000-element and 1,000-content-block limits. An explicit HTML body remains in scope when the preceding head end tag is omitted. An empty older HTML observation whose body cannot be verified can return `review_required`. JSON retains its structural and literal-integrity limits. Missing selectors, partial HTTP responses and over-limit inputs return explicit errors.

When a text observation exceeds the original byte or line-index limit, its complete normalized text is retained as `ordered-text-v1`. The comparison can also use this policy when structural text matching reaches its work limit. Whitespace, line wraps and the existing cosmetic normalization remain equivalent. For a difference, the response provides a single enclosing range, which may contain unchanged text between edits. `before_path` and `after_path` locate `/text`, and `before_range` and `after_range` give half-open UTF-16 offsets where that side exists. `comparison_complete` refers to the comparison of both complete texts. `changes_enumerated:false` indicates the range does not enumerate individual edits. Long previews set `evidence_excerpt_truncated:true`.

The existing state and response ceilings still apply. A source within its byte limit can exceed those ceilings or the parser and comparison limits. A large saved observation can also exceed the portable evidence limit and return `omitted_size` when exported.

## API Compatibility Review

Supply a public unfiltered JSON OpenAPI 3.0/3.1 URL, then reuse its returned observation ID. There is no `scope` parameter for this product. The report identifies supported operation, request/response and effective authentication changes, with operation identities, evidence pointers and directional classifications. Counts can exceed returned evidence; check omissions. YAML, arbitrary external-reference fetching and complete JSON Schema semantic analysis are unsupported. A contract-level breaking classification is not proof of deployed enforcement or a failing consumer.

```json
{"url":"https://example.com/openapi.json","detail":"compact"}
```

## On-chain Evidence Brief

Required inputs are `chain_id:8453`, one `contract_address`, and one `wallet_address`. The selected contract is also the token-facts and Transfer-log contract. Code/proxy observations, contract-reported token facts, exact native wallet balance and selected Transfer evidence share one finalized block and a shared bounded RPC cache. Raw integers remain decimal strings. Optional `previous_contract_snapshot` must be an owned compatible `contract_snapshot_id` from this same narrow workflow scope; primitive snapshots with another scope are rejected.

```json
{"chain_id":8453,"contract_address":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","wallet_address":"0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3"}
```

The workflow selects state by canonical block hash (EIP-1898) and both directions of the wallet Transfer filter by the same block hash (EIP-234). It rechecks the selected block header before delivery. Use `summary.evidence_index` to resolve block, field and event pointers. A previous snapshot whose header disagrees with the current provider yields an unknown comparison. Wallet coverage is limited to provider-reported events for the selected contract at that one block. Independent consensus, receipts, full wallet history, actual delegatecall, authority, ERC-20 compliance, circulating supply and safety are outside this evidence scope. Unsupported pinning, invalid or excessive logs and provider errors can stop delivery before settlement.

## Cross-domain Release Evidence

With a new `url`, also provide required `onchain` (the three Base inputs above), required `release_label` (1–128 characters) and optional explicit `api_url`. No link discovery occurs. The optional `scope` applies to the website only. Reusing `observation_id` freezes website, API, addresses and scope: omit `url`, `api_url`, `onchain` and `scope`; continue to provide `release_label`. The label may change without changing observation identity.

Read `summary.findings` for each source's status, evidence pointer, previous observation when available and the caller label with any literal mention in the selected website projection. `summary.timeline` separates document acquisition, provider block selection and block time. The release relationship remains unverified. Partial HTTP responses stop execution before a paid result or baseline update. Omitting `api_url` records the API as unselected. An explicitly selected API source must return a supported, complete JSON OpenAPI document. The website and API each retain their 256,000-byte limit.

## Payment, eligibility and recovery

Direct resources advertise supported native-USDC x402 v2 and MPP methods in the live challenge. An unsigned call returns requirements without execution. Verify exact origin/resource, recipient, native USDC, amount and deadline before signing.

Eligible finalized prepaid credits use tariff **5**, exact authenticated quotes at `GET /v4/prepaid/workflows/quote/{underscored_workflow_id}`, `Idempotency-Key`, `X-Fresh402-Tariff-Version: 5` and `X-Fresh402-Max-Credits`. Existing Web product rights must cover the workflow's constituent scope. Chain workflows additionally require existing accepted finalized All-Services rights or the three original explicit Base grants. No grant, balance, funding terms or credential is minted by a workflow quote. Provisional credits and free trials cannot execute these workflows. A 403/429/503 never authorizes a paid fallback.

Persist original inputs, idempotency identity, exact quote/maximum, payment proof and private recovery token before submission. Reuse those originals across REST/MCP as supported; never create a replacement authorization after uncertainty. A completed result may report unsaved workflow state: recover the same original until delivery is complete, and do not use an unsaved ID. Settled-but-pending delivery is not a zero-charge failure or an invented refund. Financial-result retention is separately bounded; do not equate it with observation retention.

The SDK's `PrepaidClient.quoteRemote(workflowId)` reads the authenticated price; `execute` requires a finite credit cap and private durable persistence. It never signs or buys USDC. The older client-orchestrated `runFlagship` remains available and still bills each underlying operation separately; it is not this server product. See [SDK package](SDK_PACKAGE.md), [public API](API.md) and [live OpenAPI](https://api.fresh402.com/openapi.json).

## Economics: an existing pipeline versus building one

These are separate comparisons. A new integration may avoid implementing source validation, normalized state, bounded comparison and recovery. An already running pipeline has sunk engineering costs; a hosted workflow adds its published per-operation charge and can be more expensive in cash. There is no general token, latency or cash-saving guarantee against a warm existing pipeline.

Compare equivalent source scope, retained history, output detail and failure recovery. Count client orchestration, provider/source calls, model input/output tokens, retained bytes and paid operations separately. Fixed fixture benchmarks measure deterministic processing and local wall time; they do not measure third-party model tokens, Cloudflare Container latency or customer infrastructure savings. The bounded hosted evidence and original-operation recovery are the product value; whether they justify the charge depends on the customer's existing system.

## Native USDC on Solana

The existing paid resources support native Circle USDC on Solana Mainnet where the live unpaid challenge advertises it. Native Solana MPP is available for advertised standalone charges. Prepaid MPP funding uses Base. The observation chain for these two workflows is Base regardless of the payment network. Solana package funding requires matching Solana wallet ownership, network-specific terms and finalized native-USDC evidence. [Network selection, compatible client requirements and original recovery](SOLANA_USDC.md).

## Explicit CI contracts and stronger evidence

Workflow `status` describes observation/change state, not a CI pass/fail decision. For supplied pairs use `summary.findings.verdict`; for a stored-source comparison use `evidence.api.summary.verdict` when present. An additive change may retain workflow status `review_required` while its supported-rules verdict is `no_breaking_change_observed`. Seeded and hash-unchanged observations skip the comparator and do not return a verdict; do not infer CI approval or complete schema compatibility from them. The fixed demo preserves these same production behaviors.

API Compatibility Review also accepts `contracts:{before,after}` (serialized JSON or bounded YAML 1.2 strings; YAML pairs only, without aliases, anchors, tags, merges or ambiguous keys), exclusive with url/source_watch_id/observation_id. Each string is at most 1,200,000 characters and 1,200,000 UTF-8 bytes; combined contract text is at most 2,400,000 bytes, within the supplied-OpenAPI-only 3,600,000-byte total REST/MCP envelope. Unrelated and stored-source calls retain the 65,536-byte request ceiling. Existing parser/work/reference/output bounds still apply; larger inputs can still be rejected for complexity. JSON duplicate object names are rejected. Omit comparison overrides. It compares immediately at the same $0.010/4credit price, fetches no source and creates no observation state. Original financial recovery still applies. `summary.findings.verdict` provides conservative `breaking`(CI exit1), `review_required`(2) or `no_breaking_change_observed`(0); none proves live API compatibility. Inert `urn:sha256` provenance references identify supplied canonical contract bytes, not fetched URLs.

Website evidence reports raw-byte versus normalized-evidence change and bounded mechanical inspection targets. On-chain summaries index returned finalized block/event identities without extra RPC or full-history claims. Cross-domain timelines distinguish source-observation time from chain-block time and do not assert causation. Seven-day non-sliding source state retention is unchanged; explicitly supplied pairs do not create source state.

## Bounded structured evidence update

See [structured records, Release Guardian, record identity and portable observation context](DEEP_CAPABILITIES.md) for exact optional inputs, limits, CI semantics and original recovery boundaries. The existing tool identities and tariffs are unchanged.
