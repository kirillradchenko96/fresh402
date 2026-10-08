# Paid result recovery and reconciliation

## Client contract

Generate **32 random bytes**, encode as hex/base64url, and persist the secret, exact request arguments and signed payment **before** the first paid call. REST uses `X-Fresh402-Recovery-Token`; MCP uses `params._meta["fresh402/recovery-token"]`. Allowed token syntax is 43–128 URL-safe characters. The server cannot measure randomness: clients must use a cryptographic RNG. Never send this bearer secret in a URL or disclose it in logs.

Retry the original request, payment and secret. Recovery binds service, transport, canonical parsed arguments and the payment proof digest. It returns the saved result/receipt without facilitator verification, target fetch, or another settlement. A transaction hash, watch ID, nonce, or full signed payment alone grants no recovery. EIP-3009 calldata can expose the signature publicly, so the independent token is essential.

The token remains optional to preserve existing 1.1.1 client behavior. Legacy calls without it receive the normal paid response but cannot later retrieve private results without an operator-supported authentication procedure; no insecure fallback is provided. Recovery lasts seven days from reservation. `410 paid_result_expired` never asks the server to debit again. Refunds and wallet-authenticated recovery for lost tokens are not implemented.

## Durable states

| State | Meaning | Retry behavior |
|---|---|---|
| `preparing` | Verified nonce reserved; computation not durably staged | No debit; return pending/error, no automatic re-execution |
| `prepared` | Exact result and trusted SQL plan saved in D1 | No settlement submitted yet; no automatic replacement payment |
| `settling` | Persisted irreversible-boundary marker, then at most one facilitator submission | Outcome can be unknown; withhold content and reconcile |
| `settled` | Successful receipt durably recorded; final snapshot commit pending | Authenticated retry finalizes the saved plan and returns paid data |
| `completed` | Snapshot writes plus completion committed in one D1 batch | Return original saved response and receipt |
| `failed` | Operation error before submission | No charge; authorization remains reserved until expiration |

The claim and operation reservation share a D1 batch. The result and plan must be persisted before `prepared -> settling`. The facilitator adapter performs this compare-and-set; caught SDK hook errors cannot bypass it. x402 2.27.0 can retry `settlement_pending`, but a second adapter invocation cannot pass the state gate and never resubmits to CDP.

Receipt storage and `payment_events` accounting share a D1 batch. Snapshot writes and `completed` share another batch. A completion trigger aborts the entire batch if another finalizer already completed it, preventing duplicate snapshots/check counts. Failed snapshot finalization keeps `settled`, the original result, and the write plan; paid delivery includes `snapshot_saved:false` and `persistence_error`. Concurrent retries can repair it once.

An unresolved `settling` or unfinalized `settled` row also quarantines the normalized target after its 120-second capacity lease expires. Later operations cannot overwrite the target while an older paid write plan remains unresolved. Recovery bypasses expensive-operation admission because it performs no new target work.

## Unavoidable crash window

Blockchain settlement, D1 and HTTP delivery are not atomic. A crash after recording `settling` can occur before submission, during submission, after onchain success, or before receipt storage. That state cannot safely distinguish these outcomes. It is intentionally retained and never retried blindly. A successful facilitator receipt is trusted for normal delivery; independent finalized-chain validation is used for reconciliation. This is not an exactly-once end-to-end promise or automatic refund system.

Operations submitted without a recovery token still have a private durable journal. Operators can investigate their payment status, but neither a known transaction hash nor a public signature is sufficient to release confidential content. Do not invent an unauthenticated support endpoint.

## Operator reconciliation

1. Read-only export only `claim_hash,state,payer,asset,nonce,service,amount_atomic,authorization_expires,receipt_json` for the affected row. Do not export response payloads or secrets into tickets/Git.
2. Obtain the candidate transaction from the payer/facilitator or a trusted chain indexer. A hash is an investigation hint, not authentication.
3. Run the read-only proof checker against a trusted HTTPS Base RPC:

```sh
node scripts/reconcile-payment.mjs operation.json 0xTRANSACTION HTTPS_BASE_RPC reviewed-reconciliation.sql
```

The checker requires Base chain 8453, a successful receipt at/below the RPC finalized block, matching transaction/receipt block identity, a **direct** call to native Base USDC, EIP-3009 calldata matching payer/recipient/amount/nonce/expiry, and matching `AuthorizationUsed` plus `Transfer` events. It rejects indirect/batched calls instead of guessing. A production incident needs trusted RPC evidence, preferably independent-provider confirmation; a mocked fixture does not confirm mainnet payment.

4. Review the generated SQL and affected operation identity. It only updates an existing quarantined row to `settled`, checks all binding fields, and cannot overwrite a different saved receipt. The tool never executes D1 writes or sends blockchain transactions. Applying SQL remotely requires the owner's normal change authorization.
5. The authenticated client retries the original request/token. The Worker finalizes exactly once and accounts for a reconciled payment. For a legacy/no-token incident, the operator needs a separately reviewed authentication/delivery procedure; the script does not release the result.

If no candidate transaction is known, investigate payer/nonce logs through a trusted indexer. Do not treat absence from one query as proof that settlement failed, and do not delete/retry a pending operation automatically. Clearing a quarantined target or authorizing a replacement payment is an operator decision after evidence review. The current tool deliberately does not automate “no payment occurred” decisions.

## Safe cleanup

Prepared Cron: every ten minutes. Each invocation deletes at most 500 claims whose stored expiry (`validBefore + 300 seconds`) passed, removes expired capacity leases, and deletes at most 500 never-submitted/failed operation rows after the same authorization safety window. Settlement independently rejects expired authorizations even if a faulty verifier says valid. Removing expired claims cannot reopen an authorization that remains valid.

At most 100 completed response payloads are scrubbed per invocation after seven days. Financial operation rows, receipts and `payment_events` remain. Settling/settled-but-unfinalized rows and plans are retained for reconciliation, even past retention; no customer watches, snapshots, baselines or financial history are deleted by maintenance. Old nonfinancial daily budget counters are removed after 30 days. Successful finalization clears the no-longer-needed write plan immediately.

The retained financial journal grows with actual payment history, intentionally. Unresolved rows can also grow until an operator resolves incidents; alert on their age/count and on maintenance backlog. This exception is required to preserve financial evidence and avoid opening replay/delivery races. Technical claims and completed payloads have bounded retention and indexed cleanup. Cleanup is tested with active authorizations, crash leases and existing user data.

Sources: [D1 transactional batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [Workers cancellation/runtime limits](https://developers.cloudflare.com/workers/platform/limits/), [CDP settlement API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/settle-payment), [Circle EIP-3009 contract](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol), [native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
