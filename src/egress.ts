import {BodyReadError,readBoundedBody,cancelBody} from './body';
import {validateHttpsUrl} from './network-policy.mjs';
import {capacityConfiguration,type CapacityBindings} from './capacity-config';
export interface EgressBindings extends CapacityBindings {EGRESS_GATEWAY_URL?:string;EGRESS_GATEWAY_TOKEN?:string;EGRESS_CONTAINER?:{getByName(name:string):{fetch(request:Request):Promise<Response>}};egressLeaseOwner?:string;egressInstance?:number}
export interface EgressGateway {url:string;token:string;fetcher?:(request:Request)=>Promise<Response>;admission?:string;instance?:number}
export function gatewayFromBindings(env:EgressBindings):EgressGateway|undefined {
  if(env.TARGET_FETCH_MODE==='container') {
    const config=capacityConfiguration(env),instance=env.egressInstance;
    if(!config.enabled||!env.EGRESS_CONTAINER||!env.EGRESS_GATEWAY_TOKEN||env.EGRESS_GATEWAY_TOKEN.length<43||!env.egressLeaseOwner||!Number.isSafeInteger(instance)||instance!<0||instance!>=config.poolSize)throw new BodyReadError('egress_unavailable','Secure container fetching is not configured or admitted.',503);
    const stub=env.EGRESS_CONTAINER.getByName('fresh402-egress-'+instance);
    return {url:'https://fresh402-egress.invalid/fetch',token:env.EGRESS_GATEWAY_TOKEN,admission:env.egressLeaseOwner,instance,fetcher:request=>stub.fetch(request)};
  }
  if(env.TARGET_FETCH_MODE==='gateway'||env.EGRESS_GATEWAY_URL||env.EGRESS_GATEWAY_TOKEN) {
    if(!env.EGRESS_GATEWAY_URL||!env.EGRESS_GATEWAY_TOKEN||env.EGRESS_GATEWAY_TOKEN.length<43)throw new BodyReadError('egress_unavailable','Secure outbound fetching is not configured.',503);
    let url:URL;try{url=validateHttpsUrl(env.EGRESS_GATEWAY_URL);}catch{throw new BodyReadError('egress_unavailable','Secure outbound fetching is not configured.',503);}
    if(url.pathname!=='/fetch'||url.search)throw new BodyReadError('egress_unavailable','Secure outbound fetching is not configured.',503);
    return {url:url.href,token:env.EGRESS_GATEWAY_TOKEN};
  }
}
export async function fetchViaGateway(target:URL,validators:{etag?:string|null;last_modified?:string|null}|undefined,gateway:EgressGateway,signal:AbortSignal):Promise<Response> {
  let response:Response;
  const init:RequestInit={method:'POST',redirect:'manual',signal,headers:{'content-type':'application/json',authorization:`Bearer ${gateway.token}`,...(gateway.admission?{'x-fresh402-admission':gateway.admission,'x-fresh402-instance':String(gateway.instance)}:{})},body:JSON.stringify({url:target.href,validators:validators??{}})};
  try {response=gateway.fetcher?await gateway.fetcher(new Request(gateway.url,init)):await fetch(gateway.url,init);}
  catch {if(signal.aborted)throw signal.reason;throw new BodyReadError('egress_unavailable','Secure outbound fetching failed.',503);}
  if(!response.ok) {
    const data=await readBoundedBody(response,1024,new BodyReadError('egress_unavailable','Secure outbound fetching failed.',503),signal);
    let code:string|undefined;try{code=(JSON.parse(new TextDecoder().decode(data)) as {error?:string}).error;}catch{/* No external gateway details are disclosed. */}
    if(code==='target_not_allowed')throw new BodyReadError(code,'Destination is private or reserved.',400);
    if(code==='content_too_large')throw new BodyReadError(code,'Target content exceeds the 5 MB limit.',413);
    if(code==='upstream_timeout')throw new BodyReadError(code,'Target response timed out.',504);
    if(code==='dns_unavailable')throw new BodyReadError(code,'Target DNS resolution failed.',502);
    if(code==='tls_verification_failed')throw new BodyReadError(code,'Target TLS verification failed.',502);
    if(code==='ipv6_unavailable')throw new BodyReadError(code,'Target IPv6 connectivity is unavailable.',502);
    if(code==='upstream_error'||code==='unsupported_content_encoding'||code==='upstream_upgrade_not_allowed')throw new BodyReadError(code,'Target response could not be read safely.',502);
    if(code==='egress_capacity_exceeded')throw new BodyReadError(code,'Secure outbound capacity is exhausted. Retry later.',429);
    if(code==='egress_budget_exhausted')throw new BodyReadError(code,'Secure outbound operating budget is exhausted. Retry later.',429);
    throw new BodyReadError('egress_unavailable','Secure outbound fetching failed.',503);
  }
  const status=Number(response.headers.get('x-fresh402-upstream-status'));
  if(response.headers.get('x-fresh402-egress-policy')!=='literal-public-tls-v1'||!Number.isInteger(status)||status<200||status>599){cancelBody(response.body);throw new BodyReadError('egress_unavailable','Secure outbound fetching failed.',503);}
  const headers=new Headers();for(const name of ['content-type','etag','last-modified','location']){const value=response.headers.get(name);if(value!==null)headers.set(name,value);}
  return new Response([204,205,304].includes(status)?null:response.body,{status,headers});
}
