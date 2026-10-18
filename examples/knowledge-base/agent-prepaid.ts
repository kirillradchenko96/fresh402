import {randomUUID} from 'node:crypto';
import {CustomerClient} from './onboarding.ts';
import {PrepaidClient} from './prepaid.ts';
type Json=Record<string,any>;
export interface AuthorizedSigner {address:string;chainId:8453;signTypedData:(data:any)=>Promise<`0x${string}`>}
export interface PrivateStore {save:(name:string,value:Json)=>Promise<void>}

/** No entry point: the caller supplies an already authorized EOA/external signer.
 * Store implementation must be encrypted/private, outside Git, without logs.
 * Never call the purchase function again to recover an uncertain purchase.
 */
export async function authenticateAgent(client:CustomerClient,signer:AuthorizedSigner,store:PrivateStore){
 if(signer.chainId!==8453)throw Error('Base Mainnet signer required');
 const challenge=await client.beginSignup(signer.address);await store.save('ownership-challenge',challenge);
 const d=challenge.typed_data,signature=await signer.signTypedData({...d,message:{...d.message,issuedAt:BigInt(d.message.issuedAt),expiresAt:BigInt(d.message.expiresAt)}});
 const session=await client.verifyOwnership(challenge,signature);await store.save('customer-session',session);return session;
}
/** Invoke ONCE per owner-approved purchase. Ambiguous signing/submission must
 * retain the saved intent and authorization; resume with inspect/recover, not here.
 */
export async function purchaseAgentPackage(client:CustomerClient,signer:AuthorizedSigner,store:PrivateStore,approval:{packageId:'candidate-starter-v3'|'candidate-developer-v3';maximumAtomicUSDC:bigint}){
 const plans=await client.plans();if(!plans.availability.package_purchasing)throw Error('Purchasing is disabled');
 const key=randomUUID();await store.save('purchase-start',{key,package_id:approval.packageId,signing_requested:false});
 const intent=await client.preparePurchase(approval.packageId,key);await store.save('purchase-intent',intent);
 if(intent.payer?.toLowerCase()!==signer.address.toLowerCase()||intent.network!=='eip155:8453'||intent.asset?.toLowerCase()!=='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'||intent.pay_to?.toLowerCase()!=='0x58b4b483fbe31860335eceb12cccf4338b251085')throw Error('Intent does not match the authorized payer/chain/asset/merchant');
 const quote=await client.paymentChallenge(intent),prepared=client.preparePayment(intent,quote,{chainId:signer.chainId,payer:signer.address,authorizedAtomicUSDC:approval.maximumAtomicUSDC});
 // Persist before requesting a signature. A signer timeout is ambiguous too.
 await store.save('signing-requested',{intent,quote,signing_requested:true});
 const payload=prepared.payloadForSignature(await signer.signTypedData(prepared.typedData));await store.save('original-payment',{intent,payload});
 const result=await client.submitAuthorizedPayment(intent,payload);return{intent,result};
}
/** Browserless first operation; no payment signer and no x402 fallback. */
export async function firstAgentCheck(client:CustomerClient,intent:Json,store:PrivateStore,url:string,transport:'rest'|'mcp'='mcp'){
 const status=await client.awaitSpendable(intent,{intervalMs:15000});await store.save('funding-status',status);
 // Claiming replaces prior keys. Only call automatically for a new account
 // without existing keys; recover an existing private key or explicitly rotate.
 if((await client.credentials()).credentials.some((k:Json)=>k.revoked_at===null&&k.expires_at>Date.now()))throw Error('Reuse the existing private credential or explicitly authorize rotation');
 const credential=await client.claimCredential();await store.save('api-credential',credential);
 const prepaid=new PrepaidClient(client.base,credential.api_key,{transport,tariffVersion:3,maxCredits:2,persist:op=>store.save('prepaid-operation',op)});
 await prepaid.quoteRemote();return prepaid.execute('check',{url});
}
