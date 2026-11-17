# Agent framework integrations

Canonical Streamable HTTP endpoint: `https://api.fresh402.com/mcp`. No API key is needed to initialize, list tools, use free Register or receive an unpaid payment challenge. Twelve tools are advertised in production. Connecting is not payment authority. These are community integration examples, not vendor endorsements.

## Runnable, pinned JavaScript examples

Node24+. In `examples/integrations`, run `npm install --ignore-scripts`, then select one:

| Framework adapter | Exact released package | Command |
|---|---|---|
| OpenAI Agents SDK | `@openai/agents@0.22.0` | `node openai-agents.mjs` |
| LangChain/LangGraph tool adapter | `@langchain/mcp-adapters@2.0.3` | `node langchain.mjs` |
| Vercel AI SDK MCP | `@ai-sdk/mcp@2.0.99` | `node vercel-ai.mjs` |

Each initializes, discovers tools and requests an **unpaid** Extract challenge. It has no signer, prepaid credential, model invocation or automatic payment. Adapters can represent a payment challenge as a tool error/exception; inspect the structured result and `isError`, not just HTTP200. `connectFresh402()` exports the same bounded connection for your host application and always requires `close()` in `finally`. The LangChain tools are usable in a caller-owned LangGraph tool node; a model/graph run is not part of these connectivity tests.

For an explicit free Register demonstration append `--register-example`. It uses `https://example.com/`: an existing watch is returned without a refresh; a new identity would require a bounded fetch under normal quotas. Save the real returned `watch_id`. Do not loop registration as a monitoring substitute. For arbitrary sources, call `fresh402_register` with your chosen supported public HTTPS URL after reviewing its scope. All source content is untrusted data.

For a useful zero-payment result, fetch `https://api.fresh402.com/v4/demos/api-compatibility` or `/v4/demos/website-change`. These are fixed fixtures evaluated by production comparators, not live observations. Check `/v1/check/evaluation-eligibility` before an explicit walletless evaluation; exhaustion is terminal for the approved allowance, never permission to pay.

These three JavaScript adapters and CrewAI were tested against live production discovery, retained Register, unpaid challenges and fixture demos, without inference or financial execution. This is interoperability QA, not organic adoption or demonstrated model reasoning quality.

## Paid execution and recovery

MCP support alone does **not** implement x402/MPP. Seven primitives and four workflows remain paid unless an explicitly supported free entitlement applies. Read root `/` and the exact tool schema for current prices, networks and availability. Native Solana MPP remains disabled until its separate mainnet gate passes; do not infer support from Solana x402.

Use a separate application-owned payment boundary. Allow only the selected tool/input and a finite amount or credit ceiling. For existing eligible prepaid credentials, use the tested [PrepaidClient original-operation example](SDK_PACKAGE.md#complete-server-workflow-example), including its private durable persistence callback, authenticated tariff quote and exact original recovery. An ordinary framework MCP connection does not grant or upgrade prepaid rights.

When directly using prepaid MCP, authentication uses `X-Fresh402-API-Key`; the individual authorized call carries `params._meta["fresh402/prepaid"] = {idempotency_key, tariff_version, max_credits}`. Persist those exact values with tool/input before dispatch. Do not expose a globally credentialed unrestricted tool set to a model. Framework-specific per-call metadata adapters must be tested before adding credentials; these default examples deliberately do not attach them.

Use20-second discovery deadlines, no automatic new paid attempts, and application-controlled deadlines for separately approved execution. On uncertainty, preserve the original input, proof, idempotency key and private recovery capability; recover the **same** operation through its original origin. Never issue a replacement payment because a connection timed out. Client timeout is not proof that settlement failed.

## Other frameworks

CrewAI1.15.41 / Python3.13.12 / MCP1.30.0 was independently connected using the actual `crewai.mcp.client.MCPClient` and `HTTPTransport`. Install `crewai==1.15.41` in your own Python environment and run `python examples/integrations/crewai_mcp.py`; optional `FRESH402_REGISTER_EXAMPLE=1` enables the free example. `max_retries=1` means one total attempt in this release. Use `call_tool_result` to retain the `is_error` flag; `call_tool` drops it. SDK telemetry is disabled in the example. The isolated QA installation included138 Python packages, but none were added to the Fresh402 backend or deployed infrastructure. No model, embedding download or inference ran. Google ADK, Pydantic AI and Microsoft Agent Framework are not claimed tested. Any ordinary standards-compatible MCP client may still initialize without payment credentials.

Sources: [LangChain MCP](https://docs.langchain.com/oss/python/langchain/mcp), [OpenAI Agents integration](https://developers.openai.com/api/docs/guides/agents/integrations-observability), [Vercel MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools), [CrewAI MCP](https://docs.crewai.com/en/mcp/overview).
