import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {existsSync,realpathSync,lstatSync,openSync,closeSync,chmodSync} from 'node:fs';
import {dirname,isAbsolute,join} from 'node:path';
import type {Signer} from '../knowledge-base/client.ts';

type Json=Record<string,any>;
export interface BudgetPolicy {
 origin:string;network:'eip155:8453';asset:string;recipient:string;
 perCallAtomic:number;dailyAtomic:number;monthlyAtomic:number;lifetimeAtomic:number;
 allowedServices:string[];allowedPackages:string[];maximumPurchaseAtomic:number;
}
export type Spend={id:string;amountAtomic:number;service?:string;packageId?:string};
const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const stable=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=(x:unknown)=>createHash('sha256').update(stable(x)).digest('hex');
const integer=(n:number)=>Number.isSafeInteger(n)&&n>=0;

/** Customer-side cooperative guard, composed with the existing payment clients.
 * Reserves BEFORE signing. Never releases uncertain/failed authorizations or signs an ID twice.
 * Use one private store across every process sharing this budget; an external wallet
 * must independently enforce the same policy. Import/construction cannot access a wallet.
 */
export class BudgetGuard {
 #db:DatabaseSync;#policy:BudgetPolicy;#now:()=>number;
 constructor(path:string,policy:BudgetPolicy,now=Date.now){
  const u=new URL(policy.origin);
  if(u.protocol!=='https:'||u.origin!==policy.origin||policy.network!=='eip155:8453'||policy.asset.toLowerCase()!==USDC||!/^0x[\da-f]{40}$/i.test(policy.recipient))throw Error('Explicit HTTPS/Base/native-USDC/recipient policy required');
  if(![policy.perCallAtomic,policy.dailyAtomic,policy.monthlyAtomic,policy.lifetimeAtomic,policy.maximumPurchaseAtomic].every(integer)||!policy.perCallAtomic||policy.dailyAtomic<policy.perCallAtomic||policy.monthlyAtomic<policy.dailyAtomic||policy.lifetimeAtomic<policy.monthlyAtomic||policy.maximumPurchaseAtomic>policy.lifetimeAtomic)throw Error('Consistent finite integer budgets required');
  for(const values of [policy.allowedServices,policy.allowedPackages])if(!Array.isArray(values)||values.some(v=>typeof v!=='string'||!v.length)||new Set(values).size!==values.length)throw Error('Explicit service/package allowlists required');
  if(!isAbsolute(path))throw Error('Use an absolute private budget path outside Git');
  const realParent=realpathSync(dirname(path));for(let p=realParent;;p=dirname(p)){if(existsSync(join(p,'.git')))throw Error('Keep budget state outside Git');if(dirname(p)===p)break;}
  if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Budget file cannot be a symlink');
  try{closeSync(openSync(path,'ax',0o600));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  this.#policy=structuredClone(policy);this.#now=now;this.#db=new DatabaseSync(path);
  this.#db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS owner_policy(id INTEGER PRIMARY KEY CHECK(id=1),digest TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,last_ms INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,amount INTEGER NOT NULL,service TEXT,package_id TEXT,day TEXT NOT NULL,month TEXT NOT NULL);');
  this.#db.prepare('INSERT OR IGNORE INTO owner_policy(id,digest) VALUES(1,?)').run(digest(policy));
  if((this.#db.prepare('SELECT digest FROM owner_policy WHERE id=1').get() as any).digest!==digest(policy)){this.#db.close();throw Error('Persisted owner policy differs; never reset unresolved authorizations');}
  for(const file of [path,path+'-wal',path+'-shm'])if(existsSync(file))chmodSync(file,0o600);
 }
 close(){this.#db.close();}
 disable(){this.#db.prepare('UPDATE owner_policy SET disabled=1 WHERE id=1').run();}
 totals(){return this.#db.prepare('SELECT count(*) reservations,COALESCE(sum(amount),0) reserved_atomic FROM reservations').get() as {reservations:number;reserved_atomic:number};}
 reserve(s:Spend){
  const p=this.#policy,now=this.#now();
  if(!/^[\w-]{16,128}$/.test(s.id)||!integer(s.amountAtomic)||s.amountAtomic<1||!Number.isSafeInteger(now)||now<0)throw Error('Valid unique operation ID, clock and positive atomic amount required');
  const purchase=s.packageId!==undefined;
  if(purchase?(s.service!==undefined||!p.allowedPackages.includes(s.packageId!)||s.amountAtomic>p.maximumPurchaseAtomic):(!s.service||!p.allowedServices.includes(s.service)||s.amountAtomic>p.perCallAtomic))throw Error('Operation exceeds the owner service/package/per-call policy');
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   const state=this.#db.prepare('SELECT disabled,last_ms FROM owner_policy WHERE id=1').get() as any;
   if(state.disabled)throw Error('Owner emergency stop is active');
   if(now<state.last_ms)throw Error('Clock moved backwards; budget remains reserved');
   if(this.#db.prepare('SELECT id FROM reservations WHERE id=?').get(s.id))throw Error('Original operation already reserved; recover it without signing again');
   const day=new Date(now).toISOString().slice(0,10),month=day.slice(0,7),sums=this.#db.prepare('SELECT COALESCE(sum(amount),0) total,COALESCE(sum(CASE WHEN day=? THEN amount ELSE 0 END),0) daily,COALESCE(sum(CASE WHEN month=? THEN amount ELSE 0 END),0) monthly FROM reservations').get(day,month) as any;
   if(sums.total+s.amountAtomic>p.lifetimeAtomic||sums.daily+s.amountAtomic>p.dailyAtomic||sums.monthly+s.amountAtomic>p.monthlyAtomic)throw Error('Owner cumulative budget exhausted');
   this.#db.prepare('INSERT INTO reservations VALUES(?,?,?,?,?,?)').run(s.id,s.amountAtomic,s.service??null,s.packageId??null,day,month);
   this.#db.prepare('UPDATE owner_policy SET last_ms=? WHERE id=1').run(now);this.#db.exec('COMMIT');
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 /** One signing attempt, never a retry loop. saveSigned must durably encrypt the exact
  * returned proof outside Git before this resolves. No private key is accepted here.
  * Recovery uses the existing client's ORIGINAL Operation, not this method.
  */
 async signOnce(spend:Omit<Spend,'amountAtomic'>,challenge:Json,expectedResource:string,signer:Signer,saveSigned:(proof:Json)=>Promise<void>){
  const original=structuredClone(challenge),p=this.#policy,r=original?.accepts?.[0],url=new URL(expectedResource);
  if(url.origin!==p.origin||url.username||url.password||url.search||original.x402Version!==2||original.resource?.url!==expectedResource||original.accepts?.length!==1||r.scheme!=='exact'||r.network!==p.network||r.asset?.toLowerCase()!==p.asset.toLowerCase()||r.payTo?.toLowerCase()!==p.recipient.toLowerCase()||!/^[1-9]\d*$/.test(r.amount??'')||!Number.isInteger(r.maxTimeoutSeconds)||r.maxTimeoutSeconds<1||r.maxTimeoutSeconds>300||typeof signer!=='function'||typeof saveSigned!=='function')throw Error('Challenge differs from explicit owner payment policy');
  this.reserve({...spend,amountAtomic:Number(r.amount)});
  // Give the external signer an isolated copy so it cannot mutate validated terms.
  const proof=await signer(structuredClone(original));
  if(proof.x402Version!==2||stable(proof.accepted)!==stable(r)||stable(proof.resource)!==stable(original.resource)||stable(proof.extensions??{})!==stable(original.extensions??{}))throw Error('Signer changed original terms; reservation retained');
  await saveSigned(structuredClone(proof));return proof;
 }
}
