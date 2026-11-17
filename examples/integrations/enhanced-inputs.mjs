// Unsigned challenges only. No credentials, signatures, model calls or source fetches.
const before={openapi:'3.1.0',info:{title:'Example CI API',version:'1'},paths:{'/items':{post:{requestBody:{content:{'application/json':{schema:{type:'integer',minimum:0}}}},responses:{'200':{description:'OK'}}}}}};
export const enhancedInputs=[
 ['fresh402_extract',{url:'https://example.com/catalog.json',records:{source:'json',pointer:'/items',fields:[{name:'id',pointer:'/id',type:'string'},{name:'price',pointer:'/price',type:'number',required:false}],limit:10}}],
 ['fresh402_api_compatibility_review',{contracts:{before:JSON.stringify(before),after:JSON.stringify({...before,paths:{}})}}],
];
export async function enhancedChallenges(client){for(const [name,input]of enhancedInputs){try{const result=await client.call(name,input);console.log(name,JSON.stringify(result));}catch(error){console.log(name,'Unpaid challenge or tool error:',error.message);}}}
