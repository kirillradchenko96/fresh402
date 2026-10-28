# Prepaid client preview

Historical integration proposal. The current deployed 2.5 contract, approved package prices and terms are documented in [the agent purchasing guide](../../docs/AGENT_PREPAID.md) and [live plans](https://api.fresh402.com/v2/prepaid/plans). Use those current sources; this page is not the purchasing contract.

The example has no automatic payment fallback. It can inspect a balance, obtain an account-specific versioned quote, reserve an explicit local credit budget, and recover the original idempotency key. A 402 balance error stops execution. Unknown pricing contracts stop execution. Previously saved operations retain their original tariff and maximum charge.

Run the local client-contract simulator without a credential or wallet:

```sh
node examples/knowledge-base/prepaid-run.ts --demo
node --test examples/knowledge-base/*.test.ts
```

The simulator uses the historical 1/2/3-credit contract and fictional credits: three operations consume six credits, and recovery does not debit twice. This checks client behavior; it does not run the hosted backend, prove durable D1 accounting, or validate an onchain payment. The separate private integration lab exercises the real application with isolated storage and synthetic funding.

When the operator approves prepaid access and issues your account credential, provide `FRESH402_API_KEY` through a protected process environment. Never put it in command-line arguments, URLs, Git, or logs. Default execution remains disabled:

```sh
node examples/knowledge-base/prepaid-run.ts
# Inspect the returned quote and balance before choosing a total credit cap.
node examples/knowledge-base/prepaid-run.ts --execute --max-credits 20 --url https://example.com/
node examples/knowledge-base/prepaid-run.ts --recover --max-credits 20
```

Persisted operations consume the same cumulative cap on subsequent runs. Keep the local state private. Recovery resends the original input, version, maximum credits and idempotency key; do not discard an uncertain operation and create a replacement.

The quote declares the applicable limits. This preview supports a fixed resource contract and has no selectable Standard/Large classes. An oversized or overly complex input receives a bounded rejection; it cannot silently select a higher price. A permanently released execution returns its reserved credits, while attempt, credential and service limits still constrain repeated failures.

`funding.ts` only validates a future funding challenge and constructs typed data for explicit wallet review. It checks Base 8453, native USDC, recipient, amount, intent resource, nonce and an owner-supplied maximum. It cannot connect a wallet, sign, approve tokens, submit a payment, or claim an unrelated transaction. Package purchase requires a separately approved enabled offer and the payer's normal explicit wallet confirmation.

Fresh402 provides reusable watches, noise rules, structured differences and recovery. Direct Node HTTP fetching with local parsing/comparison can cost less in service fees. Check plus conditional Extract is cheaper than repeated Extract only when the actual quoted prices satisfy `CheckPrice + changeRate * ExtractPrice < ExtractPrice`; some tariffs do not satisfy this condition at any positive change rate. Smart Diff adds an explanation cost. Browser rendering and authenticated pages remain outside the advertised API.
