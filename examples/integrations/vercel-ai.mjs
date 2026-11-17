import {createMCPClient} from '@ai-sdk/mcp';
import {pathToFileURL} from 'node:url';
export async function connectFresh402(){
 const client=await createMCPClient({transport:{type:'http',url:'https://api.fresh402.com/mcp'}});
 return{tools:async()=>(await client.listTools()).tools,call:(name,args)=>client.callTool({name,arguments:args}),close:()=>client.close()};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const client=await connectFresh402();try{
  console.log((await client.tools()).map(t=>t.name));
  console.log(await client.call('fresh402_extract',{url:'https://example.com/'}));
  if(process.argv.includes('--register-example'))console.log(await client.call('fresh402_register',{url:'https://example.com/'}));
 }finally{await client.close();}
}
