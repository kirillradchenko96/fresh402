# Register once, then authorize a workflow comparison

Free Register creates or retrieves a **public** watch identified by its exact canonical HTTPS URL and normalization rules. It is not private account state. Repeating registration can return `created:false` and `baseline_created:false` without any fetch or refresh. Read the original `first_seen_at`, `checked_at` and fingerprint accordingly.

Website Change Intelligence and API Compatibility Review accept exactly one source selector:

| Input | Meaning |
|---|---|
| `url` | Start or reuse an owned source/scope identity. The first operation seeds when there is no retained prior observation. |
| `source_watch_id` | Adopt the current retained Register observation as prior evidence and compare it with **one new authorized fetch**. Omit URL, scope and observation ID. |
| `observation_id` | Continue owned state from this same workflow and authenticated billing principal. Omit URL, scope and source watch ID. |

Baseline adoption performs no extra baseline fetch or internal charge. The new workflow operation still requires the ordinary quoted payment or finalized eligible credits. Registration, connection and possession of a public watch ID grant no payment or private-state authority. Save the returned `wf_…` ID for later observations; a `w_…` ID is not interchangeable with it.

The exact saved selector, exclusions, HTML attributes and normalizer are preserved. Register's default empty attribute list remains text-only. Older HTML retains text/attribute evidence, not DOM structure; the comparison discloses this limitation and uses the same Register normalization for both sides. API adoption requires complete unfiltered JSON OpenAPI 3.0/3.1 evidence. Arbitrary JSON/HTML is not an API contract.

The result reports `summary.comparison: "baseline"` on first adoption, previous/current fingerprints, original/current timestamps and separate provenance. An unchanged observation is not a seed. Historical final redirect URLs were not retained by Register; `final_url_recorded:false` explicitly marks that limitation. Old retained evidence can be useful, but its original timestamp is never presented as a new fetch.

Missing, truncated, corrupt, wrong-kind or unsupported-normalizer evidence fails explicitly. Choose a narrower/new source identity or explicitly start a URL-based workflow; there is no silent reseeding. Owned workflow state expires **seven days after creation**. Reads and updates do not extend it. Financial result recovery is separate: retain the original key/proof/private recovery capability and do not authorize replacement payments after uncertainty.

Cross-domain Release Evidence can adopt the website component with `source_watch_id`, plus its required `onchain` selection and `release_label`. Its optional `api_url` seeds separately. A public website baseline never substitutes for finalized chain evidence or establishes causation. On-chain Evidence Brief continues to accept only its own compatible `previous_contract_snapshot` for contract comparison.

## curl: Website or API baseline followed by an unpaid quote

These Bash examples require curl and Python 3. Register may fetch a public source; the second request has no payment credential and returns **402**, not an executed paid comparison.

```sh
API=https://api.fresh402.com
WATCH=$(curl -fsS "$API/v1/register" -H 'Content-Type: application/json' --data '{"url":"https://example.com/"}' | python -c 'import json,sys; print(json.load(sys.stdin)["watch_id"])')
curl -i "$API/v4/workflows/website-change-intelligence" -H 'Content-Type: application/json' --data "{\"source_watch_id\":\"$WATCH\"}"

CONTRACT=$(curl -fsS "$API/v1/register" -H 'Content-Type: application/json' --data '{"url":"https://petstore3.swagger.io/api/v3/openapi.json"}' | python -c 'import json,sys; print(json.load(sys.stdin)["watch_id"])')
curl -i "$API/v4/workflows/api-compatibility-review" -H 'Content-Type: application/json' --data "{\"source_watch_id\":\"$CONTRACT\"}"
```

## JavaScript: standard fetch, no wallet or automatic payment

```js
const api = 'https://api.fresh402.com';
async function prepare(source, workflow) {
  const registered = await fetch(api + '/v1/register', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({url: source})
  });
  if (!registered.ok) throw new Error(`Register failed: ${registered.status}`);
  const baseline = await registered.json();
  const input = {source_watch_id: baseline.watch_id}; // Persist this exact input.
  const quote = await fetch(api + '/v4/workflows/' + workflow, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(input)
  });
  return {baseline, input, status: quote.status, quote: await quote.json()};
}
console.log(await prepare('https://example.com/', 'website-change-intelligence'));
console.log(await prepare('https://petstore3.swagger.io/api/v3/openapi.json', 'api-compatibility-review'));
// Both workflow requests are unpaid quotes. No signer or paid execution is supplied.
```

## Python: standard library

```python
import json, urllib.request, urllib.error
API = "https://api.fresh402.com"
def post(path, body):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)
for source, workflow in [
    ("https://example.com/", "website-change-intelligence"),
    ("https://petstore3.swagger.io/api/v3/openapi.json", "api-compatibility-review")
]:
    status, baseline = post("/v1/register", {"url": source})
    if status != 200: raise RuntimeError((status, baseline))
    print(post("/v4/workflows/" + workflow, {"source_watch_id": baseline["watch_id"]}))
# The workflow calls return unpaid requirements, not successful paid execution.
```

## MCP

Connect a standard Streamable HTTP MCP client to `https://api.fresh402.com/mcp`, initialize and list tools. Call `fresh402_register` with either source URL above. Save its actual returned `watch_id`. Then use:

```json
{"name":"fresh402_website_change_intelligence","arguments":{"source_watch_id":"REAL_WEBSITE_REGISTER_WATCH_ID"}}
```

or, for the registered OpenAPI source:

```json
{"name":"fresh402_api_compatibility_review","arguments":{"source_watch_id":"REAL_API_REGISTER_WATCH_ID"}}
```

Without explicit payment/prepaid authorization these are unpaid challenges (`isError:true`), not executed comparisons. Preserve input, quote and any original financial recovery material before separately authorizing a supported payment client. Read current exact prices from root discovery and authenticated prepaid quotes; never treat a trial denial or MCP connection as authority to spend.

For no-fetch examples of complete results, use `/v4/demos/website-change` and `/v4/demos/api-compatibility`. They use fixed fixtures and the real production comparison functions, not live targets, customer state or payments.
