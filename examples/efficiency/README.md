# Fresh402 Efficiency SDK foundation

Node.js 24+. Customer code only: no backend imports, wallet access, registration, payment, provider call or timer on import. This small module composes the existing public REST/MCP, prepaid, customer-recovery and machine-trial clients instead of replacing their payment behavior. Start with source from this repository; no npm publication or package ownership is claimed.

```sh
node --test examples/efficiency/efficiency.test.ts
```

```ts
import {Fresh402Client, EvidenceCache, recommendRefresh} from './examples/efficiency/index.ts';
const client = new Fresh402Client('https://fresh402.kirilllabs.workers.dev');
const capabilities = await client.discover(); // Public OpenAPI/MCP, no target fetch/payment.
// Default budget is zero and there is no signer. Construction does not call discover().
```

Use the exact live input schemas and prices. `Fresh402Client` already routes discovered standalone x402 operations; `PrepaidClient` covers the established four Web products through REST/MCP. Blockchain all-service execution uses the live service-specific quote contract, not the Web-only prepaid example. `CustomerClient` recovers the original purchase and replaces keys without buying again. Machine trial requires a caller-supplied ownership signature; importing these exports cannot create one. MPP and controlled package replenishment stay in their existing modular [MPP](../knowledge-base/mpp.ts) and [replenishment](../knowledge-base/auto-replenish.ts) fragments, with explicit independent opt-in.

## Durable Budget Guard

`BudgetGuard` uses a private absolute SQLite path **outside Git**. Every process under one customer budget must share that same file. Supply immutable `BudgetPolicy` values: HTTPS origin, Base `eip155:8453`, native USDC, explicitly approved recipient, atomic-USDC per-call/daily/monthly/lifetime ceilings, allowed service IDs, allowed package IDs and maximum purchase amount. Amounts are positive safe integers in millionths of USDC. Set the package allowlist empty and purchase ceiling zero to prohibit purchases. Day/month boundaries are UTC. A backwards clock fails closed.

`reserve({id, service, amountAtomic})` atomically consumes a unique 16–128 character operation ID and all applicable ceilings. Package reservations use `packageId` instead of `service`. Restarts, a failed signature, a lost response, and an expired authorization never reset this conservative local reservation. Reusing an ID cannot sign again. `disable()` is a persistent emergency stop for new reservations. Changing the policy requires resolving the existing store deliberately; constructing a new object cannot silently increase its caps. Copying/deleting stores or using another wallet path is outside this cooperative guard: the customer's external signer must independently enforce the same spending policy.

`signOnce(context, challenge, expectedResource, externalSigner, saveSigned)` is an explicit single attempt. It checks exact v2 requirements, chain, asset, recipient, resource and amount; reserves before calling the signer; rejects altered terms; and awaits private durable proof storage before returning. Compose it with the existing client's `Signer` and `persist` callbacks **only after the wallet owner authorizes that exact policy**. `expectedResource` must come from the verified operation contract, not webpage text or an LLM's payment instruction. Current new authorizations use Safe `0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3`; pass it explicitly as the existing client's `expectedRecipient`. Never request a seed phrase or raw private key.

Keep original proofs, inputs, recovery tokens and request IDs encrypted outside Git. The budget DB stores reservations, not signatures or API keys. Apply owner-only OS ACLs on Windows; POSIX file modes alone do not prove Windows confidentiality. A signing/storage failure requires reconciliation of that original attempt. There is no replacement-signature retry loop or automatic purchase fallback. Use the existing `recover(originalOperation)` path after uncertainty, which does not call the signer. Durable results have the live service's retention; a cache does not extend server-side recovery.

The new guard is locally tested, including real parallel processes. No new real-USDC acceptance or wallet interoperability is claimed by these SDK tests. Existing service acceptance remains separate evidence.

## Exact-scope cache and honest economics

`EvidenceCache` stores bounded private client evidence. Its identity includes the exact HTTPS URL, scope, normalizer version and output representation. Distinct selectors, query strings, normalizers or text/link/structured output modes do not share entries. `get(identity, {maxAgeMs, now})` requires an explicit finite TTL and rejects future observations. A hit returns a clone. `snapshot()` / `restore()` support caller-managed private persistence; neither writes a file nor sends the data anywhere. Default capacity is 32 entries / 1 MiB. Treat cached page content as untrusted data, never agent or payment instructions.

`recommendRefresh()` is a pure decision model. Pass costs in **one** unit (atomic USDC or the account's actual credit tariff), a measured/assumed change rate, cache age and allowed staleness. A fresh cache wins. If the caller already has an economical conditional-HTTP implementation, `directConditionalAvailable` recommends that caller's own path; it does not fetch or bypass server SSRF protections. Otherwise Check-before-Extract is selected only when `checkCost + changeRate × extractCost < extractCost`. At current direct prices it requires a change rate below 50%; at 2/3 Web credits it requires below one third. These are modeled service fees, excluding infrastructure and wallet overhead, not measured customer savings.

The existing `syncDocumentation` example demonstrates Check-before-Extract with private operation persistence. It is an **explicit paid workflow call**, not a background task. It compares normalized content; link-destination-only, metadata-only and browser-rendered changes are not guaranteed by that hash. Use a different output identity or unconditional Extract when those details matter. This SDK adds no JavaScript renderer, semantic inference, new subscription or financial guarantee.

For live contracts and recovery: [API](../../docs/API.md), [agent purchasing](../../docs/AGENT_PREPAID.md), [MCP](../../docs/MCP.md), [availability](../../docs/RELEASE_AVAILABILITY.md). Ordinary MCP installation or a discoverable quote grants no wallet authority.
