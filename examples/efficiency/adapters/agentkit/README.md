# Fresh402 Coinbase AgentKit Action Provider

Optional first-party source integration for Node24+, tested with the actual official `@coinbase/agentkit`0.10.4, `AgentKit.from`, `ActionProvider` and address-only `ViemWalletProvider`. No framework endorsement or npm publication is claimed. Install only when using AgentKit; the base SDK and service have no AgentKit dependency.

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix examples/efficiency/adapters/agentkit
node --test examples/efficiency/adapters/agentkit/provider.test.ts
```

```ts
import {AgentKit} from '@coinbase/agentkit';
import {createProductionClient} from '../../index.ts';
import {fresh402ActionProvider} from './provider.ts';
const provider = await fresh402ActionProvider(createProductionClient(), {
  allowedTools: ['fresh402_register', 'fresh402_check'],
});
const kit = await AgentKit.from({
  walletProvider: yourAlreadyConfiguredWalletProvider,
  actionProviders: [provider],
});
const actions = kit.getActions();
```

Use your existing supported wallet abstraction. Fresh402 does not create a wallet, read a private key, call a wallet signing method or enable transfer actions. Base mainnet (`protocolFamily: 'evm'`, `chainId: '8453'`) is required, including a recheck when invoking. The wallet's network does not establish that every smart-wallet signature works with x402. Default paid actions **quote only**, even when another part of your agent has wallet authority. Registration is free but an explicit invocation can fetch the target and consume the service's registration quota.

Paid opt-in uses `mode: 'authorized', executePaid: invocation => session.execute(invocation)`, where `session` is the shared [CreditSession](../../README.md). This provides prepaid Web execution, independently pinned account/transport/service limits and encrypted original-operation persistence. It cannot buy credits or sign USDC. Other owner-approved x402 execution remains an explicit external executor using the existing BudgetGuard/private proof store; no new wallet compatibility is claimed here.

AgentKit0.10.4's public `Action.invoke(args)` carries **no tool-call ID**. Your trusted runtime must persist its original ID and use:

```ts
const result = await provider.withInvocation(originalRuntimeCallId,
  () => selectedAction.invoke(originalArguments));
```

The same ID and input must survive uncertainty/restarts. Do not generate a replacement ID on retry or accept an ID from model arguments. Authorized calls outside that scope are denied. AsyncLocalStorage isolates concurrent invocations. An interrupted call returns `pending_recovery`; stop that workflow and recover its original call. There is no scheduled retry or replacement signature.

Actions expose exact discovery JSON Schema as `inputSchema`, alongside the Zod3 `schema` required by AgentKit. The bounded converter preserves property descriptions/types/constraints, checks conditional combinations and rejects unknown validation keywords. Defaults remain server-applied; arguments are not filled or rewritten. Zod refinements do not reproduce every conditional keyword in downstream Zod-to-JSON-schema projections; consumers needing the exact schema should retain `inputSchema`. Fresh402 still performs authoritative validation. Input traversal is capped before Zod descends into oversized collections.

Dependency acceptance is separate from payment acceptance. The current optional AgentKit dependency tree has upstream npm advisories, including Zod3 and unused Solana/legacy wallet dependencies; npm reports no complete supported fix for AgentKit0.10.4. This adapter does not use those payment transports, enables no native addon scripts and takes no raw wallet key. Keep it isolated from treasury/signing processes and assess the upstream dependency tree for your deployment. Do not describe the full package as vulnerability-free. AgentKit's own WalletProvider also emits upstream analytics; tests intercept it locally before construction, without sending a wallet address. Your wallet provider's telemetry policy remains your responsibility.

Official interfaces: [Coinbase AgentKit source](https://github.com/coinbase/agentkit/tree/main/typescript/agentkit). Tests use real framework classes and synthetic service responses; no model, external RPC, real credit or payment execution occurs.
