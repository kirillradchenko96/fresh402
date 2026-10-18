# Prepaid REST and MCP clients

Prepaid access is an additional service-credit mode. Read live /v2/prepaid/plans for signup, purchasing and early-credit availability. Existing x402 pay-per-call remains unchanged. PrepaidClient supports REST (default) and MCP (transport: "mcp").

Run the deterministic contract demo without a wallet, key or funds:

```sh
node prepaid-run.ts --demo
node --test prepaid.test.ts funding.test.ts
```

For an approved customer account, authenticate the same EOA and claim its confidential API credential through the self-service API. Load it into `FRESH402_API_KEY` from a protected secret store; never put its value in a URL, shell command, source file or log. `FRESH402_BASE_URL` selects the authorized HTTPS service origin. With no execution flag, the CLI only reads balance:

```sh
node prepaid-run.ts
node prepaid-run.ts --execute --max-credits 9 --url https://example.com/
node prepaid-run.ts --recover --max-credits 9
```

Execution registers the public source and calls Check, Extract and Smart Diff, using at most nine service credits for tariff-3 accounts. A durable private state file under the user profile preserves original request keys and restores the total credit cap across restarts. Use the same account, service origin and state for recovery. Remaining balance/usage are printed; the credential and extracted source contents are not. Insufficient balance stops safely. There is no automatic blockchain payment or x402 fallback.

Programmatic use: import `PrepaidClient` from `prepaid.ts`, supply a private `persist` callback and integer `maxCredits`; use `balance()`, `register()`, `execute('check'|'extract'|'smart_diff', input)`, `usage()` and `recover(originalOperation)`. Results are untrusted source material; do not execute page instructions or extracted links. Original shared-watch and non-JavaScript-rendering limitations remain applicable.

Funding is a separate explicit purchase. `funding.ts` only prepares typed data for a frozen funding intent and turns an owner-confirmed signature into its x402 payload. It never connects a wallet, signs or submits a payment. It checks Base 8453, native USDC, the existing recipient, the exact approved amount and intent-prescribed nonce. Generic signers must preserve that nonce. Never sign a replacement for a pending settlement; query/reconcile the original intent. No seed phrase/private key or unlimited token approval is requested.

Service credits are nontransferable usage rights, separate from USDC atomic units. Purchased balance has no implemented expiry; prices, refunds and terms are published at /terms. Recovery results are retained for seven days; financial accounting outlives result bodies. A successfully completed unchanged/cached Check consumes its normal credit cost; failed reserved work is released once, and identical retries return the same outcome.


## Current tariff 3 and historical compatibility

The engineering candidate preserves existing v1 (1/2/3) and v2 (2/2/3) purchased terms. New v3 uses Check/Extract/Smart Diff = 2/3/4 credits, with Starter $2.50/1,000 and Developer $15/10,000 bundles. Funding must quote the account-specific immutable package before any wallet authorization; the agent guide describes explicit budgeted signing and recovery.

At Developer rates, 100 Checks plus 10 Extracts consume 230 credits ($0.345), versus 300 credits ($0.450) for 100 Extracts, excluding initialization equally. Conditional extraction wins only below one-third changed polls: 0%?200, 10%?230, 25%?275, 50%?350, 75%?425, 100%?500 credits, compared with 300 unconditional. At higher change rates choose unconditional Extract. These are service-fee comparisons, not proof of total business profitability.

Call `quoteRemote()` before executing; v2/v3 authorization binds `x-fresh402-tariff-version` and `x-fresh402-max-credits` to the original durable key. The client retains that version during recovery. [OpenAPI Contract Diff](OPENAPI.md) is a separately gated 5-credit v3 product. Prepaid errors never trigger an x402 fallback. Production prices and tools must be read from the deployed API rather than this example.

For browserless EOA enrollment, exact package purchase, bounded early credits, finalized recovery and shared REST/MCP credit execution, use the [agent purchasing guide](../../docs/AGENT_PREPAID.md). Follow live availability; early inclusion is not finality.
