# OpenAI Agents SDK adapter

Optional customer-side integration, tested with the actual `@openai/agents` 0.21.0 library on Node.js 24. This is a Fresh402 example, not an OpenAI partnership. No model API request, wallet connection, signature, purchase or product execution happens on import. A model run has its own provider cost and needs the customer's own authorization.

From a checkout of this public repository:

```sh
cd examples/efficiency/adapters/openai
npm ci --ignore-scripts
node --test tools.test.ts
```

```ts
import {Agent} from '@openai/agents';
import {Fresh402Client} from '../../index.ts';
import {createOpenAITools} from './tools.ts';

const client = new Fresh402Client('https://fresh402.kirilllabs.workers.dev', {
  transport: 'mcp',
  expectedRecipient: '0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3',
});
const tools = await createOpenAITools(client, {
  allowedTools: ['fresh402_check', 'fresh402_extract'],
}); // Explicit metadata reads only. No product call or signature.
const agent = new Agent({name: 'Documentation observer', tools});
// Construction is free of model calls. Invoke your own authorized model runner separately.
```

The default mode is **quote-only** even if a signer was attached to `client`. Paid tools return public payment terms, not a paid result. Add `fresh402_register` to the explicit allowlist only when you want an agent to create/reuse a watch; registration is free but fetches the supplied public URL. Save its `watch_id` and reuse that exact scope. Select only the tools your task needs to avoid sending eight full schemas to every model request.

Arguments have the shape `{ "input": { "watch_id": "<your-real-watch-id>" } }`. The adapter nests the **unchanged live input schema** under `input`, including conditional URL/watch rules and parameter descriptions. `strict: false` preserves existing optional/default semantics; it does not disable Fresh402 validation. The SDK's non-strict schema type uses an open outer wrapper; this handler explicitly rejects extra wrapper keys. Nested raw JSON Schema is not locally validated by this adapter: the service still checks actual arguments. Successful local tool construction is not evidence that every model provider accepts every schema.

For paid execution, explicitly choose `mode: 'authorized'` and provide `executePaid({tool, input, callId})`. This customer-owned callback must enforce independent wallet/credit budgets, durably map the stable runtime call ID to the original operation **before submission**, and recover that same operation after interruption. Return `{result: publicResult}` only. Never return credentials, proofs, recovery tokens or an entire operation object. The adapter cannot establish that an arbitrary callback enforces the policy. Paid tools also retain the SDK's `needsApproval: true`; use the SDK's supported approval/resume mechanism. No payment credential is accepted as a model parameter.

The existing [budget guard](../../README.md) and private `persist`/`recover` clients provide the building blocks. A new model tool call ID is not proof that a prior uncertain operation failed. The adapter has no automatic payment retry, package purchase, refund or replacement-signature path. Missing runtime call IDs deny paid execution. Pending/error results contain safe status fields and instructions to reconcile the original operation; private operation objects and exception messages are excluded.

For the supported prepaid Web subset, the SDK now supplies `CreditSession`: set `executePaid: invocation => session.execute(invocation)` to reuse its encrypted original-operation store, pinned account/transport, and credit ceilings. This keeps the existing adapter and approval behavior intact, while removing the need to build a separate prepaid state manager. Configure it from the [shared SDK example](../../README.md).

Actual framework construction/invocation, schema preservation, call-ID propagation, approval metadata and redaction are tested offline. Live public metadata has been checked separately. **No real payment or paid OpenAI model run was performed for this adapter.**

Official API context: [OpenAI tools](https://developers.openai.com/api/docs/guides/tools), [Agents SDK](https://developers.openai.com/api/docs/guides/agents/sdk).
