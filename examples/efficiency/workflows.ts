import {createHash} from 'node:crypto';
type Json=Record<string,any>;
export type WorkflowKind='website'|'api-review'|'onchain'|'cross-domain';
export type WorkflowRecord={tool:string;input:Json;atomic:number;state:'reserved'|'completed';result?:Json};
export type WorkflowStore={load:(id:string)=>Promise<WorkflowRecord|undefined>;save:(id:string,record:WorkflowRecord)=>Promise<void>};
export type WorkflowContext={
 runId:string;store:WorkflowStore;
 /** Derived from reviewed root/OpenAPI metadata, never from fetched page text. */
 costs:Record<string,number>;maxAtomic:number;
 /** One decision per NEW operation; this is NOT a signer. */
 authorize:(operation:{id:string;tool:string;input:Json;atomic:number;reservedTotal:number})=>Promise<boolean>;
 /** Customer executor must persist original proof/key/input before submission,
  * enforce the same wallet budget, and return only the public completed result. */
 execute:(tool:string,input:Json,id:string)=>Promise<Json>;
 /** Only recover ORIGINAL privately saved operations. No replacement payment. */
 recover?:(tool:string,input:Json,id:string)=>Promise<Json>;
};
const encode=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const digest=(v:unknown)=>createHash('sha256').update(encode(v)).digest('hex');

/** No network, wallet or scheduler is created here. Calls are sequential (max5),
 * independently authorized, journaled before execution, and never auto-retried.
 * Use one serial caller per runId; the external executor must provide durable
 * idempotency and concurrency/spend enforcement across processes. */
export async function runFlagship(kind:WorkflowKind,input:Json,c:WorkflowContext){
 if(!['website','api-review','onchain','cross-domain'].includes(kind)||!/^[\w-]{1,64}$/.test(c.runId)||!Number.isSafeInteger(c.maxAtomic)||c.maxAtomic<0)throw Error('Invalid explicit workflow policy');
 const prefix=c.runId+':'+digest({kind,input}),evidence:Json[]=[];let reserved=0,step=0;
 async function call(tool:string,args:Json){
  if(++step>5)throw Error('Workflow step bound');const id=prefix+':'+step,atomic=c.costs[tool];
  if(!Number.isSafeInteger(atomic)||atomic<0||atomic===0&&tool!=='fresh402_register')throw Error('Reviewed operation cost required');
  reserved+=atomic;if(reserved>c.maxAtomic)throw Error('Workflow budget exceeded');
  const saved=await c.store.load(id);if(saved&&(saved.tool!==tool||encode(saved.input)!==encode(args)||saved.atomic!==atomic))throw Error('Original operation mismatch');
  let result:Json;
  if(saved?.state==='completed')result=saved.result!;
  else if(saved){if(!c.recover)throw Error('Recover ORIGINAL operation; no replacement');result=await c.recover(tool,args,id);}
  else{if(!await c.authorize({id,tool,input:structuredClone(args),atomic,reservedTotal:reserved}))throw Error('Operation authorization declined');await c.store.save(id,{tool,input:structuredClone(args),atomic,state:'reserved'});result=await c.execute(tool,args,id);}
  // An HTTP200 MCP error, unsaved chain result or pending response is not success.
  if(!result||typeof result!=='object'||result.error||result.isError||['pending','pending_recovery','payment_required','error','execution_denied'].includes(result.status)||result.observation_saved===false)throw Error('Original operation needs recovery/review');
  await c.store.save(id,{tool,input:structuredClone(args),atomic,state:'completed',result:structuredClone(result)});
  evidence.push({tool,operation_id:id,result});return result;
 }
 const watch=async()=>{if(input.watch_id)return input.watch_id;if(!input.url)throw Error('URL or persisted watch required');const r=await call('fresh402_register',{url:input.url});if(typeof r.watch_id!=='string')throw Error('Missing real watch identity');return r.watch_id;};
 if(kind==='website'){
  const id=await watch();if(input.phase==='baseline')return{watch_id:id,evidence,reserved_atomic:reserved,next:'Persist watch_id. Run review only when another observation is useful.'};
  const check=await call('fresh402_check',{watch_id:id,include_diff:true});
  if(check.changed===true){await call('fresh402_extract',{url:input.url??check.url,max_chars:20000});await call('fresh402_smart_diff',{watch_id:id,compare_to:'baseline'});}
 }else if(kind==='api-review'){
  const id=await watch();if(input.phase!=='seed'&&!input.contract_baseline_seeded)throw Error('Seed contract history in an earlier run; first diff only seeds');
  if(input.phase==='seed')await call('fresh402_openapi_contract_diff',{watch_id:id,compare_to:'baseline'});
  else{const changed=await call('fresh402_check',{watch_id:id});if(changed.changed===true)await call('fresh402_openapi_contract_diff',{watch_id:id,compare_to:'baseline'});}
 }else{
  if(kind==='cross-domain'){
   const id=await watch(),check=await call('fresh402_check',{watch_id:id});
   if(check.changed===true)await call('fresh402_extract',{url:input.url??check.url,max_chars:20000});
  }
  if(!input.contract)throw Error('Explicit Base contract required');
  await call('fresh402_contract_watch',{chain_id:8453,address:input.contract,block:'finalized',...(input.previous_snapshot?{previous_snapshot:input.previous_snapshot}:{})});
  if(kind==='onchain'){
   await call('fresh402_wallet_watch',{chain_id:8453,address:input.wallet,tokens:[input.token],block:'finalized',...(input.cursor?{cursor:input.cursor}:{})});
   await call('fresh402_token_facts',{chain_id:8453,address:input.token,block:'finalized'});
  }
 }
 return{evidence,reserved_atomic:reserved,interpretation:kind==='cross-domain'?'Separate web and chain observations; temporal proximity does not prove causation.':'Source evidence only; uncertainty and unsupported states remain in individual results.'};
}
