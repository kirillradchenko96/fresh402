import {createHash} from 'node:crypto';
type Json=Record<string,unknown>;
export type CacheIdentity={url:string;normalizerVersion:string;representation:string;scope?:Json};
export type CachedEvidence={watchId?:string;hash?:string;observedAt:number;value:Json};
const stable=(x:unknown):string=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const key=(i:CacheIdentity)=>createHash('sha256').update(stable(i)).digest('hex');
function identity(i:CacheIdentity){const u=new URL(i.url);if(u.protocol!=='https:'||u.username||u.password||u.hash||!i.normalizerVersion||!i.representation)throw Error('Use an exact public HTTPS URL, normalizer version, representation and scope');return key(i);}
/** Private client cache only. No shared server state, request, payment, or origin fetch.
 * Caller persists snapshot() confidentially. Scope/normalizer/output identity are exact;
 * a different output mode can never borrow another mode's freshness guarantee.
 */
export class EvidenceCache {
 #entries=new Map<string,CachedEvidence>();#bytes=0;#maxEntries:number;#maxBytes:number;
 hits=0;misses=0;
 constructor({maxEntries=32,maxBytes=1048576}={}){if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>512||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8388608)throw Error('Finite cache capacity required');this.#maxEntries=maxEntries;this.#maxBytes=maxBytes;}
 put(input:CacheIdentity,evidence:CachedEvidence){
  const k=identity(input);if(!Number.isSafeInteger(evidence.observedAt)||evidence.observedAt<0||!evidence.value||typeof evidence.value!=='object'||Array.isArray(evidence.value))throw Error('Valid observation time and result required');
  const copy=structuredClone(evidence),bytes=Buffer.byteLength(stable(copy));if(bytes>this.#maxBytes)throw Error('Result exceeds cache budget');
  const previous=this.#entries.get(k);if(previous)this.#bytes-=Buffer.byteLength(stable(previous));this.#entries.delete(k);this.#entries.set(k,copy);this.#bytes+=bytes;
  while(this.#entries.size>this.#maxEntries||this.#bytes>this.#maxBytes){const oldest=this.#entries.keys().next().value!;this.#bytes-=Buffer.byteLength(stable(this.#entries.get(oldest)));this.#entries.delete(oldest);}
 }
 get(input:CacheIdentity,{maxAgeMs,now=Date.now()}:{maxAgeMs:number;now?:number}){
  if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<0||!Number.isSafeInteger(now)||now<0)throw Error('Explicit finite cache age and clock required');
  const value=this.#entries.get(identity(input));if(!value||now<value.observedAt||now-value.observedAt>maxAgeMs){this.misses++;return undefined;}this.hits++;return structuredClone(value);
 }
 snapshot(){return JSON.stringify({version:1,entries:[...this.#entries]});}
 restore(text:string){
  if(Buffer.byteLength(text)>this.#maxBytes+this.#maxEntries*100+1024)throw Error('Snapshot exceeds cache budget');const j=JSON.parse(text);if(j.version!==1||!Array.isArray(j.entries)||j.entries.length>this.#maxEntries)throw Error('Unsupported cache snapshot');
  const next=new Map<string,CachedEvidence>();let bytes=0;for(const [k,v]of j.entries){if(typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k)||next.has(k)||!v||!Number.isSafeInteger(v.observedAt)||v.observedAt<0||!v.value||typeof v.value!=='object'||Array.isArray(v.value))throw Error('Invalid cached evidence');bytes+=Buffer.byteLength(stable(v));next.set(k,v);}if(bytes>this.#maxBytes)throw Error('Snapshot exceeds cache budget');this.#entries=next;this.#bytes=bytes;
 }
}

/** Cost model in ONE caller-selected unit (atomic USDC or purchased credits).
 * Estimates only; no signature, request or bypass of Fresh402 origin security.
 * Check+Extract is cheaper only when checkCost + changeRate*extractCost < extractCost.
 */
export function recommendRefresh(p:{cacheAgeMs:number|null;maximumAgeMs:number;checkCost:number;extractCost:number;estimatedChangeRate:number;directConditionalAvailable?:boolean}){
 if(!Number.isSafeInteger(p.maximumAgeMs)||p.maximumAgeMs<0||p.cacheAgeMs!==null&&(!Number.isSafeInteger(p.cacheAgeMs)||p.cacheAgeMs<0)||!Number.isFinite(p.checkCost)||p.checkCost<0||!Number.isFinite(p.extractCost)||p.extractCost<=0||!Number.isFinite(p.estimatedChangeRate)||p.estimatedChangeRate<0||p.estimatedChangeRate>1)throw Error('Explicit finite cache and cost model required');
 if(p.cacheAgeMs!==null&&p.cacheAgeMs<=p.maximumAgeMs)return{action:'reuse_cache' as const,estimatedServiceCost:0};
 if(p.directConditionalAvailable)return{action:'caller_conditional_http' as const,estimatedServiceCost:0};
 const expected=p.checkCost+p.estimatedChangeRate*p.extractCost;
 return expected<p.extractCost?{action:'check_then_extract_on_change' as const,estimatedServiceCost:expected}:{action:'extract' as const,estimatedServiceCost:p.extractCost};
}
