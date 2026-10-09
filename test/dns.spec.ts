import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTarget, validateTarget } from "../src/safe-fetch";
import { assertPublicDns } from "../src/dns";
const dns = (answers: Array<{type:number;data:string}>, Status = 0) => Response.json({ Status, Answer:answers });
beforeEach(()=>{ vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("Unmocked network")); });
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const isBlocked = (host:string) => Boolean(validateTarget(new URL(`https://${host.includes(":") ? `[${host}]` : host}/`),false));
describe("DNS and redirect SSRF defense",()=>{
  it.each(["http://public.example/","https://public.example:8443/"])("rejects insecure scheme/port under an approved-host launch: %s",async url=>{
    await expect(fetchTarget(new URL(url),false,undefined,"public.example")).rejects.toThrow("HTTPS on port 443");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["https://attacker.public.example/","https://public.example.attacker.net/"])("requires exact approved host equality: %s",async url=>{
    await expect(fetchTarget(new URL(url),false,undefined,"public.example")).rejects.toThrow("allowlist");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("still blocks private destinations even if mistakenly allowlisted",async()=>{
    await expect(fetchTarget(new URL("https://127.0.0.1/"),false,undefined,"127.0.0.1")).rejects.toThrow("Private");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rechecks same-host DNS between redirects without following a private answer",async()=>{
    let queries=0;const targets:string[]=[];
    vi.mocked(fetch).mockImplementation(async input=>{
      const url=new URL(String(input));
      if(url.hostname==="cloudflare-dns.com")return dns([{type:1,data:++queries<=2?"93.184.216.34":"127.0.0.1"}]);
      targets.push(url.href);return new Response(null,{status:302,headers:{location:"/next"}});
    });
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"public.example")).rejects.toMatchObject({code:"target_not_allowed"});
    expect(targets).toEqual(["https://public.example/"]);
  });
  it("uses the Workers-supported manual redirect mode for both DNS lookups",async()=>{
    vi.mocked(fetch).mockImplementation(async(_input,init)=>{
      if(init?.redirect === "error") throw new TypeError('Invalid redirect value; Workers supports follow/manual only');
      return dns([{type:1,data:"93.184.216.34"}]);
    });
    await assertPublicDns("public.example",new AbortController().signal,isBlocked);
    expect(fetch).toHaveBeenCalledTimes(2);
    for(const [,init] of vi.mocked(fetch).mock.calls) expect(init?.redirect).toBe("manual");
  });
  it("never follows a DNS redirect or fetches its destination",async()=>{
    vi.mocked(fetch).mockResolvedValue(new Response(null,{status:302,headers:{location:"http://127.0.0.1/private"}}));
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"public.example,rebind.example")).rejects.toMatchObject({code:"dns_unavailable"});
    expect(fetch).toHaveBeenCalledTimes(2);
    for(const [input,init] of vi.mocked(fetch).mock.calls) {
      expect(String(input)).toMatch(/^https:\/\/cloudflare-dns\.com\//);
      expect(init?.redirect).toBe("manual");
    }
  });
  it("checks the operator host allowlist on every redirect before DNS or fetch",async()=>{
    const targets:string[]=[];
    vi.mocked(fetch).mockImplementation(async input=>{
      const url=new URL(String(input));
      if(url.hostname==="cloudflare-dns.com") return dns([{type:1,data:"93.184.216.34"}]);
      targets.push(url.href);return new Response(null,{status:302,headers:{location:"https://other.example/"}});
    });
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"public.example")).rejects.toThrow("allowlist");
    expect(targets).toEqual(["https://public.example/"]);
  });
  it("fails closed for an empty operator allowlist",async()=>{
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"")).rejects.toThrow("allowlist");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["127.0.0.1","10.0.0.1","169.254.169.254","192.168.0.1","100.64.0.1","0.0.0.0","192.0.2.1","198.51.100.1","203.0.113.1","192.88.99.1","2001::1","2001:2::1","3fff::1","::1","fd00::1","::ffff:127.0.0.1","64:ff9b::7f00:1","ff02::1"])("rejects DNS answers containing %s",async address=>{
    vi.mocked(fetch).mockImplementation(async()=>dns([{type:address.includes(":")?28:1,data:address}]));
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"public.example,rebind.example")).rejects.toMatchObject({code:"target_not_allowed"});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([{type:1,data:"999.0.0.1"},{type:28,data:"2001:not-an-ip"}])("rejects malformed DNS IP answers %j",async answer=>{
    vi.mocked(fetch).mockImplementation(async()=>dns([answer]));
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"public.example,rebind.example")).rejects.toMatchObject({code:"dns_unavailable"});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("rejects a private answer even alongside a public address",async()=>{
    vi.mocked(fetch).mockImplementation(async()=>dns([{type:1,data:"93.184.216.34"},{type:1,data:"10.0.0.1"}]));
    await expect(assertPublicDns("public.example",new AbortController().signal,isBlocked)).rejects.toMatchObject({code:"target_not_allowed"});
  });
  it("rejects internal CNAMEs and DNS failure before target fetch",async()=>{
    vi.mocked(fetch).mockImplementation(async()=>dns([{type:5,data:"secret.internal."}]));
    await expect(fetchTarget(new URL("https://public.example"),false,undefined,"public.example,rebind.example")).rejects.toMatchObject({code:"target_not_allowed"});
    vi.mocked(fetch).mockImplementation(async()=>dns([],3));
    await expect(fetchTarget(new URL("https://public.example"),false,undefined,"public.example,rebind.example")).rejects.toMatchObject({code:"dns_unavailable"});
  });
  it("revalidates DNS for the redirect hostname and never fetches its private address",async()=>{
    const targets:string[]=[];
    vi.mocked(fetch).mockImplementation(async input=>{
      const url=new URL(String(input));
      if(url.hostname==="cloudflare-dns.com") return dns([{type:1,data:url.searchParams.get("name")==="public.example"?"93.184.216.34":"127.0.0.1"}]);
      targets.push(url.href); return new Response(null,{status:302,headers:{location:"https://rebind.example/"}});
    });
    await expect(fetchTarget(new URL("https://public.example/"),false,undefined,"public.example,rebind.example")).rejects.toMatchObject({code:"target_not_allowed"});
    expect(targets).toEqual(["https://public.example/"]);
  });
  it("uses one timeout for DNS and target loading",async()=>{
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_,init)=>new Promise((_,reject)=>init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true})));
    const pending=fetchTarget(new URL("https://public.example/"),false,undefined,"public.example");
    const assertion=expect(pending).rejects.toMatchObject({code:"upstream_timeout"});
    await vi.advanceTimersByTimeAsync(10000);await assertion;
  });
  it("permits public DNS addresses and forwards no client credentials",async()=>{
    vi.mocked(fetch).mockImplementation(async input=>String(input).startsWith("https://cloudflare-dns.com")?dns([{type:1,data:"93.184.216.34"}]):new Response("OK"));
    expect((await fetchTarget(new URL("https://public.example/"),false,undefined,"public.example,rebind.example")).body).toBe("OK");
    expect(fetch).toHaveBeenLastCalledWith("https://public.example/",expect.objectContaining({redirect:"manual",headers:expect.not.objectContaining({authorization:expect.anything(),cookie:expect.anything()})}));
  });
});
