# Analytics and conversion

Daily D1 aggregates use only `day`, `service`, `transport`, `event`, `traffic_class`, `count`. There are no request bodies, target URLs, page contents, payment signatures, cookies, IP addresses, raw user agents or API secrets in these counters. Request admission uses Cloudflare's trusted connecting-IP header in the platform rate limiter; this is not persisted in analytics.

| Event | Meaning |
|---|---|
| `discovery` | Root/manifest or MCP initialize/tools-list discovery |
| `documentation` | OpenAPI retrieval |
| `registration_created` | A new successful free baseline |
| `registration_existing` | Repeat registration served from storage without fetching |
| `initial_402` | Unpaid REST challenge or unpaid MCP payment-required result |
| `payment_attempt` | A payment header/meta value was supplied, including malformed/invalid attempts |
| `payment_verified` | Facilitator verified and D1 admitted a fresh authorization identity |
| `payment_settled` | Successful SDK settlement recorded with a unique transaction hash |
| `paid_result` | Operation succeeded and settlement was confirmed |
| `repeat_paid_call` | Settlement from a payer with an earlier recorded settlement |
| `operation_failed` | Work was prepared but failed or did not settle |

`technical` means an explicit `X-Fresh402-Purpose: probe`, or a user-agent containing healthcheck, uptime, probe, monitoring, test/ or vitest (case-insensitive). Everything else is `unclassified`, not a claim of human intent or commercial value. These labels are spoofable. Count externally settled paid use separately when evaluating useful traffic. Do not exclude ordinary AI-agent traffic simply because it is automated.

The existing settlement table retains on-chain transaction ID, payer, network, route, amount and known-test-wallet flag for financial deduplication. It contains no signed payment payload. Repeat counts refer to repeated paying wallets across the service, not identified people or cohorts. Simultaneous first-time payments can undercount repeat events; use the ledger for exact retrospective analysis. Aggregates are best effort and may undercount on crashes/D1 outages. They are not an accounting ledger.

## Operator queries (no public analytics endpoint)

```sql
SELECT day, service, transport, traffic_class, event, SUM(count) AS calls
FROM analytics_daily GROUP BY day, service, transport, traffic_class, event
ORDER BY day DESC, service, event;

SELECT route, is_test_buyer, COUNT(*) AS paid_calls,
       SUM(amount_atomic) / 1000000.0 AS revenue_usdc
FROM payment_events GROUP BY route, is_test_buyer;

SELECT lower(payer) AS wallet, COUNT(*) AS settled_calls
FROM payment_events WHERE is_test_buyer = 0
GROUP BY lower(payer) HAVING COUNT(*) > 1;
```

Use `payment_settled / initial_402` only as an **aggregate funnel indicator**. It is not a user conversion rate: repeated discovery, direct paid calls, different transports and technical probes affect the denominator. Do not equate HTTP 402 volume with revenue.

Review retention operationally. Expired payment claims can be removed only after `expires_at` (authorization expiry plus five minutes); aggregate rows can be archived by date. This beta does not install a production cron or delete historical analytics automatically. Capacity leases are reused after expiry. Snapshot retention is described in the architecture document.
