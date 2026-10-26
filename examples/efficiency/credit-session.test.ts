import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {CreditSession,type CreditSessionPolicy} from './credit-session.ts';
import {PendingPrepaid} from '../knowledge-base/prepaid.ts';
const credential='fp_'+'a'.repeat(64),encryptionKey=new Uint8Array(32).fill(7);
const check={tool:'fresh402_check',input:{watch_id:'w_'+'1'.repeat(32)},callId:'stable_1'};
async function fixture(t:any,transport:'rest'|'mcp'='rest',caps:Partial<CreditSessionPolicy>={}){
 const dir=mkdtempSync(join(tmpdir(),'fresh402-credit-')),file=join(dir,'state.sqlite');
 const seen=new Map<string,any>(),keys:string[]=[],acceptedCredentials=new Set([credential]),stats={account:'customer_fixture',tariff:3,drop:false,expired:false,posts:0,delay:0};let notifyPost!:()=>void;const firstPost=new Promise<void>(r=>notifyPost=r);
 const server=createServer(async(req,res)=>{let text='';for await(const p of req)text+=p;const j=text?JSON.parse(text):{},mcp=req.url==='/mcp',key=mcp?j.params?._meta?.['fresh402/prepaid']?.idempotency_key:req.headers['idempotency-key'];
  assert(acceptedCredentials.has(String(req.headers['x-fresh402-api-key'])));
  res.setHeader('content-type','application/json');
  if(req.url==='/v2/prepaid/balance')return res.end(JSON.stringify({access_method:'prepaid',account_id:stats.account,tariff_version:stats.tariff,available:100,reserved:0}));
  if(req.url==='/v2/prepaid/quote')return res.end(JSON.stringify({tariff_version:3,resource_class:'fixed',credits:{check:2,extract:3,smart_diff:4,openapi_diff:5}}));
  stats.posts++;notifyPost();keys.push(key);if(stats.delay)await new Promise(r=>setTimeout(r,stats.delay));
  if(stats.expired){res.statusCode=410;return res.end(JSON.stringify({error:'prepaid_result_expired'}));}
  if(!seen.has(key))seen.set(key,{hash:'e'.repeat(64),changed:false,text:'private page evidence',request:mcp?j.params.arguments:j});
  if(stats.drop){stats.drop=false;req.socket.destroy();return;}
  if(mcp)return res.end(JSON.stringify({jsonrpc:'2.0',id:j.id,result:{structuredContent:seen.get(key),_meta:{'fresh402/prepaid':{durable:true,access_method:'prepaid',credits:2}}}}));
  res.setHeader('x-fresh402-access','prepaid');res.setHeader('x-fresh402-credits','2');res.end(JSON.stringify(seen.get(key)));
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+(server.address() as any).port,policy:CreditSessionPolicy={origin,accountId:'customer_fixture',transport,allowedServices:['check'],perCallCredits:2,dailyCredits:4,monthlyCredits:4,lifetimeCredits:4,...caps};
 const opened:CreditSession[]=[];const open=(more:any={})=>{const s=new CreditSession(file,policy,{credential,encryptionKey,...more});opened.push(s);return s;};
 t.after(async()=>{for(const s of opened)try{s.close();}catch{}server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(dir,{recursive:true,force:true});});return{file,policy,open,stats,seen,keys,opened,acceptedCredentials,firstPost};
}
for(const transport of ['rest','mcp'] as const)test(`${transport}: lost delivery recovers the original encrypted request after restart, with one debit`,async t=>{
 const f=await fixture(t,transport),a=f.open();f.stats.drop=true;await assert.rejects(a.execute(check),PendingPrepaid);assert.equal(f.seen.size,1);assert.equal(a.totals().reserved_credits,2);a.close();f.opened.pop();
 const b=f.open(),result=await b.execute(check);assert.equal(result.result.changed,false);assert.equal(result.localReplay,false);assert.equal(new Set(f.keys).size,1);assert.equal(f.seen.size,1);
 const replay=await b.execute(check);assert.equal(replay.localReplay,true);assert.equal(f.stats.posts,2);assert.equal(b.totals().reserved_credits,2);
 assert.doesNotMatch(JSON.stringify(b),/fp_|storage|private page/);for(const suffix of ['','-wal'])assert(!readFileSync(f.file+suffix).includes(Buffer.from('private page evidence')));assert(!readFileSync(f.file).includes(Buffer.from(credential)));
});
test('restart and a second process share the lifetime cap; no server charge is attempted above it',async t=>{
 const f=await fixture(t,'rest',{dailyCredits:2,monthlyCredits:2,lifetimeCredits:2}),a=f.open();await a.execute(check);a.close();f.opened.pop();
 const moduleUrl=new URL('./credit-session.ts',import.meta.url).href,code=`import{CreditSession}from ${JSON.stringify(moduleUrl)};const s=new CreditSession(${JSON.stringify(f.file)},${JSON.stringify(f.policy)},{credential:${JSON.stringify(credential)},encryptionKey:new Uint8Array(32).fill(7)});try{await s.execute(${JSON.stringify({...check,callId:'second_process'})});process.exitCode=2;}catch(e){if(e.code!=='client_credit_budget_exceeded')process.exitCode=3;}finally{s.close();}`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'});let err='';child.stderr.on('data',b=>err+=b);const exit=await new Promise(r=>child.on('exit',r));assert.equal(exit,0,err);assert.equal(f.stats.posts,1);assert.equal(f.open().totals().reserved_credits,2);
});
test('same ID with changed inputs is rejected; simultaneous workers cannot submit that ID twice',async t=>{
 const f=await fixture(t),a=f.open(),b=f.open();f.stats.delay=100;const first=a.execute(check);await f.firstPost;await assert.rejects(b.execute(check),{code:'client_operation_busy'});await first;
 await assert.rejects(b.execute({...check,input:{watch_id:'w_'+'2'.repeat(32)}}),/different original/);assert.equal(f.stats.posts,1);
});
test('rotated credential for the same pinned account recovers the existing operation without a new debit',async t=>{
 const f=await fixture(t),a=f.open();f.stats.drop=true;await assert.rejects(a.execute(check),PendingPrepaid);a.close();f.opened.pop();const rotated='fp_'+'b'.repeat(64);f.acceptedCredentials.delete(credential);f.acceptedCredentials.add(rotated);const b=f.open({credential:rotated});assert.equal((await b.execute(check)).result.changed,false);assert.equal(f.seen.size,1);assert.equal(new Set(f.keys).size,1);
});
test('two concurrent processes cannot overshoot a shared credit cap with distinct original IDs',async t=>{
 const f=await fixture(t,'rest',{dailyCredits:2,monthlyCredits:2,lifetimeCredits:2}),moduleUrl=new URL('./credit-session.ts',import.meta.url).href;
 const results=await Promise.all(['process_one','process_two'].map(id=>new Promise<number|null>(resolve=>{const code=`import{CreditSession}from ${JSON.stringify(moduleUrl)};const s=new CreditSession(${JSON.stringify(f.file)},${JSON.stringify(f.policy)},{credential:${JSON.stringify(credential)},encryptionKey:new Uint8Array(32).fill(7)});try{await s.execute(${JSON.stringify({...check,callId:id})});process.exitCode=0;}catch(e){process.exitCode=e.code==='client_credit_budget_exceeded'?7:9;}finally{s.close();}`;const p=spawn(process.execPath,['--input-type=module','-e',code],{stdio:'pipe'});p.on('exit',resolve);})));assert.deepEqual(results.sort(),[0,7]);assert.equal(f.stats.posts,1);assert.equal(f.open().totals().reserved_credits,2);
});
test('wrong account/tariff and missing runtime ID cannot reserve or charge',async t=>{
 const f=await fixture(t),s=f.open();f.stats.account='another';await assert.rejects(s.execute(check),{code:'client_account_policy_mismatch'});f.stats.account='customer_fixture';f.stats.tariff=2;await assert.rejects(s.execute(check),{code:'client_account_policy_mismatch'});f.stats.tariff=3;
 await assert.rejects(s.execute({...check,callId:undefined as any}),{code:'invalid_input'});assert.equal(s.totals().operations,0);assert.equal(f.stats.posts,0);await s.execute(check);
});
test('UTC day/month ceilings reset only their own counters; lifetime reservations never reset',async t=>{
 const f=await fixture(t,'rest',{dailyCredits:2,monthlyCredits:4,lifetimeCredits:6});let now=Date.UTC(2026,9,26);const s=f.open({now:()=>now});
 await s.execute(check);await assert.rejects(s.execute({...check,callId:'day_limit'}),{code:'client_credit_budget_exceeded'});
 now+=86400000;await s.execute({...check,callId:'next_day'});now+=86400000;await assert.rejects(s.execute({...check,callId:'month_limit'}),{code:'client_credit_budget_exceeded'});
 now=Date.UTC(2026,10,1);await s.execute({...check,callId:'next_month'});now=Date.UTC(2026,11,1);await assert.rejects(s.execute({...check,callId:'lifetime_limit'}),{code:'client_credit_budget_exceeded'});assert.equal(f.stats.posts,3);assert.equal(s.totals().reserved_credits,6);
});
test('emergency stop, clock rollback, changed policy/key and corrupt ciphertext fail closed',async t=>{
 const f=await fixture(t);let now=Date.UTC(2026,9,26);const s=f.open({now:()=>now});await s.execute(check);now--;await assert.rejects(s.execute(check),/Clock rollback/);now+=2;s.disable();await assert.rejects(s.execute(check),/emergency stop/);
 assert.throws(()=>f.open({encryptionKey:new Uint8Array(32).fill(8)}),/policy\/storage key/);assert.throws(()=>new CreditSession(f.file,{...f.policy,accountId:'different'},{credential,encryptionKey}),/policy\/storage key/);
 const db=new DatabaseSync(f.file);db.prepare('UPDATE credit_policy SET disabled=0').run();db.prepare('UPDATE credit_calls SET sealed=?').run(new Uint8Array(40));db.close();await assert.rejects(s.execute(check),/encrypted session state unavailable/);assert.equal(f.stats.posts,1);
});
test('410 expiry becomes a terminal local outcome; no replacement request or repeated recovery loop',async t=>{
 const f=await fixture(t),s=f.open();f.stats.expired=true;await assert.rejects(s.execute(check),{code:'prepaid_result_expired',status:410});await assert.rejects(s.execute(check),{code:'prepaid_result_expired',status:410});assert.equal(f.stats.posts,1);assert.equal(s.totals().reserved_credits,2);
});
test('invalid inputs and unsupported service never transmit authenticated requests',async t=>{
 const f=await fixture(t),s=f.open();for(const input of [null,[],{x:'x'.repeat(262145)}])await assert.rejects(s.execute({...check,input:input as any}),{code:'invalid_input'});await assert.rejects(s.execute({...check,tool:'fresh402_token_facts'}),{code:'client_credit_service_unsupported'});assert.equal(s.totals().operations,0);assert.equal(f.stats.posts,0);
});
