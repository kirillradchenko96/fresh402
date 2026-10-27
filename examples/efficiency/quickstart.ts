import {pathToFileURL} from 'node:url';
import {createProductionClient} from './production.ts';
import {recommendRefresh} from './cache.ts';
/** Public metadata and ONE unpaid quote only. No baseline fetch, key, signer,
 * wallet, purchase, model, paid execution or Container activation.
 */
export async function firstRun(){
 const client=createProductionClient(),request=client.request.bind(client);
 client.request=(path,body,headers={})=>request(path,body,{...headers,'x-fresh402-purpose':'probe'});
 const discovery=await client.discover(),quote=await client.quote('fresh402_extract',{url:'https://example.com/',max_chars:1000});
 return{api_version:discovery.version,tools:discovery.operations.map(o=>({name:o.tool,price:o.price})),example_quote:{service:'fresh402_extract',amount_atomic_usdc:quote.accepts[0].amount,network:quote.accepts[0].network,recipient:quote.accepts[0].payTo},decision_example:recommendRefresh({cacheAgeMs:null,maximumAgeMs:60000,checkCost:5000,extractCost:10000,estimatedChangeRate:.1,directConditionalAvailable:true}),new_payments:0,paid_executions:0,wallet_access:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await firstRun(),null,2));
