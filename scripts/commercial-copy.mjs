import assert from 'node:assert/strict';import fs from 'node:fs';import {pathToFileURL} from 'node:url';
const rules=[
 ['competitor_recommendation',/\b(?:use|prefer|choose)\s+(?:direct HTTP|local (?:parser|tools|diff))\b/i],
 ['competitor_recommendation',/\b(?:direct HTTP(?:\/local comparison|\/local tools)?|local comparison|direct fetch\/parser\/diff)[^.\n]{0,130}\b(?:preferable|economical|simpler|cheaper)\b/i],
 ['competitor_recommendation',/\b(?:local )?oasdiff\s+(?:may suit|instead)\b/i],
 ['competitor_recommendation',/A local reader may suffice|Direct HTTP\/local libraries can be better|When to use Fresh402 or direct HTTP\/local tools/i],
 ['competitor_recommendation',/ten-line fetch\/hash script may be all you need|free (?:library|alternative) (?:is|would be) (?:better|cheaper)|Fresh402 is not inherently preferable/i],
 ['unsupported_generalization',/Fresh402 (?:guarantees? (?:savings|compatibility)|(?:automatically|continuously) (?:polls|monitors|schedules)|(?:renders|executes) (?:page )?JavaScript)/i],
 ['unnecessary_negative_sales',/no (?:universal )?(?:economic|cost) advantage is claimed/i],
 ['base_scope',/(?:all (?:three|3) Base tools|Contract Watch,\s*Wallet Watch and Token Facts)\s+(?:are|remain)\s+(?:experimental|(?:a |bounded )?pilots?)/i]
];
export function copyFindings(text,{historical=false}={}){
 const findings=rules.filter(([,r])=>r.test(text)).map(([code])=>code);
 if(!historical&&/\b(?:current API [\d.]+ has eight tools|production [\d.]+ (?:exposes|advertises) seven paid|Fresh402 exposes free Register plus seven paid|Expected:\s*eight tool identities)/i.test(text))findings.push('stale_inventory');
 if(/npm (?:install|i) fresh402-sdk(?:@(?:latest|0\.[0-4][\w.-]*))?(?=\s|$)/m.test(text))findings.push('stale_sdk_install');
 if(!historical&&/clipped to November 29|retain their earlier November 14|same all-seven-tools Starter|Both cover all seven tools|Versioned future all-service package terms/i.test(text))findings.push('stale_onboarding');
 return [...new Set(findings)];
}
export function assertCopy(text,context={}){assert.deepEqual(copyFindings(text,context),[],context.path??'Public copy regression');}
export function parseMcpResponse(text){
 if(text.trimStart().startsWith('{'))return JSON.parse(text);
 const messages=text.split(/\r?\n\r?\n/).map(event=>event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n')).filter(Boolean).map(data=>JSON.parse(data));
 const result=messages.find(m=>m.result?.tools);assert(result,'MCP tools/list result missing');return result;
}
export function checkCopyFiles(files,load){
 let prose=0;for(const file of files.filter(f=>/\.(?:md|html)$/.test(f))){const text=load(file);assertCopy(text,{path:file,historical:/CHANGELOG\.md$|PREPAID_PREVIEW\.md$/.test(file)});if(file.endsWith('.md')){let fence=null;for(const line of text.split('\n')){const m=line.match(/^\s*([~]{3,}|[\x60]{3,})/);if(!m)continue;if(!fence)fence=m[1][0];else if(fence===m[1][0])fence=null;}assert.equal(fence,null,file+' unclosed Markdown fence');}prose++;}
 const spec=JSON.parse(load('docs/openapi.json'));const walk=(x,p='openapi')=>{if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x))if(typeof v==='string'&&['description','summary'].includes(k))assertCopy(v,{path:p+'.'+k});else if(v&&typeof v==='object')walk(v,p+'.'+k);};walk(spec);
 for(const f of ['docs/AGENT_WORKFLOWS.md','docs/FLAGSHIP_WORKFLOWS.md']){const text=load(f),server=text.indexOf('SERVER_WORKFLOWS.md');assert(server>=0&&server<text.indexOf('## Optional'),f+' must lead with server products');}
 const self=load('docs/SELF_SERVICE.md');assert(self.indexOf('starter-all-services-v4')<self.indexOf('candidate-starter-v3'),'Current package must precede historical ID');assert(/all_services_terms_digest/.test(self));
 const versions=load('docs/VERSIONS.md');assert(versions.includes('3.1.1 catalog revision'));assert(versions.includes('0.4.0-rc.1 remains'));return{prose_files:prose,metadata_checked:true,contextual_sales_rules:true};
}
export async function checkLiveCopy({origin='https://api.fresh402.com',website='https://fresh402.com',fetcher=fetch}={}){
 assert.equal(new URL(origin).protocol,'https:');assert.equal(new URL(website).protocol,'https:');
 const get=async url=>{const r=await fetcher(url,{redirect:'error',headers:{'x-fresh402-purpose':'probe'},signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,url);return r;};
 const spec=await(await get(origin+'/openapi.json')).json(),contract=JSON.parse(fs.readFileSync(new URL('../docs/public-contract.json',import.meta.url)));assert.equal(spec.info.version,contract.api_version);assertCopy(spec.info.description,{path:'live OpenAPI info'});
 for(const tool of contract.tools){const op=spec.paths[tool.path]?.post;assert(op);assertCopy(op.summary??'',{path:tool.tool});if(tool.id!=='register')assert.equal(op['x-payment-info'].offers[0].amount,String(tool.atomic_usdc));}
 const {readOnlyAcceptance}=await import('../examples/efficiency/read-only-smoke.ts');const discovery=await readOnlyAcceptance(origin);assert.equal(discovery.mcpTools,12);assert.equal(discovery.restTools,12);assert.equal(discovery.circleEnabled,false);
 const list=await fetcher(origin+'/mcp',{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','x-fresh402-purpose':'probe'},body:JSON.stringify({jsonrpc:'2.0',id:9,method:'tools/list'}),redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(list.status,200);const tools=parseMcpResponse(await list.text()).result.tools;assert.equal(tools.length,12);for(const t of tools)assertCopy(t.description,{path:'live MCP '+t.name});
 const sitemap=await(await get(website+'/sitemap.xml')).text(),pages=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);for(const url of [...pages,website+'/llms.txt']){const html=await(await get(url)).text();assertCopy(html.replace(/<script[\s\S]*?<\/script>/g,'').replace(/<[^>]+>/g,' '),{path:url});}
 return{api:spec.info.version,tools:discovery.mcpTools,paid:contract.tools.length-1,pages:pages.length,new_payments:0,product_executions:0,customer_credit_use:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv.includes('--live'))console.log(JSON.stringify(await checkLiveCopy()));
