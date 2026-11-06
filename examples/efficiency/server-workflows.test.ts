import test from 'node:test';import assert from 'node:assert/strict';
import {createServer} from 'node:http';import {mkdtempSync,rmSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,sep} from 'node:path';
import {PrepaidClient,type PrepaidRequest} from '../knowledge-base/prepaid.ts';
import {Fresh402Client,PendingPayment,type Operation} from '../knowledge-base/client.ts';
import {CreditSession} from './credit-session.ts';
import {SERVER_WORKFLOWS,serverWorkflowPath,serverWorkflowPrepaidPath,type ServerWorkflow} from '../knowledge-base/workflow-products.ts';
const credential='fp_'+'1'.repeat(64),costs={website_change_intelligence:2,api_compatibility_review:4,onchain_evidence_brief:10,cross_domain_release_evidence:16}; // Public frozen test fixture, not runtime pricing.
async function fixture(t:any){
 const originals=new Map<string,any>(),stats={quotes:0,posts:0,denyQuotes:false,badQuote:false};
 const s=createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.headers['x-fresh402-api-key']!==credential){res.statusCode=403;res.end('{}');return;}
  if(req.url==='/v2/prepaid/balance'){res.end(JSON.stringify({access_method:'prepaid',account_id:'isolated-workflow-account',tariff_version:3,available:100,reserved:0}));return;}
  if(req.url?.startsWith('/v4/prepaid/workflows/quote/')){stats.quotes++;if(stats.denyQuotes){res.statusCode=404;res.end('{"error":"tool_not_available"}');return;}const id=req.url.split('/').at(-1) as ServerWorkflow;res.end(JSON.stringify({service:id,tariff_version:5,resource_class:'fixed',credits:costs[id],terms_digest:'a'.repeat(64),workflow_terms:{service:id,cost:stats.badQuote?99:costs[id]},provisional_credits:false,one_financial_operation:true,internal_charges:0}));return;}
  const chunks=[];for await(const c of req)chunks.push(c);const j=JSON.parse(Buffer.concat(chunks).toString()),mcp=req.url==='/mcp',id=(mcp?j.params.name.replace('fresh402_',''):SERVER_WORKFLOWS.find(id=>serverWorkflowPrepaidPath(id)===req.url)) as ServerWorkflow,input=mcp?j.params.arguments:j,meta=j.params?._meta?.['fresh402/prepaid'],key=meta?.idempotency_key??req.headers['idempotency-key'];
  assert.equal(Number(meta?.tariff_version??req.headers['x-fresh402-tariff-version']),5);assert.equal(Number(meta?.max_credits??req.headers['x-fresh402-max-credits']),costs[id]);assert.equal(req.headers['payment-signature'],undefined);
  const saved=originals.get(String(key));if(saved)assert.deepEqual(saved.input,input);else{stats.posts++;originals.set(String(key),{input,result:{workflow:id,version:1,status:'evidence_ready',unfunded_unit_fixture:true}});}const result=originals.get(String(key)).result;
  if(mcp)res.end(JSON.stringify({jsonrpc:'2.0',id:j.id,result:{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,_meta:{'fresh402/prepaid':{durable:true,access_method:'prepaid',credits:costs[id]}}}}));else{res.setHeader('x-fresh402-access','prepaid');res.setHeader('x-fresh402-credits',String(costs[id]));res.end(JSON.stringify(result));}
 });await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r());}));return{base:'http://127.0.0.1:'+(s.address() as any).port,stats};
}
for(const id of SERVER_WORKFLOWS)for(const transport of ['rest','mcp'] as const)test(id+' '+transport+': authenticated quote and one original prepaid operation; recovery needs no fresh quote',async t=>{
 const f=await fixture(t);let saved:PrepaidRequest|undefined;const options={transport,maxCredits:costs[id],persist:async(op:PrepaidRequest)=>{saved=structuredClone(op);}},client=new PrepaidClient(f.base,credential,options);assert.throws(()=>client.quote(id),/authenticated workflow quote/);assert.equal((await client.quoteRemote(id)).tariff_version,5);
 const first=await client.execute(id,{test:'synthetic public client fixture'});assert.equal(first.workflow,id);assert(saved);assert.equal(saved.tariffVersion,5);assert.equal(saved.cost,costs[id]);assert.equal(f.stats.posts,1);f.stats.denyQuotes=true;
 const restarted=new PrepaidClient(f.base,credential,options);assert.deepEqual(await restarted.recover(saved),first);assert.equal(f.stats.posts,1);assert.equal(f.stats.quotes,1);assert.equal(saved.state,'completed');
});
test('workflow SDK rejects inconsistent pricing and enforces explicit total cap before POST',async t=>{
 const f=await fixture(t),id=SERVER_WORKFLOWS[0],client=new PrepaidClient(f.base,credential,{maxCredits:1,persist:async()=>{}});f.stats.badQuote=true;await assert.rejects(client.quoteRemote(id),/pricing contract/);f.stats.badQuote=false;await client.quoteRemote(id);await assert.rejects(client.execute(id,{}),/client_credit_budget_exceeded/);assert.equal(f.stats.posts,0);
});
test('encrypted credit session supports workflow5 and replays the original after quote/new-work disable',async t=>{
 const f=await fixture(t),dir=mkdtempSync(join(tmpdir(),'workflow-client-')),file=join(dir,'private.sqlite'),encryptionKey=new Uint8Array(32).fill(9),id=SERVER_WORKFLOWS[1],policy={origin:f.base,accountId:'isolated-workflow-account',transport:'rest' as const,allowedServices:[id],perCallCredits:4,dailyCredits:4,monthlyCredits:4,lifetimeCredits:4},options={credential,encryptionKey};t.after(()=>{const target=realpathSync(dir);assert(target.startsWith(realpathSync(tmpdir())+sep+'workflow-client-'));rmSync(target,{recursive:true,force:true});});
 let c=new CreditSession(file,policy,options);const task={tool:'fresh402_'+id,input:{url:'https://example.com/openapi.json'},callId:'workflow_acceptance_1'},first=await c.execute(task);assert.equal(first.localReplay,false);assert.equal(c.totals().reserved_credits,4);c.close();f.stats.denyQuotes=true;
 c=new CreditSession(file,policy,options);try{const replay=await c.execute(task);assert.equal(replay.localReplay,true);assert.deepEqual(replay.result,first.result);assert.equal(f.stats.posts,1);assert.equal(f.stats.quotes,1);await assert.rejects(c.execute({...task,input:{url:'https://different.example/'}}),/different original input/);assert.equal(c.totals().reserved_credits,4);}finally{c.close();}
});
test('a successful settlement receipt with pending persistence is never marked completed by the x402 client',async()=>{
 for(const result of [{workflow_state_saved:false},{snapshot_saved:false},{observation_saved:false},{persistence_error:'pending original delivery'}]){let saved:Operation|undefined;const c=new Fresh402Client('https://example.com',{persist:async op=>{saved=structuredClone(op);}});c.raw=async()=>({result,receipt:{success:true,network:'eip155:8453',transaction:'0x'+'1'.repeat(64)}});const op:Operation={tool:'fresh402_website_change_intelligence',input:{},payment:{},recoveryToken:'private-unit-placeholder',amount:'5000',state:'authorized'};await assert.rejects(c.recover(op),PendingPayment);assert.equal(saved?.state,'pending');assert.equal(op.state,'pending');}
});

