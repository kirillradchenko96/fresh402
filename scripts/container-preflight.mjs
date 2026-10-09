import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {checkStaging} from './staging-check.mjs';
import {verifyImageConfiguration} from './container-build-check.mjs';
export function validatePilotAllowances(record,seconds,now=Date.now()) {
  const required={memory_gib_hours:0.25*seconds/3600,cpu_minutes:seconds/16/60,disk_gb_hours:2*seconds/3600,do_gb_seconds:0.125*seconds,egress_gb:1};
  if(!Number.isInteger(seconds)||seconds<60||seconds>300||record?.account_id!=='158ce1c5e76daae3f8e9e662a8d5de3b'||record.containers_authorized!==true||record.verified!==true||!['cloudflare-api','cloudflare-dashboard'].includes(record.source)||!Number.isFinite(Date.parse(record.verified_at))||Date.parse(record.verified_at)>now||now-Date.parse(record.verified_at)>3600000||!Number.isFinite(Date.parse(record.billing_period_end))||Date.parse(record.billing_period_end)<=now+30*60000||record.image_storage_verified!==true)throw new Error('Container authorization and current included allowances are unverified');
  for(const [field,needed]of Object.entries(required))if(!Number.isFinite(record.remaining?.[field])||record.remaining[field]<needed)throw new Error('Insufficient verified included allowance: '+field);
  return required;
}
export async function preflight() {
  const raw=await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'),config=JSON.parse(raw.slice(raw.indexOf('{')));checkStaging(config,true);await verifyImageConfiguration();
  const seconds=Number(config.env.staging.vars.GATEWAY_RUNTIME_BUDGET_SECONDS),blockers=[];
  const engine=spawnSync(process.env.WRANGLER_DOCKER_BIN??'docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8',timeout:10000,windowsHide:true});
  if(engine.status!==0||engine.error)blockers.push('docker_compatible_builder_unavailable');
  let allowances;
  try {const record=JSON.parse(await readFile(join(process.env.LOCALAPPDATA??'','Fresh402/private-docs/release-execution/container-pilot-allowances.json'),'utf8'));allowances=validatePilotAllowances(record,seconds);}catch{blockers.push('container_authorization_or_unused_allowances_unverified');}
  return {status:blockers.length?'blocked':'preflight_passed',blockers,maximum_pilot_runtime_seconds:seconds,maximum_initial_instances:config.env.staging.containers[0].max_instances,required_allowances:allowances,resources_created:0,note:'Read-only preflight. A passed result alone does not activate the disabled pilot or certify its network boundary.'};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/container-preflight.mjs')){const result=await preflight();console.log(JSON.stringify(result,null,2));if(result.status==='blocked')process.exitCode=2;}
