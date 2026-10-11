import {Fresh402Client} from './client.ts';
import {PrepaidClient} from './prepaid.ts';
/** Public interfaces only. No signer, implicit funding, or prepaid→x402 fallback. */
export async function inspectContractProduct(base:string,watchId?:string){
 const client=new Fresh402Client(base),discovery=await client.discover();
 const tool=discovery.operations.find(o=>o.tool==='fresh402_openapi_contract_diff');
 return{discovery,available:!!tool,execution_enabled:false,...(tool&&watchId?{quote:await client.quote(tool.tool,{watch_id:watchId})}:{})};
}
export async function compareOpenApi(client:PrepaidClient,url:string,compareTo:'baseline'|'previous'='previous'){
 const quote=await client.quoteRemote();if(quote.tariff_version!==3||quote.credits?.openapi_diff!==5)throw new Error('The service/account does not advertise the supported candidate contract product');
 if(client.reserved+5>client.budget)throw new Error('Explicit five-credit allowance is required before registration');
 const watch=await client.register({url}),result=await client.execute('openapi_diff',{watch_id:watch.watch_id,compare_to:compareTo});
 return{quote,watch,result,balance:await client.balance()};
}
