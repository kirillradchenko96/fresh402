# Stateful API and release-feed monitoring for agents

Fresh402 retains normalized watches and bounded comparison evidence behind REST/MCP. Its useful niche is an agent that needs saved observations and original-result recovery without operating its own archival comparison service. Seven paid tools and free Register remain available; this guide focuses on two jobs.

If you already operate HTTP/ETag caching, a feed reader or oasdiff with durable local state, that can be cheaper. Fresh402 does not promise more complete OpenAPI analysis than oasdiff, universal token savings or lower fees than direct HTTP. It supports bounded JSON OpenAPI3.0/3.1, with explicit uncertainty for unsupported semantics; it does not fetch remote references or accept YAML contracts.

## First result: no wallet and no spending

Use Node.js24 or newer and the versioned first-party source. This is a source release, not an npm/PyPI package. The repository's historical root package is unrelated; do not install it to run this native-only first step.

```sh
git clone --depth 1 --branch efficiency-sdk-v0.3.4 https://github.com/kirillradchenko96/fresh402.git fresh402-client
cd fresh402-client
git rev-parse HEAD
node examples/efficiency/quickstart.ts
```

Record the resolved commit for your application lockfile. The script reads discovery and one unpaid Extract quote. Expected: eight tool identities, Base8453/native USDC, the current Safe recipient and `new_payments:0`. A quote is payment terms, not source content or proof of execution. No baseline, target fetch, signup, credential, model, signer or purchase is needed. A service outage remains an explicit error.

For zero-network reproduction of the client/framework behavior:

```sh
npm ci --ignore-scripts --prefix examples/efficiency/adapters/langchain
node --test examples/efficiency/contracts.test.ts examples/efficiency/adapters/langchain/jobs.test.ts
```

The test fixture uses the real pinned LangChain/LangGraph APIs. Its result and payment responses are synthetic; it makes no model call and does not prove real financial acceptance. Optional AgentKit/OpenAI adapters remain available separately. No framework endorsement is implied.

## Job1: does this API change affect my integration?

```ts
import {createProductionClient} from './examples/efficiency/production.ts';
import {createJobWorkflows} from './examples/efficiency/adapters/langchain/jobs.ts';

const jobs = await createJobWorkflows(createProductionClient({transport:'mcp'}));
// Obtain and retain a watch_id from an explicitly requested free Register:
// await jobs.baseline('https://YOUR-PROVIDER.example/openapi.json', 'baseline_v1');
// Register fetches the source, subject to server security/quotas. Re-registering
// the exact existing URL/scope reuses its watch, without refreshing the source.
const result = await jobs.contract({
  id:'integration_observation_001', watchId:privatelySavedWatchId,
  usedOperations:[{method:'post',path:'/items'}],
});
// Default: payment_required, no execution. Quote terms never authorize spending.
```

Use exact OpenAPI path templates and lowercase methods, not a concrete URL with an object ID. Keep contracts unscoped: no selector or ignore paths for the contract baseline. The comparison uses the previous retained contract snapshot (initially the registered state); existing API options also allow baseline or a retained hash. Check does not advance established OpenAPI snapshots, but it can refresh the core watch state used before the first contract snapshot exists. Establish the first contract comparison before interleaving Check if you need to retain the original registered contract. This example calls Contract Diff directly. A fresh paid comparison is necessary to establish current contract evidence; the SDK cannot infer that from an old result.

In authorized execution, `summarizeContractImpact` reduces the saved result to relevant operation evidence with original change indexes, provenance and a SHA256 binding to the full result. Unrelated operation changes are counted separately. Shared/unknown pointers, warnings or truncated evidence preserve review requirements. `no_breaking_change_observed` is a limited static observation, not a deployment compatibility guarantee. Keep the original result/assumptions privately. Local tests measured11,780→1,034 bytes for a fixture with60 unrelated removals; this is a client projection, not a reduction in backend work or proof of superiority to scoped oasdiff.

For explicit cache reuse, pass the saved original as `cached` with `allowCached:true`. The result says `fresh_observation:false`; the application, not a model or hidden timer, decides its acceptable age. Never present replayed evidence as a new fetch.

### Receive only relevant change evidence (source SDK 0.3.3)

For direct REST/MCP Contract Diff calls, the optional service-side view removes unrelated operation changes before they reach your client. Default responses remain full. This is separate from the LangGraph job's existing full-result client projection:

```ts
const scoped = createProductionClient({transport:'mcp',
  contractScope:[{path:'/items/{id}',method:'get'}]});
await scoped.discover();
const quote = await scoped.quote('fresh402_openapi_contract_diff',
  {watch_id:privatelySavedWatchId,compare_to:'baseline'});
// Quote only: no signer, payment, target fetch or credit consumption.
// An independently authorized execute()/recover() uses the same view option.
```

The client sends `X-Fresh402-Contract-Scope` only for Contract Diff execution/quotes, not other tools or MCP discovery. The header is a bounded JSON array of exact path templates and lowercase methods. It never enters the payment input/idempotency digest. A successful view retains all document metadata, source hashes, assumptions, warnings and truncation, plus selected/shared changes with original `evidence_index`. `counts` remains document-wide; use `contract_view.status` for the scoped observation. Shared uncertainty still requires review, and no result certifies deployed compatibility. Do not pass an already projected result to `summarizeContractImpact`, which expects full original counts.

