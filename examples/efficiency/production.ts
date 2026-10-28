import {Fresh402Client} from '../knowledge-base/client.ts';
export const PRODUCTION_ORIGIN='https://api.fresh402.com';
export const PRODUCTION_RECIPIENT='0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3';
/** Current public deployment, zero spend/no signer by default. Original-operation
 * recovery remains unchanged. Both client constructors now default to Safe. Explicit policy
 * still wins; discovery must never silently choose a merchant for the caller.
 */
export function createProductionClient(options:ConstructorParameters<typeof Fresh402Client>[1]={}){
 return new Fresh402Client(PRODUCTION_ORIGIN,{expectedRecipient:PRODUCTION_RECIPIENT,...options});
}
