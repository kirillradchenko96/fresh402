// Modular customer SDK foundation. No backend imports, wallet access or network work on import.
export {BudgetGuard} from './budget.ts';
export type {BudgetPolicy,Spend} from './budget.ts';
export {EvidenceCache,recommendRefresh} from './cache.ts';
export type {CacheIdentity,CachedEvidence} from './cache.ts';
export {Fresh402Client,ApiError,PaymentRequired,PendingPayment,signerFromX402Client,syncDocumentation} from '../knowledge-base/client.ts';
export type {Operation,Signer} from '../knowledge-base/client.ts';
export {PrepaidClient,PendingPrepaid} from '../knowledge-base/prepaid.ts';
export type {PrepaidRequest} from '../knowledge-base/prepaid.ts';
export {CustomerClient} from '../knowledge-base/onboarding.ts';
export {prepareMachineTrialChallenge,claimMachineTrialKey} from '../knowledge-base/machine-trial.ts';
