import test from 'node:test';import assert from 'node:assert/strict';
import {createProductionClient,PRODUCTION_ORIGIN,PRODUCTION_RECIPIENT} from './production.ts';
import {Fresh402Client,PaymentRequired} from '../knowledge-base/client.ts';
const legacy='0x58b4b483fbe31860335eceb12cccf4338b251085';
function prepare(c:Fresh402Client,recipient:string){c.operations.set('fresh402_check',{path:'/v1/check',price:{amount:'0.005'}});const challenge={x402Version:2,resource:{url:c.base+'/v1/check'},accepts:[{scheme:'exact',network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:recipient,amount:'5000',maxTimeoutSeconds:300}]};c.raw=async()=>({challenge});return challenge;}
test('production factory defaults to current Safe, no signer/zero budget and creates no network work',async()=>{
 const c=createProductionClient();assert.equal(c.base,PRODUCTION_ORIGIN);assert.equal(c.expectedRecipient,PRODUCTION_RECIPIENT.toLowerCase());assert.equal(c.budget,0n);assert.equal(c.signer,undefined);prepare(c,PRODUCTION_RECIPIENT);assert.equal((await c.quote('fresh402_check',{watch_id:'fixture'})).accepts[0].payTo,PRODUCTION_RECIPIENT);await assert.rejects(c.execute('fresh402_check',{watch_id:'fixture'}),PaymentRequired);
});
test('both constructors default to Safe while an explicit historical policy stays pinned',async()=>{
 const c=createProductionClient({expectedRecipient:legacy});prepare(c,legacy);await c.quote('fresh402_check',{watch_id:'fixture'});assert.equal(new Fresh402Client(PRODUCTION_ORIGIN).expectedRecipient,PRODUCTION_RECIPIENT.toLowerCase());prepare(c,PRODUCTION_RECIPIENT);await assert.rejects(c.quote('fresh402_check',{}),/Unsafe or unexpected/);
});
test('production factory recovery preserves the original legacy operation without a signer or merchant rewrite',async()=>{
 const c=createProductionClient(),op={tool:'fresh402_check',input:{watch_id:'fixture'},payment:{accepted:{payTo:legacy}},recoveryToken:'private-original-token',amount:'5000',state:'pending' as const};c.raw=async(_tool,_input,original)=>{assert.equal(original,op);assert.equal(original!.payment.accepted.payTo,legacy);return{result:{changed:false},receipt:{success:true,network:'eip155:8453',transaction:'0x'+'a'.repeat(64)}};};assert.equal((await c.recover(op)).result.changed,false);assert.equal(c.reserved,0n);
});
