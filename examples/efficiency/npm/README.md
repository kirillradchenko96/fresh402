# Fresh402 SDK

The client package is `fresh402-sdk@0.5.0-rc.1`, under MIT. Use the exact prerelease version; confirm the version, integrity and `next` tag in the public npm registry. Earlier 0.4.0-rc.2 and the separate `latest` release remain available. The source-client compatibility version remains 0.3.6; the hosted API has its own version. This license covers the package's public client files and accompanying documentation only, not the private Fresh402 backend or unrelated repository contents.

```sh
npm install fresh402-sdk@0.5.0-rc.1
```

Node.js 24 or later, ESM only, TypeScript declarations included. Zero runtime dependencies and no install scripts. No CommonJS or browser-wallet support is claimed. The package never creates a wallet, signs a payment or spends on import.

```js
import {createProductionClient, BudgetGuard} from 'fresh402-sdk';
import {runFlagship} from 'fresh402-sdk/workflows';

const client = createProductionClient(); // canonical API, existing Safe, no signer
// Read-only discovery; no paid operation or free Register/Container wakeup.
console.log(typeof client, typeof BudgetGuard, typeof runFlagship);
```

Direct x402/MPP payments need an explicitly authorized customer-owned signer and wallet-wide budgets. Prepaid execution uses an existing private API key and finite credit cap. Both require reviewed quotes, private durable storage and original-operation recovery. Workflow orchestration is sequential and bounded; it does not supply those controls on the customer's behalf. Never retry uncertain payments with a new signature.

Workflow and source adapter instructions: https://github.com/kirillradchenko96/fresh402/blob/main/docs/FLAGSHIP_WORKFLOWS.md and https://github.com/kirillradchenko96/fresh402/tree/main/examples/efficiency . OpenAI Agents, AgentKit and LangChain/LangGraph adapters remain separately tested source examples, not bundled integrations or runtime dependencies. No API credentials or signing material are included.


Version 0.4.0-rc.2 adds authenticated prepaid Base quotes and execution to `PrepaidClient`. Call `await client.quoteRemote('token_facts')` before `client.execute('token_facts', input)`. The Web tariff remains 3; Base uses tariff 4 and 4/8/4 credits. An ineligible legacy key is not upgraded by the SDK. Exact original recovery, durable private persistence and the finite client credit cap remain mandatory. New packages use the all-service v4 IDs and explicit accepted terms, with finalized funding.

Version 0.5.0-rc.1 adds the four [server-executed workflows](https://github.com/kirillradchenko96/fresh402/blob/main/docs/SERVER_WORKFLOWS.md), typed workflow inputs, eligible authenticated tariff-5 prepaid quotes/execution and original-operation recovery over REST or MCP. `SERVER_WORKFLOWS`, `ServerWorkflowInputs` and `serverWorkflowPath` are root exports. Read `await client.quoteRemote('api_compatibility_review')` before execution; construct `PrepaidClient` with an existing private credential, finite `maxCredits` and private durable `persist` callback. The SDK does not grant eligibility, sign payments or supply a credential. Do not use a console logger as persistence. The previous `runFlagship` export remains client orchestration with separately billed underlying operations; it has not silently become a server workflow. Imported code performs no operation.
