import { z } from "zod";
import { SERVICES, type ServiceId, inputJsonSchema, registerSchema } from "./contracts";
import { FRESH402_VERSION } from "./freshness";

const string = { type: "string" }, boolean = { type: "boolean" }, integer = { type: "integer" };
const nullableString = { type: ["string", "null"] };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const array = (items: unknown) => ({ type: "array", items });
const json = (schema: unknown) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const paymentResponse = { description: "Base64 x402 v2 settlement receipt", schema: string };
const errors = Object.fromEntries([400,403,404,408,409,413,415,422,429,500,502,503,504].map(code => [String(code), {
  description: ({400:"Invalid request or disallowed target",403:"MCP Origin rejected",404:"Watch or snapshot not found",408:"Request body timed out",409:"Baseline incompatible",413:"Input, target, stored document or output too large",415:"Unsupported target media type",422:"Selector not found, incompatible scope or complexity budget",429:"Rate or concurrency limit",500:"Legacy core failure",502:"Upstream or DNS failure",503:"Service or payment unavailable",504:"Target timed out"} as Record<number,string>)[code],
  content: json(ref("Error")),
}]));
const challenge = {
  description: "Payment required or rejected; never a sale. No paid data returned.",
  headers: { "PAYMENT-REQUIRED": { description: "Base64 x402 v2 requirements", schema: string } },
  content: json(object({}, [])),
};

