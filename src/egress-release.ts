import type {CapacityBindings} from './capacity-config';

export interface EgressReleaseBindings extends CapacityBindings {
  CF_VERSION_METADATA?:{id:string;tag?:string;timestamp?:string};
  ENVIRONMENT?:string;
  GATEWAY_CODE_HASH?:string;
}
export interface EgressReleaseIdentity {version_id:string|null;configuration_hash:string;enabled:boolean;approved:boolean;object_id?:string}
const fields=['ENVIRONMENT','TARGET_FETCH_MODE','GATEWAY_CODE_HASH','CONTAINER_EGRESS_ENABLED','GATEWAY_POOL_SIZE','GATEWAY_INSTANCE_CONCURRENCY','GATEWAY_RUNTIME_BUDGET_SECONDS','GATEWAY_BUDGET_WINDOW','GATEWAY_BUDGET_EXPIRES_MS','OPERATION_CONCURRENCY','OPERATION_ISOLATE_CONCURRENCY','OPERATION_DAILY_LIMIT','FREE_REGISTRATION_DAILY_LIMIT','VERIFIED_PAYMENT_DAILY_LIMIT'] as const;
export async function egressReleaseIdentity(env:EgressReleaseBindings):Promise<EgressReleaseIdentity> {
  const bytes=new TextEncoder().encode(JSON.stringify(fields.map(field=>[field,env[field]??null])));
  const configuration_hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const id=env.CF_VERSION_METADATA?.id;
  return {version_id:id&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)?id:null,configuration_hash,enabled:env.CONTAINER_EGRESS_ENABLED==='1',approved:Number(env.GATEWAY_BUDGET_EXPIRES_MS)>Date.now()+20000};
}
export function releasesMatch(expected:EgressReleaseIdentity,actual:EgressReleaseIdentity):boolean {
  return expected.version_id!==null&&expected.version_id===actual.version_id&&expected.configuration_hash===actual.configuration_hash;
}
