import {enhancedChallenges} from './enhanced-inputs.mjs';
import {MCPServerStreamableHttp} from '@openai/agents';
import {pathToFileURL} from 'node:url';
export async function connectFresh402(){
 const server=new MCPServerStreamableHttp({url:'https://api.fresh402.com/mcp',name:'Fresh402',clientSessionTimeoutSeconds:20,cacheToolsList:true});
 await server.connect();return{tools:()=>server.listTools(),call:(name,args)=>server.callToolResult(name,args),close:()=>server.close()};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const client=await connectFresh402();try{
  console.log((await client.tools()).map(t=>t.name));
  if(process.argv.includes('--advanced')){await enhancedChallenges(client);}else
  // This is an unpaid challenge. No signer, API key, payment handler or model is configured.
  console.log(await client.call('fresh402_extract',{url:'https://example.com/'}));
  if(process.argv.includes('--register-example'))console.log(await client.call('fresh402_register',{url:'https://example.com/'}));
 }finally{await client.close();}
}
