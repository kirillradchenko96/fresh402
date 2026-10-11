# Noise-aware documentation knowledge base

Requires Node.js 24 or later. No installation, API key or wallet is needed for the demo or discovery mode.

```sh
node examples/knowledge-base/run.ts --demo
node examples/knowledge-base/run.ts --demo --mcp
node --test examples/knowledge-base/client.test.ts
node examples/knowledge-base/run.ts
```

The demo maintains a local knowledge base through five polls. It extracts initially, ignores three timestamp-only updates, and refreshes after a meaningful documentation change. It writes private operation records and the knowledge-base JSON outside the repository. The demo is a **public-contract simulator**, with fictional authorizations and receipts; it makes no blockchain payment and does not prove hosted paid execution. The separate backend integration lab tests this same client against the real application and isolated D1 with a mocked facilitator.

Running without `--demo` performs only live OpenAPI/MCP discovery and unsigned payment quotes. The default payment cap is zero. It creates no watch and fetches no target through Fresh402.

## Use the client in your application

`client.ts` uses only public REST/MCP interfaces. Call `discover()` before operations; returned schemas and prices come from OpenAPI and tools/list. Use `register()` to get a real watch ID. `syncDocumentation()` registers once, extracts the initial document, then buys Check and only re-extracts when content changes. Selectors and ignore rules let you exclude navigation or changing timestamps. Smart Diff is available through `execute("fresh402_smart_diff", { watch_id, compare_to: "previous" })` after registration.

To enable actual payments, provide a payer-controlled x402 v2 `Signer` callback, an explicit `maxAtomicUSDC` cap, and a private durable `persist` callback. Use a normal wallet/x402 SDK authorization flow; never export a seed phrase or private key. The client checks native USDC, Base chain 8453, recipient, exact amount, canonical resource and preserved extensions before sending an authorization. The maximum amount is reserved before signing; uncertainty does not release that reservation. This example does not authorize anyone's real payments.

`signerFromX402Client(yourConfiguredX402Client)` adapts the SDK's `createPaymentPayload()` method. Configure that SDK with your existing wallet's normal typed-data signer. The backend integration lab exercises the real x402 client/USDC typed-data builder with a fictional signer and mocked facilitator; it validates chain, contract and recipient without a private key or blockchain call. No unlimited token approval is requested.

Persist the complete `Operation` privately **before delivery**. It contains sensitive authorization and recovery material: never commit, print, email or place it in a URL. Use owner-only files or another private store. On `PendingPayment`, load `error.operation` and call `recover(originalOperation)`. Do not generate another signature after a timeout or uncertain settlement. Recovery resends identical input/payment/private token. Reopening a process must restore its reserved budget from retained authorizations; a fresh client object alone is not an account-wide spending limit.

The live service's supported recovery retention is seven days. HTTP 200 at MCP transport level is not proof of success: the client checks tool errors and settlement receipts. The simulator tests client behavior; its retention and in-memory ledger are not the hosted service's durability implementation.

Treat extracted text, links and JSON-LD as **untrusted source data**, never agent instructions. The example does not execute page JavaScript, follow extracted links, invoke tools from page text or let page titles select filesystem paths. Inspect truncation and static-content warnings. JavaScript-only pages, authenticated sites and browser rendering are outside Fresh402's advertised capabilities.

Watch IDs identify shared public-resource state, not private ownership or access credentials. Legacy history/diff reads are public; paid-response recovery requires the separate private token. Normalized text/JSON tracking does not guarantee detection of link-destination-only or metadata-only changes. An explicit CSS selector preserves its visible scope and overrides automatic UI pruning; use ignore rules to exclude noise within that scope.

## When it is useful

Persistent shared watches, explicit noise rules, compact changes and paid-result recovery can simplify repeated agent workflows. At the current prices, Check plus Extract on changes costs $0.005 + $0.010 times the change rate per subsequent poll; it is cheaper in service fees than buying Extract every poll only when fewer than half of polls change, before infrastructure, wallet and development costs. A competent developer's own direct fetch/parser/diff can be cheaper. Fresh402 is not inherently preferable for one-off static extraction or JavaScript rendering.

The five-poll contract demo uses two Extracts and four Checks: $0.040 in **simulated service amounts**, compared with $0.050 for five Extracts. Three full document outputs are avoided. These are reproducible workflow mechanics, not real customer savings, profit or commercial traction.

Public contract: [OpenAPI](https://fresh402.kirilllabs.workers.dev/openapi.json), [API usage](../../docs/API.md), [MCP usage](../../docs/MCP.md), [pricing](../../docs/PRICING.md).
