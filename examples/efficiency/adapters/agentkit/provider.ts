import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {Action,Network,WalletProvider} from '@coinbase/agentkit';
import {createAgentBindings,type AgentBinding,type AgentToolOptions} from '../../agent-tools.ts';
import type {Fresh402Client} from '../../../knowledge-base/client.ts';
import {agentKitSchema} from './schema.ts';
// AgentKit0.10.4 exports CommonJS. Public-root require avoids Node24 Windows'
// expensive recursive ESM named-export analysis; no private package imports.
const {ActionProvider}=createRequire(import.meta.url)('@coinbase/agentkit') as typeof import('@coinbase/agentkit');
type FreshAction=Action&{inputSchema:Record<string,any>};

export class Fresh402ActionProvider extends ActionProvider{
 #context=new AsyncLocalStorage<string>();#bindings:AgentBinding[];
 private constructor(bindings:AgentBinding[]){super('fresh402',[]);this.#bindings=bindings;}
 static async create(client:Fresh402Client,options:AgentToolOptions){return new Fresh402ActionProvider(await createAgentBindings(client,options));}
 supportsNetwork(network:Network){return network.protocolFamily==='evm'&&network.chainId==='8453';}
 /** AgentKit supplies no call context. The application must persist a stable ID
  * in its own runtime/checkpoint, then reuse it for the ORIGINAL invocation.
  * Neither wallet construction nor payment signing is performed here.
  */
 withInvocation<T>(callId:string,run:()=>T):T{if(typeof callId!=='string'||!/^[\w-]{1,128}$/.test(callId))throw Error('Stable trusted runtime call ID required');return this.#context.run(callId,run);}
 getActions(wallet:WalletProvider):FreshAction[]{
  if(!this.supportsNetwork(wallet.getNetwork()))return[];
  return this.#bindings.map((binding):FreshAction=>{
   const schema=agentKitSchema(binding.inputSchema);
   return{name:binding.name,description:binding.description,schema: schema as Action['schema'],inputSchema:structuredClone(binding.inputSchema),invoke:async(args:Record<string,any>)=>{
    if(!this.supportsNetwork(wallet.getNetwork()))return JSON.stringify({status:'execution_denied',reason:'base_mainnet_required',new_payment_authorized:false});
    if(!schema.safeParse(args).success)return JSON.stringify({status:'invalid_input',new_payment_authorized:false});
    return JSON.stringify(await binding.invoke(args as Record<string,any>,this.#context.getStore()));
   }};
  });
 }
}
export const fresh402ActionProvider=(client:Fresh402Client,options:AgentToolOptions)=>Fresh402ActionProvider.create(client,options);