test('fresh x402 workflow client recovers originals after catalog disable without discovery, signing or origin rewriting',async()=>{
 for(const transport of ['rest','mcp'] as const)for(const id of SERVER_WORKFLOWS){
  const tool='fresh402_'+id,base='https://legacy.example',path=serverWorkflowPath(id),resource=base+(transport==='rest'?path:'/mcp#'+tool),receipt={success:true,network:'eip155:8453',transaction:'0x'+'1'.repeat(64)},result={workflow:id,workflow_state_saved:true};let posts=0;
  const payment={x402Version:2,resource:{url:resource},accepted:{scheme:'exact',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:'0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3',amount:'5000'},payload:{signature:'synthetic-unit-proof-never-networked'}};
  const original:Operation={tool,input:{original:'saved'},payment,recoveryToken:'private-unit-placeholder',amount:'5000',state:'pending'},proof=JSON.stringify(payment),client=new Fresh402Client(base,{transport,persist:async()=>{}});
  client.request=async(route,body,headers)=>{posts++;assert.equal(route,transport==='rest'?path:'/mcp');assert.equal(headers?.['X-Fresh402-Recovery-Token'],original.recoveryToken);const json=transport==='rest'?result:{jsonrpc:'2.0',id:1,result:{structuredContent:result,_meta:{'x402/payment-response':receipt}}};return{response:Response.json(json,{headers:transport==='rest'?{'payment-response':Buffer.from(JSON.stringify(receipt)).toString('base64')}:{}}),json};};
  client.discover=async()=>{throw Error('Disabled discovery must not be needed');};client.quote=async()=>{throw Error('Never get a new quote during original recovery');};
  assert.deepEqual((await client.recover(original)).result,result);assert.equal(posts,1);assert.equal(client.operations.size,0);assert.equal(client.reserved,0n);assert.equal(JSON.stringify(original.payment),proof);
  for(const corrupt of [(x:Operation)=>x.payment.resource.url='https://other.example'+path,(x:Operation)=>x.payment.accepted.payTo='0x'+'2'.repeat(40),(x:Operation)=>x.amount='9999']){const bad=structuredClone(original);corrupt(bad);await assert.rejects(client.recover(bad),PendingPayment);assert.equal(posts,1,'invalid origin/merchant/amount must fail before sending original proof');}
 }
});
