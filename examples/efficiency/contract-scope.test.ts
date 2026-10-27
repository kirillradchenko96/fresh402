import{test}from'node:test';import assert from'node:assert/strict';import{Fresh402Client}from'../knowledge-base/client.ts';
test('scope headers are opt-in, ASCII-safe and limited to contract calls including recovery',async()=>{
 const original=globalThis.fetch,seen:Array<{path:string;headers:Headers;body:any}>=[];
 globalThis.fetch=async(input,options)=>{seen.push({path:new URL(String(input)).pathname,headers:new Headers(options?.headers),body:options?.body?JSON.parse(String(options.body)):null});return Response.json({});};
 try{
  const client=new Fresh402Client('https://service.example',{contractScope:[{path:'/é/{id}',method:'get'}]});
  await client.request('/openapi.json');await client.request('/mcp',{method:'tools/list'});await client.request('/v2/extract',{url:'https://example.com/'});await client.request('/v2/openapi-contract-diff',{watch_id:'w_original'},{'X-Fresh402-Recovery-Token':'private-fixture'});await client.request('/mcp',{method:'tools/call',params:{name:'fresh402_openapi_contract_diff',arguments:{watch_id:'w_original'}}});
  assert(seen.slice(0,3).every(r=>!r.headers.has('X-Fresh402-Contract-Scope')));assert(seen.slice(3).every(r=>r.headers.get('X-Fresh402-Contract-Scope')==='[{"path":"/\\u00e9/{id}","method":"get"}]'));assert.deepEqual(seen[3].body,{watch_id:'w_original'});assert.equal(seen[3].headers.get('X-Fresh402-Recovery-Token'),'private-fixture');assert.equal(client.budget,0n);
  await new Fresh402Client('https://service.example').request('/v2/openapi-contract-diff',{watch_id:'w_original'});assert(!seen.at(-1)!.headers.has('X-Fresh402-Contract-Scope'));
 }finally{globalThis.fetch=original;}
});
test('invalid scope is rejected before any request or signer',()=>{for(const contractScope of[[],[{path:'/items',method:'GET'}],[{path:'items',method:'get'}],Array(65).fill({path:'/x',method:'get'}),Array(9).fill({path:'/'+'x'.repeat(500),method:'get'})])assert.throws(()=>new Fresh402Client('https://service.example',{contractScope}));});
