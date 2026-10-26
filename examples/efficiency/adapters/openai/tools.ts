import {tool} from '@openai/agents';
import {createAgentBindings,type AgentToolOptions} from '../../agent-tools.ts';
import type {Fresh402Client} from '../../../knowledge-base/client.ts';

/** Optional OpenAI Agents SDK adapter. No model call, wallet or tracing setup.
 * Non-strict JSON Schema preserves live optional/default/conditional semantics.
 * The outer object nests the original schema, including its unions, unchanged.
 */
export async function createOpenAITools(client:Fresh402Client,options:AgentToolOptions){
 const requiresApproval=options.mode==='authorized';
 const bindings=await createAgentBindings(client,options);
 return bindings.map(binding=>tool({
  name:binding.name,description:binding.description,strict:false,
  parameters:{type:'object' as const,properties:{input:binding.inputSchema},required:['input'],additionalProperties:true as const},
  needsApproval:binding.paid&&requiresApproval,
  execute:async(args,_context,details)=>{
   const value=args as {input?:Record<string,any>};
   if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'input'))return JSON.stringify({status:'invalid_input',new_payment_authorized:false});
   return JSON.stringify(await binding.invoke(value?.input as Record<string,any>,details?.toolCall?.callId));
  },
 }));
}
