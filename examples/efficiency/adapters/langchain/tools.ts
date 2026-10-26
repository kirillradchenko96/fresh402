import {tool} from '@langchain/core/tools';
import {createAgentBindings,type AgentToolOptions} from '../../agent-tools.ts';
import type {Fresh402Client} from '../../../knowledge-base/client.ts';

/** Optional LangChain/LangGraph tools: native JSON Schema validation preserves
 * defaults, optional arguments and conditional rules without Zod conversion.
 * Pass ToolCall objects (not bare args) for paid mode so framework call IDs flow
 * to the shared durable executor. Model arguments never select a payment ID.
 */
export async function createLangChainTools(client:Fresh402Client,options:AgentToolOptions){
 const bindings=await createAgentBindings(client,options);
 return bindings.map(binding=>tool(async(input,config)=>binding.invoke(input as Record<string,any>,config?.toolCall?.id),{
  name:binding.name,description:binding.description,schema:binding.inputSchema,
 }));
}
