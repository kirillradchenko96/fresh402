import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext, waitOnExecutionContext, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, PaymentPayload } from "@x402/core/types";
import { boundedFetch, createApp } from "../src/index";
import { NETWORK, PAY_TO, type Bindings } from "../src/payments";
import { SERVICES, type ServiceId, extractSchema } from "../src/contracts";
import { analyzeContent, extract, type IntelligenceDocument } from "../src/extract";
import { compareDocuments, prepareSmartDiff } from "../src/smart-diff";
import { handleCoreRequest } from "../src/freshness";
import { acquireCapacity } from "../src/operations";
import { cleanupTemporaryData } from "../src/maintenance";
import { digest } from "../src/extract";
import { validateDiscoveryExtension } from "@x402/extensions/bazaar";
import { PROTOCOL_VERSION_META_KEY, CLIENT_INFO_META_KEY, CLIENT_CAPABILITIES_META_KEY } from "@modelcontextprotocol/server";

vi.mock("../src/dns", () => ({ assertPublicDns: vi.fn(async () => {}) }));
declare global { namespace Cloudflare { interface Env { TEST_MIGRATIONS: D1Migration[] } } }
const payer = "0x1111111111111111111111111111111111111111";
let facilitator: FacilitatorClient, bindings: Bindings, application: ReturnType<typeof createApp>;
let errorLog: { mock: { calls: unknown[][] } };
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  await env.DB.batch(["operation_budget", "payment_operations", "smart_snapshots", "smart_baselines", "watch_snapshots", "watches", "operation_leases", "payment_claims", "analytics_daily", "payment_events"].map(table => env.DB.prepare(`DELETE FROM ${table}`)));
  facilitator = {
    getSupported: vi.fn(async () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }], extensions: [], signers: {} })),
    verify: vi.fn(async () => ({ isValid: true, payer })),
    settle: vi.fn(async () => ({ success: true, payer, transaction: `0x${crypto.randomUUID().replace(/-/g, "").padEnd(64, "0")}`, network: NETWORK })),
  };
  bindings = { ...env, REQUEST_LIMITER: { limit: async () => ({ success: true }) }, REGISTER_TARGET_LIMITER: { limit: async () => ({ success: true }) }, REGISTER_GLOBAL_LIMITER: { limit: async () => ({ success: true }) } };
  application = createApp(() => facilitator);
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unmocked outbound fetch"));
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
async function request(path: string, body: unknown, payment?: PaymentPayload, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const response = await boundedFetch(new Request(`https://service.example${path}`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers, ...(payment ? { "payment-signature": btoa(JSON.stringify(payment)) } : {}) }, body: JSON.stringify(body),
  }), bindings, ctx, application);
  await waitOnExecutionContext(ctx);
  return response;
}
const target = (body: string, type = "text/html") => new Response(body, { headers: { "content-type": type } });
async function getPayment(service: ServiceId, input: unknown) {
  const response = await request(SERVICES[service].path, input);
  expect(response.status).toBe(402);
  const challenge = JSON.parse(atob(response.headers.get("payment-required")!)) as PaymentRequired;
  return paymentFor(challenge);
}
function paymentFor(challenge: PaymentRequired): PaymentPayload {
  return {
    x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], extensions: challenge.extensions,
    payload: { signature: "0x" + "1".repeat(130), authorization: { from: payer, to: PAY_TO, value: challenge.accepts[0].amount, validAfter: "0", validBefore: String(Math.floor(Date.now()/1000) + 300), nonce: "0x" + crypto.randomUUID().replace(/-/g, "").padEnd(64, "0") } },
  };
}
async function baseline(body = '{"price":10,"stock":true}', type = "application/json") {
  vi.mocked(fetch).mockResolvedValueOnce(target(body, type));
  const response = await handleCoreRequest(new Request("https://service.example/v1/register", { method: "POST", body: JSON.stringify({ url: "https://public.example/" }) }), bindings);
  expect(response.status).toBe(200);
  return response.json<{ watch_id: string; hash: string }>();
}
async function rpc(result: Response): Promise<any> {
  const text = await result.text();
  return text.startsWith("event:") || text.startsWith("data:") ? JSON.parse(text.split("\n").find(s => s.startsWith("data:"))!.slice(5)) : JSON.parse(text);
}

