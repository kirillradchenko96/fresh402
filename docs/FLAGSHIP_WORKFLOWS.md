# Executable evidence workflows

Use [workflows.ts](../examples/efficiency/workflows.ts) with a customer-controlled executor. It composes existing tools; it adds no endpoint, scheduler, wallet or automatic purchase. Run the controlled examples with `node --test examples/efficiency/workflows.test.ts` from this repository after its validation dependencies are installed. Tests validate every constructed input against the reviewed public OpenAPI. Their changed/unchanged and observation results are **fixtures, not production observations**.

| Workflow | Explicit operations | Maximum current service fees |
|---|---|---:|
| Website change intelligence | Free Register in a separate `phase: "baseline"` run; later Check, then Extract and Smart Diff only if changed | $0.030 / review |
| API compatibility review | Unfiltered Register and `phase: "seed"` OpenAPI Diff ($0.020); later Check and baseline OpenAPI Diff if changed | $0.025 / review, plus initial $0.020 seed |
| On-chain evidence brief | Contract Watch + Wallet Watch + Token Facts | $0.040 |
| Cross-domain release evidence | Check, Extract if changed, Contract Watch | $0.025 |

These are service fees for one completed bounded page/observation, excluding any wallet/provider overhead. No operation here was newly purchased during publication. Cache hits remain billable when paid. Free Register quotas and existing shared limits apply. Direct HTTP/local comparison is often preferable if you already hold both source versions; JavaScript rendering and full wallet history require another service.

```ts
import {runFlagship} from '../examples/efficiency/workflows.ts';

// Application-owned durable store and execution policy are REQUIRED.
// reviewedCosts comes from reviewed OpenAPI offers, not untrusted page text.
const report = await runFlagship('onchain', {
  contract: selectedContract, wallet: selectedWallet, token: selectedToken,
}, {
  runId: durableJobId, costs: reviewedCosts, maxAtomic: 40000,
  store: privateWorkflowStore,
  authorize: confirmEachNewOperation,
  execute: budgetedExecutorUsingOriginalOperationPersistence,
  recover: recoverOriginalPrivateOperation,
});
```

The callback names are application integration points, not supplied credentials or built-in global functions. A normal source client has no signer or spending authority by default. Integrate the existing [agent bindings](../examples/efficiency/agent-tools.ts), [explicit spending guard](../examples/efficiency/README.md), and original-operation recovery. Store proofs, keys and recovery tokens privately outside Git. The workflow journal contains potentially private source evidence; protect it too.

Each new operation needs explicit authorization. Persist the reserved operation before submission. Never replace an uncertain authorization: restart the same run/input/store and supply `recover` for the original operation. Completed steps return saved results; failed/unknown steps retain their reservation. The workflow has no automatic retries. Serialize a run ID; its cooperative per-run ceiling does not replace external wallet-wide concurrency and spend enforcement.

Save real Register watch IDs and reuse them across sessions. Repeated Register does not fetch existing content. Check and Extract fetch independently; their bodies are not a shared snapshot. Smart Diff compares supported retained snapshots; OpenAPI Diff's first call only seeds contract history. A review requires `contract_baseline_seeded: true` backed by that earlier result. No YAML/external references or exhaustive compatibility guarantee.

On-chain tools accept Base 8453 and finalized observations only. Retain owned snapshot/cursor IDs only when `observation_saved` is true. Wallet pages cover selected ERC-20-shaped logs, not full transaction history; provider completeness is not proven. Token metadata is contract-reported, not a safety or investment assessment. Preserve each result's block hash, source, observation time, uncertainty and accounting. Cross-domain reports keep web and chain evidence separate: close timestamps do not establish causation.

The core source SDK remains 0.3.6; these additive orchestration examples are available on current main. npm publication is pending authentication; there is no supported npm installation command yet.
