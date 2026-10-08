import { BodyReadError, readBoundedBody, cancelBody } from "./body";

/** Fail closed on mixed public/private answers, CNAMEs, malformed answers and DNS outages. */
export async function assertPublicDns(host: string, signal: AbortSignal, blocked: (host: string) => boolean): Promise<void> {
  host = host.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return;
  const results = await Promise.all(["A", "AAAA"].map(async type => {
    const endpoint = new URL("https://cloudflare-dns.com/dns-query");
    endpoint.searchParams.set("name", host); endpoint.searchParams.set("type", type);
    const response = await fetch(endpoint, { headers: { accept: "application/dns-json" }, redirect: "error", signal });
    if (!response.ok) { cancelBody(response.body); throw new BodyReadError("dns_unavailable", "DNS validation failed.", 502); }
    const bytes = await readBoundedBody(response, 32768, new BodyReadError("dns_unavailable", "DNS response exceeded its limit.", 502), signal);
    const result = JSON.parse(new TextDecoder().decode(bytes)) as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    if (result.Status !== 0 || (result.Answer !== undefined && !Array.isArray(result.Answer))) throw new BodyReadError("dns_unavailable", "DNS validation failed.", 502);
    return result.Answer ?? [];
  }));
  let addresses = 0;
  for (const answer of results.flat()) {
    if (![1, 5, 28].includes(answer.type)) continue;
    if (typeof answer.data !== "string") throw new BodyReadError("dns_unavailable", "Malformed DNS answer.", 502);
    if (answer.type === 1 || answer.type === 28) {
      if (answer.type === 1 && !/^\d{1,3}(\.\d{1,3}){3}$/.test(answer.data) || answer.type === 28 && !answer.data.includes(":")) throw new BodyReadError("dns_unavailable", "Malformed DNS address.", 502);
      let canonical: string;
      try { canonical = new URL(`https://${answer.type === 28 ? `[${answer.data}]` : answer.data}/`).hostname; }
      catch { throw new BodyReadError("dns_unavailable", "Malformed DNS address.", 502); }
      if (blocked(canonical)) throw new BodyReadError("target_not_allowed", "DNS points to a private or reserved destination.", 400);
      addresses++;
    } else if (blocked(answer.data)) throw new BodyReadError("target_not_allowed", "DNS points to a private or reserved destination.", 400);
  }
  if (!addresses) throw new BodyReadError("dns_unavailable", "Target has no public address.", 502);
}
