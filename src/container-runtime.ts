import {BodyReadError,readBoundedBody} from './body';

export interface RuntimeBudget {month:string;reservedMs:number;until:number}
export async function reserveGlobalRuntime(db:D1Database,window:string,expires:number,limitMs:number):Promise<void> {
  const reserved=await db.prepare(`INSERT INTO gateway_runtime_budget(window,reserved_ms,expires_at) SELECT ?,60000,? WHERE ?>=60000
    ON CONFLICT(window) DO UPDATE SET reserved_ms=reserved_ms+60000
    WHERE reserved_ms+60000<=? AND expires_at=? RETURNING reserved_ms`).bind(window,expires,limitMs,limitMs,expires).first<number>('reserved_ms');
  if(reserved===null)throw new BodyReadError('egress_budget_exhausted','Secure outbound operating budget is exhausted.',429);
}
export function reserveRuntime(prior:RuntimeBudget|undefined,now:number,limitMs:number,window=new Date(now).toISOString().slice(0,7)):{budget:RuntimeBudget;changed:boolean} {
  const month=window;
  const budget=prior?.month===month?{...prior}:{month,reservedMs:0,until:0};
  // Reserve complete 60-second windows before boot. Overlapping reservations
  // intentionally overestimate runtime; alarms/inactivity are not a billing cap.
  if(!Number.isSafeInteger(limitMs)||limitMs<0||budget.reservedMs>limitMs)throw new BodyReadError('egress_budget_exhausted','Secure outbound operating budget is exhausted.',429);
  if(budget.until-now>=20_000)return {budget,changed:false};
  if(budget.reservedMs+60_000>limitMs)throw new BodyReadError('egress_budget_exhausted','Secure outbound operating budget is exhausted.',429);
  return {budget:{month,reservedMs:budget.reservedMs+60_000,until:now+60_000},changed:true};
}
export interface ContainerPort {fetch(input:string|Request,init?:RequestInit):Promise<Response>}
export interface ManagedContainer {
  running:boolean;
  start(options:{enableInternet:boolean;env:Record<string,string>}):void;
  setInactivityTimeout(milliseconds:number):Promise<void>;
  getTcpPort(port:number):ContainerPort;
  destroy():Promise<void>;
}
export class ContainerRuntime {
  private ready?:Promise<void>;
  constructor(private readonly container:ManagedContainer,private readonly token:string,private readonly perInstance:number,private readonly expectedCodeHash:string) {}
  async ensureReady(signal:AbortSignal):Promise<void> {
    signal.throwIfAborted();
    if(!this.container.running) {
      this.ready=undefined;
      this.container.start({enableInternet:true,env:{FRESH402_GATEWAY_TOKEN:this.token,GATEWAY_LISTEN_HOST:'0.0.0.0',PORT:'8080',GATEWAY_MAX_ACTIVE:String(this.perInstance)}});
    }
    await this.container.setInactivityTimeout(5000);
    this.ready??=this.readiness().catch(error=>{this.ready=undefined;throw error;});
    let abort:()=>void=()=>{};
    const cancelled=new Promise<never>((_,reject)=>{abort=()=>reject(signal.reason);if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
    try {await Promise.race([this.ready,cancelled]);}finally{signal.removeEventListener('abort',abort);}
    signal.throwIfAborted();
  }
  private async readiness() {
    for(let attempt=0;attempt<8;attempt++) {
      try {
        const response=await this.container.getTcpPort(8080).fetch('http://gateway/health',{headers:{authorization:'Bearer '+this.token},signal:AbortSignal.timeout(500)});
        if(response.ok){const bytes=await readBoundedBody(response,8192,new BodyReadError('egress_unavailable','Invalid gateway readiness.',503),AbortSignal.timeout(500));const health=JSON.parse(new TextDecoder().decode(bytes));if(health.policy==='literal-public-tls-v1'&&health.code_hash===this.expectedCodeHash)return;throw new BodyReadError('egress_unavailable','Gateway artifact mismatch.',503);}
        void response.body?.cancel().catch(()=>{});
      }catch(error){if(error instanceof BodyReadError)throw error;}
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new BodyReadError('egress_unavailable','Gateway readiness failed.',503);
  }
  private async verifyActiveImage(signal:AbortSignal):Promise<void> {
    const deadline=AbortSignal.any([signal,AbortSignal.timeout(500)]);
    const response=await this.container.getTcpPort(8080).fetch('http://gateway/health',{headers:{authorization:'Bearer '+this.token},signal:deadline});
    if(!response.ok){void response.body?.cancel().catch(()=>{});throw new BodyReadError('egress_unavailable','Gateway readiness failed.',503);}
    const bytes=await readBoundedBody(response,8192,new BodyReadError('egress_unavailable','Invalid gateway readiness.',503),deadline);
    const health=JSON.parse(new TextDecoder().decode(bytes));
    if(health.policy!=='literal-public-tls-v1'||health.code_hash!==this.expectedCodeHash)throw new BodyReadError('egress_unavailable','Gateway artifact mismatch.',503);
  }
  async fetch(body:Uint8Array<ArrayBuffer>,signal:AbortSignal):Promise<Response> {
    await this.ensureReady(signal);
    // Worker and image rollouts are not transactional. Validate again before
    // every target GET, even when a prior process was already marked ready.
    await this.verifyActiveImage(signal);
    // No retries of the actual target fetch, including process/crash failures.
    const response=await this.container.getTcpPort(8080).fetch('http://gateway/fetch',{method:'POST',headers:{authorization:'Bearer '+this.token,'content-type':'application/json'},body,signal});
    const bytes=await readBoundedBody(response,5_000_000,new BodyReadError('content_too_large','Target content exceeds its limit.',413),signal);
    return new Response(bytes,{status:response.status,headers:response.headers});
  }
}
