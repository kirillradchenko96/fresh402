import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createWalletClient,custom} from 'viem';import {base,mainnet} from 'viem/chains';
import {fresh402ActionProvider} from './provider.ts';
import {agentKitSchema} from './schema.ts';
import {Fresh402Client} from '../../../knowledge-base/client.ts';
const {AgentKit,ActionProvider,ViemWalletProvider}=createRequire(import.meta.url)('@coinbase/agentkit') as typeof import('@coinbase/agentkit');
const schema={type:'object',properties:{url:{type:'string',format:'uri',pattern:'^https://',maxLength:4096,description:'Absolute public HTTPS target.'},watch_id:{type:'string',pattern:'^w_[a-f0-9]{32}$',description:'Reuse a real registered watch.'},max_age_seconds:{type:'integer',minimum:0,maximum:86400,default:0,description:'Allowed cached age.'}},oneOf:[{required:['url']},{required:['watch_id']}],additionalProperties:false};
function fixture(){let quotes=0,registrations=0,executions:any[]=[];const c=new Fresh402Client('https://service.example');c.discover=async()=>({version:'fixture',operations:['register','check'].map(n=>({tool:'fresh402_'+n,path:'/v1/'+n,summary:'Fixture '+n,schema,price:{amount:'0.005'}}))});c.quote=async()=>{quotes++;return{amount:'0.005',network:'eip155:8453'};};c.register=async()=>{registrations++;return{watch_id:'w_'+'1'.repeat(32)};};return{c,counts:()=>({quotes,registrations}),executions};}
function wallet(chain=base){return new ViemWalletProvider(createWalletClient({chain,account:'0x0000000000000000000000000000000000000001',transport:custom({request:async()=>{throw Error('No wallet/RPC operations allowed');}})}));}
// The upstream WalletProvider emits analytics. Intercept it locally BEFORE
// construction; no wallet address is sent to a vendor during these tests.
const originalFetch=globalThis.fetch;let blockedAnalytics=0;
globalThis.fetch=async(input,init)=>{if(String(input)==='https://cca-lite.coinbase.com/amp'){blockedAnalytics++;return new Response(null,{status:204});}throw Error('External network disabled in adapter tests');};
test.after(()=>{globalThis.fetch=originalFetch;assert(blockedAnalytics>0);});
test('actual AgentKit.from uses the real ActionProvider and Viem abstraction; construction cannot pay',async()=>{
 const f=fixture(),p=await fresh402ActionProvider(f.c,{allowedTools:['fresh402_register','fresh402_check']});assert(p instanceof ActionProvider);const kit=await AgentKit.from({walletProvider:wallet(),actionProviders:[p]}),actions=kit.getActions();assert.equal(actions.length,2);assert.deepEqual(f.counts(),{quotes:0,registrations:0});
 const free=JSON.parse(await actions[0].invoke({url:'https://example.com'}));assert.equal(free.result.watch_id,'w_'+'1'.repeat(32));const quote=JSON.parse(await actions[1].invoke({watch_id:free.result.watch_id}));assert.equal(quote.status,'payment_required');assert.equal(quote.new_payment_authorized,false);assert.deepEqual(f.counts(),{quotes:1,registrations:1});assert.equal(f.c.reserved,0n);
});
test('authorized AgentKit calls need trusted invocation scope; context is isolated across parallel calls',async()=>{
 const f=fixture(),p=await fresh402ActionProvider(f.c,{allowedTools:['fresh402_check'],mode:'authorized',executePaid:async i=>{await new Promise(r=>setTimeout(r,i.callId==='one'?10:1));f.executions.push(i);return{result:{call:i.callId}};}}),[a]=p.getActions(wallet());const args={watch_id:'w_'+'1'.repeat(32)};
 assert.equal(JSON.parse(await a.invoke(args)).status,'execution_denied');assert.equal(f.executions.length,0);
 const out=await Promise.all(['one','two'].map(id=>p.withInvocation(id,()=>a.invoke(args))));assert.deepEqual(out.map(x=>JSON.parse(x).result.call),['one','two']);assert.deepEqual(f.executions.map(x=>x.callId).sort(),['one','two']);assert.equal(JSON.parse(await a.invoke(args)).status,'execution_denied');
});
test('Base-only checks, exact original schema and conditional validation prevent malformed dispatch',async()=>{
 const f=fixture(),p=await fresh402ActionProvider(f.c,{allowedTools:['fresh402_check']}),[a]=p.getActions(wallet());assert.deepEqual(a.inputSchema,schema);assert.equal(p.getActions(wallet(mainnet as any)).length,0);for(const args of [{},{url:'https://example.com',watch_id:'w_'+'1'.repeat(32)},{url:'http://example.com'},{watch_id:'invented'},{url:'https://example.com',max_age_seconds:86401},{url:'https://example.com',extra:1}])assert.equal(JSON.parse(await a.invoke(args)).status,'invalid_input');assert.equal(f.counts().quotes,0);const original={url:'https://example.com'};assert.deepEqual(a.schema.parse(original),original);
});
test('bounded Zod adapter enforces array uniqueness, nested strictness, enums, const, not and fails unknown keywords',()=>{
 const s=agentKitSchema({type:'object',properties:{network:{type:'number',const:8453},mode:{type:'string',enum:['previous','baseline']},items:{type:'array',minItems:1,maxItems:2,uniqueItems:true,items:{type:'string'}},a:{type:'boolean'},b:{type:'boolean'}},required:['network','mode','items'],not:{required:['a','b']},additionalProperties:false}),valid={network:8453,mode:'baseline',items:['x']};assert(s.safeParse(valid).success);for(const x of [{...valid,network:1},{...valid,mode:'hash'},{...valid,items:['x','x']},{...valid,a:true,b:false}])assert(!s.safeParse(x).success);assert.throws(()=>agentKitSchema({$ref:'https://example.com'}),/Unsupported/);assert.throws(()=>agentKitSchema({type:'string',format:'email'}),/Unsupported/);
});
test('all eight published discovery schemas construct; nested reads and oversized collections are checked before dispatch',()=>{
 const api=JSON.parse(readFileSync(new URL('../../../../docs/openapi.json',import.meta.url),'utf8'));let count=0;
 for(const item of Object.values(api.paths) as any[])if(item.post?.operationId==='fresh402_register'||item.post?.operationId?.startsWith('fresh402_')&&item.post['x-payment-info']?.price){const schema=item.post.requestBody.content['application/json'].schema,parsed=agentKitSchema(schema);assert(parsed);for(const example of schema.examples??[])assert(parsed.safeParse(example).success,item.post.operationId);count++;}assert.equal(count,8);
 const s=agentKitSchema({type:'array',maxItems:1,items:{type:'string'}});assert(!s.safeParse(new Array(1000000).fill('x')).success);
});
