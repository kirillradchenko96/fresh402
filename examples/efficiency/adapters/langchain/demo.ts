import {createServer} from 'node:http';import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
import {AIMessage} from '@langchain/core/messages';
import {StateGraph,MessagesAnnotation,MemorySaver,START,END,Command} from '@langchain/langgraph';
import {Fresh402Client} from '../../../knowledge-base/client.ts';
import {CreditSession} from '../../credit-session.ts';
import {createLangChainTools} from './tools.ts';import {createRecoveryToolNode} from './recovery-node.ts';

/** Real framework/client execution against a LOOPBACK contract fixture. All
 * credits, sources and results are synthetic. No wallet, model, RPC or provider.
 */
export async function runLocalDemo(transport:'rest'|'mcp'='rest'){
 const api=JSON.parse(readFileSync(new URL('../../../../docs/openapi.json',import.meta.url),'utf8'));
 const tools=Object.values(api.paths).flatMap((p:any)=>(p.post?.operationId==='fresh402_register'||p.post?.operationId?.startsWith('fresh402_')&&p.post['x-payment-info']?.price)?[{name:p.post.operationId,inputSchema:p.post.requestBody.content['application/json'].schema}]:[]);
 const credential='fp_'+'a'.repeat(64),store=new Map<string,any>(),watch='w_'+'1'.repeat(32),hash='1'.repeat(64),directory=mkdtempSync(join(tmpdir(),'fresh402-graph-')),file=join(directory,'private.sqlite'),encryptionKey=new Uint8Array(32).fill(7);
 let changed=false,drop=false,charged=0,registrations=0,extractions=0,submissions=0;
 const server=createServer(async(req,res)=>{
  let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{},mcp=req.url==='/mcp';res.setHeader('content-type','application/json');
  if(req.url==='/openapi.json')return res.end(JSON.stringify(api));
  if(mcp&&body.method==='initialize')return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'local-only'}}}));
  if(mcp&&body.method==='tools/list')return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{tools}}));
  if(mcp&&body.method==='notifications/initialized'){res.statusCode=202;return res.end();}
  const tool=mcp?body.params.name:undefined;
  if(req.url==='/v1/register'||tool==='fresh402_register'){registrations++;const result={watch_id:watch,hash};return res.end(JSON.stringify(mcp?{jsonrpc:'2.0',id:body.id,result:{structuredContent:result}}:result));}
  if(req.headers['x-fresh402-api-key']!==credential){res.statusCode=403;return res.end('{}');}
  if(req.url==='/v2/prepaid/balance')return res.end(JSON.stringify({account_id:'fixture_account',access_method:'prepaid',tariff_version:3,available:100-charged,reserved:0}));
  if(req.url==='/v2/prepaid/quote')return res.end(JSON.stringify({tariff_version:3,resource_class:'fixed',credits:{check:2,extract:3,smart_diff:4,openapi_diff:5}}));
  const service=mcp?tool.replace('fresh402_',''):req.url?.split('/').at(-1),cost=service==='check'?2:service==='extract'?3:0;if(!cost){res.statusCode=404;return res.end('{}');}
  submissions++;const key=mcp?body.params._meta['fresh402/prepaid'].idempotency_key:req.headers['idempotency-key'];
  if(!store.has(key)){charged+=cost;if(service==='extract')extractions++;store.set(key,service==='check'?{watch_id:watch,hash:changed?'2'.repeat(64):hash,changed,cache_hit:false,untrusted_source:true}:{url:'https://documentation.fixture.example/',text:changed?'Retention is fourteen days.':'Retention is seven days.',hash:changed?'2'.repeat(64):hash,untrusted_source:true});}
  if(drop){drop=false;req.socket.destroy();return;}
  const result=store.get(key);if(mcp)return res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result:{structuredContent:result,_meta:{'fresh402/prepaid':{durable:true,access_method:'prepaid',credits:cost}}}}));
  res.setHeader('x-fresh402-access','prepaid');res.setHeader('x-fresh402-credits',String(cost));res.end(JSON.stringify(result));
 });server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+(server.address() as any).port;
 const policy={origin,accountId:'fixture_account',transport,allowedServices:['check','extract'] as ('check'|'extract')[],perCallCredits:3,dailyCredits:10,monthlyCredits:10,lifetimeCredits:10};let session=new CreditSession(file,policy,{credential,encryptionKey});
 try{
  const client=new Fresh402Client(origin,{transport}),bindings=await createLangChainTools(client,{allowedTools:['fresh402_register','fresh402_check','fresh402_extract'],mode:'authorized',executePaid:i=>session.execute(i)});
  const graph=new StateGraph(MessagesAnnotation).addNode('tools',createRecoveryToolNode(bindings)).addEdge(START,'tools').addEdge('tools',END).compile({checkpointer:new MemorySaver()});
  async function invoke(name:string,args:Record<string,any>,id:string,recover=false){const config={configurable:{thread_id:id}},message=new AIMessage({content:'',tool_calls:[{name,args,id}]});let value=await graph.invoke({messages:[message]},config);if((value as any).__interrupt__){assert(recover);const before=charged;session.close();session=new CreditSession(file,policy,{credential,encryptionKey});value=await graph.invoke(new Command({resume:true}),config);assert.equal(charged,before,'Recovery cannot debit again');}return JSON.parse(value.messages.at(-1)!.content as string);}
  const baseline=await invoke('fresh402_register',{url:'https://documentation.fixture.example/'},'baseline');assert.equal(baseline.result.watch_id,watch);
  let evidence=(await invoke('fresh402_extract',{url:'https://documentation.fixture.example/'},'initial_extract')).result;
  const unchanged=await invoke('fresh402_check',{watch_id:watch},'unchanged');assert.equal(unchanged.result.changed,false);assert.equal(extractions,1);assert.match(evidence.text,/seven/);
  changed=true;drop=true;const observation=await invoke('fresh402_check',{watch_id:watch},'changed_check',true);assert.equal(observation.result.changed,true);evidence=(await invoke('fresh402_extract',{url:'https://documentation.fixture.example/'},'changed_extract')).result;assert.match(evidence.text,/fourteen/);
  const denied=await invoke('fresh402_check',{watch_id:watch},'over_budget');assert.equal(denied.status,'error');assert.equal(denied.http_status,402);assert.equal(charged,10);assert.equal(store.size,4);assert.equal(registrations,1);
  return{mode:'LOCAL synthetic contract fixture; real LangChain/LangGraph and durable client',transport,free_baselines:registrations,paid_fixture_operations:store.size,fixture_credit_units:charged,submissions,extractions,reused_unchanged_evidence:true,recovery_after_restart:true,recovery_extra_debits:0,cap_enforced:true,model_calls:0,real_payments:0};
 }finally{session.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)for(const transport of ['rest','mcp'] as const)console.log(JSON.stringify(await runLocalDemo(transport)));
