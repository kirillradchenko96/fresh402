import {AIMessage} from '@langchain/core/messages';
import {StateGraph,MessagesAnnotation,MemorySaver,START,END,Command} from '@langchain/langgraph';
import type {Fresh402Client} from '../../../knowledge-base/client.ts';
import type {AgentToolOptions} from '../../agent-tools.ts';
import {summarizeContractImpact,validateUsedOperations,type UsedOperation} from '../../contracts.ts';
import {compareFeedEntries,type FeedSnapshot} from '../../feeds.ts';
import {createLangChainTools} from './tools.ts';import {createRecoveryToolNode} from './recovery-node.ts';
type Json=Record<string,any>;
/** Two application jobs sharing the existing tools, durable executor and real
 * LangGraph. No model, schedule, signer, purchase or implicit payment authority.
 * Keep job IDs/state/checkpoints private. Default mode is quote-only.
 */
export async function createJobWorkflows(client:Fresh402Client,options:Omit<AgentToolOptions,'allowedTools'>={}){
 const tools=await createLangChainTools(client,{...options,allowedTools:['fresh402_register','fresh402_openapi_contract_diff','fresh402_extract']});
 const graph=new StateGraph(MessagesAnnotation).addNode('tools',createRecoveryToolNode(tools)).addEdge(START,'tools').addEdge('tools',END).compile({checkpointer:new MemorySaver()});
 async function invoke(name:string,input:Json,id:string,resume=false){
  if(!/^[\w-]{1,128}$/.test(id))throw Error('Application-owned stable original job ID required');const config={configurable:{thread_id:id}};
  const value=await graph.invoke(resume?new Command({resume:true}):{messages:[new AIMessage({content:'',tool_calls:[{name,args:input,id}]})]},config);
  if((value as any).__interrupt__)return{status:'pending_recovery',new_payment_authorized:false,original_job_id:id};
  return JSON.parse(String(value.messages.at(-1)!.content)) as Json;
 }
 return{
  /** Explicit free source fetch if no matching watch exists. Save the returned
   * watch_id; do not scope a JSON contract with selectors/ignore paths.
   */
  baseline:(url:string,jobId:string)=>invoke('fresh402_register',{url},jobId),
  async contract(job:{id:string;watchId:string;usedOperations:UsedOperation[];cached?:Json;allowCached?:boolean;resume?:boolean}){
   validateUsedOperations(job.usedOperations);
   if(job.allowCached){if(!job.cached||job.cached.watch_id!==job.watchId)throw Error('Matching original cached watch evidence required');return{status:'cached',result:summarizeContractImpact(job.cached as any,job.usedOperations),fresh_observation:false};}
   const observed=await invoke('fresh402_openapi_contract_diff',{watch_id:job.watchId,compare_to:'previous'},job.id,job.resume);
   if(observed.status!=='completed')return observed;
   if(observed.result.watch_id!==job.watchId)throw Error('Original recovered contract belongs to a different watch; preserve it without another execution');
   return{status:'completed',result:summarizeContractImpact(observed.result,job.usedOperations),original:observed.result,fresh_observation:true};
  },
  async feed(job:{id:string;url:string;previous?:FeedSnapshot;cached?:FeedSnapshot;allowCached?:boolean;resume?:boolean}){
   if(job.allowCached){if(!job.cached||job.cached.source_url!==job.url)throw Error('Matching complete cached feed required');compareFeedEntries(job.cached,job.cached);return{status:'cached',feed:structuredClone(job.cached),fresh_observation:false};}
   const observed=await invoke('fresh402_extract',{url:job.url,feed_mode:'entries',max_chars:50000},job.id,job.resume);
   if(observed.status!=='completed')return observed;
   const feed=observed.result.feed as FeedSnapshot;if(!feed||feed.source_url!==job.url)throw Error('Complete matching feed required; never advance baseline after clipping or error');
   const comparison=compareFeedEntries(job.previous??feed,feed);
   return{status:'completed',feed,comparison,baseline:!job.previous,original:observed.result,fresh_observation:true};
  },
 };
}
