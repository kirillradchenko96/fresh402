/** Customer-side opt-in only. No network calls, wallet access or signing on import. */
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,chmodSync,openSync,closeSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import {prepareFundingAuthorization} from './funding.ts';
import type {PackageId,CustomerClient} from './onboarding.ts';
type Json=Record<string,any>;
const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const TERMS:Record<PackageId,[number,number]>={'candidate-starter-v3':[2500000,1000],'candidate-developer-v3':[15000000,10000],'starter-all-services-v4':[2500000,1000],'developer-all-services-v4':[15000000,10000]};
export interface ReplenishmentPolicy{
 explicitOptIn:true;origin:string;payer:string;chainId:8453;asset:string;recipient:string;
 packageId:PackageId;allowedPackages:PackageId[];allServicesTermsDigest?:string;
 thresholdCredits:number;perPurchaseAtomic:number;dailyAtomic:number;monthlyAtomic:number;maxPurchases:number;
}
/** Customer owns this adapter and its encrypted proof store. Never hand its signer key to Fresh402. */
export interface AuthorizationVault{
 load(id:string):Promise<Json|undefined>;
 authorizeAndPersist(id:string,request:{intent:Json;challenge:Json;typedData:Json}):Promise<void>;
}
export type FundingTransport=Pick<CustomerClient,'preparePurchase'|'paymentChallenge'|'submitAuthorizedPayment'|'fundingStatus'|'inspectOriginalPayment'|'balance'>;
type Attempt={id:string;day:string;month:string;phase:string;intent:string|null;quote:string|null;proof_hash:string|null;lease:string|null;lease_until:number;deadline:number;valid_after:number;submissions:number};
const encode=(value:any):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=(value:any)=>createHash('sha256').update(encode(value)).digest('hex');
function validatePolicy(p:ReplenishmentPolicy){
 const u=new URL(p.origin);if(p.explicitOptIn!==true||u.protocol!=='https:'||u.origin!==p.origin||u.username||u.password||p.chainId!==8453||p.asset.toLowerCase()!==USDC||!/^0x[a-f0-9]{40}$/i.test(p.payer)||!['0x58b4b483fbe31860335eceb12cccf4338b251085','0xfac492a8d7843c9afcca6a1691bccb5425ab14f3'].includes(p.recipient.toLowerCase())||p.recipient.toLowerCase()===p.payer.toLowerCase())throw Error('Explicit Base/native-USDC/recipient policy required');
 if(!TERMS[p.packageId]||!Array.isArray(p.allowedPackages)||!p.allowedPackages.includes(p.packageId)||p.allowedPackages.some(id=>!TERMS[id]))throw Error('Package not authorized');
 for(const n of [p.thresholdCredits,p.perPurchaseAtomic,p.dailyAtomic,p.monthlyAtomic,p.maxPurchases])if(!Number.isSafeInteger(n)||n<1)throw Error('Positive finite integer budgets required');
 if(p.perPurchaseAtomic<TERMS[p.packageId][0]||p.dailyAtomic<p.perPurchaseAtomic||p.monthlyAtomic<p.dailyAtomic||p.maxPurchases>1000)throw Error('Inconsistent purchase ceilings');
 if(p.packageId.includes('all-services')&&!/^[a-f0-9]{64}$/.test(p.allServicesTermsDigest??''))throw Error('Explicit all-service terms acceptance required');
}
/**
 * Private SQLite persists authorization reservations across restarts/processes. Budgets count
 * even failed/expired reservations conservatively. Use one store for the entire owner budget.
 * A signer outside this cooperative client must independently enforce the same wallet policy.
 */
