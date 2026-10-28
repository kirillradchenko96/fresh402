import {pathToFileURL} from 'node:url';
import {Fresh402Client} from './index.ts';

/** Optional live PUBLIC acceptance. Reads metadata only; never registers, signs,
 * buys, invokes a product, uses a customer key, or wakes a Container.
 */
export async function readOnlyAcceptance(base='https://api.fresh402.com',options:{expiresMs?:number}={}){
 const admitted=()=>{if(options.expiresMs!==undefined&&(!Number.isSafeInteger(options.expiresMs)||Date.now()>=options.expiresMs))throw Error('Read-only probe authorization expired');};
 class ProbeClient extends Fresh402Client {
  observedMcpVersion?:string;
  override request(path:string,body?:Record<string,any>,headers:Record<string,string>={}){admitted();return super.request(path,body,{...headers,'x-fresh402-purpose':'probe'});}
  override async rpc(method:string,params:Record<string,any>={}){const result=await super.rpc(method,params);if(method==='initialize')this.observedMcpVersion=result.serverInfo?.version;return result;}
 }
 const rest=new ProbeClient(base),mcp=new ProbeClient(base,{transport:'mcp'});
 const [r,m]=await Promise.all([rest.discover(),mcp.discover()]);
 const root=await rest.request('/');if(!root.response.ok||root.json.version!==r.version||mcp.observedMcpVersion!==r.version)throw Error('Public version agreement failed');
 const names=['register','check','extract','smart_diff','openapi_contract_diff','contract_watch','wallet_watch','token_facts'].map(s=>'fresh402_'+s);
 for(const name of names)if(!r.operations.some(o=>o.tool===name)||!m.operations.some(o=>o.tool===name))throw Error('Public discovery is missing an expected tool');
 admitted();const response=await fetch(base+'/v2/prepaid/plans',{redirect:'error',headers:{'x-fresh402-purpose':'probe'},signal:AbortSignal.timeout(15000)});if(response.status!==200)throw Error('Public plans unavailable');const plans=await response.json() as any;
 if(plans.network!=='eip155:8453'||plans.asset?.toLowerCase()!=='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'||plans.pay_to.toLowerCase()!=='0xfac492a8d7843c9afcca6a1691bccb5425ab14f3')throw Error('Unexpected live merchant policy; stop before any authorization');
 return{publiclyVerifiedAt:new Date().toISOString(),version:r.version,rootVersion:root.json.version,mcpVersion:mcp.observedMcpVersion,restTools:r.operations.length,mcpTools:m.operations.length,services:r.operations.map(o=>({tool:o.tool,path:o.path,price:o.price})),prepaidPurchasing:plans.availability.package_purchasing,recipient:plans.pay_to,circleEnabled:typeof root.json.circle_gateway?.enabled==='boolean'?root.json.circle_gateway.enabled:null,walletAccess:false,newPayments:0,customerCreditUse:0,productCalls:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await readOnlyAcceptance()));
