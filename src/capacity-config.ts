import {BodyReadError} from './body';

export interface CapacityBindings {
  OPERATION_DAILY_LIMIT?:string;
  OPERATION_CONCURRENCY?:string;
  OPERATION_ISOLATE_CONCURRENCY?:string;
  VERIFIED_PAYMENT_DAILY_LIMIT?:string;
  FREE_REGISTRATION_DAILY_LIMIT?:string;
  GATEWAY_POOL_SIZE?:string;
  GATEWAY_INSTANCE_CONCURRENCY?:string;
  GATEWAY_RUNTIME_BUDGET_SECONDS?:string;
  CONTAINER_EGRESS_ENABLED?:string;
  GATEWAY_BUDGET_WINDOW?:string;
  GATEWAY_BUDGET_EXPIRES_MS?:string;
  TARGET_FETCH_MODE?:string;
}
export function boundedInteger(value:string|undefined,fallback:number,min:number,max:number):number {
  const number=value===undefined?fallback:Number(value);
  if(!Number.isSafeInteger(number)||number<min||number>max)throw new BodyReadError('invalid_capacity_configuration','Operator capacity configuration is invalid.',503);
  return number;
}
export function capacityConfiguration(env:CapacityBindings) {
  const poolSize=boundedInteger(env.GATEWAY_POOL_SIZE,1,1,64);
  const perInstance=boundedInteger(env.GATEWAY_INSTANCE_CONCURRENCY,4,1,4);
  const requested=boundedInteger(env.OPERATION_CONCURRENCY,8,1,4096);
  const enabled=env.CONTAINER_EGRESS_ENABLED==='1',budgetWindow=env.GATEWAY_BUDGET_WINDOW??'',budgetExpires=boundedInteger(env.GATEWAY_BUDGET_EXPIRES_MS,0,0,Number.MAX_SAFE_INTEGER);
  if(env.TARGET_FETCH_MODE==='container'&&enabled&&(!/^[a-zA-Z0-9_-]{1,80}$/.test(budgetWindow)||budgetExpires<Date.now()+20_000))throw new BodyReadError('egress_budget_exhausted','Container budget approval is absent or expired.',429);
  return {
    poolSize,perInstance,
    concurrency:env.TARGET_FETCH_MODE==='container'?Math.min(requested,poolSize*perInstance):requested,
    isolateConcurrency:boundedInteger(env.OPERATION_ISOLATE_CONCURRENCY,4,1,4),
    dailyLimit:boundedInteger(env.OPERATION_DAILY_LIMIT,10000,0,10_000_000),
    freeDailyLimit:boundedInteger(env.FREE_REGISTRATION_DAILY_LIMIT,100,0,10_000_000),
    runtimeBudgetSeconds:boundedInteger(env.GATEWAY_RUNTIME_BUDGET_SECONDS,0,0,31*86400*64),
    enabled,budgetWindow,budgetExpires,
  };
}