describe("Web Extract", () => {
  it("extracts scoped main content, entities, metadata, links and JSON-LD without executing scripts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(target(`<html><head><title>A &amp; B</title><meta name="description" content="Example"><link rel="canonical" href="/canonical"><script type="application/ld+json">{"@type":"Product","price":9}</script></head><body><nav>menu</nav><main><h1>Product</h1><p>Hello <strong>world</strong> &copy;</p><a href="/next">Next</a><a href="javascript:alert(1)">bad</a><script>fetch('https://evil.example')</script><div class="cookie">cookie noise</div></main><aside>ad</aside></body></html>`));
    const result = await extract(extractSchema.parse({ url: "https://public.example/" }));
    expect(result).toMatchObject({ title: "A & B", description: "Example", canonical_url: "https://public.example/canonical", content_kind: "html" });
    expect(result.text).toContain("Hello world ©");
    expect(result.text).not.toMatch(/menu|cookie noise|fetch/);
    expect(result.headings).toEqual([{ level: 1, text: "Product" }]);
    expect(result.links).toEqual([{ url: "https://public.example/next", text: "Next" }]);
    expect(result.structured_data).toEqual([{ "@type": "Product", price: 9 }]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("supports explicit CSS scope and ignore rules", async () => {
    const result = await analyzeContent('<body><p>outside</p><div id="price"><p>Pro $10 <span class="noise">timestamp</span></p></div></body>', "text/html", "https://public.example/", { selector: "#price", ignore_selectors: [".noise"] });
    expect(result.document.text).toBe("Pro $10");
  });
  it("returns typed canonical JSON and filters volatile paths", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(target('{"z":2,"timestamp":3,"a":1}', "application/json"));
    expect(await extract(extractSchema.parse({ url: "https://public.example/", ignore_json_paths: ["/timestamp"] }))).toMatchObject({ content_kind: "json", data: { a: 1, z: 2 }, text: '{"a":1,"z":2}' });
  });
  it("handles text and explicitly reports truncation", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(target("one ".repeat(100), "text/plain"));
    const result = await extract(extractSchema.parse({ url: "https://public.example/", max_chars: 100 }));
    expect(result.text).toHaveLength(100); expect(result.truncated).toBe(true);
  });
  it("preserves literal entities in plain text and decodes HTML blocks only once",async()=>{
    expect((await analyzeContent("A &amp; B","text/plain","https://public.example/",{})).document.text).toBe("A &amp; B");
    const html=await analyzeContent("<body><p>A &amp;amp; B</p></body>","text/html","https://public.example/",{});
    expect(html.document.text).toBe("A &amp; B");
    expect(html.document.blocks[0].text).toBe("A &amp; B");
  });
  it.each([["application/octet-stream", "binary", "unsupported_content_type"], ["application/json", "{", "invalid_upstream_json"]])("rejects %s", async (type, body, code) => {
    await expect(analyzeContent(body, type, "https://public.example/", {})).rejects.toMatchObject({ code });
  });
  it("rejects missing selectors and excessive JSON complexity", async () => {
    await expect(analyzeContent("<p>hello</p>", "text/html", "https://public.example/", { selector: "#missing" })).rejects.toMatchObject({ code: "selector_not_found" });
    await expect(analyzeContent("[".repeat(70) + "0" + "]".repeat(70), "application/json", "https://public.example/", {})).rejects.toMatchObject({ code: "content_too_complex" });
  });
});
describe("Smart Diff", () => {
  const jsonDoc = (data: unknown): IntelligenceDocument => ({ kind: "json", data, text: JSON.stringify(data), blocks: [], fidelity: "structural" });
  it("reports added/removed/modified paths and rule-based significance", () => {
    const result = compareDocuments(jsonDoc({ price: 10, stock: true, old: 1 }), jsonDoc({ price: 12, stock: false, new: 2 }));
    expect(result.counts).toEqual({ added: 1, removed: 1, modified: 2 });
    expect(result.changes.modified).toContainEqual({ path: "/price", before: 10, after: 12 });
    expect(result.significance.level).toBe("high");
  });
  it("ignores JSON key order, escapes JSON Pointers, preserves array order", () => {
    expect(compareDocuments(jsonDoc({ a: 1, b: 2 }), jsonDoc({ b: 2, a: 1 })).changed).toBe(false);
    expect(compareDocuments(jsonDoc({ "a/b~": 1 }), jsonDoc({ "a/b~": 2 })).changes.modified[0].path).toBe("/a~1b~0");
    expect(compareDocuments(jsonDoc([1,2]), jsonDoc([2,1])).changed).toBe(true);
  });
  it("ignores HTML attributes/wrappers and reordered unchanged blocks", async () => {
    const a = await analyzeContent('<body><p>A paragraph.</p><h2>Details</h2><p>Plan costs $10 monthly.</p></body>', "text/html", "https://x.example/", {});
    const b = await analyzeContent('<body><section><h2 class="new">Details</h2><p>A   paragraph.</p><p>Plan costs $10 monthly.</p></section></body>', "text/html", "https://x.example/", {});
    expect(compareDocuments(a.document, b.document).changed).toBe(false);
  });
  it("identifies changed HTML blocks separately from unchanged content", async () => {
    const a = await analyzeContent('<body><p>Unchanged text</p><p id="price">Pro costs $10 per month</p></body>', "text/html", "https://x.example/", {});
    const b = await analyzeContent('<body><p>Unchanged text</p><p id="price">Pro costs $12 per month</p><p>New item</p></body>', "text/html", "https://x.example/", {});
    const result = compareDocuments(a.document,b.document);
    expect(result.counts).toEqual({ added: 1, removed: 0, modified: 1 });
  });
  it("bounds output and never silently claims a partial diff is complete", () => {
    const result = compareDocuments(jsonDoc({}), jsonDoc(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, i]))));
    expect(result.counts.added).toBe(300); expect(result.changes.added).toHaveLength(200); expect(result.changes_truncated).toBe(true);
  });
  it("commits only explicitly, retains a fixed baseline and compares previous snapshots", async () => {
    const watch = await baseline();
    vi.mocked(fetch).mockResolvedValueOnce(target('{"price":12,"stock":false}', "application/json"));
    const first = await prepareSmartDiff(env.DB, { watch_id: watch.watch_id, compare_to: "previous" });
    expect(first.result.changed).toBe(true);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM smart_snapshots").first("n")).toBe(0);
    await first.commit();
    vi.mocked(fetch).mockResolvedValueOnce(target('{"price":12,"stock":false}', "application/json"));
    const second = await prepareSmartDiff(env.DB, { watch_id: watch.watch_id, compare_to: "previous" });
    expect(second.result.changed).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(target('{"price":12,"stock":false}', "application/json"));
    expect((await prepareSmartDiff(env.DB, { watch_id: watch.watch_id, compare_to: "baseline" })).result.changed).toBe(true);
    expect(await env.DB.prepare("SELECT hash FROM watches").first("hash")).toBe(watch.hash);
  });
  it("does not invent changes when comparing a v1 HTML baseline with title/noise", async () => {
    const html = '<html><head><title>Title</title></head><body><header>Header</header><main><p>Same content.</p></main><nav>Noise</nav></body></html>';
    const watch = await baseline(html,"text/html");
    vi.mocked(fetch).mockResolvedValueOnce(target(html));
    const prepared = await prepareSmartDiff(env.DB,{watch_id:watch.watch_id,compare_to:"baseline"});
    expect(prepared.result).toMatchObject({changed:false,comparison_quality:"legacy_text"});
  });
  it("detects loose HTML text changes outside paragraph blocks", async () => {
    const left = await analyzeContent('<body><main><p>Same</p><div>Available</div></main></body>',"text/html","https://public.example/",{});
    const right = await analyzeContent('<body><main><p>Same</p><div>Sold out</div></main></body>',"text/html","https://public.example/",{});
    expect(compareDocuments(left.document,right.document).changed).toBe(true);
  });
  it("keeps 20 private snapshots and preserves the fixed baseline", async () => {
    const watch=await baseline();
    for(let i=0;i<23;i++) {
      vi.mocked(fetch).mockResolvedValueOnce(target(JSON.stringify({price:i}),"application/json"));
      await (await prepareSmartDiff(env.DB,{watch_id:watch.watch_id,compare_to:"previous"})).commit();
    }
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM smart_snapshots").first("n")).toBe(20);
    expect(await env.DB.prepare("SELECT hash FROM smart_baselines").first("hash")).toBe(watch.hash);
  });
  it("rejects unknown and truncated baselines before loading a target", async () => {
    const watch=await baseline();vi.mocked(fetch).mockClear();
    await expect(prepareSmartDiff(env.DB,{watch_id:watch.watch_id,compare_to:"previous",previous_hash:"f".repeat(64)})).rejects.toMatchObject({code:"snapshot_not_found"});
    await env.DB.prepare("UPDATE watches SET content_truncated=1").run();
    await expect(prepareSmartDiff(env.DB,{watch_id:watch.watch_id,compare_to:"previous"})).rejects.toMatchObject({code:"baseline_incompatible"});
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("real SDK payment boundary with a fake facilitator (no money)", () => {
  it.each(Object.keys(SERVICES) as ServiceId[])("challenges %s at its own price with valid Bazaar metadata and no fetch", async service => {
    const response = await request(SERVICES[service].path, SERVICES[service].example);
    expect(response.status).toBe(402);
    const challenge = JSON.parse(atob(response.headers.get("payment-required")!)) as PaymentRequired;
    expect(challenge.accepts[0]).toMatchObject({ amount: String(SERVICES[service].atomic), network: NETWORK, payTo: PAY_TO });
    expect(validateDiscoveryExtension(challenge.extensions!.bazaar as Parameters<typeof validateDiscoveryExtension>[0]).valid).toBe(true);
    expect(fetch).not.toHaveBeenCalled(); expect(facilitator.verify).not.toHaveBeenCalled(); expect(facilitator.settle).not.toHaveBeenCalled();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM payment_events").first("n")).toBe(0);
  });
  it.each(["extract", "check", "smart_diff"] as ServiceId[])("delivers %s only after verify and settle", async service => {
    const watch = service === "smart_diff" ? await baseline() : null;
    vi.mocked(fetch).mockClear();
    const input = watch ? { watch_id: watch.watch_id } : { url: "https://public.example/" };
    const payment = await getPayment(service, input);
    vi.mocked(fetch).mockImplementation(async () => { expect(facilitator.verify).toHaveBeenCalledOnce(); return target('{"price":12}', "application/json"); });
    const response = await request(SERVICES[service].path, input, payment);
    expect(response.status).toBe(200);
    expect(response.headers.has("payment-response")).toBe(true);
    expect(facilitator.settle).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT amount_atomic FROM payment_events").first("amount_atomic")).toBe(SERVICES[service].atomic);
  });
  it("denies an invalid signature before target fetch", async () => {
    const input = { url: "https://public.example/" }, payment = await getPayment("extract", input);
    vi.mocked(facilitator.verify).mockResolvedValueOnce({ isValid: false, invalidReason: "bad_signature" });
    expect((await request("/v2/extract", input, payment)).status).toBe(402);
    expect(fetch).not.toHaveBeenCalled(); expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it("rejects wrong price or service payment requirements", async () => {
    const payment = await getPayment("check", { url: "https://public.example/" });
    expect((await request("/v2/extract", { url: "https://public.example/" }, payment)).status).toBe(402);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["check", "smart_diff"] as ServiceId[])("does not expose or persist %s when settlement fails", async service => {
    const watch = await baseline(); vi.mocked(fetch).mockClear();
    const input = { watch_id: watch.watch_id }, payment = await getPayment(service,input);
    vi.mocked(fetch).mockResolvedValueOnce(target('{"private_paid_result":999}', "application/json"));
    vi.mocked(facilitator.settle).mockResolvedValueOnce({ success: false, errorReason: "settlement_failed", transaction: "", network: NETWORK });
    const response = await request(SERVICES[service].path,input,payment);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private_paid_result");
    expect(await env.DB.prepare("SELECT hash FROM watches").first("hash")).toBe(watch.hash);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM watch_snapshots").first("n")).toBe(1);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM smart_snapshots").first("n")).toBe(0);
  });
  it("rejects concurrent/repeated authorization use without repeated fetch or settlement", async () => {
    const input = { url: "https://public.example/" }, payment = await getPayment("extract", input);
    vi.mocked(fetch).mockImplementation(async () => target("<p>Paid result</p>"));
    const responses = await Promise.all([request("/v2/extract",input,payment),request("/v2/extract",input,payment)]);
    expect(responses.map(r => r.status).sort()).toEqual([200,402]);
    expect(fetch).toHaveBeenCalledOnce(); expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("does not settle failed upstream operations", async () => {
    const input = { url: "https://public.example/" }, payment = await getPayment("extract", input);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null,{ status:403 }));
    expect((await request("/v2/extract",input,payment)).status).toBe(502);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it("withholds results on an indeterminate settlement exception and blocks reuse",async()=>{
    const input={url:"https://public.example/"},payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("<p>secret paid result</p>"));
    vi.mocked(facilitator.settle).mockRejectedValueOnce(new Error("secret diagnostic that must not be logged"));
    const response=await request("/v2/extract",input,payment);
    expect(response.status).not.toBe(200);expect(await response.text()).not.toContain("secret paid result");
    expect((await request("/v2/extract",input,payment)).status).toBe(402);
    expect(fetch).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls.map(args => args.map(String).join(" ")).join("\n")).not.toContain("secret diagnostic");
  });
  it("bounds intelligence response size and never settles an oversized target",async()=>{
    const input={url:"https://public.example/"},payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("x".repeat(1000001),"text/plain"));
    expect((await request("/v2/extract",input,payment)).status).toBe(413);
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it("returns the paid result and a persistence warning if D1 commit fails after settlement",async()=>{
    const watch=await baseline(), input={watch_id:watch.watch_id}, payment=await getPayment("check",input);
    vi.mocked(fetch).mockResolvedValueOnce(target('{"price":12}',"application/json"));
    vi.mocked(facilitator.settle).mockImplementationOnce(async () => {
      const originalBatch=bindings.DB.batch.bind(bindings.DB);
      vi.spyOn(bindings.DB,"batch").mockImplementationOnce(originalBatch).mockRejectedValueOnce(new Error("simulated commit failure"));
      return {success:true,payer,transaction:"0x"+"a".repeat(64),network:NETWORK};
    });
    const response=await request("/v1/check",input,payment);
    expect(response.status).toBe(200);
    expect(response.headers.has("payment-response")).toBe(true);
    expect(await response.json()).toMatchObject({changed:true,snapshot_saved:false,persistence_error:expect.any(String)});
    expect(await env.DB.prepare("SELECT hash FROM watches").first("hash")).toBe(watch.hash);
  });
  it("rejects a malformed payment header without fetching",async()=>{
    const response=await request("/v2/extract",{url:"https://public.example/"},undefined,{"payment-signature":"not-a-payment"});
    expect(response.status).toBe(402);expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed without CDP configuration and still lists MCP tools",async()=>{
    application=createApp();
    expect((await request("/v2/extract",{url:"https://public.example/"})).status).toBe(503);
    expect((await rpc(await request("/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"}))).result.tools).toHaveLength(4);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{}, { url:"file:///etc/passwd" }, { url:"http://127.0.0.1/" }, { url:"https://public.example", selector:"[" }, { url:"https://public.example", max_chars:999999 }])("rejects invalid extract input %j before payment", async input => {
    expect((await request("/v2/extract",input)).status).toBe(400); expect(facilitator.getSupported).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

describe("MCP compatibility", () => {
  it("lists four tools without credentials or outbound calls", async () => {
    const result = await rpc(await request("/mcp", { jsonrpc:"2.0", id:1, method:"tools/list" }));
    expect(result.result.tools.map((t: { name: string })=>t.name).sort()).toEqual(["fresh402_check","fresh402_extract","fresh402_register","fresh402_smart_diff"]);
    expect(facilitator.getSupported).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("challenges then executes extraction using x402 MCP metadata", async () => {
    const call = { jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"fresh402_extract", arguments:{url:"https://public.example/"} } };
    const unpaid = await rpc(await request("/mcp",call));
    expect(unpaid.result.isError).toBe(true); expect(fetch).not.toHaveBeenCalled();
    const challenge = unpaid.result.structuredContent as PaymentRequired;
    expect(challenge.accepts[0].amount).toBe("10000");
    vi.mocked(fetch).mockResolvedValueOnce(target("<body><p>Paid MCP result</p></body>"));
    const paid = await rpc(await request("/mcp",{...call,params:{...call.params,_meta:{"x402/payment":paymentFor(challenge)}}}));
    expect(paid.result.isError).not.toBe(true);
    expect(paid.result.structuredContent.text).toBe("Paid MCP result");
    expect(paid.result._meta["x402/payment-response"].success).toBe(true);
  });
  it.each(["check","smart_diff"] as ServiceId[])("does not persist or reveal %s on MCP settlement failure",async service=>{
    const watch=await baseline();
    const call={jsonrpc:"2.0",id:5,method:"tools/call",params:{name:SERVICES[service].tool,arguments:{watch_id:watch.watch_id}}};
    const unpaid=await rpc(await request("/mcp",call));
    vi.mocked(fetch).mockResolvedValueOnce(target('{"private_paid_result":123}',"application/json"));
    vi.mocked(facilitator.settle).mockResolvedValueOnce({success:false,transaction:"",network:NETWORK,errorReason:"failed"});
    const result=await rpc(await request("/mcp",{...call,params:{...call.params,_meta:{"x402/payment":paymentFor(unpaid.result.structuredContent)}}}));
    expect(result.result.isError).toBe(true);expect(JSON.stringify(result)).not.toContain("private_paid_result");
    expect(await env.DB.prepare("SELECT hash FROM watches").first("hash")).toBe(watch.hash);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM smart_snapshots").first("n")).toBe(0);
  });
  it("rejects a foreign Origin",async()=>{
    const response=await boundedFetch(new Request("https://service.example/mcp",{method:"POST",headers:{origin:"https://attacker.example","content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list"})}),bindings,createExecutionContext(),application);
    expect(response.status).toBe(403);expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts a modern 2026 envelope for discovery",async()=>{
    const response=await request("/mcp",{jsonrpc:"2.0",method:"tools/list",id:"modern",params:{_meta:{
      [PROTOCOL_VERSION_META_KEY]:"2026-07-28",
      [CLIENT_INFO_META_KEY]:{name:"fresh402-test",version:"1.0.0"},
      [CLIENT_CAPABILITIES_META_KEY]:{},
    }}},undefined,{"MCP-Protocol-Version":"2026-07-28","Mcp-Method":"tools/list"});
    expect(response.status).toBe(200);
    expect((await rpc(response)).result.tools).toHaveLength(4);
  });
});

describe("capacity and analytics", () => {
  it("allows only eight global operations and releases leases", async () => {
    const releases = await Promise.all(Array.from({length:8},()=>acquireCapacity(env.DB)));
    await expect(acquireCapacity(env.DB)).rejects.toMatchObject({ code:"capacity_exceeded" });
    await releases[0](); const next = await acquireCapacity(env.DB); await next();
    await Promise.all(releases.slice(1).map(fn=>fn()));
  });
  it("serializes the same resource across URL and watch-id calls",async()=>{
    const watch=await baseline();
    const release=await acquireCapacity(env.DB,{url:"https://public.example/"});
    await expect(acquireCapacity(env.DB,{watch_id:watch.watch_id})).rejects.toMatchObject({code:"capacity_exceeded"});
    await release();await (await acquireCapacity(env.DB,{watch_id:watch.watch_id}))();
  });
  it("records challenges separately from sales and excludes request bodies from aggregates", async () => {
    await request("/v2/extract",{url:"https://public.example/private-query?user=123"});
    const rows = await env.DB.prepare("SELECT * FROM analytics_daily").all();
    expect(rows.results).toEqual([expect.objectContaining({event:"initial_402",service:"extract",count:1})]);
    expect(JSON.stringify(rows)).not.toContain("private-query");
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM payment_events").first("n")).toBe(0);
  });
});


describe("release payment recovery and failure isolation", () => {
  const input = { url: "https://public.example/" };
  const token = () => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const authHeaders = (key: string) => ({"x-fresh402-recovery-token":key});
  it("recovers a lost REST response across app instances without verification, refetch or debit", async () => {
    const key=token(), payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("<main><p>Confidential result</p></main>"));
    const first=await request("/v2/extract",input,payment,authHeaders(key));
    const original=await first.json();
    application=createApp(()=>facilitator);
    vi.mocked(facilitator.verify).mockResolvedValue({isValid:false,invalidReason:"authorization_already_used"});
    const second=await request("/v2/extract",input,payment,authHeaders(key));
    expect(second.status).toBe(200);expect(await second.json()).toEqual(original);
    expect(second.headers.get("payment-response")).toBe(first.headers.get("payment-response"));
    expect(fetch).toHaveBeenCalledOnce();expect(facilitator.verify).toHaveBeenCalledOnce();expect(facilitator.settle).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM payment_events").first("n")).toBe(1);
    const stored=JSON.stringify(await env.DB.prepare("SELECT * FROM payment_operations").first());
    expect(stored).not.toContain(key);expect(stored).not.toContain(payment.payload.signature);
  });
  it("never treats public payment fields/signature, nonce or transaction hash as recovery credentials",async()=>{
    const key=token(), payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("private result"));
    const response=await request("/v2/extract",input,payment,authHeaders(key));expect(response.status).toBe(200);
    for(const headers of [{},authHeaders(token())]) {
      const denied=await request("/v2/extract",input,payment,headers);
      expect(denied.status).toBe(402);expect(await denied.text()).not.toContain("private result");
    }
    expect((await application.request("/v2/results/"+"a".repeat(64),{},bindings)).status).toBe(404);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("binds recovery to original arguments, service and transport",async()=>{
    const key=token(),payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("paid result"));
    await request("/v2/extract",input,payment,authHeaders(key));
    expect((await request("/v2/extract",{...input,max_chars:100},payment,authHeaders(key))).status).toBe(409);
    expect((await request("/v1/check",input,payment,authHeaders(key))).status).toBe(409);
    const mcp=await rpc(await request("/mcp",{jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"fresh402_extract",arguments:input,_meta:{"x402/payment":payment,"fresh402/recovery-token":key}}}));
    expect(mcp.result.isError).toBe(true);expect(mcp.result.structuredContent.error).toBe("payment_request_mismatch");
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("keeps recovery valid after onchain authorization expiration",async()=>{
    const key=token(),payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("paid result"));
    await request("/v2/extract",input,payment,authHeaders(key));
    vi.useFakeTimers();vi.setSystemTime(Date.now()+3600000);
    expect((await request("/v2/extract",input,payment,authHeaders(key))).status).toBe(200);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("returns 410 after result retention, without new debit or deleting financial history",async()=>{
    const key=token(),payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("paid result"));
    await request("/v2/extract",input,payment,authHeaders(key));
    vi.useFakeTimers();vi.setSystemTime(Date.now()+8*86400000);
    await cleanupTemporaryData(env.DB);
    expect((await request("/v2/extract",input,payment,authHeaders(key))).status).toBe(410);
    expect(await env.DB.prepare("SELECT response_json FROM payment_operations").first("response_json")).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM payment_events").first("n")).toBe(1);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("fails closed on D1 reservation failure even when facilitator verified the payment",async()=>{
    const payment=await getPayment("extract",input);
    vi.spyOn(bindings.DB,"batch").mockRejectedValueOnce(new Error("reservation unavailable"));
    expect((await request("/v2/extract",input,payment)).status).not.toBe(200);
    expect(fetch).not.toHaveBeenCalled();expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it("withholds a confirmed charge if D1 receipt storage fails, then recovers after operator reconciliation",async()=>{
    const key=token(),payment=await getPayment("extract",input),receipt={success:true,payer,network:NETWORK,transaction:"0x"+"d".repeat(64)};
    vi.mocked(fetch).mockResolvedValueOnce(target("durable private result"));
    vi.mocked(facilitator.settle).mockImplementationOnce(async()=>{
      vi.spyOn(bindings.DB,"batch").mockRejectedValueOnce(new Error("receipt storage failed"));
      return receipt;
    });
    const failed=await request("/v2/extract",input,payment,authHeaders(key));
    expect(failed.status).toBe(503);expect(await failed.text()).not.toContain("durable private result");
    expect(await env.DB.prepare("SELECT state FROM payment_operations").first("state")).toBe("settling");
    expect((await request("/v2/extract",input,payment,authHeaders(key))).status).toBe(409);
    // Local simulation of an operator applying separately verified reconciliation SQL.
    await env.DB.prepare("UPDATE payment_operations SET state='settled', receipt_json=? WHERE state='settling'").bind(JSON.stringify(receipt)).run();
    const recovered=await request("/v2/extract",input,payment,authHeaders(key));
    expect(recovered.status).toBe(200);expect(await recovered.text()).toContain("durable private result");
    expect(facilitator.settle).toHaveBeenCalledOnce();
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM payment_events").first("n")).toBe(1);
  });
  it("retains durable prepared result and quarantines timeouts without SDK resubmission",async()=>{
    const key=token(),payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("private prepared result"));
    vi.mocked(facilitator.settle).mockRejectedValueOnce(new Error("network timeout"));
    expect((await request("/v2/extract",input,payment,authHeaders(key))).status).toBe(503);
    const row=await env.DB.prepare("SELECT * FROM payment_operations").first();
    expect(row).toMatchObject({state:"settling",response_json:expect.stringContaining("private prepared result")});
    const retry=await request("/v2/extract",input,payment,authHeaders(key));
    expect(retry.status).toBe(409);expect(await retry.text()).not.toContain("private prepared result");
    expect(facilitator.settle).toHaveBeenCalledOnce();
    await env.DB.prepare("DELETE FROM operation_leases").run();
    await expect(acquireCapacity(env.DB,input)).rejects.toMatchObject({code:"capacity_exceeded"});
    await cleanupTemporaryData(env.DB,Date.now()+9*86400000);
    expect(await env.DB.prepare("SELECT state FROM payment_operations").first("state")).toBe("settling");
  });
  it("does not let settlement_pending trigger a second facilitator call",async()=>{
    const payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("private result"));
    vi.mocked(facilitator.settle).mockResolvedValueOnce({success:false,transaction:"0x"+"b".repeat(64),network:NETWORK,errorReason:"settlement_pending"});
    expect((await request("/v2/extract",input,payment)).status).toBe(503);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("repairs a failed post-settlement snapshot commit exactly once under parallel recovery",async()=>{
    const watch=await baseline(),args={watch_id:watch.watch_id},key=token(),payment=await getPayment("check",args);
    vi.mocked(fetch).mockResolvedValueOnce(target('{"price":12}',"application/json"));
    vi.mocked(facilitator.settle).mockImplementationOnce(async()=>{
      const originalBatch=bindings.DB.batch.bind(bindings.DB);
      vi.spyOn(bindings.DB,"batch").mockImplementationOnce(originalBatch).mockRejectedValueOnce(new Error("snapshot commit failed"));
      return {success:true,payer,network:NETWORK,transaction:"0x"+"c".repeat(64)};
    });
    const first=await request("/v1/check",args,payment,authHeaders(key));
    expect(first.status).toBe(200);expect(await first.json()).toMatchObject({snapshot_saved:false});
    expect(await env.DB.prepare("SELECT state FROM payment_operations").first("state")).toBe("settled");
    application=createApp(()=>facilitator);
    const retries=await Promise.all(Array.from({length:4},()=>request("/v1/check",args,payment,authHeaders(key))));
    for(const response of retries) expect(response.status).toBe(200);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM watch_snapshots").first("n")).toBe(2);
    expect(await env.DB.prepare("SELECT check_count FROM watches").first("check_count")).toBe(2);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM payment_events").first("n")).toBe(1);
    expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("recovers MCP replies using private metadata across app instances",async()=>{
    const call={jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"fresh402_extract",arguments:input}};
    const challenge=await rpc(await request("/mcp",call));const payment=paymentFor(challenge.result.structuredContent),key=token();
    const paidCall={...call,params:{...call.params,_meta:{"x402/payment":payment,"fresh402/recovery-token":key}}};
    vi.mocked(fetch).mockResolvedValueOnce(target("private MCP result"));
    const first=await rpc(await request("/mcp",paidCall));application=createApp(()=>facilitator);
    const second=await rpc(await request("/mcp",paidCall));
    expect(second.result.structuredContent).toEqual(first.result.structuredContent);
    expect(second.result._meta["x402/payment-response"]).toEqual(first.result._meta["x402/payment-response"]);
    expect(facilitator.settle).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
  });
  it("fences a worker that lost its capacity lease before preparing the paid result",async()=>{
    const payment=await getPayment("extract",input);
    vi.mocked(fetch).mockImplementationOnce(async()=>{
      await env.DB.prepare("DELETE FROM operation_leases").run();
      return target("stale operation result");
    });
    const response=await request("/v2/extract",input,payment);
    expect(response.status).not.toBe(200);expect(await response.text()).not.toContain("stale operation result");
    expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it("rejects expired authorization locally even when a facilitator incorrectly says valid",async()=>{
    const payment=await getPayment("extract",input);
    (payment.payload.authorization as Record<string,unknown>).validBefore=String(Math.floor(Date.now()/1000)-1);
    expect((await request("/v2/extract",input,payment)).status).not.toBe(200);
    expect(fetch).not.toHaveBeenCalled();expect(facilitator.settle).not.toHaveBeenCalled();
  });
  it("allows only one debit and operation for concurrent callers using one recovery token",async()=>{
    const key=token(),payment=await getPayment("extract",input);
    vi.mocked(fetch).mockImplementation(async()=>target("paid result"));
    const responses=await Promise.all(Array.from({length:4},()=>request("/v2/extract",input,payment,authHeaders(key))));
    expect(responses.some(r=>r.status===200)).toBe(true);
    expect(facilitator.settle).toHaveBeenCalledOnce();expect(fetch).toHaveBeenCalledOnce();
  });
  it("cleans expired claims/leases but preserves active authorizations, watches and snapshots",async()=>{
    const watch=await baseline(),now=Date.now(),sec=Math.floor(now/1000);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO payment_claims VALUES ('expired', ?),('active', ?)").bind(sec-1,sec+3600),
      env.DB.prepare("INSERT INTO operation_leases VALUES (0,'expired',NULL,?),(1,'active',NULL,?)").bind(now-1,now+3600),
    ]);
    await cleanupTemporaryData(env.DB,now);
    expect((await env.DB.prepare("SELECT claim_hash FROM payment_claims").all()).results).toEqual([{claim_hash:"active"}]);
    expect((await env.DB.prepare("SELECT owner FROM operation_leases").all()).results).toEqual([{owner:"active"}]);
    expect(await env.DB.prepare("SELECT watch_id FROM watches").first("watch_id")).toBe(watch.watch_id);
    expect(await env.DB.prepare("SELECT COUNT(*) n FROM watch_snapshots").first("n")).toBe(1);
  });
  it("cleanup cannot reopen a still-valid payment authorization",async()=>{
    const payment=await getPayment("extract",input);
    vi.mocked(fetch).mockResolvedValueOnce(target("paid result"));
    await request("/v2/extract",input,payment);
    await cleanupTemporaryData(env.DB);
    expect((await request("/v2/extract",input,payment)).status).toBe(402);expect(facilitator.settle).toHaveBeenCalledOnce();
  });
  it("enforces a global daily operation budget atomically and supports a zero-budget kill switch",async()=>{
    const first=await acquireCapacity(env.DB,undefined,2);await first();
    const second=await acquireCapacity(env.DB,undefined,2);await second();
    await expect(acquireCapacity(env.DB,undefined,2)).rejects.toMatchObject({code:"capacity_exceeded"});
    expect(await env.DB.prepare("SELECT started FROM operation_budget").first("started")).toBe(2);
    await expect(acquireCapacity(env.DB,undefined,0)).rejects.toMatchObject({code:"capacity_exceeded"});
  });
  it("protects staging discovery and refuses paid calls without staging-specific credentials",async()=>{
    bindings={...bindings,ENVIRONMENT:"staging",STAGING_ACCESS_TOKEN:token(),TARGET_HOST_ALLOWLIST:"public.example"};
    expect((await request("/mcp",{jsonrpc:"2.0",id:1,method:"tools/list"})).status).toBe(403);
    const ctx=createExecutionContext();
    const discovery=await boundedFetch(new Request("https://service.example/.well-known/x402",{headers:{authorization:"Bearer "+bindings.STAGING_ACCESS_TOKEN}}),bindings,ctx,application);
    expect(discovery.status).toBe(404);
    const challenge=await request("/v2/extract",input,undefined,{authorization:"Bearer "+bindings.STAGING_ACCESS_TOKEN});
    expect(challenge.status).toBe(402);
    expect(JSON.parse(atob(challenge.headers.get("payment-required")!)).extensions ?? {}).toEqual({});
  });
  it.each(["short", "!".repeat(64)])("rejects invalid recovery tokens before verification: %s",async key=>{
    expect((await request("/v2/extract",input,undefined,authHeaders(key))).status).toBe(400);
    expect(facilitator.verify).not.toHaveBeenCalled();
  });
});

describe("release extraction regression fixtures",()=>{
  it("does not duplicate text when the scope matches nested elements",async()=>{
    const result=await analyzeContent('<body><div>A <div>B</div> C</div><p>outside</p></body>',"text/html","https://public.example/",{selector:"div"});
    expect(result.document.text).toBe("A B C");
  });
  it("preserves nested list and paragraph content exactly once",async()=>{
    const result=await analyzeContent('<main><ul><li>Parent<p>Child <b>bold</b></p><ul><li>Nested</li></ul>Tail</li></ul></main>',"text/html","https://public.example/",{});
    expect(result.document.text).toBe("Parent Child bold Nested Tail");
    expect(result.document.blocks.map(b=>b.text).join(" ")).toContain("Child bold");
  });
  it("inserts boundaries between divs, table cells and line breaks",async()=>{
    const result=await analyzeContent('<main><div>One</div><div>Two<br>Three</div><table><tr><td>A</td><td>B</td></tr></table></main>',"text/html","https://public.example/",{});
    expect(result.document.text).toBe("One Two Three A B");
  });
  it("does not include outside text when an explicit selector matches a void element",async()=>{
    const result=await analyzeContent('<body><img id="x"><p>Outside</p></body>',"text/html","https://public.example/",{selector:"#x"});
    expect(result.document.text).toBe("");
  });
  it("reports sparse static content on a JavaScript application shell",async()=>{
    const result=await analyzeContent('<body><div id="root"></div><script>renderEverything()</script></body>',"text/html","https://public.example/",{});
    expect(result.warnings).toContain("limited_static_content_may_require_javascript");
  });
  it("preserves Unicode, nested JSON and prototype-looking JSON keys",async()=>{
    const result=await analyzeContent('{"__proto__":{"x":1},"items":[{"name":"日本語 🦊","price":12.3}]}',"application/json","https://public.example/",{});
    expect(result.document.text).toContain('"__proto__":{"x":1}');
    expect(result.document.text).toContain("日本語 🦊");
    expect(({} as Record<string,unknown>).x).toBeUndefined();
  });
});
