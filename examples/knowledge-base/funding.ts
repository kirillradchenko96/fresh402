/** Pure wallet adapter preparation. Does not connect, sign, broadcast or submit a payment. */
import {SOLANA_NETWORK,SOLANA_USDC,SOLANA_MERCHANT,SOLANA_CDP_FEE_PAYER,nativeSolanaRequirement} from './payment-networks.ts';
const USDC='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',RECEIVER='0xfac492a8d7843c9afcca6a1691bccb5425ab14f3',LEGACY_RECEIVER='0x58b4b483fbe31860335eceb12cccf4338b251085';
export function prepareFundingAuthorization(intent:any,challenge:any,owner:{chainId:number;payer:string;authorizedAtomicUSDC:bigint;expectedRecipient?:string;authorizationDeadline?:number;authorizationValidAfter?:number}){
 const receiver=(owner.expectedRecipient??RECEIVER).toLowerCase();if(![RECEIVER,LEGACY_RECEIVER].includes(receiver))throw Error('Unexpected merchant policy');
 if(intent.pay_to!==undefined&&intent.pay_to.toLowerCase()!==receiver)throw Error('Original intent recipient does not match the owner policy');
 const r=challenge?.accepts?.[0];if(owner.chainId!==8453||!/^0x[a-f0-9]{40}$/i.test(owner.payer)||owner.payer.toLowerCase()===receiver)throw new Error('Use the designated distinct payer on Base mainnet');
 if(challenge.x402Version!==2||challenge.accepts.length!==1||r.scheme!=='exact'||r.network!=='eip155:8453'||r.asset.toLowerCase()!==USDC||r.payTo.toLowerCase()!==receiver||r.amount!==String(intent.amount_atomic)||!Number.isSafeInteger(intent.amount_atomic)||intent.amount_atomic<1||BigInt(r.amount)>owner.authorizedAtomicUSDC||challenge.resource?.url!==intent.resource||!/^0x[a-f0-9]{64}$/i.test(intent.nonce)||r.extra?.fresh402FundingNonce!==intent.nonce)throw new Error('Funding challenge does not match the explicit authorized purchase');
 const maximumDeadline=Math.floor(intent.expires_at/1000)-1,deadline=owner.authorizationDeadline??maximumDeadline;if(deadline>maximumDeadline)throw Error('Authorization exceeds its original quote');if(!Number.isSafeInteger(deadline)||deadline<=Math.floor(Date.now()/1000)||deadline>Math.floor(Date.now()/1000)+300)throw new Error('Funding intent lifetime is invalid');
 const validAfter=owner.authorizationValidAfter??0;if(!Number.isSafeInteger(validAfter)||validAfter<0||validAfter>=deadline)throw Error('Invalid authorization time window');
 const authorization={from:owner.payer,to:r.payTo,value:r.amount,validAfter:String(validAfter),validBefore:String(deadline),nonce:intent.nonce};
 const typedData={domain:{name:'USD Coin',version:'2',chainId:8453,verifyingContract:r.asset},primaryType:'TransferWithAuthorization',types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},message:{...authorization,value:BigInt(r.amount),validAfter:BigInt(validAfter),validBefore:BigInt(deadline)}};
 return{typedData,payloadForSignature:(signature:string)=>{if(!/^0x[a-f0-9]{130}$/i.test(signature))throw new Error('An owner-confirmed EIP-3009 signature is required');return{x402Version:2,resource:challenge.resource,accepted:r,payload:{signature,authorization}};}};
}

/** Prepare an explicit sponsored Solana x402 purchase for the official client.
 * No connection, RPC, signature or submission happens here. The caller supplies
 * its own Solana signer and must privately persist the returned original proof. */
export function prepareSolanaFundingAuthorization(intent:any,challenge:any,owner:{payer:string;authorizedAtomicUSDC:bigint;termsDigest:string;expectedFeePayer?:string;expectedOrigin?:string}){
 const expected:intentPackage=({ 'starter-all-services-v4':[2500000,1000], 'developer-all-services-v4':[15000000,10000] } as Record<string,intentPackage>)[intent?.package_id];
 const r=challenge?.accepts?.[0],resource=intent?.resource,fee=owner.expectedFeePayer??SOLANA_CDP_FEE_PAYER;
 if(!expected||intent.package_version!==4||intent.amount_atomic!==expected[0]||intent.credits!==expected[1]||intent.tariff_version!==3||intent.all_services!==true||intent.all_services_terms_digest!==owner.termsDigest||!/^[a-f0-9]{64}$/.test(owner.termsDigest)||!/^pf_[a-f0-9]{32}$/.test(intent.intent_id)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(owner.payer)||owner.payer===SOLANA_MERCHANT||intent.payer!==owner.payer||intent.network!==SOLANA_NETWORK||intent.asset!==SOLANA_USDC||intent.pay_to!==SOLANA_MERCHANT||intent.recipient_version!=='solana-v1'||!/^0x[a-f0-9]{64}$/.test(intent.nonce)||!Number.isSafeInteger(intent.expires_at)||intent.expires_at<=Date.now()||intent.expires_at>Date.now()+300000||challenge?.x402Version!==2||challenge.accepts?.length!==1||!nativeSolanaRequirement(r,String(expected[0]),fee)||r.maxTimeoutSeconds!==300||r.extra.memo!=='Fresh402 funding '+intent.nonce||typeof resource!=='string'||new URL(resource).pathname!=='/v2/prepaid/funding/'+intent.intent_id||challenge.resource?.url!==resource||BigInt(expected[0])>owner.authorizedAtomicUSDC)throw Error('Solana funding does not match the explicitly authorized original purchase');
 if(new URL(resource).origin!==(owner.expectedOrigin??'https://api.fresh402.com'))throw Error('Funding must use its original expected service origin');
 const original=structuredClone(challenge),canonical=(v:any):string=>JSON.stringify(v,(_k,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
 return{challenge:structuredClone(original),payloadFromSigner:(payment:any)=>{
  const wire=payment?.payload?.transaction;
  if(payment?.x402Version!==2||canonical(payment.accepted)!==canonical(original.accepts[0])||canonical(payment.resource)!==canonical(original.resource)||canonical(payment.extensions??{})!==canonical(original.extensions??{})||typeof wire!=='string'||wire.length<1||wire.length>1644||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(wire))throw Error('Signer changed the original Solana funding policy');
  return payment;
 }};
}
type intentPackage=[number,number]|undefined;
