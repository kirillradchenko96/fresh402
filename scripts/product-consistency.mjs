import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
import {Validator} from '@cfworker/json-schema';
const root=new URL('../',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,root),'utf8'));
export function checkProducts(spec,contract){
 assert.equal(contract.tools.length,8);const names=new Set();
 for(const t of contract.tools){const op=spec.paths[t.path]?.post;assert(op,'Missing product '+t.path);assert.equal(op.operationId,t.tool);assert(!names.has(t.tool));names.add(t.tool);assert.deepEqual(t.product,op['x-fresh402-product']);assert(['supported','restricted'].includes(t.product.maturity));assert(t.product.limitations.length);assert.equal(t.product.serviceName,'Fresh402');assert.equal(new URL(t.product.iconUrl).protocol,'https:');
  if(t.id==='register'){assert.equal(t.atomic_usdc,0);assert.equal(t.credits,0);continue;}
  const runtime=op['x-fresh402-tool'],tariffs=Object.values(runtime.prepaid_credits);assert.equal(t.credits,tariffs.at(-1));assert.equal(runtime.network,contract.network);assert.equal(runtime.asset,contract.asset);assert.equal(op['x-payment-info'].offers[0].amount,String(t.atomic_usdc));assert.equal(Math.round(Number(op['x-payment-info'].price.amount)*1e6),t.atomic_usdc);
  const input=op.requestBody.content['application/json'];assert(new Validator({...input.schema,components:spec.components},'2020-12').validate(input.example).valid,'Stale request example '+t.tool);
 }
 return{tools:names.size,surfaces:['runtime-derived OpenAPI','MPP offers','current credit tariffs','product projection','request examples']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(checkProducts(read('docs/openapi.json'),read('docs/public-contract.json'))));
