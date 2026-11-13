import test from 'node:test';import assert from 'node:assert/strict';
import {Fresh402Client,PendingPayment,PaymentRequired} from './client.ts';
import {CustomerClient,validateSolanaOwnershipChallenge} from './onboarding.ts';
import {prepareSolanaFundingAuthorization} from './funding.ts';
import {createProductionClient} from '../efficiency/production.ts';
import {SOLANA_NETWORK,SOLANA_USDC,SOLANA_MERCHANT,SOLANA_CDP_FEE_PAYER} from './payment-networks.ts';
const origin='https://api.fresh402.com',payer='4Vc5o9Ac2h8fPo5eFSqVBLCS9ZHcwh6d7c6KRM5WVgCe';
test('customer plan discovery selects the explicitly configured funding network and preserves the Base default URL',async()=>{const original=globalThis.fetch,urls:string[]=[];globalThis.fetch=async url=>{urls.push(String(url));return Response.json({plans:[]});};try{await new CustomerClient(origin).plans();await new CustomerClient(origin,{paymentNetwork:SOLANA_NETWORK}).plans();assert.deepEqual(urls,[origin+'/v2/prepaid/plans',origin+'/v2/prepaid/plans?network='+encodeURIComponent(SOLANA_NETWORK)]);}finally{globalThis.fetch=original;}});
function quote(amount='10000',resource=origin+'/v2/extract'){
 return{x402Version:2,resource:{url:resource},accepts:[{scheme:'exact',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:'0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3',amount,maxTimeoutSeconds:300,extra:{name:'USD Coin',version:'2'}},{scheme:'exact',network:SOLANA_NETWORK,asset:SOLANA_USDC,payTo:SOLANA_MERCHANT,amount,maxTimeoutSeconds:300,extra:{feePayer:SOLANA_CDP_FEE_PAYER,memo:undefined as string|undefined}}]};
}
function client(options:ConstructorParameters<typeof Fresh402Client>[1]={}){const c=new Fresh402Client(origin,options);c.operations.set('fresh402_extract',{path:'/v2/extract',price:{amount:'0.010'}});return c;}
test('legacy Base remains first/default and a second correct Solana offer does not break the public client',()=>{
 const c=client(),q=quote();assert.equal(c.paymentNetwork,'eip155:8453');assert.equal(c.validateChallenge('fresh402_extract',q),10000n);q.accepts.pop();assert.equal(c.validateChallenge('fresh402_extract',q),10000n);
 const s=createProductionClient({paymentNetwork:SOLANA_NETWORK});assert.equal(s.expectedRecipient,SOLANA_MERCHANT);assert.equal(s.expectedSolanaFeePayer,SOLANA_CDP_FEE_PAYER);
});
test('explicit Solana selection never falls back or enables signing without budget and private persistence',async()=>{
 const c=client({paymentNetwork:SOLANA_NETWORK});assert.equal(c.validateChallenge('fresh402_extract',quote()),10000n);const q=quote();q.accepts.pop();assert.throws(()=>c.validateChallenge('fresh402_extract',q),/unavailable/);
 c.raw=async()=>({challenge:quote()});await assert.rejects(c.execute('fresh402_extract',{}),PaymentRequired);
 for(const change of [(q:any)=>q.accepts[1].asset=q.accepts[0].asset,(q:any)=>q.accepts[1].payTo=payer,(q:any)=>q.accepts[1].amount='9999',(q:any)=>q.accepts[1].extra.feePayer=payer,(q:any)=>q.accepts.reverse(),(q:any)=>q.accepts.push(q.accepts[1])]){const q=quote();change(q);assert.throws(()=>c.validateChallenge('fresh402_extract',q));}
});
test('only the selected Solana requirement reaches a signer; original replay does not sign again or switch network',async()=>{
 let signs=0,posts=0,saves=0;const c=client({paymentNetwork:SOLANA_NETWORK,maxAtomicUSDC:10000n,persist:async()=>{saves++;},signer:async q=>{signs++;assert.equal(q.accepts.length,1);assert.equal(q.accepts[0].network,SOLANA_NETWORK);return{x402Version:2,resource:q.resource,accepted:q.accepts[0],payload:{transaction:'AA=='}};}});
 c.raw=async(_tool,_input,op)=>op?(posts++,{result:{synthetic:true},receipt:{success:true,network:SOLANA_NETWORK,transaction:'1'.repeat(64)}}):{challenge:quote()};
 const result=await c.execute('fresh402_extract',{});assert.equal(result.operation.state,'completed');assert.equal(c.reserved,10000n);await c.recover(result.operation);assert.equal(signs,1);assert.equal(posts,2);assert.ok(saves>=3);
 await assert.rejects(c.execute('fresh402_extract',{}),/cap exceeded/);assert.equal(signs,1);
 const other=client({paymentNetwork:SOLANA_NETWORK,persist:async()=>{}});other.raw=async()=>{throw Error('must not dispatch changed origin');};const changed=structuredClone(result.operation);changed.payment.resource.url='https://other.invalid/v2/extract';await assert.rejects(other.recover(changed),PendingPayment);
});
function funding(){const id='pf_'+'a'.repeat(32),intent={intent_id:id,package_id:'starter-all-services-v4',package_version:4,amount_atomic:2500000,credits:1000,tariff_version:3,all_services:true,all_services_terms_digest:'b'.repeat(64),payer,network:SOLANA_NETWORK,asset:SOLANA_USDC,pay_to:SOLANA_MERCHANT,recipient_version:'solana-v1',nonce:'0x'+'c'.repeat(64),expires_at:Date.now()+240000,resource:origin+'/v2/prepaid/funding/'+id},q=quote('2500000',intent.resource);q.accepts.shift();q.accepts[0].extra.memo='Fresh402 funding '+intent.nonce;return{intent,q,owner:{payer,authorizedAtomicUSDC:2500000n,termsDigest:'b'.repeat(64)}};}
test('pure Solana purchase preparation checks exact owner, package, memo, origin and cap without a signature or network call',()=>{
 const f=funding(),prepared=prepareSolanaFundingAuthorization(f.intent,f.q,f.owner),p={x402Version:2,resource:f.q.resource,accepted:f.q.accepts[0],payload:{transaction:'AA=='}};
 assert.equal(prepared.payloadFromSigner(p),p);prepared.challenge.accepts[0].amount='1';assert.throws(()=>prepared.payloadFromSigner({...p,accepted:prepared.challenge.accepts[0]}));
 for(const change of [(f:any)=>f.intent.payer=SOLANA_MERCHANT,(f:any)=>f.intent.asset=payer,(f:any)=>f.q.accepts[0].extra.memo='other',(f:any)=>f.owner.authorizedAtomicUSDC=2499999n,(f:any)=>f.intent.credits=1001,(f:any)=>f.intent.all_services_terms_digest='d'.repeat(64),(f:any)=>{f.intent.resource='https://other.invalid'+new URL(f.intent.resource).pathname;f.q.resource.url=f.intent.resource;}]){const f=funding();change(f);assert.throws(()=>prepareSolanaFundingAuthorization(f.intent,f.q,f.owner));}
});
test('Solana ownership inspection rejects any changed origin, network, action, nonce or expiry before signing',()=>{
 const now=Date.now(),c={challenge_id:'cc_'+'a'.repeat(64),expires_at:now+300000,network:SOLANA_NETWORK,signing_method:'signMessage',signature_encoding:'base64',message:['Fresh402 Account Ownership','Version: 1','Action: Authenticate Fresh402 customer','This signature authenticates ownership only. It does not authorize a payment or token approval.',`Network: ${SOLANA_NETWORK}`,`Wallet: ${payer}`,`Origin: ${origin}`,'Environment: production','Challenge: cc_'+'a'.repeat(64),'Nonce: 0x'+'b'.repeat(64),`Issued At: ${now}`,`Expires At: ${now+300000}`].join('\n')};
 assert.equal(validateSolanaOwnershipChallenge(c,payer,origin),c);
 for(const message of[c.message.replace(origin,'https://other.invalid'),c.message.replace(SOLANA_NETWORK,'eip155:8453'),c.message.replace('Authenticate','Authorize payment'),c.message.replace('Nonce: 0x','Nonce: 0xQ'),c.message+'\nadditional instruction'])assert.throws(()=>validateSolanaOwnershipChallenge({...c,message},payer,origin));
});
test('Solana customer paths select the network explicitly, preserve wallet case and never send a payment during signup/quotes/recovery',async()=>{
 const old=fetch,events:any[]=[];globalThis.fetch=async(url,init)=>{events.push({url:String(url),body:init?.body,headers:new Headers(init?.headers)});return Response.json({state:'credited'});};
 try{const c=new CustomerClient(origin,{paymentNetwork:SOLANA_NETWORK});await c.allServiceTerms();await c.preparePurchase('starter-all-services-v4','stored-purchase-key','b'.repeat(64));await c.recoverFunding({intent_id:'pf_'+'a'.repeat(32)});assert.ok(events[0].url.includes(encodeURIComponent(SOLANA_NETWORK)));assert.equal(JSON.parse(events[1].body).network,SOLANA_NETWORK);assert.ok(events.every(e=>!e.headers.has('payment-signature')));}finally{globalThis.fetch=old;}
});
