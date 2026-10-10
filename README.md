# Fresh402 v2.0 — Web Intelligence API for AI Agents

[![Smithery](https://smithery.ai/badge/kirillradchenko96/fresh402)](https://smithery.ai/servers/kirillradchenko96/fresh402)

**Check whether a source changed, extract usable content, and compare structured snapshots. Pay per call with x402 USDC on Base.**

The hosted production API reports **2.0.0**. Connect at [fresh402.kirilllabs.workers.dev](https://fresh402.kirilllabs.workers.dev/) or its [MCP endpoint](https://fresh402.kirilllabs.workers.dev/mcp). This documentation describes the hosted service; the repository's legacy implementation and backend release PR are maintained separately. A documentation release does not deploy the service.

| Product | MCP tool | REST endpoint | Price per call |
|---|---|---|---:|
| Persistent baseline | `fresh402_register` | `POST /v1/register` | Free |
| Freshness Check | `fresh402_check` | `POST /v1/check` | $0.005 USDC |
| Web Extract | `fresh402_extract` | `POST /v2/extract` | $0.01 USDC |
| Smart Diff | `fresh402_smart_diff` | `POST /v2/smart-diff` | $0.015 USDC |

## Choose the operation

- **Register** once to establish a persistent baseline and receive a `watch_id`. Re-registering the same watch returns its existing baseline without loading the target again.
- **Check** before reusing a web source or spending on downstream browsing and reasoning. Get a change signal, noise filtering, conditional HTTP revalidation and an optional compact deterministic text diff. A cached Check is still a paid operation.
- **Extract** when an agent needs content for retrieval: text, titles, metadata, headings, links and JSON-LD from public HTML, JSON or text, with optional CSS scoping.
- **Smart Diff** when the change itself matters: compare a watch with its previous Smart Diff snapshot or fixed baseline, get structured additions/removals/modifications, and inspect significance scores with explainable deterministic rules.

Requests fetch eligible **public HTTPS** sources on demand. Fresh402 does not execute page JavaScript, render a browser, access authenticated sites, perform LLM-powered semantic analysis, continuously poll watches, or send push alerts. Security checks and rate, size, concurrency and operation limits apply; capacity failures may require a later retry.

## Start with discovery

- [Live OpenAPI 3.1 reference](https://fresh402.kirilllabs.workers.dev/openapi.json): current request schemas, examples, response formats and payment headers.
- [API guide](docs/API.md), [MCP integration](docs/MCP.md), [pricing](docs/PRICING.md), [request examples](examples/README.md).
- [x402 resource manifest](https://fresh402.kirilllabs.workers.dev/.well-known/x402), [agent guide](https://fresh402.kirilllabs.workers.dev/llms.txt), [release notes](CHANGELOG.md).
- [Official MCP Registry](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.kirillradchenko96%2Ffresh402/versions/latest): the existing identity is `io.github.kirillradchenko96/fresh402`.
- [Discovery audit](docs/DISCOVERY_AUDIT.md): externally verified catalog status and outstanding reindexing or authorization requirements.

Free service metadata and MCP `initialize` / `tools/list` let a new agent learn all four tools without paying or fetching a target.

## REST quick start

Register a baseline for free:

```sh
curl https://fresh402.kirilllabs.workers.dev/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/"}'
```

Use the returned `watch_id` in a Check or Smart Diff. The following unsigned request retrieves payment requirements, not a paid result:

```sh
curl -i https://fresh402.kirilllabs.workers.dev/v2/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","max_chars":20000}'
```

Expect **HTTP 402** and a `PAYMENT-REQUIRED` header describing the exact amount, USDC asset, Base network and recipient. Use an x402 v2 compatible client and a payer-controlled wallet to authorize the exact amount, then retry the same request with `PAYMENT-SIGNATURE`. Never share a wallet seed phrase or private key. No unlimited token approval is required by the exact authorization flow.

Persist a client-generated recovery token before paying; [the API guide](docs/API.md#payment-and-recovery) explains the public client contract. A confirmed paid result carries a `PAYMENT-RESPONSE` settlement receipt. An HTTP 402 challenge is not a successful payment; a pending settlement must not trigger a replacement authorization.

## MCP quick start

Add this URL as a **remote Streamable HTTP MCP server** in a compatible client:

```text
https://fresh402.kirilllabs.workers.dev/mcp
```

The client performs `initialize` and `tools/list`; all four tools use the names and prices above. Free discovery does not require a Fresh402 API key. Paid tool calls require an x402-capable client; an ordinary MCP client can list tools and register a baseline but cannot automatically complete payment unless it implements x402.

MCP payment challenges are tool results with `isError: true` and requirements in `structuredContent`. **HTTP 200 alone is not success.** The payment belongs in `params._meta["x402/payment"]`, and the settlement receipt is in `result._meta["x402/payment-response"]`. See [MCP examples](docs/MCP.md).

## Public data and operational boundaries

Watch identifiers and legacy snapshot history are shared public service data. Do not use Fresh402 for private pages or submit secrets in target URLs. Free `GET /v1/history` and `GET /v1/diff` read retained legacy data without fetching a target; they do not expose paid Smart Diff results. Recovery tokens are private client credentials and must not appear in URLs, public repositories or logs.

The live API is the authority for the deployed contract. Catalog descriptions and cached schemas can lag it; [the audit](docs/DISCOVERY_AUDIT.md) records that distinction. There is no claim that an unsigned 402 response proves Coinbase Bazaar indexing.

Built and maintained by **Kirill Radchenko**. [Report an integration issue](https://github.com/kirillradchenko96/fresh402/issues).
