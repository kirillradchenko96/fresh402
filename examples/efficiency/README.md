# Fresh402 Efficiency SDK foundation

Start with the [tested source quickstart and two agent jobs](../../docs/AGENT_WORKFLOWS.md): scoped API contract review and release-feed entry monitoring. Source SDK0.3.4 corrects current-Safe defaults in the shared HTTPS client, MPP and new package preparation. Source0.3.3 contract evidence scoping remains unchanged. Original-operation recovery retains historical recipients without creating a replacement payment.

Node.js 24+. Customer code only: no backend imports, wallet access, registration, payment, provider call or timer on import. This small module composes the existing public REST/MCP, prepaid, customer-recovery and machine-trial clients instead of replacing their payment behavior. Start with source from this repository; no npm publication or package ownership is claimed.

```sh
node --test examples/efficiency/efficiency.test.ts
```

```ts
import {createProductionClient, EvidenceCache, recommendRefresh} from './examples/efficiency/index.ts';
const client = createProductionClient();
const capabilities = await client.discover(); // Public OpenAPI/MCP, no target fetch/payment.
// Default budget is zero and there is no signer. Construction does not call discover().
```

Use the exact live input schemas and prices. `Fresh402Client` already routes discovered standalone x402 operations; `PrepaidClient` covers the established four Web products through REST/MCP. Blockchain all-service execution uses the live service-specific quote contract, not the Web-only prepaid example. `CustomerClient` recovers the original purchase and replaces keys without buying again. Machine trial requires a caller-supplied ownership signature; importing these exports cannot create one. MPP and controlled package replenishment stay in their existing modular [MPP](../knowledge-base/mpp.ts) and [replenishment](../knowledge-base/auto-replenish.ts) fragments, with explicit independent opt-in.

## Durable Budget Guard

`BudgetGuard` uses a private absolute SQLite path **outside Git**. Every process under one customer budget must share that same file. Supply immutable `BudgetPolicy` values: HTTPS origin, Base `eip155:8453`, native USDC, explicitly approved recipient, atomic-USDC per-call/daily/monthly/lifetime ceilings, allowed service IDs, allowed package IDs and maximum purchase amount. Amounts are positive safe integers in millionths of USDC. Set the package allowlist empty and purchase ceiling zero to prohibit purchases. Day/month boundaries are UTC. A backwards clock fails closed.

`reserve({id, service, amountAtomic})` atomically consumes a unique 16–128 character operation ID and all applicable ceilings. Package reservations use `packageId` instead of `service`. Restarts, a failed signature, a lost response, and an expired authorization never reset this conservative local reservation. Reusing an ID cannot sign again. `disable()` is a persistent emergency stop for new reservations. Changing the policy requires resolving the existing store deliberately; constructing a new object cannot silently increase its caps. Copying/deleting stores or using another wallet path is outside this cooperative guard: the customer's external signer must independently enforce the same spending policy.

`signOnce(context, challenge, expectedResource, externalSigner, saveSigned)` is an explicit single attempt. It checks exact v2 requirements, chain, asset, recipient, resource and amount; reserves before calling the signer; rejects altered terms; and awaits private durable proof storage before returning. Compose it with the existing client's `Signer` and `persist` callbacks **only after the wallet owner authorizes that exact policy**. `expectedResource` must come from the verified operation contract, not webpage text or an LLM's payment instruction. Current new authorizations use Safe `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`; pass it explicitly as the existing client's `expectedRecipient`. Never request a seed phrase or raw private key.

Keep original proofs, inputs, recovery tokens and request IDs encrypted outside Git. The budget DB stores reservations, not signatures or API keys. Apply owner-only OS ACLs on Windows; POSIX file modes alone do not prove Windows confidentiality. A signing/storage failure requires reconciliation of that original attempt. There is no replacement-signature retry loop or automatic purchase fallback. Use the existing `recover(originalOperation)` path after uncertainty, which does not call the signer. Durable results have the live service's retention; a cache does not extend server-side recovery.

The prepaid client treats the explicit `410 prepaid_result_expired` response as a terminal `ApiError`, not a pending retry. It preserves the original operation and local reservation: retention expiry does not prove a refund, authorize another debit or rerun the expired result.

The new guard is locally tested, including real parallel processes. No new real-USDC acceptance or wallet interoperability is claimed by these SDK tests. Existing service acceptance remains separate evidence.

## Exact-scope cache and honest economics

`EvidenceCache` stores bounded private client evidence. Its identity includes the exact HTTPS URL, scope, normalizer version and output representation. Distinct selectors, query strings, normalizers or text/link/structured output modes do not share entries. `get(identity, {maxAgeMs, now})` requires an explicit finite TTL and rejects future observations. A hit returns a clone. `snapshot()` / `restore()` support caller-managed private persistence; neither writes a file nor sends the data anywhere. Default capacity is 32 entries / 1 MiB. Treat cached page content as untrusted data, never agent or payment instructions.