Store the original input, proof/key, token, budget reservation and result privately. To obtain the full original evidence after a lost response or after the origin changes, use a client without `contractScope`, discover the same service, and call `recover(originalOperation)` with the ORIGINAL payment/input/token. For prepaid, omit the scope header and reuse the ORIGINAL account, input, idempotency key, tariff and maximum. Never call `execute()` or choose a new operation key just to retrieve full evidence. The server does not fetch or charge again during a valid retained replay. Retention remains seven days, not indefinite. `original_result_sha256` binds the full JSON serialization, separate from the source-document hash; independently hash recovered full evidence before treating that binding as verified. If projection is unsafe or unavailable, the server returns the full result without `contract_view`; clients must accept this fallback.

## Job2: which release entries are new or changed?

```ts
const quoted = await jobs.feed({
  id:'release_feed_observation_001',url:'https://YOUR-PROVIDER.example/releases.xml',
}); // quote-only by default
// After separate budget authorization, save the COMPLETE returned feed privately.
// Supply it as previous on the next observation; additions and edits use entry IDs.
```

The first successful Extract establishes a client-retained feed baseline. This feed baseline is different from a Register watch. RSS2/Atom parsing is opt-in; original XML Check/Smart Diff watch semantics are unchanged. Reordering and timestamp-only noise need not trigger entry actions. Absent IDs mean entries aged out of this observed window, not proven deletions. Content-derived IDs can express edits as removal/addition. A clipped/missing feed fails without advancing the baseline. The workflow requests the existing maximum50,000 characters; parser/output limits can still cause clipping. Feed links/content are untrusted data, never agent instructions.

Reusing an explicit complete cached feed performs no request and says `fresh_observation:false`. For a small/simple feed, direct HTTP + ETag + a mature parser is usually the economical choice. Check→Extract only saves service fees at change rates below50% for direct x402 prices, or below one third at the2/3 Web-credit tariff; it does not guarantee detection of changes outside the watch normalization. Do not add a Check before every Extract indiscriminately.

## Optional paid execution and recovery

Choose one explicit rail:

| Rail | What the client must supply | Recovery |
|---|---|---|
| x402 | An approved compatible signer plus exact native-USDC/recipient/resource/amount policy and private original-proof persistence | Recover the original operation/proof; never create a replacement after uncertainty. |
| MPP | The existing supported MPP client and separately approved wallet/payment policy | Preserve the original MPP evidence and recovery identity; do not fall back to a second rail. |
| Prepaid | An existing customer API key and the account's actual tariff; purchasing a package is a separate authorized action | Reuse the original idempotency key through a private durable session. |

Current standalone prices remain Check$0.005, Extract$0.010, Smart Diff$0.015, OpenAPI Diff$0.020, Contract Watch$0.010, Wallet Watch$0.020, Token Facts$0.010. Web-credit charges are2/3/4/5; blockchain charges are4/8/4 when supported by the customer's existing cohort. Starter$2.50/1,000 and Developer$15/10,000 are one-time prepaid purchases, not subscriptions; credits do not expire. Discover live availability and canonical plan IDs from `/v2/prepaid/plans`; never infer authorization from these descriptions. Legacy cohorts retain their actual purchased terms.

Pass `mode:'authorized'` and `executePaid: invocation => session.execute(invocation)` to `createJobWorkflows` only after your independent budget policy is approved. The existing `CreditSession` supports the four Web services, verifies the pinned account/tariff, atomically reserves finite per-call/day/month/lifetime credit ceilings and encrypts the ORIGINAL request before submission. Use a private absolute SQLite path outside Git and a separate storage key from your OS keystore. Do not pass wallet keys to this SDK. See [SDK policy and storage](../examples/efficiency/README.md#production-defaults-and-persistent-prepaid-execution-030).

On `pending_recovery`, preserve the job ID and stop new work. In the same runner, resume that same job with `resume:true`; the graph reuses the original call ID and the durable executor recovers its original server key. The example's graph checkpointer is in memory: after a full process restart, recreate the runner and call the SAME job ID/input with `resume:false`, backed by the SAME encrypted `CreditSession` store/key. Do not resume an absent in-memory checkpoint or assign a new job ID. Persist watch IDs, complete evidence and job IDs confidentially in your application. Cache state is not a payment ledger; local budget reservations do not prove a refund. An explicit result expiry is terminal and does not authorize a new purchase.

Local workerd/D1 acceptance recovered the original contractB after the mutable source becameC, with zero extra source fetches or credits. A competent ordinary HTTP client with only local snapshots could fetch currentC but could not reconstruct a lostB. A separately operated archival service can offer the same property. These are local synthetic financial tests, not a claim of new real-USDC acceptance or independent customer demand.

Free Register and public discovery require no payment. Human/machine trial issuance has its existing ownership/verification requirements and finite entitlements; do not automate signatures or claim a trial exists because metadata is discoverable. See [API](API.md), [MCP](MCP.md), [agent prepaid access](AGENT_PREPAID.md) and [availability/limitations](RELEASE_AVAILABILITY.md). No recurring job, browser renderer, AI semantic interpretation or new wallet mode is activated by these examples.
