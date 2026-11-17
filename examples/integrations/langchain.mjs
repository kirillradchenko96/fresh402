import {enhancedChallenges} from './enhanced-inputs.mjs';
import {MCPAdapter} from '@langchain/mcp-adapters';
import {pathToFileURL} from 'node:url';
export async function connectFresh402(){
 const adapter=new MCPAdapter({servers:{fresh402:{transport:'http',url:'https://api.fresh402.com/mcp',defaultToolTimeout:20000}},prefixToolNameWithServerName:false});
 const tools=await adapter.getTools();return{tools:async()=>tools,call:(name,args)=>{const tool=tools.find(t=>t.name===name);if(!tool)throw Error('Tool is unavailable');return tool.invoke(args);},close:()=>adapter.close()};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const client=await connectFresh402();try{
  console.log((await client.tools()).map(t=>t.name));
  if(process.argv.includes('--advanced')){await enhancedChallenges(client);}else
  try{console.log(await client.call('fresh402_extract',{url:'https://example.com/'}));}catch(error){console.log('Inspect the unpaid MCP challenge; do not auto-pay:',error.message);}
  if(process.argv.includes('--register-example'))console.log(await client.call('fresh402_register',{url:'https://example.com/'}));
 }finally{await client.close();}
}
