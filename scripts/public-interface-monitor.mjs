import fs from 'node:fs';import {pathToFileURL} from 'node:url';
import {readOnlyAcceptance} from '../examples/efficiency/read-only-smoke.ts';

const BASE='https://fresh402.kirilllabs.workers.dev';
const classes=['HEALTHY','DEGRADED','MONITOR_UNCERTAIN','INCIDENT','RECOVERED'];
const healthy=c=>['HEALTHY','RECOVERED'].includes(c);
const rank=c=>c==='INCIDENT'?3:c==='DEGRADED'?2:c==='MONITOR_UNCERTAIN'?1:0;

/** Durable state is encoded in the existing GitHub run's step name. No artifacts,
 * cache, repository commits, customer store, Cloudflare binding, or wallet required.
 */
export function stateLabel(s){return `F402v1:${s.classification}:${s.slot}:${s.failures}:${s.open?1:0}:${s.incident}:${s.lastAlertSlot}`;}
export function parseStateLabel(label){const m=/^F402v1:(HEALTHY|DEGRADED|MONITOR_UNCERTAIN|INCIDENT|RECOVERED):(\d{1,9}):(\d{1,3}):([01]):(\d{1,20}):(\d{1,9})$/.exec(label??'');if(!m)return null;const s={classification:m[1],slot:Number(m[2]),failures:Number(m[3]),open:m[4]==='1',incident:m[5],lastAlertSlot:Number(m[6])};if(s.lastAlertSlot>s.slot||s.open&&s.incident==='0'||healthy(s.classification)&&(s.failures!==0||s.open))return null;return s;}
export function transition(previous,classification,slot,runId){
 if(!classes.includes(classification)||classification==='RECOVERED'||!Number.isSafeInteger(slot)||slot<0||!/^\d{1,20}$/.test(runId))throw Error('Invalid bounded observation');
 if(previous&&slot<=previous.slot)return{...previous,duplicate:true,alert:false,recovery:false};
 if(classification==='HEALTHY')return{classification:previous?.open?'RECOVERED':'HEALTHY',slot,failures:0,open:false,incident:previous?.incident??'0',lastAlertSlot:previous?.lastAlertSlot??0,alert:false,recovery:previous?.open===true,duplicate:false};
 const consecutive=previous&&slot===previous.slot+1&&!healthy(previous.classification),failures=Math.min(999,consecutive?previous.failures+1:1),eligible=classification==='INCIDENT'||failures>=2;
 const alert=eligible&&(!previous?.open||rank(classification)>rank(previous.classification)||slot-(previous?.lastAlertSlot??0)>=6);
 return{classification,slot,failures,open:previous?.open===true||eligible,incident:previous?.open?previous.incident:eligible?runId:'0',lastAlertSlot:alert?slot:previous?.lastAlertSlot??0,alert,recovery:false,duplicate:false};
}

/** A parsed critical application response is evidence. A timeout is uncertainty.
 * This public client never requests products, targets, a facilitator or a provider.
 */