`recommendRefresh()` is a pure decision model. Pass costs in **one** unit (atomic USDC or the account's actual credit tariff), a measured/assumed change rate, cache age and allowed staleness. A fresh cache wins. If the caller already has an economical conditional-HTTP implementation, `directConditionalAvailable` recommends that caller's own path; it does not fetch or bypass server SSRF protections. Otherwise Check-before-Extract is selected only when `checkCost + changeRate × extractCost < extractCost`. At current direct prices it requires a change rate below 50%; at 2/3 Web credits it requires below one third. These are modeled service fees, excluding infrastructure and wallet overhead, not measured customer savings.

The existing `syncDocumentation` example demonstrates Check-before-Extract with private operation persistence. It is an **explicit paid workflow call**, not a background task. It compares normalized content; link-destination-only, metadata-only and browser-rendered changes are not guaranteed by that hash. Use a different output identity or unconditional Extract when those details matter. This SDK adds no JavaScript renderer, semantic inference, new subscription or financial guarantee.

For live contracts and recovery: [API](../../docs/API.md), [agent purchasing](../../docs/AGENT_PREPAID.md), [MCP](../../docs/MCP.md), [availability](../../docs/RELEASE_AVAILABILITY.md). Ordinary MCP installation or a discoverable quote grants no wallet authority.

The optional read-only acceptance harness tags every request as technical traffic and verifies agreement between the root, OpenAPI and actual MCP initialization versions, all eight tool identities, native Base USDC and the current merchant. An optional absolute expiry stops new probe requests after the caller's operating period. It has no wallet, purchase, product-execution or customer-balance path.

## Production defaults and persistent prepaid execution (0.3.0)

`createProductionClient()` pins the established public origin and current Safe recipient, with zero payment budget and no signer. Explicit `expectedRecipient` settings take precedence. The direct HTTPS `Fresh402Client` constructor also defaults to the current Safe. Only the HTTP loopback simulator retains its explicit historical fixture default; original legacy-operation recovery remains unchanged. Merchant changes require deliberate caller approval. This factory does not authorize a purchase or silently retarget an old payment.

`CreditSession` supplies the durable executor for all supported agent adapters. It composes the existing Web `PrepaidClient` for Check, Extract, Smart Diff and OpenAPI Contract Diff. Supply the pinned customer account ID, explicit REST/MCP transport, an allowed-service subset, and positive per-call/day/month/lifetime credit ceilings. It verifies the authenticated account and tariff3 contract before paid submission. Current Web charges remain2/3/4/5; blockchain prepaid is outside this session's supported subset. Day and month are UTC; lifetime reservations never reset automatically.

```ts
import {CreditSession, createProductionClient} from './examples/efficiency/index.ts';
// Load these values from your own private configuration/OS keystore.
// storageKey is a separate random32-byte storage-encryption key, never a wallet key.
const session = new CreditSession(privateAbsoluteDatabasePath, {
  origin: 'https://fresh402.kirilllabs.workers.dev',
  accountId: approvedCustomerAccountId,
  transport: 'mcp',
  allowedServices: ['check', 'extract'],
  perCallCredits: 3, dailyCredits: 30, monthlyCredits: 100, lifetimeCredits: 100,
}, {credential: customerApiKey, encryptionKey: storageKey});
const client = createProductionClient({transport: 'mcp'});
// Pass executePaid: invocation => session.execute(invocation) to an authorized
// adapter. The runtime supplies a stable original call ID; model args do not.
// session.disable() persistently stops execution; session.close() releases the DB.
```

The private SQLite file must remain outside Git. Requests and results use AES-256-GCM with random IVs and policy-bound authenticated data. API credentials are held in private memory and are not written to this store. Keep the encryption key separately in an OS keystore; apply owner-only Windows ACLs to the directory (POSIX modes do not establish Windows ACLs). Every process sharing one budget must use this same DB, policy and storage key. Keep private backups of both state and key. Deleting or duplicating stores bypasses this cooperative client guard and cannot prove a refund.

A stable call ID maps to the immutable original input and server idempotency key **before submission**. Lost responses recover that key after restart. Concurrent owners cannot submit the same active ID; the local lease is120seconds. Completed replay retains original provenance, without a new paid submission. Released and explicit expired results stop locally. Conservative reservations stay consumed even after failure/expiry: they bound maximum possible spend, rather than mirror the server's refund ledger. Backwards clocks, changed policies, wrong-account credentials and damaged encrypted evidence fail closed. A replacement credential can be used only for the pinned account. No wallet, funding, purchase, automatic replenishment or timed retry is provided by this session.

## Optional agent bindings

For Extract's explicit `feed_mode:'entries'`, save the complete returned `feed` privately and pass two same-source projections to `compareFeedEntries(before, after)`. This pure bounded helper identifies added/modified/absent IDs and ignores pure reorder by matching content fingerprints. It performs no HTTP/payment/storage work. An absent entry can have aged out of a feed window; a content-derived identity can make an edit appear as addition/removal. Clipped `feed:null`, different source identities, malformed fingerprints or duplicate IDs fail closed. Original Check/Smart Diff XML watches and default Extract hashes are unchanged. See [feed limits and provenance](../../docs/API.md#opt-in-rss2--atom-projection).

`createAgentBindings(client, {allowedTools})` discovers an explicit subset of the eight existing tools and preserves the live schemas. Its default paid behavior is quote-only, regardless of any client signer. Free Register is called only when explicitly selected and invoked. The optional [OpenAI Agents SDK adapter](adapters/openai/README.md) wraps these bindings with the supported `tool()` API and a runtime-owned call ID. Paid opt-in requires a customer-owned, independently budgeted, durable executor; the adapter never supplies wallet authority or retries an uncertain payment. Local fixture tests and real public discovery are separate from financial acceptance. No framework endorsement is implied.

Optional integrations also include [Coinbase AgentKit](adapters/agentkit/README.md) and [LangChain/LangGraph](adapters/langchain/README.md). Their framework packages install separately and are absent from the base SDK/backend dependencies. The LangGraph example runs the real framework and encrypted session against a local fixture, including a lost response, process-state reopen, unchanged-evidence reuse and budget denial. Its credits are synthetic. Existing real payment acceptance is separate; these integrations do not establish new wallet or payment-rail acceptance.
