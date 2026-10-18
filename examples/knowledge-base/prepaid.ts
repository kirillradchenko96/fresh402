import { randomUUID } from 'node:crypto';
import { ApiError } from './client.ts';
type Json=Record<string,any>;
export type PrepaidRequest={key:string;service:'check'|'extract'|'smart_diff'|'openapi_diff';input:Json;cost:number;tariffVersion?:1|2|3;state:'pending'|'completed'|'released';result?:Json};
export class PendingPrepaid extends Error {declare operation:PrepaidRequest;constructor(operation:PrepaidRequest){super('Prepaid outcome uncertain. Recover the ORIGINAL idempotency key.');Object.defineProperty(this,'operation',{value:operation,enumerable:false});}}
const cost={check:1,extract:2,smart_diff:3};
const charge=(version:number,service:PrepaidRequest['service'])=>{if(service==='openapi_diff'){if(version!==3)throw new Error('OpenAPI requires tariff 3');return 5;}return version===3?({check:2,extract:3,smart_diff:4}[service]):version===2&&service==='check'?2:cost[service];};
const paths={check:'/v2/prepaid/check',extract:'/v2/prepaid/extract',smart_diff:'/v2/prepaid/smart-diff',openapi_diff:'/v2/prepaid/openapi-contract-diff'};
/** REST/MCP prepaid-only: this client has no signer or payment submission path. */
export class PrepaidClient {
 transport:'rest'|'mcp';base:string;budget:number;reserved=0;timeout:number;tariffVersion:1|2|3;persist:(op:PrepaidRequest)=>Promise<void>;declare credential:string;declare stagingToken?:string;specialized=false;
 constructor(base:string,credential:string,options:{transport?:'rest'|'mcp';maxCredits:number;persist:(op:PrepaidRequest)=>Promise<void>;stagingToken?:string;timeoutMs?:number;restoredCredits?:number;tariffVersion?:1|2|3}){
  const u=new URL(base);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!(u.protocol==='https:'||u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('Use an HTTPS origin or local loopback');
  if(!/^fp_[a-f0-9]{64}$/.test(credential)||!Number.isSafeInteger(options.maxCredits)||options.maxCredits<0||typeof options.persist!=='function')throw new Error('Credential, integer credit cap and private persistence are required');
  this.base=u.origin;this.transport=options.transport??'rest';this.budget=options.maxCredits;this.persist=options.persist;this.timeout=options.timeoutMs??15000;
  this.tariffVersion=options.tariffVersion??1;if(![1,2,3].includes(this.tariffVersion))throw new Error('Unknown tariff');
  const restored=options.restoredCredits??0;if(!Number.isSafeInteger(restored)||restored<0||restored>this.budget)throw new Error('Invalid restored credit budget');this.reserved=restored;
  Object.defineProperty(this,'credential',{value:credential,enumerable:false});Object.defineProperty(this,'stagingToken',{value:options.stagingToken,enumerable:false});
 }
 async request(path:string,input?:Json,key?:string,authorization?:{version:number;maximum:number}){
  const service=(Object.entries(paths) as Array<[PrepaidRequest['service'],string]>).find(([,p])=>p===path)?.[0],mcp=this.transport==='mcp'&&service&&input!==undefined;
  const payload=mcp?{jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name:service==='openapi_diff'?'fresh402_openapi_contract_diff':'fresh402_'+service,arguments:input,_meta:{'fresh402/prepaid':{idempotency_key:key,tariff_version:authorization?.version,max_credits:authorization?.maximum}}}}:input;
  const r=await fetch(this.base+(mcp?'/mcp':path),{method:input===undefined?'GET':'POST',redirect:'error',headers:{accept:'application/json, text/event-stream','x-fresh402-api-key':this.credential,...(this.stagingToken?{authorization:'Bearer '+this.stagingToken}:{}),...(input===undefined?{}:{'content-type':'application/json'}),...(key?{'idempotency-key':key}:{}),...(authorization&&authorization.version>=2?{'x-fresh402-tariff-version':String(authorization!.version),'x-fresh402-max-credits':String(authorization.maximum)}:{})},...(input===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(this.timeout)});
  if(!r.body)throw new Error('Empty service response');const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000)throw new Error('Response too large');parts.push(value);}}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
  const text=Buffer.concat(parts).toString('utf8'),event=mcp?text.split(/\r?\n/).find(l=>l.startsWith('data:')):undefined,json=JSON.parse(event?event.slice(5):text);
  if(mcp&&r.ok){if(json.error)throw new ApiError('mcp_protocol_error',400);const result=json.result,data=result?.structuredContent,meta=result?._meta?.['fresh402/prepaid'];if(!data)throw new Error('Missing MCP result');const headers=new Headers({'content-type':'application/json'});if(meta?.durable&&meta.access_method==='prepaid'&&Number.isSafeInteger(meta.credits)&&meta.credits>=0){headers.set('x-fresh402-access','prepaid');headers.set('x-fresh402-credits',String(meta.credits));}return{response:new Response(null,{status:result.isError?(Number.isInteger(data.status)?data.status:503):200,headers}),json:data};}
  return{response:r,json};
 }
 async balance(){const {response,json}=await this.request('/v2/prepaid/balance');if(!response.ok)throw new ApiError(json.error??'prepaid_error',response.status);if(json.access_method!=='prepaid'||!Number.isSafeInteger(json.available)||json.available<0||!Number.isSafeInteger(json.reserved)||json.reserved<0)throw new Error('Invalid balance response');return json;}
 async usage(){const {response,json}=await this.request('/v2/prepaid/usage');if(!response.ok)throw new ApiError(json.error??'prepaid_error',response.status);return json;}
 quote(service:PrepaidRequest['service']){if(!Object.hasOwn(paths,service)||service==='openapi_diff'&&!this.specialized)throw new Error('Unknown prepaid product');return{tariff_version:this.tariffVersion,resource_class:'fixed',maximum_credits:charge(this.tariffVersion,service)};}
 async quoteRemote(){const {response,json}=await this.request('/v2/prepaid/quote');if(!response.ok)throw new ApiError(json.error??'prepaid_error',response.status);if(![1,2,3].includes(json.tariff_version)||json.resource_class!=='fixed'||['check','extract','smart_diff'].some(s=>json.credits?.[s]!== charge(json.tariff_version,s as keyof typeof cost)))throw new Error('Unsupported pricing contract');if(json.credits.openapi_diff!==undefined&&(json.tariff_version!==3||json.credits.openapi_diff!==5))throw new Error('Unsupported OpenAPI pricing contract');this.specialized=json.credits.openapi_diff===5;this.tariffVersion=json.tariff_version;return json;}
 async register(input:Json){const {response,json}=await this.request('/v1/register',input);if(!response.ok)throw new ApiError(json.error??'registration_error',response.status);return json;}
 async execute(service:PrepaidRequest['service'],input:Json){
  const charge=this.quote(service).maximum_credits;if(this.reserved+charge>this.budget)throw new ApiError('client_credit_budget_exceeded',402);
  const op:PrepaidRequest={key:randomUUID(),service,input:structuredClone(input),cost:charge,...(this.tariffVersion>=2?{tariffVersion:this.tariffVersion}:{}),state:'pending'};this.reserved+=charge;
  try{await this.persist(op);}catch(e){this.reserved-=charge;throw e;}
  return this.recover(op);
 }
 async recover(op:PrepaidRequest){
  const version=op.tariffVersion??1;if(![1,2,3].includes(version)||!Object.hasOwn(paths,op.service)||op.cost!==charge(version,op.service)||!/^[A-Za-z0-9_-]{16,128}$/.test(op.key))throw new Error('Invalid persisted prepaid operation');
  let r;try{r=await this.request(paths[op.service],op.input,op.key,{version,maximum:op.cost});}catch{throw new PendingPrepaid(op);}
  const durable=r.response.headers.get('x-fresh402-access')==='prepaid',charged=r.response.headers.get('x-fresh402-credits');
  if(r.response.ok){if(!durable||charged!==String(op.cost))throw new PendingPrepaid(op);op.state='completed';op.result=r.json;await this.persist(op);return r.json;}
  if(durable&&charged==='0'||r.response.status<500&&![409,410].includes(r.response.status)){if(op.state==='pending')this.reserved=Math.max(0,this.reserved-op.cost);op.state='released';await this.persist(op);throw new ApiError(r.json.error??'prepaid_error',r.response.status);}
  throw new PendingPrepaid(op);
 }
}
