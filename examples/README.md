# Fresh402 2.0 request examples

These examples use the existing production URLs. Discovery is free. The three unsigned paid requests return HTTP 402 requirements and do not pay for or deliver the paid operation. The free Register example does fetch a new public target if you choose to execute it.

## Discover

```sh
curl https://fresh402.kirilllabs.workers.dev/
curl https://fresh402.kirilllabs.workers.dev/openapi.json
curl https://fresh402.kirilllabs.workers.dev/.well-known/x402
curl https://fresh402.kirilllabs.workers.dev/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

An MCP client should normally initialize first; see [MCP integration](../docs/MCP.md).

## Register: free (fresh402_register)

```sh
curl https://fresh402.kirilllabs.workers.dev/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/"}'
```

Save its real `watch_id`. Repeating the same registration does not fetch the target again.

## Check: $0.005 USDC (fresh402_check)

```sh
curl -i https://fresh402.kirilllabs.workers.dev/v1/check \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","include_diff":true}'
```

## Web Extract: $0.01 USDC (fresh402_extract)

```sh
curl -i https://fresh402.kirilllabs.workers.dev/v2/extract \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/","max_chars":20000,"include_links":true,"include_structured_data":true}'
```

## Smart Diff: $0.015 USDC (fresh402_smart_diff)

```sh
curl -i https://fresh402.kirilllabs.workers.dev/v2/smart-diff \
  -H 'Content-Type: application/json' \
  -d '{"watch_id":"w_0123456789abcdef0123456789abcdef","compare_to":"baseline"}'
```

The Smart Diff ID above is illustrative. Replace it with a returned watch ID before a paid request. Without payment, inspect the `PAYMENT-REQUIRED` quote. Do not paste signatures, recovery tokens or wallet keys into source files. An x402-compatible client must obtain owner-approved payment authorization, preserve the challenge's resource/extensions, and supply a private recovery token before retrying. See [payment and recovery](../docs/API.md#payment-and-recovery).
