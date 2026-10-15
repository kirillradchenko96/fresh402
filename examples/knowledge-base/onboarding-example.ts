import {randomUUID} from 'node:crypto';
import {CustomerClient} from './onboarding.ts';
import {PrepaidClient} from './prepaid.ts';
import {ApiError} from './client.ts';
type Json=Record<string,any>;
type Wallet={address:string;chainId:number;signIdentity:(typedData:Json)=>Promise<string>;confirmExactPurchase:(terms:Json)=>Promise<boolean>;signAuthorizedUSDC:(typedData:Json)=>Promise<string>};
/** No entry-point execution. persistPrivate must append or merge events, preserving earlier authorizations. Wallet approval is always caller supplied. */
export async function purchase(client:CustomerClient,wallet:Wallet,pkg:'candidate-starter-v3'|'candidate-developer-v3',persistPrivate:(value:Json)=>Promise<void>){
 const plans=await client.plans();if(!plans.availability.package_purchasing)throw Error('Public package purchasing is gated; do not connect or sign');
 const challenge=await client.beginSignup(wallet.address);await client.verifyOwnership(challenge,await wallet.signIdentity(challenge.typed_data));
 const key=randomUUID();await persistPrivate({phase:'quote',key,package_id:pkg});const intent=await client.preparePurchase(pkg,key),quote=await client.paymentChallenge(intent);
 const maximum=pkg==='candidate-starter-v3'?2500000n:15000000n;
 const prepared=client.preparePayment(intent,quote,{chainId:wallet.chainId,payer:wallet.address,authorizedAtomicUSDC:maximum});
 if(!await wallet.confirmExactPurchase({package_id:pkg,amount_atomic:intent.amount_atomic,credits:intent.credits,network:intent.network,asset:intent.asset,pay_to:intent.pay_to}))throw Error('Explicit wallet-side purchase confirmation required');
 const payload=prepared.payloadForSignature(await wallet.signAuthorizedUSDC(prepared.typedData));await persistPrivate({phase:'authorized',intent,payload});
 // Submission happens once. Cron and read-only polling recover an uncertain response.
 try{await client.submitAuthorizedPayment(intent,payload);}catch(e){if(!(e instanceof ApiError)||![0,409,429,500,502,503,504].includes(e.status))throw e;}
 return finishPurchase(client,intent,persistPrivate);
}
export async function finishPurchase(client:CustomerClient,intent:Json,persistPrivate:(value:Json)=>Promise<void>){
 const status=await client.awaitFunding(intent);const existing=await client.credentials();if(existing.credentials.some((c:Json)=>c.revoked_at===null&&c.expires_at>Date.now())){await persistPrivate({phase:'funded',intent,status,existing_credentials_preserved:true});return{...status,existing_credentials_preserved:true};}
 const credential=await client.claimCredential();await persistPrivate({phase:'credential',...credential});return credential;
}
/** Example A: after genuine Starter funding. Save operations privately before execution. */
export async function firstCheck(base:string,key:string,url:string,persist:(operation:any)=>Promise<void>){const api=new PrepaidClient(base,key,{maxCredits:2,tariffVersion:3,persist});await api.quoteRemote();const result=await api.execute('check',{url});return{result,balance:await api.balance()};}
/** Example B: Developer can use Extract and a previously registered OpenAPI watch. */
export async function developerTools(base:string,key:string,url:string,openApiWatch:string,persist:(operation:any)=>Promise<void>){const api=new PrepaidClient(base,key,{maxCredits:8,tariffVersion:3,persist});await api.quoteRemote();const extract=await api.execute('extract',{url}),contract=await api.execute('openapi_diff',{watch_id:openApiWatch});return{extract,contract,usage:await api.usage(),balance:await api.balance()};}
/** Example C: same authenticated wallet/session; persist one new idempotency key per intentional top-up. */
export async function prepareTopUp(client:CustomerClient,pkg:'candidate-starter-v3'|'candidate-developer-v3',persistPrivate:(value:Json)=>Promise<void>){const key=randomUUID();await persistPrivate({phase:'topup',key,package_id:pkg});const intent=await client.preparePurchase(pkg,key);await persistPrivate({phase:'topup-quoted',intent,key});return{intent,challenge:await client.paymentChallenge(intent)};}
