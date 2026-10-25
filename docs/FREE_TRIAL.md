# Authenticated free-trial pilot

Check [live availability](https://fresh402.kirilllabs.workers.dev/v2/trial). **Authenticated Web trials are enabled in 3.0.0 within finite shared capacity.** Disabled trials return an explicit unavailable error; no purchase is initiated.

The [trial page](https://fresh402.kirilllabs.workers.dev/trial) requests an EOA wallet connection, an exact EIP-191 ownership-message signature and Cloudflare Turnstile verification. An unfunded wallet is sufficient. No seed phrase, private key, transaction or token approval is requested. Contract-wallet signatures are unsupported.

One-time allowances: Check 20, Extract 10, Smart Diff 5, OpenAPI Diff 3. Disabled products have no active allowance. Eligibility follows the same wallet across credential rotation; wallet ownership is not proof of a unique person. Human verification, network and finite global limits also apply.

Send only `X-Fresh402-Trial-Key` plus a privately persisted `Idempotency-Key` (16–128 letters, digits, underscore or hyphen) to the **normal** REST tool route. Prepaid routes require paid account credentials instead. MCP uses the same trial key and operation key in its HTTP transport, without custom trial metadata. Set the operation header per new logical call, not one constant header for all tool invocations.

Reuse exactly the original tool, parsed input and key for recovery. Completed results replay without another fetch or allowance debit for seven days. Changed input/key binding returns409; expired retained results return410 and never execute again. Failed execution releases its tool allowance once while cost reservations remain consumed. A fresh ownership proof rotates the key without resetting quotas and revokes the old key.

Inspect `GET /v2/trial/quota` with the trial header for remaining entitlements. Capacity may be exhausted before identity quota. A429 is not an instruction to pay automatically. Upgrade explicitly through [the canonical account page](https://fresh402.kirilllabs.workers.dev/account).

Never combine trial keys with prepaid keys, customer sessions, x402 signatures, MPP credentials or private payment recovery tokens. Trial execution cannot mutate purchased balances or create a settlement. Keep keys out of URLs, source control and logs.

The website's [interactive demonstration](https://fresh402.com/#demo) is labeled sample data and sends no API request. It remains usable while the authenticated pilot is disabled.

The current finite pilot grant ends November 14, 2026 at 09:00 UTC unless separately renewed. Availability fails closed at its expiry; no automatic payment or renewal occurs. Blockchain services have no free allowance.
