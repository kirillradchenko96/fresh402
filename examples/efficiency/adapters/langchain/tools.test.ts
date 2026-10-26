import test from 'node:test';import assert from 'node:assert/strict';
import {AIMessage} from '@langchain/core/messages';
import {StateGraph,MessagesAnnotation,START,END,MemorySaver,Command} from '@langchain/langgraph';
import {ToolNode} from '@langchain/langgraph/prebuilt';
import {createLangChainTools} from './tools.ts';
import {createRecoveryToolNode} from './recovery-node.ts';
import {Fresh402Client} from '../../../knowledge-base/client.ts';
import {PendingPrepaid} from '../../../knowledge-base/prepaid.ts';
const schema={type:'object',properties:{url:{type:'string',format:'uri',description:'Absolute public URL.'},watch_id:{type:'string',description:'Original watch.'}},oneOf:[{required:['url']},{required:['watch_id']}],additionalProperties:false};
function fixture(){let executed:any[]=[];const c=new Fresh402Client('https://service.example');c.discover=async()=>({version:'fixture',operations:['register','check'].map(n=>({tool:'fresh402_'+n,path:'/v1/'+n,summary:'Fixture '+n,schema,price:{amount:'0.005'}}))});c.quote=async()=>({network:'eip155:8453',amount:'0.005'});c.register=async()=>({watch_id:'w_fixture'});return{c,executed};}
test('actual LangChain tool preserves original JSON Schema, quote-only behavior and structured ToolMessage',async()=>{
 const f=fixture(),[t]=await createLangChainTools(f.c,{allowedTools:['fresh402_check']});assert.deepEqual(t.schema,schema);const value=await t.invoke({type:'tool_call',name:t.name,id:'call_fixture',args:{watch_id:'w_fixture'}});assert.equal(value.tool_call_id,'call_fixture');assert.equal(JSON.parse(value.content as string).status,'payment_required');assert.equal(f.c.reserved,0n);await assert.rejects(t.invoke({url:'https://example.com',watch_id:'w_fixture'}),/did not match/);
});
test('authorized bare-argument invocation is denied; ToolCall IDs reach the durable executor unchanged',async()=>{
 const f=fixture(),[t]=await createLangChainTools(f.c,{allowedTools:['fresh402_check'],mode:'authorized',executePaid:async i=>{f.executed.push(i);return{result:{changed:false}};}});const denied=await t.invoke({watch_id:'w_fixture'});assert.equal((denied as any).status,'execution_denied');const value=await t.invoke({type:'tool_call',name:t.name,id:'original_call',args:{watch_id:'w_fixture'}});assert.equal(JSON.parse(value.content as string).result.changed,false);assert.equal(f.executed[0].callId,'original_call');assert.equal(f.executed.length,1);
});
test('actual checkpointed LangGraph ToolNode executes selected tools and retains the original call ID for recovery',async()=>{
 const f=fixture();let pending=true;const tools=await createLangChainTools(f.c,{allowedTools:['fresh402_check'],mode:'authorized',executePaid:async i=>{f.executed.push(i.callId);if(pending){pending=false;throw new PendingPrepaid({key:'private-original-operation'} as any);}return{result:{changed:false,observation:'fixture-only'}};}});
 const saver=new MemorySaver(),graph=new StateGraph(MessagesAnnotation).addNode('tools',createRecoveryToolNode(tools)).addEdge(START,'tools').addEdge('tools',END).compile({checkpointer:saver}),config={configurable:{thread_id:'local_example'}};
 const message=new AIMessage({content:'',tool_calls:[{name:'fresh402_check',args:{watch_id:'w_fixture'},id:'same_original'}]});const first=await graph.invoke({messages:[message]},config);assert.equal((first as any).__interrupt__[0].value.status,'pending_recovery');const recovered=await graph.invoke(new Command({resume:true}),config);assert.equal(JSON.parse(recovered.messages.at(-1)!.content as string).status,'completed');assert.deepEqual(f.executed,['same_original','same_original']);const state=await graph.getState(config);assert(state.values.messages.length>=2);assert.doesNotMatch(JSON.stringify(state.values),/private-original-operation/);
});
