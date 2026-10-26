import {pathToFileURL} from 'node:url';
import {Fresh402Client} from './index.ts';

/** Optional live PUBLIC acceptance. Reads metadata only; never registers, signs,
 * buys, invokes a product, uses a customer key, or wakes a Container.
 */
export async function readOnlyAcceptance(base='https://fresh402.kirilllabs.workers.dev'){
 const rest=new Fresh402Client(base),mcp=new Fresh402Client(base,{transport:'mcp'});
 const [r,m]=await Promise.all([rest.discover(),mcp.discover()]);
 const names=['register','check','extract','smart_diff','openapi_contract_diff','contract_watch','wallet_watch','token_facts'].map(s=>'fresh402_'+s);
 for(const name of names)if(!r.operations.some(o=>o.tool===name)||!m.operations.some(o=>o.tool===name))throw Error('Public discovery is missing an expected tool');
 const response=await fetch(base+'/v2/prepaid/plans',{redirect:'error',headers:{'x-fresh402-purpose':'probe'},signal:AbortSignal.timeout(15000)});if(response.status!==200)throw Error('Public plans unavailable');const plans=await response.json() as any;
 if(plans.network!=='eip155:8453'||plans.pay_to.toLowerCase()!=='0xfac492a8d7843c9afcca6a1691bccb5425ab14f3')throw Error('Unexpected live merchant policy; stop before any authorization');
 return{publiclyVerifiedAt:new Date().toISOString(),version:r.version,restTools:r.operations.length,mcpTools:m.operations.length,services:r.operations.map(o=>({tool:o.tool,path:o.path,price:o.price})),prepaidPurchasing:plans.availability.package_purchasing,recipient:plans.pay_to,walletAccess:false,newPayments:0,customerCreditUse:0,productCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await readOnlyAcceptance()));