export async function inspectPublicHealth({fetcher=fetch,now=Date.now,deadlineMs=10000}={}){
 const controller=new AbortController();let timer;const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({classification:'MONITOR_UNCERTAIN',reason:'public_health_timeout',httpStatus:null});},deadlineMs);});
 const task=(async()=>{let status=null;try{const r=await fetcher(BASE+'/health',{redirect:'error',headers:{accept:'application/json','x-fresh402-purpose':'probe'},signal:controller.signal});status=r.status;
  const reader=r.body?.getReader();if(!reader)return{classification:'DEGRADED',reason:'invalid_public_health',httpStatus:status};let bytes=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();return{classification:'DEGRADED',reason:'invalid_public_health',httpStatus:status};}parts.push(value);}}finally{reader.releaseLock();}
  const j=JSON.parse(Buffer.concat(parts).toString('utf8'));
  if(status===503&&j.status==='unavailable')return{classification:j.reason==='monitoring_stale'?'DEGRADED':'INCIDENT',reason:j.reason==='monitoring_stale'?'operational_heartbeat_stale':'critical_operational_health',httpStatus:status};
  if(status!==200)return{classification:'MONITOR_UNCERTAIN',reason:'unexpected_health_status',httpStatus:status};
  if(!['ok','degraded'].includes(j.status)||![j.checked_at,j.scheduler_last_ok].every(n=>Number.isSafeInteger(n)&&n<=now()+60000))return{classification:'DEGRADED',reason:'invalid_public_health',httpStatus:status};
  if(now()-j.checked_at>900000||now()-j.scheduler_last_ok>300000)return{classification:'DEGRADED',reason:'operational_heartbeat_stale',httpStatus:status};
  return{classification:j.status==='ok'?'HEALTHY':'DEGRADED',reason:j.status==='ok'?'ok':'operational_warning',httpStatus:status};
 }catch{return{classification:status===null?'MONITOR_UNCERTAIN':'DEGRADED',reason:status===null?'public_health_transport':'invalid_public_health',httpStatus:status};}})();
 try{return await Promise.race([task,timeout]);}finally{clearTimeout(timer);controller.abort();}
}

