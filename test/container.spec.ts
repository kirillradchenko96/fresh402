import {describe,it,expect,vi,afterEach} from 'vitest';
import {ContainerRuntime,reserveRuntime,type ManagedContainer} from '../src/container-runtime';
import {capacityConfiguration} from '../src/capacity-config';
import {gatewayFromBindings,fetchViaGateway} from '../src/egress';
import {EgressController} from '../src/container-egress';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const token='synthetic-container-token-'.repeat(3),hash='a'.repeat(64);
function fixture() {
  const fetch=vi.fn(async(input:string|Request)=>String(input).endsWith('/health')?Response.json({policy:'literal-public-tls-v1',code_hash:hash}):new Response('public document',{headers:{'x-fresh402-egress-policy':'literal-public-tls-v1','x-fresh402-upstream-status':'200'}}));
  const container:ManagedContainer={running:false,start:vi.fn(()=>{container.running=true;}),setInactivityTimeout:vi.fn(async()=>{}),getTcpPort:()=>({fetch}),destroy:vi.fn(async()=>{container.running=false;})};
  return {container,fetch,runtime:new ContainerRuntime(container,token,4,hash)};
}
describe('Container lifecycle and financial resource gates',()=>{
  it('coordinates simultaneous cold starts and passes only gateway credentials',async()=>{
    const f=fixture(),signal=new AbortController().signal;
    await Promise.all([f.runtime.ensureReady(signal),f.runtime.ensureReady(signal)]);
    expect(f.container.start).toHaveBeenCalledOnce();expect(f.fetch).toHaveBeenCalledOnce();
    const options=vi.mocked(f.container.start).mock.calls[0][0];expect(Object.keys(options.env).sort()).toEqual(['FRESH402_GATEWAY_TOKEN','GATEWAY_LISTEN_HOST','GATEWAY_MAX_ACTIVE','PORT']);
    expect(f.container.setInactivityTimeout).toHaveBeenCalledWith(5000);
  });
  it('performs a new readiness check after the instance sleeps',async()=>{
    const f=fixture();await f.runtime.ensureReady(new AbortController().signal);await f.container.destroy();await f.runtime.ensureReady(new AbortController().signal);expect(f.container.start).toHaveBeenCalledTimes(2);expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects a stale image before contacting a target',async()=>{
    const f=fixture();f.fetch.mockResolvedValueOnce(Response.json({policy:'literal-public-tls-v1',code_hash:'b'.repeat(64)}));await expect(f.runtime.fetch(new Uint8Array(),new AbortController().signal)).rejects.toThrow('artifact mismatch');expect(f.fetch).toHaveBeenCalledOnce();
  });
  it('does not boot on an already cancelled operation',async()=>{const f=fixture(),c=new AbortController();c.abort();await expect(f.runtime.fetch(new Uint8Array(),c.signal)).rejects.toThrow();expect(f.container.start).not.toHaveBeenCalled();});
  it('never retries a target operation after a gateway process crash',async()=>{
    const f=fixture();await f.runtime.ensureReady(new AbortController().signal);f.fetch.mockResolvedValueOnce(Response.json({policy:'literal-public-tls-v1',code_hash:hash})).mockRejectedValueOnce(new Error('process terminated'));await expect(f.runtime.fetch(new Uint8Array(),new AbortController().signal)).rejects.toThrow('process terminated');expect(f.fetch.mock.calls.filter(([url])=>String(url).endsWith('/fetch'))).toHaveLength(1);
  });
  it('enforces the decoded response cap before returning a prepared result',async()=>{const f=fixture();await f.runtime.ensureReady(new AbortController().signal);f.fetch.mockResolvedValueOnce(Response.json({policy:'literal-public-tls-v1',code_hash:hash})).mockResolvedValueOnce(new Response('x'.repeat(5_000_001)));await expect(f.runtime.fetch(new Uint8Array(),new AbortController().signal)).rejects.toMatchObject({code:'content_too_large'});});
  it('rejects an image replaced after warm readiness before any target request',async()=>{const f=fixture();await f.runtime.ensureReady(new AbortController().signal);f.fetch.mockResolvedValueOnce(Response.json({policy:'literal-public-tls-v1',code_hash:'b'.repeat(64)}));await expect(f.runtime.fetch(new Uint8Array(),new AbortController().signal)).rejects.toThrow('artifact mismatch');expect(f.fetch.mock.calls.filter(([url])=>String(url).endsWith('/fetch'))).toHaveLength(0);});
  it('reserves runtime before boot and refuses expansion past the explicit budget',()=>{
    const now=Date.UTC(2026,9,9),one=reserveRuntime(undefined,now,120000);expect(one.budget.reservedMs).toBe(60000);expect(reserveRuntime(one.budget,now+10000,120000).changed).toBe(false);const two=reserveRuntime(one.budget,now+50000,120000);expect(two.budget.reservedMs).toBe(120000);expect(()=>reserveRuntime(two.budget,now+110000,120000)).toThrow('budget is exhausted');
  });
  it('splits a fixed global runtime allowance among the configured pool',()=>{const config=capacityConfiguration({TARGET_FETCH_MODE:'container',GATEWAY_POOL_SIZE:'2',GATEWAY_RUNTIME_BUDGET_SECONDS:'120',OPERATION_CONCURRENCY:'32'});expect(config.concurrency).toBe(8);expect(()=>reserveRuntime(undefined,Date.now(),config.runtimeBudgetSeconds*1000/config.poolSize)).not.toThrow();});
  it('rolls the reservation period forward without carrying a running window into the new month',()=>{const one=reserveRuntime(undefined,Date.UTC(2026,9,31,23,59,50),60000);expect(reserveRuntime(one.budget,Date.UTC(2026,10,1),60000).budget.reservedMs).toBe(60000);});
  it.each([{GATEWAY_POOL_SIZE:'1000'},{GATEWAY_INSTANCE_CONCURRENCY:'100'},{OPERATION_CONCURRENCY:'0'},{GATEWAY_RUNTIME_BUDGET_SECONDS:'-1'}])('rejects invalid economic capacity configuration %j',config=>expect(()=>capacityConfiguration(config)).toThrow());
});
describe('private instance routing',()=>{
  it('selects only the admitted instance and never uses public fetch for the internal hop',async()=>{
    const stub={fetch:vi.fn(async(_request:Request)=>new Response('OK',{headers:{'x-fresh402-egress-policy':'literal-public-tls-v1','x-fresh402-upstream-status':'200'}}))},getByName=vi.fn(()=>stub),publicFetch=vi.spyOn(globalThis,'fetch');
    const gateway=gatewayFromBindings({TARGET_FETCH_MODE:'container',CONTAINER_EGRESS_ENABLED:'1',GATEWAY_BUDGET_WINDOW:'unit',GATEWAY_BUDGET_EXPIRES_MS:String(Date.now()+3600000),EGRESS_GATEWAY_TOKEN:token,EGRESS_CONTAINER:{getByName},GATEWAY_POOL_SIZE:'2',egressInstance:1,egressLeaseOwner:'synthetic-lease'})!;
    const result=await fetchViaGateway(new URL('https://public.example/'),undefined,gateway,new AbortController().signal);expect(await result.text()).toBe('OK');expect(getByName).toHaveBeenCalledWith('fresh402-egress-1');expect(publicFetch).not.toHaveBeenCalled();expect(stub.fetch.mock.calls[0][0].headers.get('x-fresh402-instance')).toBe('1');
  });
  it('refuses startup when the pilot is disabled or no admission lease exists',()=>{
    const getByName=vi.fn();expect(()=>gatewayFromBindings({TARGET_FETCH_MODE:'container',EGRESS_CONTAINER:{getByName},EGRESS_GATEWAY_TOKEN:token})).toThrow();expect(getByName).not.toHaveBeenCalled();
  });
});

