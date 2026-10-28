# Fresh402 2.4 request examples

These examples use the existing production URLs. Discovery is free. Unsigned paid requests return HTTP 402 requirements and do not pay for or deliver the paid operation. The free Register example does fetch a new public target if you choose to execute it.

For a runnable TypeScript client and a local no-money documentation workflow, see [the knowledge-base integration](knowledge-base/README.md). It includes REST/MCP discovery, explicit payment caps, private recovery and automated tests. Its demo does not execute hosted paid operations.

## Discover

```sh
curl https://api.fresh402.com/
curl https://api.fresh402.com/openapi.json
curl https://api.fresh402.com/.well-known/x402
curl https://api.fresh402.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

An MCP client should normally initialize first; see [MCP integration](../docs/MCP.md).

## Register: free (fresh402_register)

```sh
curl https://api.fresh402.com/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/"}'
```

Save its real `watch_id`. Repeating the same registration does not fetch the target again.

## Check: $0.005 USDC (fresh402_check)

```sh
curl -i https://api.fresh402.com/v1/check \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","include_diff":true}'
```

## Web Extract: $0.01 USDC (fresh402_extract)

```sh
curl -i https://api.fresh402.com/v2/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","max_chars":20000,"include_links":true,"include_structured_data":true}'
```

## Smart Diff: $0.015 USDC (fresh402_smart_diff)

```sh
curl -i https://api.fresh402.com/v2/smart-diff \
  -H 'Content-Type: application/json' \
  -d '{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"baseline"}'
```

The Smart Diff ID above is illustrative. Replace it with a returned watch ID before a paid request. Without payment, inspect the `PAYMENT-REQUIRED` quote. Do not paste signatures, recovery tokens or wallet keys into source files. An x402-compatible client must obtain owner-approved payment authorization, preserve the challenge's resource/extensions, and supply a private recovery token before retrying. See [payment and recovery](../docs/API.md#payment-and-recovery).

## OpenAPI Contract Diff: unsigned quote

Register a supported public JSON OpenAPI document first, then use its returned watch ID. This unsigned request obtains a $0.020 USDC quote only.

```sh
curl https://api.fresh402.com/v2/openapi-contract-diff \
  -H 'Content-Type: application/json' \
  -d '{"watch_id":"YOUR_RETURNED_WATCH_ID","compare_to":"baseline"}'
```

For browserless EOA enrollment, exact package purchase, bounded early credits, finalized recovery and shared REST/MCP credit execution, use the [agent purchasing guide](../docs/AGENT_PREPAID.md). Follow live availability; early inclusion is not finality.
