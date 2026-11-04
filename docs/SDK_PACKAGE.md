# Fresh402 SDK

The compiled public client package is fresh402-sdk@0.4.0-rc.1, released under MIT. The source-client compatibility version remains 0.3.6; the hosted API has its own version. This license covers the package's public client files and accompanying documentation only, not the private Fresh402 backend or unrelated repository contents.

Install the explicit prerelease with `npm install fresh402-sdk@0.4.0-rc.1`, or select `fresh402-sdk@next`. Public-registry clean installation, both exports, a bounded workflow and four tests with the real OpenAI Agents 0.21.0 adapter passed. See [publication provenance](SDK_RELEASE.json).

Node.js 24 or later, ESM only, TypeScript declarations included. Zero runtime dependencies and no install scripts. No CommonJS or browser-wallet support is claimed. The package never creates a wallet, signs a payment or spends on import.

```js
import {createProductionClient, BudgetGuard} from 'fresh402-sdk';
import {runFlagship} from 'fresh402-sdk/workflows';

const client = createProductionClient(); // canonical API, existing Safe, no signer
// Read-only discovery; no paid operation or free Register/Container wakeup.
console.log(typeof client, typeof BudgetGuard, typeof runFlagship);
```

Payment execution needs an explicitly authorized customer-owned signer, reviewed quotes, wallet-wide budgets, private durable storage and original-operation recovery. Workflow orchestration is sequential and bounded; it does not supply those controls on the customer's behalf. Never retry uncertain payments with a new signature.

Workflow and source adapter instructions: https://github.com/kirillradchenko96/fresh402/blob/main/docs/FLAGSHIP_WORKFLOWS.md and https://github.com/kirillradchenko96/fresh402/tree/main/examples/efficiency . OpenAI Agents, AgentKit and LangChain/LangGraph adapters remain separately tested source examples, not bundled integrations or runtime dependencies. No API credentials or signing material are included.