export class AutoReplenisher{
 private db:DatabaseSync;private policy:ReplenishmentPolicy;private transport:FundingTransport;private vault:AuthorizationVault;private now:()=>number;
 constructor(path:string,policy:ReplenishmentPolicy,transport:FundingTransport,vault:AuthorizationVault,now=Date.now){
  validatePolicy(policy);if(!isAbsolute(path))throw Error('Use an absolute private store path outside Git');
  for(let p=dirname(path);;p=dirname(p)){if(existsSync(join(p,'.git')))throw Error('Keep replenishment state outside Git');if(dirname(p)===p)break;}
  this.policy=structuredClone(policy);this.transport=transport;this.vault=vault;this.now=now;try{closeSync(openSync(path,'ax',0o600));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}this.db=new DatabaseSync(path);
  this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS policy(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,day TEXT NOT NULL,month TEXT NOT NULL,amount INTEGER NOT NULL,phase TEXT NOT NULL,intent TEXT,quote TEXT,proof_hash TEXT,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,deadline INTEGER NOT NULL DEFAULT 0,valid_after INTEGER NOT NULL DEFAULT 0,submissions INTEGER NOT NULL DEFAULT 0);');
  try{for(const file of [path,path+'-wal',path+'-shm'])if(existsSync(file))chmodSync(file,0o600);}catch{/* Owner must apply private OS ACLs where POSIX modes are unavailable. */}
  const pinned=this.db.prepare('SELECT digest FROM policy WHERE id=1').get() as {digest:string}|undefined;
  if(pinned&&pinned.digest!==hash(policy)){this.db.close();throw Error('Persisted owner policy differs; do not reset unresolved authorizations');}
  this.db.prepare('INSERT OR IGNORE INTO policy(id,digest) VALUES(1,?)').run(hash(policy));
  if((this.db.prepare('SELECT digest FROM policy WHERE id=1').get() as any).digest!==hash(policy)){this.db.close();throw Error('Concurrent persisted owner policy differs');}
 }
 close(){this.db.close();}
 disable(){this.db.prepare('UPDATE policy SET disabled=1 WHERE id=1').run();}
 private enabled(){if((this.db.prepare('SELECT disabled FROM policy WHERE id=1').get() as any).disabled)throw Error('Owner emergency stop is active');}
 private transaction<T>(fn:()=>T){this.db.exec('BEGIN IMMEDIATE');try{const out=fn();this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 private reserve(observedCount:number):Attempt{
  return this.transaction(()=>{this.enabled();const active=this.db.prepare("SELECT * FROM attempts WHERE phase NOT IN('finalized','expired_unused','cancelled_unsigned') LIMIT 1").get() as Attempt|undefined;if(active)return active;
   const day=new Date(this.now()).toISOString().slice(0,10),month=day.slice(0,7),p=this.policy,amount=TERMS[p.packageId][0],sum=(where:string,value:string)=>Number((this.db.prepare('SELECT COALESCE(sum(amount),0) n FROM attempts WHERE '+where+'=?').get(value) as any).n),count=Number((this.db.prepare('SELECT count(*) n FROM attempts').get() as any).n);
   if(count!==observedCount)throw Error('Concurrent purchase changed balance; refresh before another reservation');
   if(count>=p.maxPurchases||sum('day',day)+amount>p.dailyAtomic||sum('month',month)+amount>p.monthlyAtomic)throw Error('Owner purchase budget exhausted');
   const id=randomUUID();this.db.prepare("INSERT INTO attempts(id,day,month,amount,phase) VALUES(?,?,?,?,'preparing')").run(id,day,month,amount);return this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id) as Attempt;
  });
 }
 private own(row:Attempt,lease:string){this.enabled();const found=this.db.prepare('SELECT * FROM attempts WHERE id=? AND lease=? AND lease_until>?').get(row.id,lease,this.now()) as Attempt|undefined;if(!found)throw Error('Lost purchase lease; original authorization remains recoverable');return found;}
 private save(row:Attempt,lease:string,phase:string,values:Partial<Attempt>={}){
  this.own(row,lease);const fields=Object.keys(values);if(fields.some(k=>!['intent','quote','proof_hash','deadline','valid_after','submissions'].includes(k)))throw Error('Invalid internal state');
  this.db.prepare('UPDATE attempts SET phase=?'+fields.map(k=>','+k+'=?').join('')+' WHERE id=? AND lease=?').run(phase,...fields.map(k=>(values as any)[k]),row.id,lease);Object.assign(row,values,{phase});
 }
 private validated(row:Attempt,payload:Json){
  const intent=JSON.parse(row.intent!),challenge=JSON.parse(row.quote!),a=payload?.payload?.authorization;
  // Validation also works after expiry for original-proof read-only inspection.
  const expected={x402Version:2,resource:challenge.resource,accepted:challenge.accepts[0],payload:{signature:payload?.payload?.signature,authorization:{from:this.policy.payer,to:challenge.accepts[0].payTo,value:String(intent.amount_atomic),validAfter:String(row.valid_after),validBefore:String(row.deadline),nonce:intent.nonce}}};
  if(!/^0x[a-f0-9]{130}$/i.test(expected.payload.signature??'')||!a||encode(expected)!==encode(payload)||row.proof_hash&&row.proof_hash!==hash(payload))throw Error('Persisted proof differs from original authorized purchase');return payload;
 }
 private async status(row:Attempt,lease:string){const s=await this.transport.fundingStatus(JSON.parse(row.intent!));if(s.intent_id!==JSON.parse(row.intent!).intent_id)throw Error('Wrong funding status identity');
  if(s.state==='credited'){if(s.finalized!==true||s.settlement_kind!=='real')throw Error('Genuine finalized funding required');this.save(row,lease,'finalized');}
  if(s.recovery_status==='funding_authorization_expired_unused')this.save(row,lease,'expired_unused');return s;
 }
 /** One bounded pass. Caller schedules future passes; no background timer or automatic retry loop. */
 async tick(){
  this.enabled();const observedCount=Number((this.db.prepare('SELECT count(*) n FROM attempts').get() as any).n),current=this.db.prepare("SELECT * FROM attempts WHERE phase NOT IN('finalized','expired_unused','cancelled_unsigned') LIMIT 1").get() as Attempt|undefined;
  if(!current){const b=await this.transport.balance();const n=b.available??b.balance?.available;if(!Number.isSafeInteger(n)||n<0)throw Error('Valid authenticated balance required');if(n>=this.policy.thresholdCredits)return{state:'balance_sufficient'};}
  const row=current??this.reserve(observedCount),lease=randomUUID();const acquired=this.db.prepare('UPDATE attempts SET lease=?,lease_until=? WHERE id=? AND (lease IS NULL OR lease_until<=?)').run(lease,this.now()+120000,row.id,this.now());if(acquired.changes!==1)return{state:'another_purchase_active'};
  try{
   Object.assign(row,this.own(row,lease));
   if(['finalized','expired_unused','cancelled_unsigned'].includes(row.phase))return{state:row.phase,purchase_id:row.id};
   if(row.phase==='preparing'){
    const i=await this.transport.preparePurchase(this.policy.packageId,row.id,this.policy.allServicesTermsDigest);this.own(row,lease);
    const expected=TERMS[this.policy.packageId];if(i.package_id!==this.policy.packageId||i.amount_atomic!==expected[0]||i.credits!==expected[1]||i.tariff_version!==3||i.payer?.toLowerCase()!==this.policy.payer.toLowerCase()||i.pay_to?.toLowerCase()!==this.policy.recipient.toLowerCase()||i.network!=='eip155:8453'||i.asset?.toLowerCase()!==USDC||!/^pf_[a-f0-9]{32}$/.test(i.intent_id)||i.resource!==this.policy.origin+'/v2/prepaid/funding/'+i.intent_id||this.policy.allServicesTermsDigest&&i.all_services_terms_digest!==this.policy.allServicesTermsDigest)throw Error('Unexpected package intent; do not sign');
    this.save(row,lease,'quoted',{intent:encode(i)});
   }
   if(row.phase==='quoted'){
    // No authorization was requested on this path. Crossing the reserved day cancels conservatively.
    if(new Date(this.now()).toISOString().slice(0,10)!==row.day){this.save(row,lease,'cancelled_unsigned');return{state:row.phase};}
    const i=JSON.parse(row.intent!),q=await this.transport.paymentChallenge(i),end=Math.floor(Date.parse(row.day+'T00:00:00Z')/1000)+86400-1,deadline=Math.min(Math.floor(i.expires_at/1000)-1,end),validAfter=end-86400+1;
    const prepared=prepareFundingAuthorization(i,q,{chainId:8453,payer:this.policy.payer,expectedRecipient:this.policy.recipient,authorizedAtomicUSDC:BigInt(this.policy.perPurchaseAtomic),authorizationDeadline:deadline,authorizationValidAfter:validAfter});
    if(deadline<=Math.floor(this.now()/1000)+5)throw Error('Insufficient original quote lifetime');
    this.save(row,lease,'signing_requested',{quote:encode(q),deadline,valid_after:validAfter});
    await this.vault.authorizeAndPersist(row.id,{intent:i,challenge:q,typedData:prepared.typedData});
    this.own(row,lease);
   }
   // A restart never calls a signer again for signing_requested. Missing proof holds all new purchases.
   const status=await this.status(row,lease);if(['finalized','expired_unused'].includes(row.phase))return{state:row.phase,purchase_id:row.id};
   const proof=await this.vault.load(row.id);if(!proof)return{state:'original_authorization_unknown',purchase_id:row.id};
   const original=this.validated(row,proof);
   if(['confirmed','settling'].includes(status.state))return{state:'awaiting_original_settlement',purchase_id:row.id};
   if(this.now()/1000>=row.deadline){const r=await this.transport.inspectOriginalPayment(JSON.parse(row.intent!),original);if(r.intent_id===JSON.parse(row.intent!).intent_id&&r.read_only===true&&r.safe_to_replace===true&&r.recovery_status==='authorization_expired_unused')this.save(row,lease,'expired_unused');return{state:row.phase,purchase_id:row.id};}
   if(row.phase==='submitted')return{state:'awaiting_original_settlement',purchase_id:row.id};
   this.save(row,lease,'submitted',{proof_hash:hash(original),submissions:1});
   // Persist before HTTP. An ambiguous transport outcome never authorizes a replacement payment.
   await this.transport.submitAuthorizedPayment(JSON.parse(row.intent!),original);await this.status(row,lease);return{state:row.phase,purchase_id:row.id};
  }finally{this.db.prepare('UPDATE attempts SET lease=NULL,lease_until=0 WHERE id=? AND lease=?').run(row.id,lease);}
 }
}
