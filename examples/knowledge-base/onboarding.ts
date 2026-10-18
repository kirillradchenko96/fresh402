import {randomUUID} from 'node:crypto';
import {ApiError} from './client.ts';
import {prepareFundingAuthorization} from './funding.ts';
type Json=Record<string,any>;
export function validateOwnershipChallenge(c:Json,wallet:string,origin:string){
 const d=c?.typed_data,m=d?.message,types=[{name:'wallet',type:'address'},{name:'action',type:'string'},{name:'origin',type:'string'},{name:'environment',type:'string'},{name:'nonce',type:'bytes32'},{name:'issuedAt',type:'uint256'},{name:'expiresAt',type:'uint256'}];
 if(!/^cc_[a-f0-9]{64}$/.test(c?.challenge_id)||d?.primaryType!=='CustomerOwnership'||d.domain?.name!=='Fresh402 Account'||d.domain?.version!=='1'||d.domain?.chainId!==8453||!/^0x[a-f0-9]{64}$/i.test(d.domain?.salt)||JSON.stringify(d.types)!==JSON.stringify({CustomerOwnership:types})||m?.wallet?.toLowerCase()!==wallet.toLowerCase()||m?.origin!==origin||!['production','staging','local-lab'].includes(m?.environment)||m.action!=='Authenticate Fresh402 customer'||!/^0x[a-f0-9]{64}$/i.test(m.nonce)||Number(m.expiresAt)!==c.expires_at||c.expires_at<=Date.now()||c.expires_at>Date.now()+300000||Number(m.issuedAt)>Date.now()+5000)throw Error('Unexpected wallet identity challenge; do not sign');return c;
}
/** Wallet signatures are supplied by the caller. This client never connects a wallet or signs automatically. */
export class CustomerClient{
 readonly base:string;declare private session?:string;declare private stagingToken?:string;declare private pilotToken?:string;
 constructor(origin:string,options:{stagingToken?:string;pilotToken?:string;sessionToken?:string}={}){
  const u=new URL(origin);if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Use a plain HTTPS service origin');this.base=u.origin;
  for(const [name,value] of Object.entries({session:options.sessionToken,stagingToken:options.stagingToken,pilotToken:options.pilotToken}))Object.defineProperty(this,name,{value,writable:true,enumerable:false});
 }
 private async call(path:string,body?:Json,headers:Record<string,string>={},acceptChallenge=false){
  let r:Response;
  try{r=await fetch(this.base+path,{method:body===undefined?'GET':'POST',redirect:'error',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(this.stagingToken?{authorization:'Bearer '+this.stagingToken}:{}),...(this.pilotToken?{'x-fresh402-onboarding-pilot':this.pilotToken}:{}),...(this.session?{'x-fresh402-customer-session':this.session}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});}catch{throw new ApiError('customer_transport_unavailable',0);}
  if(!r.body)throw Error('Empty customer response');const reader=r.body.getReader();let bytes=0;const parts:Uint8Array[]=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>262144)throw Error('Customer response too large');parts.push(value);}}catch(e){void reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const json=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!r.ok&&!(acceptChallenge&&r.status===402&&json.x402Version===2))throw new ApiError(typeof json.error==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(json.error)?json.error:'customer_http_'+r.status,r.status);return json;
 }
 plans(){return this.call('/v2/prepaid/plans');}
 async beginSignup(wallet:string,key= randomUUID()){return validateOwnershipChallenge(await this.call('/v2/prepaid/customer/challenge',{wallet},{'idempotency-key':key}),wallet,this.base);}
 async verifyOwnership(challenge:Json,signature:string){if(!challenge?.challenge_id)throw Error('Missing persisted challenge');const r=await this.call('/v2/prepaid/customer/sessions',{challenge_id:challenge.challenge_id,signature});this.session=r.session_token;return r;}
 preparePurchase(packageId:'candidate-starter-v3'|'candidate-developer-v3',idempotencyKey:string){return this.call('/v2/prepaid/customer/funding',{package_id:packageId},{'idempotency-key':idempotencyKey});}
 private intentId(intent:Json){if(!/^pf_[a-f0-9]{32}$/.test(intent?.intent_id))throw Error('Invalid funding identity');return intent.intent_id;}
 paymentChallenge(intent:Json){return this.call('/v2/prepaid/customer/funding/'+this.intentId(intent),{}, {},true);}
 preparePayment(intent:Json,challenge:Json,owner:{chainId:number;payer:string;authorizedAtomicUSDC:bigint}){const terms:Record<string,[number,number]>={'candidate-starter-v3':[2500000,1000],'candidate-developer-v3':[15000000,10000]},expected=terms[intent?.package_id];if(!expected||intent.amount_atomic!==expected[0]||intent.credits!==expected[1]||intent.tariff_version!==3)throw Error('Unsupported or changed package terms; do not sign');return prepareFundingAuthorization(intent,challenge,owner);}
 /** Explicit already-authorized payment only. Persist intent and authorization privately BEFORE calling. No retry/replacement fallback. */
 submitAuthorizedPayment(intent:Json,payload:Json){if(payload.resource?.url!==intent.resource||payload.payload?.authorization?.nonce!==intent.nonce)throw Error('Use the original persisted funding authorization');return this.call('/v2/prepaid/customer/funding/'+this.intentId(intent),{}, {'payment-signature':Buffer.from(JSON.stringify(payload)).toString('base64')});}
 fundingStatus(intent:Json){return this.call('/v2/prepaid/customer/funding/'+this.intentId(intent));}
 /** Read-only bounded polling. The server continues recovery even if this process closes. */
 async awaitFunding(intent:Json,options:{allowProvisional?:boolean;timeoutMs?:number;intervalMs?:number;signal?:AbortSignal;onStatus?:(value:Json)=>void|Promise<void>;reauthenticate?:()=>Promise<void>}={}){
  const timeout=options.timeoutMs??3600000,interval=options.intervalMs??15000;
  if(!Number.isInteger(timeout)||timeout<1||timeout>7200000||!Number.isInteger(interval)||interval<1000||interval>60000)throw Error('Invalid funding polling budget');
  const deadline=Date.now()+timeout;let attempts=0,reauthentications=0,lastReauthentication=-Infinity;
  while(Date.now()<deadline){options.signal?.throwIfAborted();try{const status=await this.fundingStatus(intent);await options.onStatus?.(status);if(status.state==='credited'){if(!status.finalized||status.settlement_kind!=='real')throw Error('Genuine finalized funding required');return status;}if(options.allowProvisional&&status.purchase_status==='provisional'&&Number.isSafeInteger(status.provisional_available)&&status.provisional_available>0&&status.settlement_kind==='real')return status;if(status.recovery_status==='funding_authorization_expired_unused')throw new ApiError('funding_authorization_expired_unused',410);if(status.state==='intent')throw new ApiError('authorization_not_submitted',409);attempts=0;}catch(e){if(e instanceof ApiError&&[401,403].includes(e.status)&&options.reauthenticate&&reauthentications<4&&Date.now()-lastReauthentication>=60000){lastReauthentication=Date.now();reauthentications++;await options.reauthenticate();continue;}if(!(e instanceof ApiError)||![0,429,500,502,503,504].includes(e.status))throw e;attempts++;}
   const ms=Math.min(deadline-Date.now(),Math.min(60000,interval*2**Math.min(attempts,2)));if(ms<=0)break;
   await new Promise<void>((resolve,reject)=>{const done=()=>{options.signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(options.signal?.reason);};options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();});
  }
  throw new ApiError('funding_still_pending_automatic_recovery',503);
 }
 /** No signature, signing callback, settlement retry or replacement purchase is permitted here. */
 async recoverFunding(intent:Json){
  try{const r=await this.call('/v2/prepaid/customer/funding/'+this.intentId(intent),{},{},true);
   if(r.x402Version===2)return{intent_id:this.intentId(intent),state:'intent',recovery_status:'authorization_not_submitted',replacement_payment_authorized:false};return r;
  }catch(e){if(e instanceof ApiError&&e.code==='funding_intent_expired'&&e.status===410)return{...await this.fundingStatus(intent),recovery_status:'intent_expired_authorization_unknown',replacement_payment_authorized:false};throw e;}
 }
 /** Bounded polling only; early inclusion is not finality and may freeze. */
 awaitSpendable(intent:Json,options:Parameters<CustomerClient['awaitFunding']>[1]={}){return this.awaitFunding(intent,{...options,allowProvisional:true});}
 claimCredential(){return this.call('/v2/prepaid/customer/credentials/claim',{});}
 rotateCredential(){return this.call('/v2/prepaid/customer/credentials/rotate',{});}
 credentials(){return this.call('/v2/prepaid/customer/credentials');}
 revokeCredential(credentialId:string){return this.call('/v2/prepaid/customer/credentials/revoke',{credential_id:credentialId});}
 balance(){return this.call('/v2/prepaid/customer/account');}
 usage(){return this.call('/v2/prepaid/customer/usage');}
 purchases(){return this.call('/v2/prepaid/customer/purchases');}
}
