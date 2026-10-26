import {interrupt} from '@langchain/langgraph';
import {ToolNode} from '@langchain/langgraph/prebuilt';
import type {StructuredToolInterface} from '@langchain/core/tools';

/** Pause BEFORE committing a pending tool message. On Command({resume:true}),
 * LangGraph reruns the node with the original ToolCall IDs; CreditSession then
 * recovers original requests. No timed retry, new ID, signature or purchase.
 * Requires authorized tools backed by an independently durable executor.
 */
export function createRecoveryToolNode(tools:StructuredToolInterface[]){
 const node=new ToolNode(tools);
 return async(state:Parameters<typeof node.invoke>[0])=>{
  const result=await node.invoke(state);
  const messages=Array.isArray(result)?result:result.messages;
  const pending=messages.some((message:{content:unknown})=>{try{return JSON.parse(String(message.content)).status==='pending_recovery';}catch{return false;}});
  if(pending)interrupt({status:'pending_recovery',action:'Resume this original graph checkpoint once to recover existing operations. Do not request a new call or payment.'});
  return result;
 };
}
