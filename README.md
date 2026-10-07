# Fresh402

**A low-cost freshness oracle for AI agents, powered by x402.**

Fresh402 lets an AI agent register a web resource once, then cheaply check whether it has materially changed before spending money on a browser session, scraper, API call, or LLM context.

- Free baseline registration
- $0.005 USDC per freshness check
- REST API
- MCP support
- x402 payments on Base mainnet
- Persistent watch IDs
- HTML, JSON, and text monitoring
- Noise filtering and deterministic diffs

## Why Fresh402?

AI agents often need to answer a simple question:

> Has this resource changed since the last time I looked at it?

Fetching, rendering, parsing, and sending an entire page through an LLM can cost much more than answering that question.

Fresh402 acts as a cheap first step:

1. Register a resource for free.
2. Receive a persistent `watch_id`.
3. Ask Fresh402 whether it changed.
4. Only perform expensive downstream work when necessary.

## Live API

Production:

```text
https://fresh402.kirilllabs.workers.dev
```

Health and service metadata:

```text
GET /
```

## Pricing

| Operation | Price |
|---|---:|
| Register baseline | Free |
| Freshness check | $0.005 USDC |
| Network | Base mainnet |
| Payment protocol | x402 |

## Quick start

### 1. Register a baseline

Registration is free.

```bash
curl -X POST \
  https://fresh402.kirilllabs.workers.dev/v1/register \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'
```

Example response:

```json
{
  "watch_id": "w_0123456789abcdef0123456789abcdef",
  "url": "https://example.com",
  "created": true,
  "baseline_created": true,
  "content_kind": "html"
}
```

Registering the same resource again returns the existing baseline without refetching it.

That prevents the free registration endpoint from being used as a free repeated freshness check.

### 2. Check the resource

```bash
curl -X POST \
  https://fresh402.kirilllabs.workers.dev/v1/check \
  -H "Content-Type: application/json" \
  -d '{"watch_id":"w_0123456789abcdef0123456789abcdef","include_diff":true}'
```

Without payment, Fresh402 returns an x402 payment requirement.

The current price is **$0.005 USDC** on Base mainnet (`eip155:8453`).

An x402-compatible client can satisfy the payment requirement and retry the request automatically.

## REST API

### `POST /v1/register`

Create or retrieve a persistent baseline for free.

Example with HTML scoping:

```json
{
  "url": "https://example.com/pricing",
  "selector": "#pricing",
  "ignore_selectors": [
    ".timestamp",
    ".advertisement"
  ]
}
```

For JSON resources:

```json
{
  "url": "https://api.example.com/data",
  "ignore_json_paths": [
    "/generated_at",
    "/items/*/last_seen"
  ]
}
```

Wildcard `*` JSON Pointer segments are supported.

### `POST /v1/check`

Paid freshness check.

```json
{
  "watch_id": "w_0123456789abcdef0123456789abcdef",
  "max_age_seconds": 300,
  "include_diff": true
}
```

Supported inputs include:

- `watch_id`
- `url`
- `previous_hash`
- `selector`
- `ignore_selectors`
- `ignore_json_paths`
- `max_age_seconds`
- `include_diff`

`max_age_seconds` lets agents reuse sufficiently fresh shared Fresh402 state instead of forcing another upstream fetch.

### `GET /v1/history`

Retrieve stored snapshot history using a `watch_id` or URL.

### `GET /v1/diff`

Retrieve change information for a watched resource.

### `GET /v1/stats`

Retrieve public service usage statistics.

## MCP

Fresh402 exposes a Streamable HTTP MCP endpoint:

```text
https://fresh402.kirilllabs.workers.dev/mcp
```

Available tools:

### `fresh402_register`

Free.

Creates or retrieves a persistent baseline and returns a `watch_id`.

### `fresh402_check`

Costs **$0.005 USDC**.

Checks whether a registered or caller-supplied resource changed.

The tool exposes x402 payment metadata so compatible agents can discover and pay for the operation programmatically.

## Change detection

Fresh402 is designed to reduce false positives from irrelevant page noise.

### HTML selector scoping

Monitor only part of a page:

```json
{
  "url": "https://example.com/pricing",
  "selector": "#pricing"
}
```

### HTML noise filtering

Remove volatile elements before fingerprinting:

```json
{
  "ignore_selectors": [
    ".timestamp",
    ".visitor-counter",
    ".advertisement"
  ]
}
```

### Canonical JSON

JSON is canonicalized before hashing, so object key ordering does not cause false changes.

### JSON Pointer ignores

Known volatile JSON fields can be removed before fingerprinting.

```json
{
  "ignore_json_paths": [
    "/generated_at",
    "/items/*/last_seen"
  ]
}
```

### Conditional HTTP revalidation

Fresh402 can use upstream `ETag` and `Last-Modified` metadata when available.

### Deterministic diff

When comparable previous content exists, `include_diff: true` can return a compact deterministic change summary.

## Persistent watches

Fresh402 v1.1 introduced persistent agent watches.

A registered resource receives a stable identifier:

```text
w_0123456789abcdef0123456789abcdef
```

Fresh402 stores watch state and bounded snapshot history in Cloudflare D1.

Repeated free registration does not refresh an existing watch. A paid check is required to fetch fresh upstream state.

## Architecture

Fresh402 currently uses:

- Cloudflare Workers
- Cloudflare D1
- Coinbase / CDP x402 infrastructure
- Base mainnet
- USDC
- Model Context Protocol (MCP)
- TypeScript

The goal is to keep freshness checks cheap enough that agents can use Fresh402 before more expensive browsing, scraping, or reasoning work.

## Security

Fresh402 validates outbound targets and includes protections intended to reduce SSRF risk.

Payment credentials and deployment secrets are supplied through runtime environment configuration and are not stored in this repository.

## Current release

**v1.1.0**

Highlights:

- Persistent `watch_id`
- Free baseline registration
- Anti-free-refresh behavior
- HTML selector scoping
- HTML ignore selectors
- Canonical JSON monitoring
- Wildcard JSON Pointer ignore paths
- Shared freshness caching
- Caller-supplied `previous_hash`
- Deterministic inline diff
- ETag / Last-Modified revalidation
- Bounded snapshot retention
- REST and MCP support

## Status

Fresh402 is live and usable today.

The project is still early and the API may evolve as real agent usage patterns become clearer.

## Author

Built and maintained by **Kirill Radchenko**.

Issues, integrations, feedback, and AI-agent use cases are welcome.