export function buildOpenApiDocument(origin: string) {
  const paths: Record<string, unknown> = {};
  for (const service of Object.keys(SERVICES) as ServiceId[]) {
    const spec = SERVICES[service];
    paths[spec.path] = { post: {
      operationId: spec.tool, summary: spec.description, tags: [service], security: [{ x402Payment: [] }],
      "x-payment-info": { protocols: [{ x402: {} }], price: { mode: "fixed", currency: "USD", amount: spec.price.slice(1) } },
      "x-mcp-tool": spec.tool,
      requestBody: { required: true, content: { "application/json": { schema: inputJsonSchema(service), example: spec.example } } },
      responses: { "200": { description: "Paid result after confirmed settlement", headers: { "PAYMENT-RESPONSE": paymentResponse }, content: json(ref(service === "extract" ? "ExtractResult" : service === "smart_diff" ? "SmartDiffResult" : "CheckResult")) }, "402": challenge, ...errors },
    } };
  }
  paths["/v1/register"] = { post: { operationId: "fresh402_register", summary: "Create or retrieve a free persistent baseline; existing watches never refetch", security: [],
    requestBody: { required: true, content: json(z.toJSONSchema(registerSchema, { io:"input" })) },
    responses: { "200": { description:"Registration", content: json(ref("RegisterResult")) }, ...errors },
  } };
  for (const name of ["history", "diff"]) paths[`/v1/${name}`] = { get: { operationId:`fresh402_${name}`, summary: name === "history" ? "Read retained v1 snapshot metadata; never fetches a target" : "Read a legacy deterministic diff of the latest two stored v1 snapshots; never fetches a target", security: [],
    parameters: ["watch_id","url"].map(name=>({name,in:"query",required:false,schema:string,description:"Provide watch_id or url"})),
    responses:{ "200":{description:"Stored v1 data (shared publicly); never v2 Smart Diff data",content:json(ref(name === "history" ? "HistoryResult" : "LegacyDiffResult"))}, ...errors },
  } };
  paths["/v1/stats"] = { get: { operationId:"fresh402_stats",summary:"Confirmed settlement counts and USDC revenue; excludes 402 challenges",security:[],responses:{"200":{description:"Settlement totals",content:json(ref("StatsResult"))}} } };
  paths["/"] = { get: { operationId:"fresh402_health",summary:"Health, version, services and prices",security:[],responses:{"200":{description:"Service metadata",content:json(object({name:string,status:string,version:string,normalizer_version:integer,pricing:object({}),endpoints:object({}),features:array(string)}))}} } };
  paths["/openapi.json"] = { get:{operationId:"fresh402_openapi",summary:"This OpenAPI document",security:[],responses:{"200":{description:"OpenAPI 3.1",content:json(object({}))}}} };
  paths["/.well-known/x402"] = { get:{operationId:"fresh402_x402",summary:"x402 discovery manifest",security:[],responses:{"200":{description:"Paid REST resource URLs",content:json(object({version:integer,resources:array(string)}))}}} };
  paths["/.well-known/glama.json"] = { get:{operationId:"fresh402_glama",summary:"Glama ownership verification",security:[],responses:{"200":{description:"Existing ownership claim",content:json(object({"$schema":string,claim:string}))}}} };
  paths["/mcp"] = { post:{operationId:"fresh402_mcp",summary:"MCP Streamable HTTP (2026-07-28 plus stateless 2025 compatibility)",security:[],description:"Four tools. Payment challenge is an isError tool result with structuredContent = PaymentRequired; payment goes in params._meta['x402/payment']; receipt in result._meta['x402/payment-response']. HTTP 200 alone is not success. See MCP.md.",
    requestBody:{required:true,content:json(object({jsonrpc:string,id:{type:["string","number"]},method:string,params:object({})}))},
    responses:{"200":{description:"JSON-RPC or MCP envelope; JSON or SSE",content:{...json(object({})),"text/event-stream":{schema:string}}},"202":{description:"Notification accepted"},...errors},
  },get:{operationId:"fresh402_mcp_get",summary:"Sessionless MCP; GET not supported",responses:{"405":{description:"Method not allowed"}}},delete:{operationId:"fresh402_mcp_delete",summary:"Sessionless MCP; DELETE not supported",responses:{"405":{description:"Method not allowed"}}} };
  const change = object({path:string,before:{},after:{}},["path"]);
  return { openapi:"3.1.0",info:{title:"Fresh402 Web Intelligence API",version:FRESH402_VERSION,description:"2.0 Beta: paid extraction, structural comparison and backward-compatible freshness. No browser rendering or LLM inference.",contact:{url:"https://github.com/kirillradchenko96/fresh402/issues"}},servers:[{url:origin}],paths,
    components:{securitySchemes:{x402Payment:{type:"apiKey",in:"header",name:"PAYMENT-SIGNATURE",description:"x402 v2 exact USDC on Base (eip155:8453); use PAYMENT-REQUIRED challenge."}},schemas:{
      Error:object({error:string,message:string,issues:array(object({path:array({}),message:string}))},["error"]),
      RegisterResult:object({watch_id:string,url:string,final_url:string,created:boolean,baseline_created:boolean,hash:string,content_kind:{enum:["html","json","text"]},normalizer_version:integer,content_length:integer,snapshot_truncated:boolean,created_at:string,checked_at:string},["watch_id","url","created","baseline_created","hash"]),
      CheckResult:object({watch_id:string,url:string,final_url:string,hash:string,previous_hash:nullableString,changed:{type:["boolean","null"]},raw_changed:{type:["boolean","null"]},noise_detected:boolean,content_kind:string,cached:boolean,cache_status:string,network_fetched:boolean,comparison_source:string,normalizer_version:integer,diff:ref("TextDiff"),snapshot_saved:boolean,snapshot_truncated:boolean,checked_at:string,persistence_error:string},["watch_id","hash","changed","content_kind"]),
      TextDiff:object({available:boolean,changed:boolean,change_ratio:{type:"number"},removed_excerpt:string,added_excerpt:string,content_truncated:boolean,reason:string}),
      ExtractResult:object({url:string,final_url:string,content_kind:{enum:["html","json","text"]},title:nullableString,description:nullableString,canonical_url:nullableString,text:string,text_length:integer,truncated:boolean,data:{},data_omitted:boolean,headings:array(object({level:integer,text:string})),links:array(object({url:string,text:string})),structured_data:array({}),hash:string,fetched_at:string,extractor_version:integer,warnings:array(string)},["url","final_url","content_kind","text","truncated","hash"]),
      SmartDiffResult:object({watch_id:string,url:string,final_url:string,hash:string,previous_hash:string,content_kind:string,changed:boolean,compare_to:{enum:["previous","baseline","hash"]},comparison_source:string,comparison_quality:{enum:["structural","legacy_text"]},changes:object({added:array(change),removed:array(change),modified:array(change)}),counts:object({added:integer,removed:integer,modified:integer}),changes_truncated:boolean,significance:object({score:integer,level:{enum:["none","low","medium","high"]},reasons:array(string),rules_version:integer}),algorithm:string,semantic_model_used:boolean,fetched_at:string,warnings:array(string),persistence_error:string},["watch_id","hash","changed","changes","counts","significance"]),
      HistoryResult:object({watch_id:nullableString,url:string,count:integer,normalizer_version:integer,source:string,snapshots:array(object({id:integer,hash:string,raw_hash:nullableString,created_at:string,normalizer_version:integer,content_kind:string,content_truncated:integer}))}),
      LegacyDiffResult:object({watch_id:nullableString,url:string,changed:boolean,normalizer_version:integer,source:string,snapshots_available:integer,message:string,from:object({snapshot_id:integer,hash:string,created_at:string}),to:object({snapshot_id:integer,hash:string,created_at:string}),diff:ref("TextDiff")}),
      StatsResult:object({paid_calls:integer,test_paid_calls:integer,external_paid_calls:integer,revenue_usdc:{type:"number"},external_revenue_usdc:{type:"number"},last_paid_at:nullableString,last_external_paid_at:nullableString}),
    }},
  };
}
export function buildX402Manifest(origin:string) { return {version:1,resources:Object.values(SERVICES).map(service=>`${origin}${service.path}`)}; }
