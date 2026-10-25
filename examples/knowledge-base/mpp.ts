import {randomBytes} from 'node:crypto';
import {Mppx,evm} from 'mppx/client';
import {Challenge,Receipt} from 'mppx';
import type {Account} from 'viem';

export type MppOperation={url:string;body:string;headers:Record<string,string>;credential:string;recoveryToken:string;amount:string;resource:string};
export interface MppPrivateStore {
 /** Atomically reserve from the owner's cumulative budget and persist a signing
  * marker BEFORE signature creation. Never free it after an uncertain outcome. */
 reserve:(intent:{amount:string;resource:string;signing_requested:true})=>Promise<void>;
 save:(operation:MppOperation)=>Promise<void>;
}
const merchant='0x58b4b483fbe31860335eceb12cccf4338b251085',asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
/** Integration fragment, no entry point. The caller supplies its authorized
 * external signer, exact quote, private persistence and cumulative budget. */
export async function authorizeMppRequest(quote:Response,options:{url:string;body:string;resource:string;account:Account;maximumAtomicUSDC:bigint;store:MppPrivateStore;expectedRecipient?:string;headers?:Record<string,string>}){
 const recipient=(options.expectedRecipient??merchant).toLowerCase();if(![merchant,'0xfac492a8d7843c9afcca6a1691bccb5425ab14f3'].includes(recipient))throw Error('Unknown explicit merchant policy');
 const url=new URL(options.url),resource=new URL(options.resource);
 if(url.origin!==resource.origin||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw Error('Use the trusted service origin');
 if(options.maximumAtomicUSDC<=0n)throw Error('Explicit payment authorization required');
 const request={method:'POST',body:options.body,headers:{'content-type':'application/json',...options.headers}};
 const client=Mppx.create({polyfill:false,methods:[evm.charge({currencies:[evm.assets.base.USDC],networks:[8453],maxAtomicAmount:String(options.maximumAtomicUSDC)})]});
 const prepared=await client.preparePayment(quote,{request}),c=prepared.challenge;
 if(c.method!=='evm'||c.intent!=='charge'||c.realm!==url.host||String(c.request.recipient).toLowerCase()!==recipient||String(c.request.currency).toLowerCase()!==asset||
   (c.request.methodDetails as {chainId?:number})?.chainId!==8453||BigInt(String(c.request.amount))<=0n||BigInt(String(c.request.amount))>options.maximumAtomicUSDC)throw Error('Unexpected MPP payment terms');
 await options.store.reserve({amount:String(c.request.amount),resource:options.resource,signing_requested:true});
 const credential=await prepared.createCredential({account:options.account});
 const operation:MppOperation={url:options.url,body:options.body,resource:options.resource,headers:{...request.headers},credential,recoveryToken:randomBytes(32).toString('hex'),amount:String(c.request.amount)};
 // Include the challenge's alternate credential field for authenticated staging.
 operation.headers[Challenge.credentialHeader(c)]=credential;
 operation.headers['X-Fresh402-Recovery-Token']=operation.recoveryToken;
 await options.store.save(operation);return operation;
}
/** Safe retry: sends only the ORIGINAL saved body, credential and recovery token.
 * No signer, automatic 402 retry, new purchase or replacement authorization. */
export async function resumeMppRequest(operation:MppOperation,fetcher:typeof fetch=fetch){
 const response=await fetcher(operation.url,{method:'POST',headers:operation.headers,body:operation.body,redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Original MPP operation pending/rejected: HTTP '+response.status+'. Preserve it; do not authorize a replacement.');
 const receipt=Receipt.fromResponse(response);
 if(receipt.method!=='evm'||receipt.status!=='success'||!/^0x[a-f0-9]{64}$/i.test(receipt.reference))throw Error('Missing valid MPP settlement receipt; preserve the original operation');
 return {response,receipt}; // A package 202 receipt is not full finalized credits.
}
