# Fresh402 SDK

The reviewed next client package is fresh402-sdk@0.4.0-rc.2, licensed under MIT. npm publication is pending account access; the currently published version is 0.4.0-rc.1. The updated source clients are available in this repository. The source-client compatibility version remains 0.3.6; the hosted API has its own version. This license covers the package's public client files and accompanying documentation only, not the private Fresh402 backend or unrelated repository contents.

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


Version 0.4.0-rc.2 adds authenticated prepaid Base quotes and execution to `PrepaidClient`. Call `await client.quoteRemote('token_facts')` before `client.execute('token_facts', input)`. The Web tariff remains 3; Base uses tariff 4 and 4/8/4 credits. An ineligible legacy key is not upgraded by the SDK. Exact original recovery, durable private persistence and the finite client credit cap remain mandatory. New packages use the all-service v4 IDs and explicit accepted terms, with finalized funding.

Use an explicit package version when installing; do not assume the `next` tag has advanced. The existing published rc.1 prepaid client supports four Web tools; use the reviewed source clients for seven-service prepaid execution until rc.2 is independently visible on npm.
