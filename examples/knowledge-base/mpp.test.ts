import {test} from 'node:test';import assert from 'node:assert/strict';
import {Mppx} from 'mppx/server/core';import * as evm from 'mppx/evm/server';
import {Challenge,Receipt} from 'mppx';import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {authorizeMppRequest,resumeMppRequest} from './mpp.ts';
const url='https://service.example/v1/check';
async function quote(recipient='0xFAC492A8D7843C9aFCCa6A1691BCCB5425ab14F3'){
 const server=Mppx.create({realm:'service.example',secretKey:'synthetic-official-sdk-fixture-with-32-bytes',methods:[evm.charge({currency:evm.assets.base.USDC,recipient:recipient as `0x${string}`,settle:async()=>{throw Error('No real settlement');}})]});
 const c=await server.challenge.evm.charge({amount:'0.005'});return new Response(null,{status:402,headers:{'www-authenticate':Challenge.serialize(c)}});
}
test('official SDK signs only after cumulative budget persistence, saves original proof, and replays without signing',async()=>{
 const wallet=privateKeyToAccount(generatePrivateKey()),events:string[]=[],store={reserve:async()=>{events.push('reserved');},save:async()=>{events.push('saved');}};
 const operation=await authorizeMppRequest(await quote(),{url,resource:url,body:'{"url":"https://example.com/"}',account:wallet,maximumAtomicUSDC:5000n,store});assert.deepEqual(events,['reserved','saved']);
 let calls=0;const fetcher:typeof fetch=async(_u,init)=>{calls++;assert.equal(init?.body,operation.body);assert.equal(new Headers(init?.headers).get('authorization'),operation.credential);return Response.json({changed:false},{headers:{'payment-receipt':Receipt.serialize(Receipt.from({method:'evm',status:'success',timestamp:new Date().toISOString(),reference:'0x'+'1'.repeat(64)}))}});};
 await resumeMppRequest(operation,fetcher);await resumeMppRequest(operation,fetcher);assert.equal(calls,2);assert.deepEqual(events,['reserved','saved']);
});
test('wrong merchant and budget refusal occur without requesting any signature',async()=>{
 let signed=0;const wallet={...privateKeyToAccount(generatePrivateKey()),signTypedData:async()=>{signed++;throw Error('Must not sign');}},store={reserve:async()=>{throw Error('Budget exhausted');},save:async()=>{}};
 const options={url,resource:url,body:'{}',account:wallet,maximumAtomicUSDC:5000n,store};
 await assert.rejects(authorizeMppRequest(await quote('0x1111111111111111111111111111111111111111'),options),/Unexpected MPP/);
 await assert.rejects(authorizeMppRequest(await quote(),options),/Budget exhausted/);assert.equal(signed,0);
});
