import {z} from 'zod/v3';
type Schema=Record<string,any>;
const annotations=new Set(['$schema','description','examples','default','title']);
const supported=new Set([...annotations,'type','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minLength','maxLength','format','pattern','minimum','maximum','enum','const','oneOf','anyOf','allOf','not']);

/** Bounded live-schema adapter for AgentKit's Zod3 contract. Unknown validation
 * keywords fail closed. Defaults are documentation, never input mutation.
 * Conditional checks are enforced as refinements; retain inputSchema alongside
 * Zod for consumers needing the exact JSON Schema rather than a Zod projection.
 */
export function agentKitSchema(schema:Schema):z.ZodTypeAny{
 let nodes=0;
 function convert(s:Schema|boolean,depth:number):z.ZodTypeAny{
  if(++nodes>2000||depth>16)throw Error('Tool schema complexity exceeds adapter limit');
  if(typeof s==='boolean')return s?z.unknown():z.never();
  if(!s||Array.isArray(s)||Object.keys(s).some(k=>!supported.has(k)))throw Error('Unsupported tool schema; adapter update required');
  let v:z.ZodTypeAny;
  switch(s.type){
   case 'object':{
    const shape:Record<string,z.ZodTypeAny>=Object.create(null),required=new Set<string>(s.required??[]);
    for(const [key,child]of Object.entries(s.properties??{})){const property=convert(child as Schema,depth+1);shape[key]=required.has(key)?property:property.optional();}
    if([...required].some(k=>!Object.hasOwn(shape,k)))throw Error('Required property has no schema');
    const object=z.object(shape);v=s.additionalProperties===false?object.strict():s.additionalProperties&&typeof s.additionalProperties==='object'?object.catchall(convert(s.additionalProperties,depth+1)):object.passthrough();break;
   }
   case 'array':{
    let a=z.array(convert(s.items??{},depth+1));if(s.minItems!==undefined)a=a.min(s.minItems);if(s.maxItems!==undefined)a=a.max(s.maxItems);v=a;
    if(s.uniqueItems)v=v.refine(a=>new Set(a.map((x:unknown)=>JSON.stringify(x))).size===a.length,'Array items must be unique');break;
   }
   case 'string':{
    let a=z.string();if(s.minLength!==undefined)a=a.min(s.minLength);if(s.maxLength!==undefined)a=a.max(s.maxLength);
    if(s.pattern!==undefined){if(typeof s.pattern!=='string'||s.pattern.length>512)throw Error('Unsupported pattern');a=a.regex(new RegExp(s.pattern));}
    if(s.format!==undefined){if(s.format!=='uri')throw Error('Unsupported string format');a=a.url();}v=a;break;
   }
   case 'integer':case 'number':{
    let a=z.number().finite();if(s.type==='integer')a=a.int();if(s.minimum!==undefined)a=a.min(s.minimum);if(s.maximum!==undefined)a=a.max(s.maximum);v=a;break;
   }
   case 'boolean':v=z.boolean();break;
   case 'null':v=z.null();break;
   case undefined:v=z.unknown();break;
   default:throw Error('Unsupported schema type');
  }
  if(s.const!==undefined){if(s.const!==null&&!['string','number','boolean'].includes(typeof s.const))throw Error('Unsupported constant');v=z.intersection(v,z.literal(s.const));}
  if(s.enum){if(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>100||s.enum.some((x:unknown)=>typeof x!=='string'))throw Error('Unsupported enum');v=z.intersection(v,z.enum(s.enum as [string,...string[]]));}
  // Condition-only schemas (e.g. required without type) retain JSON Schema's
  // applicability: required affects objects, not scalars.
  if(s.type===undefined&&s.required)v=v.refine(x=>!x||typeof x!=='object'||Array.isArray(x)||s.required.every((k:string)=>Object.hasOwn(x,k)),'Required conditional input missing');
  for(const kind of ['oneOf','anyOf','allOf'] as const)if(s[kind]){
   const choices=s[kind].map((x:Schema)=>convert(x,depth+1));
   v=v.refine(x=>{const n=choices.filter((c:z.ZodTypeAny)=>c.safeParse(x).success).length;return kind==='oneOf'?n===1:kind==='allOf'?n===choices.length:n>0;},`Input must satisfy ${kind}`);
  }
  if(s.not){const forbidden=convert(s.not,depth+1);v=v.refine(x=>!forbidden.safeParse(x).success,'Forbidden input combination');}
  const description=[s.description,s.default!==undefined?'Server default when omitted: '+JSON.stringify(s.default)+'. Inputs are not filled or changed by this adapter.':undefined].filter(Boolean).join(' ');if(description)v=v.describe(description);return v;
 }
 const converted=convert(schema,0);
 // Bound work BEFORE Zod3 descends into collections. Its maxItems/maxLength
 // checks alone do not bound traversal of an adversarial oversized input.
 return z.preprocess((value,ctx)=>{
  const seen=new WeakSet<object>();let count=0,chars=0;
  function bounded(v:any,depth:number):boolean{
   if(++count>4096||depth>16)return false;
   if(typeof v==='string'){chars+=v.length;return v.length<=65536&&chars<=262144;}
   if(!v||typeof v!=='object')return true;
   if(seen.has(v))return false;seen.add(v);
   if(Array.isArray(v))return v.length<=256&&v.every(x=>bounded(x,depth+1));
   const keys=Object.keys(v);return keys.length<=128&&keys.every(k=>bounded(k,depth+1)&&bounded(v[k],depth+1));
  }
  if(!bounded(value,0)){ctx.addIssue({code:'custom',message:'Tool input exceeds bounded adapter limits'});return z.NEVER;}return value;
 },converted);
}