export function verifyPublicContract(discovery,approved){
 if(discovery.version!==approved.info.version||discovery.rootVersion!==discovery.version||discovery.mcpVersion!==discovery.version||discovery.restTools!==8||discovery.mcpTools!==8)throw Error('public_contract_mismatch');
 if(discovery.circleEnabled!==false)throw Error('unexpected_payment_configuration');
 const expected=new Map(Object.values(approved.paths).filter(p=>p.post?.operationId?.startsWith('fresh402_')&&p.post['x-payment-info']?.price).map(p=>[p.post.operationId,p.post['x-payment-info'].price]));
 if(expected.size!==7)throw Error('approved_contract_incomplete');
 const decimal=s=>{if(!/^\d+(\.\d{1,6})?$/.test(String(s)))throw Error('invalid_price');const [w,f='']=String(s).split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
 for(const [tool,price]of expected){const live=discovery.services.find(o=>o.tool===tool)?.price;if(!live||live.currency!==price.currency||decimal(live.amount)!==decimal(price.amount))throw Error('unexpected_price_configuration');}
}

async function github(path,env){
 const r=await fetch('https://api.github.com/repos/kirillradchenko96/fresh402'+path,{headers:{authorization:'Bearer '+env.GITHUB_TOKEN,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'Fresh402-public-interface-observer'},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('observer_history_unavailable');const text=await r.text();if(text.length>500000)throw Error('observer_history_limit');return JSON.parse(text);
}
export async function readObserverHistory(env){
 const data=await github('/actions/workflows/public-monitor.yml/runs?event=schedule&status=completed&per_page=3',env),runs=(data.workflow_runs??[]).filter(r=>String(r.id)!==env.GITHUB_RUN_ID).sort((a,b)=>b.run_number-a.run_number).slice(0,3);
 if(!runs.length)return null;
 for(const run of runs){const jobs=await github('/actions/runs/'+run.id+'/jobs',env);for(const job of jobs.jobs??[])for(const step of job.steps??[]){const s=parseStateLabel(step.name);if(s)return s;}}
 throw Error('observer_history_missing');
}

export async function runPublicObserver(env=process.env){
 const now=Date.now(),expiry=Number(env.FRESH402_PUBLIC_PROBE_EXPIRES_MS);
 if(!Number.isSafeInteger(expiry)||expiry<=now)return{classification:'DISABLED',reason:'no_active_operating_authorization',alert:false,recovery:false,disabled:true,requests:0};
 if(env.GITHUB_REPOSITORY!=='kirillradchenko96/fresh402'||!/^\d{1,20}$/.test(env.GITHUB_RUN_ID??'')||!env.GITHUB_TOKEN)throw Error('Use the existing first-party hosted workflow only');
 const acceptance=env.FRESH402_OBSERVER_ACCEPTANCE_CASE??'live';
 if(acceptance!=='live'){
  if(env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!['controlled_failure','controlled_recovery'].includes(acceptance))throw Error('Controlled acceptance cannot enter scheduled production state');
  const slot=Math.floor(now/3600000),prior={classification:'INCIDENT',slot:slot-1,failures:1,open:true,incident:'1',lastAlertSlot:slot-1};
  const state=acceptance==='controlled_failure'?transition(null,'INCIDENT',slot,env.GITHUB_RUN_ID):transition(prior,'HEALTHY',slot,env.GITHUB_RUN_ID);
  return{...state,reason:'CONTROLLED_NOTIFICATION_ACCEPTANCE_NOT_A_SERVICE_OUTAGE',synthetic:true,requests:0,newPayments:0,productCalls:0,customerCreditUse:0};
 }
 const slot=Math.floor(now/3600000);let previous=null,historyAvailable=true;try{previous=await readObserverHistory(env);}catch{historyAvailable=false;}
 if(previous&&slot<=previous.slot)return transition(previous,'HEALTHY',slot,env.GITHUB_RUN_ID);
 if(Date.now()>=expiry)return{classification:'DISABLED',reason:'operating_authorization_expired',disabled:true,alert:false,recovery:false};
 let health=await inspectPublicHealth({deadlineMs:Math.min(10000,expiry-Date.now())}),discovery;
 if(Date.now()>=expiry)return{classification:'DISABLED',reason:'operating_authorization_expired',disabled:true,alert:false,recovery:false};
 if(health.classification==='HEALTHY'){
  try{discovery=await readOnlyAcceptance(BASE,{expiresMs:expiry});verifyPublicContract(discovery,JSON.parse(fs.readFileSync(new URL('../docs/openapi.json',import.meta.url))));if(!discovery.prepaidPurchasing)health={classification:'DEGRADED',reason:'purchasing_not_enabled',httpStatus:200};}
  catch(error){const known=['public_contract_mismatch','unexpected_payment_configuration','unexpected_price_configuration'].includes(error.message)||/Unexpected live merchant policy|missing an expected tool|Public version agreement/.test(error.message);health={classification:known?'INCIDENT':'MONITOR_UNCERTAIN',reason:known?'public_contract_mismatch':'public_discovery_unverified',httpStatus:200};}
 }
 if(Date.now()>=expiry)return{classification:'DISABLED',reason:'operating_authorization_expired',disabled:true,alert:false,recovery:false};
 if(!historyAvailable&&health.classification==='HEALTHY')health={classification:'MONITOR_UNCERTAIN',reason:'observer_history_unavailable',httpStatus:200};
 if(previous&&slot-previous.slot>2&&health.classification==='HEALTHY')health={classification:'DEGRADED',reason:'observer_heartbeat_gap',httpStatus:200};
 const state=transition(previous,health.classification,slot,env.GITHUB_RUN_ID);
 // Losing state must never mute an explicit incident or falsely report recovery.
 if(!historyAvailable&&health.classification!=='HEALTHY')state.alert=true;
 return{...state,reason:health.reason,httpStatus:health.httpStatus,historyAvailable,...(discovery?{version:discovery.version,restTools:discovery.restTools,mcpTools:discovery.mcpTools}:{}),newPayments:0,productCalls:0,customerCreditUse:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const r=await runPublicObserver();
 if(process.env.GITHUB_OUTPUT){const values={classification:r.classification,failures:r.failures??0,alert:r.alert?'true':'false',recovery:r.recovery?'true':'false',label:r.disabled?'F402-disabled':stateLabel(r)};fs.appendFileSync(process.env.GITHUB_OUTPUT,Object.entries(values).map(([k,v])=>k+'='+v).join('\n')+'\n');}
 console.log(JSON.stringify(r));
}
