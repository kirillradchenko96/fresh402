# Fresh402 LangChain / LangGraph tools

Optional Node24+ source integration tested with actual `@langchain/core`1.3.0 and `@langchain/langgraph`1.5.3. Install it separately from the base SDK; no model account, wallet or provider subscription is needed for the local demo.

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix examples/efficiency/adapters/langchain
node --test examples/efficiency/adapters/langchain/tools.test.ts examples/efficiency/adapters/langchain/demo.test.ts
node examples/efficiency/adapters/langchain/demo.ts
```

```ts
import {createProductionClient} from '../../index.ts';
import {createLangChainTools} from './tools.ts';
const tools = await createLangChainTools(createProductionClient({transport: 'mcp'}), {
  allowedTools: ['fresh402_register', 'fresh402_check', 'fresh402_extract'],
}); // Public metadata reads; paid tools default to quote-only.
```

Native LangChain `tool()` preserves and validates the original JSON Schema, including URL/watch exclusivity, optional fields and descriptions. Arguments are the original tool arguments without an extra wrapper. An explicit Register invocation returns a reusable `watch_id`; reuse it with the saved scope. Paid tool discovery or a payment quote grants no spending authority. Select a small explicit tool subset for your task.

For owner-authorized **prepaid Web** execution, supply `mode: 'authorized', executePaid: invocation => session.execute(invocation)` using the shared [CreditSession](../../README.md). The session owns encrypted original-request state and per-call/day/month/lifetime limits. Pass a LangChain ToolCall object with `type:'tool_call'`, `name`, `args` and the original runtime `id`; LangChain passes it through `config.toolCall.id`. Bare argument calls are denied in paid mode. The runtime/checkpoint owns this ID; a new model call ID cannot resolve an old uncertain operation.

Results are structured status objects (ToolMessage JSON content when using ToolCalls). Completed results retain source provenance; fetched text is untrusted. `pending_recovery` preserves the original private operation and excludes credentials/proofs/error messages. Explicit retention expiry is terminal. An arbitrary external executor still has to enforce its own policy; the framework itself cannot authorize a payment.

For checkpointed workflows, `createRecoveryToolNode(tools)` wraps the real LangGraph ToolNode and calls `interrupt` before committing a pending result. Resume the **same graph checkpoint** once with `new Command({resume:true})`; the node reruns with original IDs and CreditSession recovers the original requests. No timer or replacement call is created. A plain ToolNode normally caches a committed result by tool-call ID, so simply appending another AI message with the same ID will not recover a pending result. Use a durable production checkpointer appropriate to your application, and keep its data private. The runnable demo uses MemorySaver only for local graph state; financial operation identity lives in the separate encrypted session store.

The demo runs both REST and MCP against a loopback contract fixture: free baseline, initial Extract, unchanged Check/evidence reuse, changed Check with a lost response, encrypted-state reopen and original recovery, changed Extract, then a refused over-budget call. Four fixture operations consume10 synthetic credits; recovery adds no debit. Actual libraries, validators, graph interrupts, checkpoint resume and clients execute. Source retrieval, settlement, credits and results are synthetic. No model, USDC, customer credit, RPC or Container call occurs. No import starts the demo.

Official APIs: [LangChain tools](https://docs.langchain.com/oss/javascript/langchain/tools), [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts).
