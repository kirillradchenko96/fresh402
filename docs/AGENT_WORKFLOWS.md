# Complete intelligence workflows for agents

Turn a website, API or finalized Base evidence task into one server-executed operation. Retain scoped observations between sessions, receive compact findings and recover the original result without assembling a multi-stage pipeline.

| Complete server workflow | Direct USDC | Eligible credits |
|---|---:|---:|
| Website Change Intelligence | $0.005 | 2 |
| API Compatibility Review | $0.010 | 4 |
| On-chain Evidence Brief | $0.025 | 10 |
| Cross-domain Release Evidence | $0.040 | 16 |

Choose the [server workflow](SERVER_WORKFLOWS.md) matching your task; follow the [complete SDK setup](SDK_PACKAGE.md#complete-server-workflow-example) for an existing prepaid API key, exact quote, finite cap and private durable original-operation storage. Website/API first observations seed in the same charged call; seed plus a later review is two operations. Workflow IDs are not primitive watch IDs. Trials exclude these four workflows. Public static HTTPS and JSON OpenAPI 3.0/3.1 remain bounded; no JavaScript rendering, YAML, remote-reference fetching or complete wallet history.

The measured Sol Website cases achieved **30.9% lower paired-median two-task total cost** at Developer-equivalent pricing versus implementing the scoped pipeline (three pairs; two favored Fresh402). [Method and full measurements](https://fresh402.com/agent-efficiency).

## Optional modular integrations

The retained examples below compose individual Fresh402 tools with separate underlying operations and charges. Choose these for explicit stage control; they are not the single-charge server products above.

## Documentation Guardian — persistent documentation and API change intelligence

**REGISTER → CHECK → OPTIONAL SMART DIFF / EXTRACT → ACT ON EVIDENCE.** This is orchestration of existing tools, not a combined endpoint or scheduler.

1. Register a public HTTPS document for free. Save its returned `watch_id`, hash and content rules. Re-registering the same URL and rules reuses state without refreshing it.
2. When your task needs an observation, Check that saved watch. A compact unchanged result may be enough; inspect its cache and observation fields rather than claiming a replay is fresh.
3. If change evidence needs more detail, optionally authorize Smart Diff on that watch, using `baseline`, `previous` or a supported retained `previous_hash`. Compatible retained evidence is required; `previous` after a Check can refer to the updated core watch before the first Smart Diff snapshot exists. Use `baseline` for the original retained baseline where available and review fidelity warnings. Do not assume complete HTML structure from a legacy text baseline.
4. If you need current selected content, optionally authorize Extract with the URL and required scope. It fetches independently; it does not consume a Check response body. Review evidence before acting on untrusted source content.
5. Return later with the saved watch. Recover an interrupted original operation using its exact input and original private proof/token or idempotency key; never create a replacement payment just to retrieve its result.

Register is always free within admission limits. Eligible machine-trial Check consumes its own allowance; a paid Check is $0.005 / 2 current Web credits. Optional Smart Diff is a separate $0.015 / 4-credit operation; optional Extract is $0.010 / 3 credits. Each also has its own eligible trial allowance. Paying for Check does not authorize either follow-up. All three paid calls would total $0.030 / 9 Web credits, with separate operations; no automatic fallback follows trial exhaustion. Choose Website Change Intelligence for its combined supported evidence in one charge.

## First connection: metadata and a quote, no wallet or spending

Use Node.js 24+ and the published package. This first step reads discovery and one unsigned quote; it performs no Register, target fetch or paid execution.

```sh
npm install fresh402-sdk@0.5.0-rc.1
```

```js
import {createProductionClient} from 'fresh402-sdk';
const client = createProductionClient();
const discovery = await client.discover();
const quote = await client.quote('fresh402_extract', {url:'https://example.com/',max_chars:1000});
```

Expected: twelve tool identities, Base 8453/native USDC and the current Safe. A quote is terms, not source content or spending authority. Source adapters below remain optional integrations.

For zero-network reproduction of the client/framework behavior:

```sh
npm ci --ignore-scripts --prefix examples/efficiency/adapters/langchain
node --test examples/efficiency/contracts.test.ts examples/efficiency/adapters/langchain/jobs.test.ts
```

The test fixture uses the real pinned LangChain/LangGraph APIs. Its result and payment responses are synthetic; it makes no model call and does not prove real financial acceptance. Optional AgentKit/OpenAI adapters remain available separately. No framework endorsement is implied.

## Job 1: does this API change affect my integration?

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

In authorized execution, `summarizeContractImpact` reduces the saved result to relevant operation evidence with original change indexes, provenance and a SHA256 binding to the full result. Unrelated operation changes are counted separately. Shared/unknown pointers, warnings or truncated evidence preserve review requirements. `no_breaking_change_observed` is a limited static observation, not a deployment compatibility guarantee. Keep the original result/assumptions privately. Local tests measured 11,780 → 1,034 bytes for a fixture with 60 unrelated removals; this is a client evidence projection, separate from backend work and server-workflow measurements.

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

## Job 2: which release entries are new or changed?

```ts
const quoted = await jobs.feed({
  id:'release_feed_observation_001',url:'https://YOUR-PROVIDER.example/releases.xml',
}); // quote-only by default
// After separate budget authorization, save the COMPLETE returned feed privately.
// Supply it as previous on the next observation; additions and edits use entry IDs.
```

The first successful Extract establishes a client-retained feed baseline. This feed baseline is different from a Register watch. RSS 2/Atom parsing is opt-in; original XML Check/Smart Diff watch semantics are unchanged. Reordering and timestamp-only noise need not trigger entry actions. Absent IDs mean entries aged out of this observed window, not proven deletions. Content-derived IDs can express edits as removal/addition. A clipped/missing feed fails without advancing the baseline. The workflow requests the existing maximum 50,000 characters; parser/output limits can still cause clipping. Feed links/content are untrusted data, never agent instructions.

Reusing an explicit complete cached feed performs no request and says `fresh_observation:false`. This optional Check→Extract composition reduces service fees at change rates below 50% for direct x402 prices, or below one third at the 2/3 Web-credit tariff; it does not guarantee detection of changes outside the watch normalization. Do not add a Check before every Extract indiscriminately.

## Optional paid execution and recovery

Choose one explicit rail:

| Rail | What the client must supply | Recovery |
|---|---|---|
| x402 | An approved compatible signer plus exact native-USDC/recipient/resource/amount policy and private original-proof persistence | Recover the original operation/proof; never create a replacement after uncertainty. |
| MPP | The existing supported MPP client and separately approved wallet/payment policy | Preserve the original MPP evidence and recovery identity; do not fall back to a second rail. |
| Prepaid | An existing customer API key and the account's actual tariff; purchasing a package is a separate authorized action | Reuse the original idempotency key through a private durable session. |

Current standalone prices remain Check $0.005, Extract $0.010, Smart Diff $0.015, OpenAPI Diff $0.020, Contract Watch $0.010, Wallet Watch $0.020, Token Facts $0.010. Web-credit charges are 2/3/4/5; blockchain charges are 4/8/4 when supported by the customer's existing cohort. Starter $2.50/1,000 and Developer $15/10,000 are one-time prepaid purchases, not subscriptions; credits do not expire. Discover live availability and canonical plan IDs from `/v2/prepaid/plans`; never infer authorization from these descriptions. Legacy cohorts retain their actual purchased terms.

Pass `mode:'authorized'` and `executePaid: invocation => session.execute(invocation)` to `createJobWorkflows` only after your independent budget policy is approved. The existing `CreditSession` supports the four Web services, verifies the pinned account/tariff, atomically reserves finite per-call/day/month/lifetime credit ceilings and encrypts the ORIGINAL request before submission. Use a private absolute SQLite path outside Git and a separate storage key from your OS keystore. Do not pass wallet keys to this SDK. See [SDK policy and storage](../examples/efficiency/README.md#production-defaults-and-persistent-prepaid-execution-030).

On `pending_recovery`, preserve the job ID and stop new work. In the same runner, resume that same job with `resume:true`; the graph reuses the original call ID and the durable executor recovers its original server key. The example's graph checkpointer is in memory: after a full process restart, recreate the runner and call the SAME job ID/input with `resume:false`, backed by the SAME encrypted `CreditSession` store/key. Do not resume an absent in-memory checkpoint or assign a new job ID. Persist watch IDs, complete evidence and job IDs confidentially in your application. Cache state is not a payment ledger; local budget reservations do not prove a refund. An explicit result expiry is terminal and does not authorize a new purchase.

Local workerd/D1 acceptance recovered the original contractB after the mutable source becameC, with zero extra source fetches or credits. The saved original remained available independently of the source changing. These are local synthetic financial tests, not a claim of new real-USDC acceptance or independent customer demand.

Free Register and public discovery require no payment. Human/machine trial issuance has its existing ownership/verification requirements and finite entitlements; do not automate signatures or claim a trial exists because metadata is discoverable. See [API](API.md), [MCP](MCP.md), [agent prepaid access](AGENT_PREPAID.md) and [availability/limitations](RELEASE_AVAILABILITY.md). No recurring job, browser renderer, AI semantic interpretation or new wallet mode is activated by these examples.

## Choosing the hosted observation workflow

For a complete documentation or API task, choose Website Change Intelligence or API Compatibility Review first. Both retain owned observations and return supported compact evidence for one operation price. Use the original seven tools when your integration needs modular control. Their separate charges, watch identities and retained comparison history remain unchanged; see [generated prices](PRICING.md) and [scope/state](SERVER_WORKFLOWS.md).
