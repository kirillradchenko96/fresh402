import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {existsSync,realpathSync,lstatSync,openSync,closeSync,chmodSync} from 'node:fs';
import {isAbsolute,dirname,join} from 'node:path';
import {PrepaidClient,type PrepaidRequest} from '../knowledge-base/prepaid.ts';
import {ApiError} from '../knowledge-base/client.ts';
import type {AgentInvocation} from './agent-tools.ts';
type Json=Record<string,any>;
export type CreditService=PrepaidRequest['service'];
export interface CreditSessionPolicy{
 origin:string;accountId:string;transport:'rest'|'mcp';allowedServices:CreditService[];
 perCallCredits:number;dailyCredits:number;monthlyCredits:number;lifetimeCredits:number;
}
const services:Record<string,CreditService>={fresh402_check:'check',fresh402_extract:'extract',fresh402_smart_diff:'smart_diff',fresh402_openapi_contract_diff:'openapi_diff'};
const encode=(v:unknown)=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=(v:unknown)=>createHash('sha256').update(encode(v)).digest('hex');
type Stored={tool:string;input:Json;op?:PrepaidRequest;terminal?:'prepaid_result_expired'};

/** Persistent conservative credit budget and encrypted original-request store.
 * No wallet, purchase, background retry or server accounting implementation.
 * Pass a customer-owned 32-byte storage key from a private keystore (not a wallet
 * key). Every process sharing the budget must use this DB and immutable policy.
 */
