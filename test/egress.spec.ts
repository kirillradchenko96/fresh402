import {describe,it,expect,vi,afterEach} from 'vitest';
import {fetchTarget} from '../src/safe-fetch';
import {gatewayFromBindings} from '../src/egress';
vi.mock('../src/dns',()=>({assertPublicDns:vi.fn(async()=>{})}));
afterEach(()=>vi.restoreAllMocks());
const gateway={url:'https://gateway.example/fetch',token:'synthetic-test-token-'.repeat(3)};
const response=(body:string,status=200,location?:string)=>new Response(body,{headers:{'x-fresh402-upstream-status':String(status),'x-fresh402-egress-policy':'literal-public-tls-v1','content-type':'text/plain',...(location?{location}:{})}});
describe('secure outbound gateway boundary',()=>{
  it('unconfigured unrestricted fetching fails before contacting the target',async()=>{const fetch=vi.spyOn(globalThis,'fetch');await expect(fetchTarget(new URL('https://arbitrary.example/'),false)).rejects.toMatchObject({code:'egress_unavailable'});expect(fetch).not.toHaveBeenCalled();});
  it('routes an arbitrary hostname only through the authenticated gateway',async()=>{const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response('public result'));const result=await fetchTarget(new URL('https://arbitrary.example/'),false,undefined,undefined,gateway);expect(result.body).toBe('public result');expect(fetch).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledWith(gateway.url,expect.objectContaining({method:'POST',redirect:'manual',headers:expect.objectContaining({authorization:'Bearer '+gateway.token})}));});
  it('validates every redirect and sends no second request for a private destination',async()=>{const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response('',302,'https://127.0.0.1/private'));await expect(fetchTarget(new URL('https://arbitrary.example/'),false,undefined,undefined,gateway)).rejects.toThrow('unsafe');expect(fetch).toHaveBeenCalledOnce();});
  it('supports arbitrary safe redirect hosts through the same gateway',async()=>{const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(response('',302,'https://second.example/')).mockResolvedValueOnce(response('OK'));expect((await fetchTarget(new URL('https://first.example/'),false,undefined,undefined,gateway)).finalUrl).toBe('https://second.example/');expect(fetch).toHaveBeenCalledTimes(2);for(const[endpoint]of fetch.mock.calls)expect(endpoint).toBe(gateway.url);});
  it('rejects missing gateway proof headers and never falls back to native fetch',async()=>{const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('untrusted'));await expect(fetchTarget(new URL('https://arbitrary.example/'),false,undefined,undefined,gateway)).rejects.toMatchObject({code:'egress_unavailable'});expect(fetch).toHaveBeenCalledOnce();});
  it('configuration cannot enable gateway mode without both secure bindings',()=>{expect(()=>gatewayFromBindings({TARGET_FETCH_MODE:'gateway'})).toThrow('not configured');expect(()=>gatewayFromBindings({TARGET_FETCH_MODE:'gateway',EGRESS_GATEWAY_URL:'http://127.0.0.1/fetch',EGRESS_GATEWAY_TOKEN:gateway.token})).toThrow('not configured');});
  it('preserves the 5 MB decoded-body limit across gateway transport',async()=>{vi.spyOn(globalThis,'fetch').mockResolvedValue(response('x'.repeat(5_000_001)));await expect(fetchTarget(new URL('https://arbitrary.example/'),false,undefined,undefined,gateway)).rejects.toMatchObject({code:'content_too_large'});});
});

describe('redirect isolation and bounded cancellation',()=>{
  it.each(['https://fresh402.kirilllabs.workers.dev/','https://fresh402-staging.kirilllabs.workers.dev/','https://preview-fresh402.kirilllabs.workers.dev/','https://gateway.example/fetch'])('never fetches self or privileged infrastructure: %s',async url=>{
    const fetch=vi.spyOn(globalThis,'fetch');await expect(fetchTarget(new URL(url),false,undefined,undefined,gateway)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
  });
  it('strips validators on cross-origin redirects and restores them only at their original origin',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(response('',302,'https://other.example/')).mockResolvedValueOnce(response('',302,'https://first.example/final')).mockResolvedValueOnce(response('OK'));
    await fetchTarget(new URL('https://first.example/'),false,{etag:'private-tag',last_modified:'date'},undefined,gateway);
    const bodies=fetch.mock.calls.map(([,init])=>JSON.parse(String(init?.body)));
    expect(bodies.map(body=>body.validators)).toEqual([{etag:'private-tag',last_modified:'date'},{},{etag:'private-tag',last_modified:'date'}]);
    expect(bodies.every(body=>!('authorization' in body)&&!('headers' in body))).toBe(true);
  });
  it('uses validators from the stored final origin rather than the original URL',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(response('',302,'https://final.example/')).mockResolvedValueOnce(response('',304));
    const result=await fetchTarget(new URL('https://first.example/'),false,{etag:'tag',origin:'https://final.example'},undefined,gateway);
    expect(result.response.status).toBe(304);expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).validators).toEqual({});expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).validators).toEqual({etag:'tag'});
  });
  it('bounds redirect loops to six fetches within one deadline',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response('',302,'/loop'));
    await expect(fetchTarget(new URL('https://first.example/'),false,undefined,undefined,gateway)).rejects.toThrow('Too many redirects');expect(fetch).toHaveBeenCalledTimes(6);
  });
  it.each(['https://other.example:8443/','http://other.example/','https://fresh402.kirilllabs.workers.dev/','https:\\other.example/private'])('rejects an unsafe redirect before another hop: %s',async location=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response('',302,location));await expect(fetchTarget(new URL('https://first.example/'),false,undefined,undefined,gateway)).rejects.toThrow();expect(fetch).toHaveBeenCalledOnce();
  });
  it('cancels before DNS or egress when the caller is already gone',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch'),controller=new AbortController();controller.abort();await expect(fetchTarget(new URL('https://first.example/'),false,undefined,undefined,gateway,controller.signal)).rejects.toMatchObject({code:'request_cancelled'});expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels a pending upstream request without waiting for its deadline',async()=>{
    const controller=new AbortController();vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});controller.abort();}));await expect(fetchTarget(new URL('https://first.example/'),false,undefined,undefined,gateway,controller.signal)).rejects.toMatchObject({code:'request_cancelled'});
  });
  it.each([['dns_unavailable',502],['tls_verification_failed',502],['upstream_error',502],['egress_capacity_exceeded',429]])('maps %s without disclosing gateway details',async(code,status)=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({error:code,detail:'private-secret-and-internal-address'}),{status:Number(status)}));
    try {await fetchTarget(new URL('https://first.example/'),false,undefined,undefined,gateway);throw new Error('must fail');}catch(error){expect(error).toMatchObject({code,status});expect(String(error)).not.toContain('private-secret');}
  });
});
