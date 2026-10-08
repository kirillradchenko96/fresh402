# Security and operational limits

## Network boundary

The shared loader validates each initial/redirect URL, forbids userinfo and common credential query keys, limits ports, blocks private/local/reserved IPv4 and non-public IPv6, and rejects HTTPS-to-HTTP downgrade. It forwards no caller cookies, authorization or arbitrary headers. At most five redirects and 5,000,000 streamed bytes are accepted. One 10-second deadline covers DNS, headers, redirects and body; cancellation is not awaited on an untrusted stalled stream.

Before each hostname fetch, A and AAAA are queried through Cloudflare's DNS-over-HTTPS endpoint with bounded responses. Any private address or internal CNAME rejects the whole set; DNS failures fail closed. Tests cover mixed answers and private redirect destinations.

**DNS limitation:** Workers `fetch` resolves again; this application cannot pin the TCP peer IP while preserving arbitrary-host TLS/SNI. The DoH check therefore does not by itself eliminate the DNS time-of-check/time-of-use race. The retrieved Cloudflare documentation does not establish an arbitrary-host peer-pinning or DNS-rebinding prevention guarantee. Public routing must not be treated as such a guarantee. `global_fetch_strictly_public` preserves public routing and prevents same-zone origin/security bypass; it is not claimed to be an IP-pinning API. Do not deploy this loader in an unrestricted Node/private-network runtime. Strong independently verified peer pinning would require a dedicated outbound gateway and is an unresolved gate for an unrestricted public production launch. Staging uses an exact operator-controlled hostname allowlist checked on every redirect. No private-origin/service bindings are added.

The service makes one public resource request at a time per operation, obeys target denial responses, performs no CAPTCHA/authentication bypass, uses an identifiable User-Agent, and does not execute site JavaScript. It does not crawl links, rotate identities or automatically retry blocked sites. Automated robots.txt policy parsing is not implemented; operators/callers remain responsible for permission and site access policies. Do not use it where automated access is prohibited.

## Input, CPU, storage and concurrency

- POST bodies: 65,536 bytes, 10-second body deadline before MCP/payment parsing.
- Edge admission: 120/minute per trusted connecting IP in separate POST/read buckets; unknown-IP callers share buckets. Platform rate limits are per Cloudflare location, not a hard global spending cap.
- Free new registrations retain the existing 10/minute target-host and 60/minute per-location global quotas. Re-registration does not fetch.
- D1 capacity: eight simultaneous operations globally, one active operation per normalized target URL, 120-second crash lease. Settling/settled-but-unfinalized targets remain quarantined after lease expiry.
- Atomic D1 daily operation budget: at most 10,000 admitted expensive operations/day (UTC), 1,000 in staging; configurable downward including zero. This does not cap total HTTP/D1 admission costs.
- Intelligence parser: 1,000,000 characters/10,000 HTML elements; JSON at most 10,000 nodes/depth 64; 1,000 content blocks; pairwise diff work capped.
- Smart snapshot: 200,000 serialized characters and 20 rolling snapshots per watch plus one fixed baseline.
- Intelligence result: at most 512 KiB of serialized JSON before settlement (MCP additionally wraps this payload).
- CSS selectors limited to 256 characters/20 ignore rules. Supported native parser only.

These are beta product limits, not a claim that Cloudflare account quotas are identical. Account-level cost alerts and traffic controls remain deployment responsibilities. Free baselines can grow D1 storage over time; no user data is automatically deleted by the upgrade.

## Payment integrity

Actual SDK verification gates execution. Different service amounts cannot satisfy each other. SDK settlement gates delivery; paid state writes are deferred so failed settlement cannot populate the free v1 history endpoints. D1 claims prevent the same EIP-3009 nonce from repeatedly triggering paid work, including concurrent calls or crossing transports. Claims retain no signatures and expire only after validBefore plus a five-minute safety margin. Cron deletes bounded expired batches, while the durable financial journal and unresolved settlements remain.

Do not remove the [Bazaar patch](../patches/@x402+extensions+2.27.0.patch). `@cfworker/json-schema` replaces runtime-generated validators. Tests run in workerd, where forbidden dynamic code generation would fail. Schema external references remain rejected.

Free v1 history/diff and deterministic shared watch IDs are an existing public product contract. They are not access-controlled private storage. V2 structural documents have no public read endpoint; possession of a watch ID still allows someone to purchase its comparison. Authentication/ownership is a future feature.

## Logs and dependency review

Application logs use fixed event codes rather than bodies, target contents, raw headers or secrets. Public errors avoid unexpected exception messages. Cloudflare request observability may separately record request metadata under the account's configuration; review account log retention before production.

Runtime dependency audit is clean at the implementation checkpoint. Development dependencies have a known `braces <=3.0.3` stack-exhaustion advisory through `micromatch → find-yarn-workspace-root → patch-package`; all four package advisories describe that chain. At review time no fixed braces release existed. Patch patterns are repository-controlled and this package is not in the deployed Worker. Preserve the necessary Bazaar patch, run installs/builds in CI with least privilege, and revisit [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) before release. Do not downgrade patch-package using `audit fix --force` blindly.

Development-only `undici`, `sharp`, and `source-map-js` overrides select advisory-fixed versions; they require full workerd/bundle verification after updates. No credentials are added to the repository. Examples read optional payment payloads from local environment and never print or generate secrets.


## Private recovery and settlement

The optional recovery bearer secret is generated and saved by the client before payment and stored only as SHA-256. Its hash is compared using Workers timingSafeEqual. REST uses a header; MCP uses private metadata. Never put it in a URL. Full payment authorization/signatures become public onchain and cannot authenticate result recovery. Known hashes, nonces, watch IDs, payment signatures or transaction hashes alone reveal no recovery result. V1 public shared history is unchanged. See [state machine and incident procedure](PAYMENT_RECOVERY.md).

Required safety gates live in the facilitator adapter rather than SDK hooks, whose exceptions are caught by x402 2.27.0. SDK settlement_pending retry behavior is fenced by durable compare-and-set and cannot submit the authorization twice. Errors/logs do not include target contents, auth headers or tokens. Cloudflare observability is a separate operator-controlled boundary; check header capture and retention.

Current sources retrieved for this review: [Workers compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public), [fetch known issues](https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [rate limiter accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/#accuracy), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