describe('Container controller authentication and admission',()=>{
  function controller() {
    const data=new Map<string,unknown>(),setAlarm=vi.fn(async(_when:number)=>{}),f=fixture();
    const storage={get:vi.fn(async(key:string)=>data.get(key)),put:vi.fn(async(key:string,value:unknown)=>{data.set(key,value);}),setAlarm,deleteAlarm:vi.fn(async()=>{}),transaction:async(fn:any)=>fn(storage)};
    const env={TARGET_FETCH_MODE:'container',CONTAINER_EGRESS_ENABLED:'1',GATEWAY_BUDGET_WINDOW:'unit',GATEWAY_BUDGET_EXPIRES_MS:String(Date.now()+3600000),GATEWAY_POOL_SIZE:'1',GATEWAY_INSTANCE_CONCURRENCY:'4',GATEWAY_RUNTIME_BUDGET_SECONDS:'120',GATEWAY_CODE_HASH:hash,EGRESS_GATEWAY_TOKEN:token,DB:{prepare:vi.fn(()=>({bind:vi.fn(()=>({first:vi.fn(async()=>0)}))}))}};
    const ctx={container:f.container,storage,blockConcurrencyWhile:async(fn:any)=>fn()};
    return {instance:new EgressController(ctx as any,env as any),...f,env,storage,data};
  }
  const request=(headers:Record<string,string>={},input:unknown={url:'https://public.example/'})=>new Request('https://fresh402-egress.invalid/fetch',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)});
  const admitted={authorization:'Bearer '+token,'x-fresh402-admission':'11111111-1111-4111-8111-111111111111','x-fresh402-instance':'0'};
  it('does not start a Container for an unauthenticated caller',async()=>{const f=controller();expect((await f.instance.fetch(request())).status).toBe(403);expect(f.container.start).not.toHaveBeenCalled();expect(f.env.DB.prepare).not.toHaveBeenCalled();});
  it('does not start a Container without a real active D1 admission lease',async()=>{const f=controller();expect((await f.instance.fetch(request({authorization:'Bearer '+token}))).status).toBe(403);expect(f.container.start).not.toHaveBeenCalled();});
  it('rejects unsafe targets before DNS, budget reservation or startup',async()=>{const f=controller();expect((await f.instance.fetch(request(admitted,{url:'https://169.254.169.254/'}))).status).toBe(400);expect(f.container.start).not.toHaveBeenCalled();expect(f.storage.setAlarm).not.toHaveBeenCalled();});
  it('rejects header injection before startup',async()=>{const f=controller();expect((await f.instance.fetch(request(admitted,{url:'https://public.example/',validators:{etag:'\r\nAuthorization: secret'}}))).status).toBe(400);expect(f.container.start).not.toHaveBeenCalled();});
  it('reserves its operating window durably before startup and serves the admitted operation',async()=>{
    const f=controller();const order:string[]=[];f.storage.setAlarm.mockImplementation(async()=>{order.push('reserved');});vi.mocked(f.container.start).mockImplementation(()=>{order.push('started');f.container.running=true;});
    expect((await f.instance.fetch(request(admitted))).status).toBe(200);expect(order.slice(0,2)).toEqual(['reserved','started']);expect(f.data.get('runtime')).toMatchObject({reservedMs:60000});
  });
  it('shutdown preserves spent budget and a future request cannot reset it',async()=>{const f=controller();await f.instance.fetch(request(admitted));await f.instance.shutdown();expect(f.data.get('runtime')).toMatchObject({reservedMs:60000,until:0});expect(f.container.destroy).toHaveBeenCalledOnce();});
  it('budget exhaustion rejects before startup',async()=>{const f=controller();f.data.set('runtime',{month:'unit',reservedMs:120000,until:0});expect((await f.instance.fetch(request(admitted))).status).toBe(429);expect(f.container.start).not.toHaveBeenCalled();});
  it('calendar rollover cannot renew an explicitly approved operating window',()=>{const period='billing-cycle-20261008';const first=reserveRuntime(undefined,Date.UTC(2026,9,31),60000,period);expect(()=>reserveRuntime(first.budget,Date.UTC(2026,10,1),60000,period)).toThrow('exhausted');});
  it('lowering the approved runtime ceiling also stops an already reserved warm window',()=>{const now=Date.now(),first=reserveRuntime(undefined,now,120000,'unit');expect(()=>reserveRuntime(first.budget,now+1000,0,'unit')).toThrow('exhausted');});
  it('expired pilot approval rejects before startup even if a runtime reservation remains',async()=>{const f=controller();f.env.GATEWAY_BUDGET_EXPIRES_MS='1';expect((await f.instance.fetch(request(admitted))).status).toBe(429);expect(f.container.start).not.toHaveBeenCalled();});
  it('durably stops an idle instance before the operating reservation expires and retains spent budget',async()=>{
    const f=controller();await f.instance.fetch(request(admitted));const budget=f.data.get('runtime') as {until:number};
    const idle=f.storage.setAlarm.mock.calls.at(-1)![0];expect(idle).toBeLessThanOrEqual(Date.now()+5000);expect(idle).toBeLessThan(budget.until);
    await f.instance.alarm();expect(f.container.running).toBe(false);expect(f.data.get('runtime')).toMatchObject({reservedMs:60000,until:0});
  });
  it('does not kill an active target on an idle alarm, but retains the hard operating deadline',async()=>{
    const f=controller();let complete!:(response:Response)=>void,entered!:()=>void;const pending=new Promise<void>(resolve=>{entered=resolve;});
    f.fetch.mockImplementation(async input=>{if(String(input).endsWith('/health'))return Response.json({policy:'literal-public-tls-v1',code_hash:hash});entered();return new Promise<Response>(resolve=>{complete=resolve;});});
    const target=f.instance.fetch(request(admitted));await pending;await f.instance.alarm();expect(f.container.destroy).not.toHaveBeenCalled();
    expect(f.storage.setAlarm.mock.calls.at(-1)![0]).toBeLessThanOrEqual((f.data.get('runtime') as {until:number}).until);
    complete(new Response('public document'));expect((await target).status).toBe(200);await f.instance.alarm();expect(f.container.running).toBe(false);
  });
  it('operator metrics never boot an instance and cannot extend its hard operating deadline',async()=>{
    const f=controller();expect((await f.instance.diagnostics()).running).toBe(false);expect(f.container.start).not.toHaveBeenCalled();
    await f.instance.fetch(request(admitted));const budget=f.data.get('runtime') as {until:number};await f.instance.diagnostics();
    expect(f.storage.setAlarm.mock.calls.at(-1)![0]).toBeLessThanOrEqual(budget.until);expect(f.data.get('runtime')).toMatchObject({reservedMs:60000});
  });
});
