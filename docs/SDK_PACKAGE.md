# Fresh402 SDK

The client package is `fresh402-sdk@0.6.1-rc.1`, under MIT. Use the exact prerelease version; confirm the version, integrity and `next` tag in the public npm registry. Earlier 0.4.0-rc.2 remains available; `latest` currently resolves to 0.4.0-rc.1, so use the exact version below or `@next` for the four workflow bindings. The source-client compatibility version remains 0.3.6; the hosted API has its own version. This license covers the package's public client files and accompanying documentation only, not the private Fresh402 backend or unrelated repository contents.

```sh
npm install fresh402-sdk@0.6.1-rc.1
```

Node.js 24 or later, ESM only, TypeScript declarations included. Zero runtime dependencies and no install scripts. No CommonJS or browser-wallet support is claimed. The package never creates a wallet, signs a payment or spends on import.

The 0.6.1 prerelease adds typed `source_watch_id` selection for compatible Website/API workflows and the website component of Cross-domain evidence. [Baseline continuity examples](https://github.com/kirillradchenko96/fresh402/blob/main/docs/BASELINE_CONTINUITY.md) distinguish free public Register state from a newly authorized owned comparison. Existing URL and observation-ID inputs remain supported. Solana x402 remains available under its live flags; native Solana MPP is a separately disabled, not-mainnet-accepted backend candidate, not a new SDK payment guarantee. Default npm installation still selects the older `latest`; use the exact tested prerelease intentionally. No stable-tag promotion is implied.

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

Version 0.5.0-rc.1 adds the four [server-executed workflows](https://github.com/kirillradchenko96/fresh402/blob/main/docs/SERVER_WORKFLOWS.md), typed workflow inputs, eligible authenticated tariff-5 prepaid quotes/execution and original-operation recovery over REST or MCP. `SERVER_WORKFLOWS`, `ServerWorkflowInputs` and `serverWorkflowPath` are root exports. Read `await client.quoteRemote('api_compatibility_review')` before execution; construct `PrepaidClient` with an existing private credential, finite `maxCredits` and private durable `persist` callback. The SDK does not grant eligibility, sign payments or supply a credential. Do not use a console logger as persistence. The previous `runFlagship` export remains client orchestration with separately billed underlying operations; it has not silently become a server workflow. Imported code performs no operation.

## Complete server-workflow example

The following Node 24+ example uses an existing **prepaid API key**, not a wallet private key. It makes no call on import. Set an existing customer-owned private directory outside Git with restrictive OS permissions (on Windows, verify its ACL). Keep it exclusive to one caller/process; this small example is not a multi-process budget manager. Each new named call has a four-credit ceiling, not a lifetime wallet budget. Seed plus a first review is two explicitly authorized operations: eight credits total ($0.020 at direct API-review prices). Never overwrite, delete or rename an uncertain original to create another attempt. If a crash leaves the temporary file, inspect and recover it before proceeding; do not delete financial evidence.

```js
import {PrepaidClient} from 'fresh402-sdk';
import {readFile, writeFile, rename} from 'node:fs/promises';
import {join, isAbsolute} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const origin = 'https://api.fresh402.com';
const credential = process.env.FRESH402_API_KEY; // prepaid API key, NOT wallet key
const directory = process.env.FRESH402_PRIVATE_DIR; // existing private directory outside Git
if (!credential || !directory || !isAbsolute(directory)) throw new Error('Private setup required');

// One caller/process per original file. Never use a new file as a timeout retry.
export async function observeOrRecover(input, originalName) {
  if (!/^[a-z0-9_-]+$/.test(originalName)) throw new Error('Stable operation name required');
  const file = join(directory, originalName + '.json');
  let original;
  try { original = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (original && (original.service !== 'api_compatibility_review' ||
      !isDeepStrictEqual(original.input, input))) throw new Error('Original input differs');
  if (original?.state === 'released') throw new Error('Original failed; inspect it before new work');
  const client = new PrepaidClient(origin, credential, {
    transport: 'rest', maxCredits: 4, restoredCredits: original?.cost ?? 0,
    persist: async operation => {
      const temporary = file + '.tmp';
      await writeFile(temporary, JSON.stringify(operation), {flag: 'wx', mode: 0o600});
      await rename(temporary, file); // commit the ORIGINAL before dispatch
    }
  });
  if (original) return client.recover(original); // same key/input/tariff; no replacement
  const quote = await client.quoteRemote('api_compatibility_review');
  if (quote.tariff_version !== 5 || quote.credits !== 4) throw new Error('Unexpected quote');
  return client.execute('api_compatibility_review', input);
}

// Deliberately authorized call 1 (4 credits): save its returned observation_id privately.
// const seed = await observeOrRecover({url: 'https://YOUR_HOST/openapi.json'}, 'api-seed');
// Deliberately authorized call 2 (4 credits), later, using the actual returned ID:
// const review = await observeOrRecover({observation_id: seed.observation_id,
//   compare_to: 'previous', detail: 'compact'}, 'api-review');
// After uncertainty: call again with EXACTLY the same input and originalName.
```

The seed URL must be your actual public JSON OpenAPI source; replace the placeholder before execution. A workflow observation_id is not a primitive watch_id. Observation state and original-result retention are separately bounded; expired results do not authorize rerunning an original. For Website Change Intelligence use its corresponding service, two-credit quote/cap and saved observation ID. Other workflows have their own published schemas and prices. No USDC signing or package purchase is performed by this prepaid example.

## Explicit native-USDC network choice

Version 0.6.1-rc.1 accepts validated dual-network x402 challenges while preserving Base as the default. Set `paymentNetwork: SOLANA_NETWORK` in `createProductionClient` or `Fresh402Client` for Solana; the merchant and sponsored fee payer are pinned. Only the selected requirement reaches an explicitly supplied signer. Missing Solana admission never falls back to Base. Existing uncertain originals retain their original origin/network/input/proof/private capability; recovery never signs again. `CustomerClient` has the same explicit network option for plans, ownership and package terms. Solana ownership is a single-use, origin-bound Ed25519 `signMessage`, not EVM typed data. No Base wallet is required for Solana accounts. Packages share the existing credit ledger; Solana funding is finalized-only and has no provisional credits. This Node package remains dependency-free and does not provide a browser wallet or private-key store. [Exact policy and account flow](https://github.com/kirillradchenko96/fresh402/blob/main/docs/SOLANA_USDC.md).

## Optional structured evidence inputs

The existing `PrepaidClient.execute(service, input)` and `Fresh402Client.execute(tool, input)` accept JSON input for the new [bounded modes](DEEP_CAPABILITIES.md); they do not authorize an additional payment or raise the configured maximum. Runtime transport/recovery APIs remain compatible with the published 0.6.1-rc.1 package. The source workflow TypeScript declarations include optional portable/record-identity inputs; older installed declarations may omit these convenience types, so use the generic JSON methods and live schemas. No package-version upgrade is required for those generic methods. Use fixed fixture demos or unsigned framework challenges before separately authorizing execution.
