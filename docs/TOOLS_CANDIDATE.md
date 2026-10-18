# Fresh402 deployed tool catalogue

The established tools and current tariff are exposed in live OpenAPI and MCP discovery. Read the live feature flags and quotes before execution. See [agent prepaid purchasing](AGENT_PREPAID.md) for shared REST/MCP credits and bounded early access.

| Tool | REST | x402 USDC | Credits v1/v2/v3 | Category |
|---|---|---:|---|---|
| fresh402_check | POST /v1/check | 0.005 | 1/2/2 | freshness |
| fresh402_extract | POST /v2/extract | 0.01 | 2/2/3 | extraction |
| fresh402_smart_diff | POST /v2/smart-diff | 0.015 | 3/3/4 | document-diff |
| fresh402_openapi_contract_diff | POST /v2/openapi-contract-diff | 0.020 | unsupported/unsupported/5 | api-contract-diff |

## fresh402_check

Detect website, API documentation and public JSON changes. Reuse a baseline, filter noise and return a compact freshness result. On-demand polling, not a background monitor.

Example: `{"url":"https://example.com/","include_diff":true}`

Limits: `{"transfer_bytes":5000000,"decoded_bytes":5000000,"output_bytes":524288,"parser_characters":1000000,"gateway_timeout_ms":10000}`

## fresh402_extract

Extract readable article or documentation content, metadata and links from public static HTML, JSON or text. CSS scope and noise exclusions; no JavaScript rendering.

Example: `{"url":"https://example.com/","max_chars":20000}`

Limits: `{"transfer_bytes":5000000,"decoded_bytes":5000000,"output_bytes":524288,"parser_characters":1000000,"gateway_timeout_ms":10000}`

## fresh402_smart_diff

Compare stored and current versions of a public web page or JSON document. Return structured changes and deterministic significance evidence; register a watch first. Not a complete API compatibility analyzer.

Example: `{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"previous"}`

Limits: `{"transfer_bytes":5000000,"decoded_bytes":5000000,"output_bytes":524288,"parser_characters":1000000,"gateway_timeout_ms":10000}`

## fresh402_openapi_contract_diff

Detect changes to API paths, methods, parameters, request requirements and response schemas, with conservative breaking-change evidence. Register the JSON contract first; no YAML, remote reference fetch or perfect compatibility guarantee.

Example: `{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"previous"}`

Limits: `{"transfer_bytes":5000000,"decoded_bytes":5000000,"output_bytes":131072,"parser_characters":256000,"gateway_timeout_ms":10000,"document_bytes":256000,"paths":100,"operations":500,"work":20000,"ref_hops":32,"ref_resolutions":2048,"changes":200}`

The service is on-demand; it does not provide automatic background monitoring. MCP x402 execution requires a payment-capable adapter. [Public-interface client](../examples/knowledge-base/README.md); [prepaid clients](../examples/knowledge-base/PREPAID.md); [contract example and assumptions](../examples/knowledge-base/OPENAPI.md).