export class CreditSession{
 #db:DatabaseSync;#key:Buffer;#credential:string;#policy:CreditSessionPolicy;#now:()=>number;#stagingToken?:string;
 constructor(file:string,policy:CreditSessionPolicy,options:{credential:string;encryptionKey:Uint8Array;now?:()=>number;stagingToken?:string}){
  const u=new URL(policy.origin);if(!(u.origin===policy.origin&&(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))||!policy.accountId||policy.accountId.length>128||!['rest','mcp'].includes(policy.transport))throw Error('Explicit account, transport and secure origin required');
  if(!policy.allowedServices.length||new Set(policy.allowedServices).size!==policy.allowedServices.length||policy.allowedServices.some(s=>!Object.values(services).includes(s)))throw Error('Explicit supported credit-service allowlist required');
  const caps=[policy.perCallCredits,policy.dailyCredits,policy.monthlyCredits,policy.lifetimeCredits];if(caps.some(n=>!Number.isSafeInteger(n)||n<1)||caps.some((n,i)=>i>0&&n<caps[i-1]))throw Error('Consistent finite credit ceilings required');
  if(!/^fp_[a-f0-9]{64}$/.test(options.credential)||options.encryptionKey.length!==32)throw Error('Credential and private 32-byte storage key required');
  if(!isAbsolute(file))throw Error('Private absolute store path outside Git required');const parent=realpathSync(dirname(file));for(let p=parent;;p=dirname(p)){if(existsSync(join(p,'.git')))throw Error('Keep session state outside Git');if(dirname(p)===p)break;}if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('Session DB cannot be a symlink');
  try{closeSync(openSync(file,'ax',0o600));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  this.#policy=structuredClone(policy);this.#key=Buffer.from(options.encryptionKey);this.#credential=options.credential;this.#stagingToken=options.stagingToken;this.#now=options.now??Date.now;this.#db=new DatabaseSync(file);
  this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS credit_policy(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,key_check TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,last_ms INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS credit_calls(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,cost INTEGER NOT NULL,day TEXT NOT NULL,month TEXT NOT NULL,owner TEXT,lease_ms INTEGER NOT NULL,sealed BLOB NOT NULL);');
  this.#db.prepare('INSERT OR IGNORE INTO credit_policy(id,digest,key_check) VALUES(1,?,?)').run(digest(policy),digest(this.#key.toString('hex')));
  const pinned=this.#db.prepare('SELECT digest,key_check FROM credit_policy WHERE id=1').get() as any;if(pinned.digest!==digest(policy)||pinned.key_check!==digest(this.#key.toString('hex'))){this.close();throw Error('Original session policy/storage key differs; never reset unresolved operations');}
  for(const p of [file,file+'-wal',file+'-shm'])if(existsSync(p))chmodSync(p,0o600);
 }
 close(){this.#db.close();this.#key.fill(0);this.#credential='';this.#stagingToken=undefined;}
 disable(){this.#db.prepare('UPDATE credit_policy SET disabled=1 WHERE id=1').run();}
 totals(){return this.#db.prepare('SELECT count(*) operations,COALESCE(sum(cost),0) reserved_credits FROM credit_calls').get() as {operations:number;reserved_credits:number};}
 #seal(id:string,value:Stored){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key,iv);cipher.setAAD(Buffer.from(id+'|'+digest(this.#policy)));const data=Buffer.concat([cipher.update(encode(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]);}
 #open(id:string,data:Uint8Array):Stored{try{const b=Buffer.from(data),decipher=createDecipheriv('aes-256-gcm',this.#key,b.subarray(0,12));decipher.setAAD(Buffer.from(id+'|'+digest(this.#policy)));decipher.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)),decipher.final()]).toString('utf8'));}catch{throw Error('Original encrypted session state unavailable; no replacement request');}}
 #reserve(id:string,request:Stored,cost:number){
  if(!/^[\w-]{1,128}$/.test(id))throw Error('Stable runtime call ID required');const p=this.#policy,now=this.#now();if(!Number.isSafeInteger(now)||now<0)throw Error('Valid session clock required');const owner=randomUUID(),requestHash=digest(request);
  this.#db.exec('BEGIN IMMEDIATE');try{
   const state=this.#db.prepare('SELECT disabled,last_ms FROM credit_policy WHERE id=1').get() as any;if(state.disabled)throw Error('Credit session emergency stop is active');if(now<state.last_ms)throw Error('Clock rollback: original budget remains reserved');
   const old=this.#db.prepare('SELECT * FROM credit_calls WHERE id=?').get(id) as any;if(old&&old.request_hash!==requestHash)throw Error('Runtime call ID already belongs to a different original input');if(old?.owner&&old.lease_ms>now)throw new ApiError('client_operation_busy',409);
   const stored=old?this.#open(id,old.sealed):request;
   if(old){this.#db.prepare('UPDATE credit_calls SET owner=?,lease_ms=? WHERE id=?').run(owner,now+120000,id);}else{
    const day=new Date(now).toISOString().slice(0,10),month=day.slice(0,7),s=this.#db.prepare('SELECT COALESCE(sum(cost),0) total,COALESCE(sum(CASE WHEN day=? THEN cost ELSE 0 END),0) daily,COALESCE(sum(CASE WHEN month=? THEN cost ELSE 0 END),0) monthly FROM credit_calls').get(day,month) as any;
    if(cost>p.perCallCredits||s.total+cost>p.lifetimeCredits||s.daily+cost>p.dailyCredits||s.monthly+cost>p.monthlyCredits)throw new ApiError('client_credit_budget_exceeded',402);
    this.#db.prepare('INSERT INTO credit_calls VALUES(?,?,?,?,?,?,?,?)').run(id,requestHash,cost,day,month,owner,now+120000,this.#seal(id,request));
   }
   this.#db.prepare('UPDATE credit_policy SET last_ms=? WHERE id=1').run(now);this.#db.exec('COMMIT');return{owner,stored};
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 #save(id:string,owner:string,stored:Stored){const r=this.#db.prepare('UPDATE credit_calls SET sealed=? WHERE id=? AND owner=?').run(this.#seal(id,stored),id,owner);if(r.changes!==1)throw Error('Original operation lease lost; recover without a new debit');}
 /** One bounded attempt. Reusing an ID recovers its original server key, even
  * after process restart. Completed local results retain original provenance.
  */
 async execute(invocation:AgentInvocation):Promise<{result:Json;localReplay:boolean}>{
  const {tool,callId}=invocation,service=services[tool];if(!service||!this.#policy.allowedServices.includes(service))throw new ApiError('client_credit_service_unsupported',400);if(!invocation.input||typeof invocation.input!=='object'||Array.isArray(invocation.input)||typeof callId!=='string'||!/^[\w-]{1,128}$/.test(callId))throw new ApiError('invalid_input',400);
  let input:Json;try{const json=JSON.stringify(invocation.input);if(Buffer.byteLength(json)>262144)throw Error();input=JSON.parse(json);}catch{throw new ApiError('invalid_input',400);}let current:Stored={tool,input},owner='';
  const client=new PrepaidClient(this.#policy.origin,this.#credential,{transport:this.#policy.transport,tariffVersion:3,maxCredits:this.#policy.perCallCredits,stagingToken:this.#stagingToken,persist:async op=>{current={tool,input,op:structuredClone(op)};this.#save(callId,owner,current);}});
  // Read-only identity/tariff checks cannot sign or purchase. Credential rotation
  // is supported only when the new key still authenticates the pinned account.
  const balance=await client.balance();if(balance.account_id!==this.#policy.accountId||balance.tariff_version!==3)throw new ApiError('client_account_policy_mismatch',403);const quote=await client.quoteRemote();if(quote.tariff_version!==3)throw new ApiError('client_tariff_policy_mismatch',409);
  const cost=client.quote(service).maximum_credits,reserved=this.#reserve(callId,{tool,input},cost);owner=reserved.owner;current=reserved.stored;
  try{
   if(current.op?.state==='completed')return{result:structuredClone(current.op.result!),localReplay:true};
   if(current.terminal)throw new ApiError(current.terminal,410);
   if(current.op?.state==='released')throw new ApiError('client_original_operation_released',409);
   try{const result=current.op?await client.recover(current.op):await client.execute(service,input);return{result,localReplay:false};}
   catch(error){if(error instanceof ApiError&&error.status===410&&error.code==='prepaid_result_expired'){current.terminal='prepaid_result_expired';this.#save(callId,owner,current);}throw error;}
  }finally{this.#db.prepare('UPDATE credit_calls SET owner=NULL,lease_ms=0 WHERE id=? AND owner=?').run(callId,owner);}
 }
}
