import assert from "node:assert/strict";
const base = process.argv[2]?.replace(/\/$/, "");
assert.match(base ?? "", /^https:\/\/fresh402-staging\.[a-z0-9-]+\.workers\.dev$/);
const token = process.env.FRESH402_STAGING_TOKEN;
assert.ok(token && token.length >= 43, "Owner staging token is required");
const summary = [];
let check = "unauthenticated routes";
async function request(path, { body, authorized = true, extraHeaders = {} } = {}) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }),
      accept: "application/json, text/event-stream", ...(authorized ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function rpc(response) {
  assert.equal(response.status, 200);
  const text = await response.text();
  const event = text.split("\n").find(line => line.startsWith("data:"));
  return JSON.parse(event ? event.slice(5).trim() : text);
}
// Do not print request headers, secrets, raw errors or paid response payloads.
try {
  for (const [path, body] of [["/",undefined],["/openapi.json",undefined],["/v1/history",undefined],["/v1/diff",undefined],["/v1/stats",undefined],["/.well-known/x402",undefined],["/.well-known/glama.json",undefined],["/missing",undefined],["/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"}],["/v1/register",{url:"https://example.com/"}],["/v2/extract",{url:"https://example.com/"}],["/v1/check",{url:"https://example.com/"}],["/v2/smart-diff",{watch_id:"w_602cf380183178d2cad24e83d803ac0a"}]]) {
    const response=await request(path,{body,authorized:false});
    assert.equal(response.status,403,`Unauthenticated ${path}`);await response.body?.cancel();
  }
  summary.push("All known REST/MCP routes and unknown route without token: 403");
  check = "wrong token";
  const wrong=await request("/",{extraHeaders:{authorization:"Bearer "+"0".repeat(token.length)}});
  assert.equal(wrong.status,403);await wrong.body?.cancel();
  check = "authorized health";
  const health=await request("/");assert.equal(health.status,200);assert.equal((await health.json()).version,"2.0.0-rc.1");
  check = "REST OpenAPI";
  const openapi=await request("/openapi.json");assert.equal(openapi.status,200);
  const schema=await openapi.json();assert.ok(schema.paths["/v2/extract"] && schema.paths["/mcp"]);
  summary.push("Authorized health and REST OpenAPI: 200");
  check = "directory discovery";
  for(const path of ["/.well-known/x402","/.well-known/glama.json"]) {
    const response=await request(path);assert.equal(response.status,404);await response.body?.cancel();
  }
  summary.push("Authenticated public directory discovery: 404");
  check = "MCP tools/list";
  const tools=await rpc(await request("/mcp",{body:{jsonrpc:"2.0",id:2,method:"tools/list"}}));
  assert.equal(tools.result.tools.length,4);summary.push("MCP tools/list: four existing tools");
  check = "REST registration";
  const response=await request("/v1/register",{body:{url:"https://example.com/"}});assert.equal(response.status,200);
  const watch=await response.json();assert.match(watch.watch_id,/^w_[a-f0-9]{32}$/);assert.equal(watch.content_kind,"html");
  check = "repeat registration";
  const existing=await request("/v1/register",{body:{url:"https://example.com/"}});assert.equal(existing.status,200);
  const previous=await existing.json();assert.equal(previous.created,false);assert.equal(previous.hash,watch.hash);assert.equal(previous.checked_at,watch.checked_at);
  check = "MCP registration";
  const registered=await rpc(await request("/mcp",{body:{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"fresh402_register",arguments:{url:"https://example.com/"}}}}));
  assert.notEqual(registered.result.isError,true);assert.equal(registered.result.structuredContent.watch_id,watch.watch_id);
  summary.push("REST/MCP free registration and idempotent repeat: same watch");
  check = "stored history";
  const history=await request("/v1/history?watch_id="+watch.watch_id);assert.equal(history.status,200);assert.ok((await history.json()).count>=1);
  check = "stored diff";
  const diff=await request("/v1/diff?watch_id="+watch.watch_id);assert.equal(diff.status,200);await diff.json();
  summary.push("Authorized stored v1 history/diff: 200");
  check = "paid REST denial";
  for(const path of ["/v2/extract","/v1/check","/v2/smart-diff"]) {
    const input=path==="/v2/extract"?{url:"https://example.com/"}:{watch_id:watch.watch_id};
    const paid=await request(path,{body:input});assert.equal(paid.status,503);assert.equal((await paid.json()).error,"payment_unavailable");
  }
  check = "paid MCP denial";
  for(const [index,name] of ["fresh402_extract","fresh402_check","fresh402_smart_diff"].entries()) {
    const arguments_=name==="fresh402_extract"?{url:"https://example.com/"}:{watch_id:watch.watch_id};
    const paidMcp=await rpc(await request("/mcp",{body:{jsonrpc:"2.0",id:4+index,method:"tools/call",params:{name,arguments:arguments_}}}));
    assert.equal(paidMcp.result.isError,true);assert.equal(paidMcp.result.structuredContent.error,"payment_unavailable");
  }
  summary.push("REST/MCP paid operations without staging CDP: fail closed, no payment");
  process.stdout.write(JSON.stringify({status:"passed",url:base,watch_id:watch.watch_id,checks:summary},null,2)+"\n");
} catch (error) {
  const safe = { check, code: error.code ?? error.name,
    ...(typeof error.expected === "number" ? {expected_status:error.expected} : {}),
    ...(typeof error.actual === "number" ? {actual_status:error.actual} : {}) };
  process.stderr.write("Staging smoke failed: " + JSON.stringify(safe) + "\n");
  process.exitCode=1;
}
