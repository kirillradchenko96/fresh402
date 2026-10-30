# Bounded machine trial

## Get your first free Check

1. Inspect [GET /v3/agent-trial](https://api.fresh402.com/v3/agent-trial). Its live `enabled` field is authoritative; stop if disabled.
2. Use an unfunded EOA whose ownership signing you are authorized to perform. Request `POST /v3/agent-trial/challenge` with its nonzero wallet address, then sign only the exact returned EIP-191 `personal_sign` message. No CAPTCHA, USDC, gas, token approval, purchase or browser is required. An ordinary MCP connection cannot supply a signer by itself; never give Fresh402 a private key.
3. Submit `POST /v3/agent-trial/claim` with `wallet`, the original unexpired `challenge_id` and its 65-byte signature. Save the returned `fm_` key privately. Challenges bind the wallet, host and network and are consumed once.
4. Register a public HTTPS source for free and save its actual `watch_id` and hash. Call normal REST Check or `fresh402_check` with `X-Fresh402-Trial-Key` and a privately persisted 16–128 character `Idempotency-Key`.
5. Read `GET /v3/agent-trial/quota` with the trial key to see the remaining allowance. Keep the watch ID for later observations.

Free discovery and Register need no wallet. The ownership signature is for trial enrollment only, not a payment. A wallet proves control, not a unique person or agent. Never mix trial, payment and prepaid credentials.

## Allowance and expiry

- Eligible new identities receive up to **100 Checks**, at most **20/day**, plus at most one each of Extract, Smart Diff, OpenAPI Contract Diff, Contract Watch, Wallet Watch and Token Facts.
- The approved window is **October 30, 2026 00:00 UTC through November 29, 2026 00:00 UTC**. A credential lasts at most 30 days and is clipped to the closing time; late joins get fewer days.
- Existing identities retain their original allowances (including legacy 2 Checks), consumed quota and original expiry. Rotation invalidates the old key without upgrading, renewing or resetting rights. An expired identity cannot renew.
- Purchased credits do not inherit trial expiry. The separate human Web trial retains its own allowances, Turnstile requirement and earlier November 14 operating gate.

An allowance is a maximum entitlement, not reserved infrastructure capacity. Shared admission can return 429 before the allowance is exhausted; 503 means unavailable. Neither authorizes payment. There is no automatic paid continuation.

## Retry, recovery and deliberate paid continuation

Persist the original tool, input and operation key before submission. Replay that exact combination to recover a retained result without another fetch; a new key means new work. Use a new operation key only for a deliberately requested new observation. Keep all keys and signatures private. If choosing paid continuation, separately approve the exact x402/MPP payment or eligible prepaid charge; exhaustion never makes that choice for you.

## Advanced shared limits

New issuance: at most 50/day globally and 10/network/day, bounded by 1,000 machine profiles and 2,000 shared trial identities. There is no ten-new-identities/month acquisition cap. Shared-cloud callers can still collide with network/request/challenge limits; this is not unique-agent or Sybil proof.

The shared expanded Web pool reserves 120 seconds per attempt: at most 500 attempts/day and 10,300 in the approved period before other limits. Calendar-month reservations also have the same period-bound maximum. These totals cover ALL identities; 100 Checks per identity are maximum entitlement, not reserved 100-call capacity. Weighted work: 3,000/day, 25,000/month and 1,000/network/day; weights 2/3/4/5/4/8/4 respectively. Check is bounded to 500/day globally; each other Web sample service to 50/day. Shared trial concurrency is one. State and aggregate delivery limits can deny earlier, particularly for large outputs. Failed work can restore entitlement while retaining infrastructure reservation. Original terminal replay does not perform another fetch.

Physical capacity remains one existing Lite and 4 global slots; free cannot take the final slot or final 20% of atomic global runtime. Minimum paid headroom is not dedicated hardware or a latency guarantee. Blockchain is much tighter: at most 18 machine RPC/day (one fully reserved observation), 18,000 machine units/month (at most 10 observations/month), 1 MiB shared machine domain-delivery reservation. General provider 180 RPC/day, 18/operation and 558,000 units/month remain. The Web pool does not expand the blockchain provider allowance. No agent is guaranteed all three free chain samples.

DNS/SSRF/TLS, provider, source/output, request and financial safeguards remain. 429 can occur before entitlement exhaustion; 503 does not authorize payment. Exhaustion never triggers paid fallback. Persist private original evidence; never publish keys/signatures or choose a replacement payment after uncertainty. [API](API.md), [website enrollment](https://fresh402.com/docs#machine-trial), [source SDK](../examples/efficiency/README.md), [challenge adapter](../examples/knowledge-base/machine-trial.ts). Source SDK 0.3.6/Node 24+, no npm publication; importing it signs/pays nothing.
