# Bounded machine trial

Current production API3.0.2 advertises the separate machine trial as enabled, verified through root, GET /v3/agent-trial and an unpaid challenge. Earlier disabled-pending-acceptance notes are historical. This is not a new allowance or activation. Existing authorization ends November14,2026 at09:00UTC (00:00AKST); read live availability each time. The human trial has its own flag and Turnstile requirement.

A machine can obtain the exact personal_sign ownership challenge without CAPTCHA or funding. Its owner must separately authorize the wallet-signing policy; this is an unavoidable ownership step, not a human checkout. Standalone x402/MPP requires no trial or customer account. No new live claim or execution is implied by an available challenge.

Inspect `GET /v3/agent-trial` on the canonical API before requesting a challenge. `enabled` is authoritative; a disabled response offers no free execution. This is a separate credential class from the human wallet + Turnstile trial. Human allowances remain unchanged.

An existing unfunded EOA can `POST /v3/agent-trial/challenge` with `{"wallet":"0x…"}`, then sign the exact returned EIP-191 `personal_sign` message. It proves wallet control, not a unique person or agent. No transfer, token approval or purchase is involved. `POST /v3/agent-trial/claim` requires `wallet`, `challenge_id` and its 65-byte `signature`. Extra fields and mixed financial credentials are rejected. No browser or CAPTCHA is required.

Save the returned `fm_` key privately. Send `X-Fresh402-Trial-Key` and a persisted `Idempotency-Key` to a normal tool REST endpoint or MCP HTTP connection. Never combine them with payment/prepaid credentials. MCP contains the same eight tools; an ordinary MCP client does not acquire payment capabilities automatically. Inspect `GET /v3/agent-trial/quota` with the key. Replay the original tool, input and operation key; a new key represents new work. Credential rotation invalidates the earlier key and preserves quotas and original expiry. Maximum lifetime is seven days, further limited by the existing service runtime authorization; an expired identity cannot renew.

Maximum one-time identity allowances: Check 2; each of Extract, Smart Diff, OpenAPI Diff, Contract Watch, Wallet Watch and Token Facts 1. These are admission ceilings, not reserved capacity or a guaranteed complete bundle. Weights are 2/3/4/5/4/8/4 respectively. Shared machine limits are 32 work units/day, 64/month and 8/network/day. New identity issuance is at most 1/network/day, 10 globally/day and 100 profiles over this deployment lifetime. Shared free concurrency is one; paid runtime capacity remains reserved.

Web runtime reservations are capped at 360 seconds/day and 1,200 seconds/month. Blockchain free capacity reserves at most 18 RPC/day globally (one bounded operation), and 18,000 billing units/month. The existing shared 18 RPC/operation, 180/day and 558,000/month ceilings remain; paid headroom is retained. Free blockchain storage is limited to 1 MiB within existing shared storage. DNS/SSRF, input and provider restrictions apply equally. `429` can precede quota exhaustion; there is no automatic paid fallback. `503` means unavailable, not permission to pay.

Use the public [challenge adapter](../examples/knowledge-base/machine-trial.ts); it never connects a wallet, signs, pays or runs on import. Apply the owner's own signing policy. Never publish a trial key, proof or private operation record. No wallet/IP scheme proves Sybil resistance: these limits bound economic exposure instead.

## Start from the website

The [first-party agent quickstart](https://fresh402.com/docs#machine-trial) includes enrollment, an explicit free Check request, quota reads and recovery. The [source SDK guide](https://fresh402.com/docs#sdk) identifies the actual0.3.5 tag; there is no npm publication. An ordinary MCP installation does not grant wallet-signing or payment permission.

The existing120-second reservation per web attempt means the shared machine pool can admit at most3web attempts/day and10/month across ALL identities, before weighted, network, rate and failure limits. Failed attempts can consume infrastructure reservations despite restored product allowance. Thus current2Checks are one-time maxima, not reserved capacity. A100-Check/30-day offer is NOT live. Maximum7-day credentials and operating expiry remain unchanged.
