import {DurableObject} from 'cloudflare:workers';
import {capacityConfiguration} from './capacity-config';
import {BodyReadError,readBoundedBody} from './body';
import {ContainerRuntime,reserveRuntime,reserveGlobalRuntime,type RuntimeBudget} from './container-runtime';
import {validateHttpsUrl} from './network-policy.mjs';
import type {Bindings} from './payments';

export class EgressController {
  private runtime?:ContainerRuntime;
  private active=0;
  constructor(private readonly ctx:DurableObjectState,private readonly env:Bindings) {
    if(ctx.container?.running)void ctx.blockConcurrencyWhile(()=>ctx.container!.setInactivityTimeout(5000));
  }
  async fetch(request:Request):Promise<Response> {
    const expected=this.env.EGRESS_GATEWAY_TOKEN,supplied=request.headers.get('authorization')?.replace(/^Bearer /,'');
    if(!expected||expected.length<43||!supplied||expected.length!==supplied.length||!crypto.subtle.timingSafeEqual(new TextEncoder().encode(expected),new TextEncoder().encode(supplied)))return new Response(null,{status:403});
    if(request.method!=='POST'||new URL(request.url).pathname!=='/fetch')return new Response(null,{status:405});
    const controller=new AbortController(),abort=()=>controller.abort(new BodyReadError('request_cancelled','Request was cancelled.',408));request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
    const timer=setTimeout(()=>controller.abort(new BodyReadError('upstream_timeout','Target response timed out.',504)),10_000);
    let admitted=false;
    try {
      const config=capacityConfiguration(this.env);
      if(!config.enabled||!this.ctx.container||!this.env.GATEWAY_CODE_HASH)throw new BodyReadError('egress_unavailable','Secure container fetching is not configured.',503);
      if(this.active>=config.perInstance)throw new BodyReadError('egress_capacity_exceeded','Secure outbound capacity is exhausted.',429);
      this.active++;admitted=true;
      const body=await readBoundedBody(request,8192,new BodyReadError('invalid_request','Invalid gateway request.',400),controller.signal);
      let input:Record<string,unknown>;try{input=JSON.parse(new TextDecoder().decode(body));if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['url','validators'].includes(key)))throw new Error();validateHttpsUrl(input.url as string);}catch{throw new BodyReadError('target_not_allowed','Invalid or unsafe destination.',400);}
      const validators=input.validators??{};
      if(!validators||typeof validators!=='object'||Array.isArray(validators)||Object.entries(validators).some(([key,value])=>!['etag','last_modified'].includes(key)||value!=null&&(typeof value!=='string'||value.length>1024||/[\r\n\u0000]/.test(value))))throw new BodyReadError('invalid_request','Invalid gateway validators.',400);
      const owner=request.headers.get('x-fresh402-admission')??'',instance=Number(request.headers.get('x-fresh402-instance'));
      if(!/^[\da-f-]{36}$/i.test(owner)||!Number.isInteger(instance)||instance<0||instance>=config.poolSize)throw new BodyReadError('admission_invalid','Gateway admission is invalid.',403);
      const lease=await this.env.DB.prepare('SELECT slot FROM operation_leases WHERE owner=? AND expires_at>?').bind(owner,Date.now()).first<number>('slot');
      if(lease===null||Math.floor(lease/config.perInstance)!==instance)throw new BodyReadError('admission_invalid','Gateway admission is invalid.',403);
      await this.ctx.storage.transaction(async storage=>{
        const assigned=await storage.get<number>('instance');if(assigned!==undefined&&assigned!==instance)throw new BodyReadError('admission_invalid','Gateway instance mismatch.',403);
        const reservation=reserveRuntime(await storage.get<RuntimeBudget>('runtime'),Date.now(),Math.floor(config.runtimeBudgetSeconds*1000/config.poolSize),config.budgetWindow);
        if(reservation.changed){await reserveGlobalRuntime(this.env.DB,config.budgetWindow,config.budgetExpires,config.runtimeBudgetSeconds*1000);reservation.budget.until=Math.min(reservation.budget.until,config.budgetExpires);await storage.put('runtime',reservation.budget);await storage.setAlarm(reservation.budget.until);}
        if(assigned===undefined)await storage.put('instance',instance);
      });
      controller.signal.throwIfAborted();
      this.runtime??=new ContainerRuntime(this.ctx.container,expected,config.perInstance,this.env.GATEWAY_CODE_HASH);
      const result=await this.runtime.fetch(body,controller.signal);
      console.log(JSON.stringify({event:'fresh402_egress_completed',instance,status:result.status}));
      return result;
    }catch(error){const safe=error instanceof BodyReadError?error:new BodyReadError('egress_unavailable','Secure outbound fetching failed.',503);console.log(JSON.stringify({event:'fresh402_egress_failed',code:safe.code}));return Response.json({error:safe.code},{status:safe.status});}
    finally{if(admitted)this.active--;clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
  }
  async alarm():Promise<void> {
    const budget=await this.ctx.storage.get<RuntimeBudget>('runtime');
    if(!budget||budget.until<=Date.now()){await this.ctx.container?.destroy();this.runtime=undefined;console.log('fresh402_egress_stopped');}
    else await this.ctx.storage.setAlarm(budget.until);
  }
  async shutdown():Promise<void>{await this.ctx.container?.destroy();this.runtime=undefined;await this.ctx.storage.deleteAlarm();const budget=await this.ctx.storage.get<RuntimeBudget>('runtime');if(budget)await this.ctx.storage.put('runtime',{...budget,until:0});}
  async diagnostics():Promise<Record<string,unknown>> {
    const budget=await this.ctx.storage.get<RuntimeBudget>('runtime'),running=this.ctx.container?.running??false;
    if(!running)return {running:false,reserved_ms:budget?.reservedMs??0,active:this.active};
    const response=await this.ctx.container!.getTcpPort(8080).fetch('http://gateway/health',{headers:{authorization:'Bearer '+this.env.EGRESS_GATEWAY_TOKEN},signal:AbortSignal.timeout(1000)});
    const bytes=await readBoundedBody(response,8192,new BodyReadError('egress_unavailable','Gateway metrics unavailable.',503),AbortSignal.timeout(1000));
    return {running:true,reserved_ms:budget?.reservedMs??0,active:this.active,gateway:JSON.parse(new TextDecoder().decode(bytes))};
  }
}

export class Fresh402Egress extends DurableObject<Bindings> {
  private readonly controller:EgressController;
  constructor(ctx:DurableObjectState,env:Bindings){super(ctx,env);this.controller=new EgressController(ctx,env);}
  fetch(request:Request):Promise<Response>{return this.controller.fetch(request);}
  alarm():Promise<void>{return this.controller.alarm();}
  shutdown():Promise<void>{return this.controller.shutdown();}
  diagnostics():Promise<Record<string,unknown>>{return this.controller.diagnostics();}
}
