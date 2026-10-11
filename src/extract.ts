import { decodeHTML } from "entities";
import { applyJsonIgnorePaths, stableJsonStringify } from "./freshness";
import { fetchTarget } from "./safe-fetch";
import { ServiceError, type ExtractInput } from "./contracts";

export type ContentKind = "html" | "json" | "text";
export interface Block { kind: string; key: string | null; text: string }
export interface IntelligenceDocument {
  kind: ContentKind;
  text: string;
  blocks: Block[];
  data: unknown;
  fidelity: "structural" | "legacy_text";
}
export const normalizeText = (value: string) => value.replace(/\s+/gu, " ").trim();
export const cleanText = (value: string) => normalizeText(decodeHTML(value));
const plainText = (html: string) => cleanText(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " "));
export async function digest(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
export function checkJsonComplexity(value: unknown): void {
  const stack: Array<[unknown, number]> = [[value, 0]];
  let nodes = 0;
  while (stack.length) {
    const [item, depth] = stack.pop()!;
    if (++nodes > 10000 || depth > 64) throw new ServiceError("content_too_complex", "JSON exceeds 10,000 nodes or 64 nesting levels.", 422);
    if (item && typeof item === "object") for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
}
function safeLink(value: string | null, base: string): string | null {
  if (!value || value.length > 4096) return null;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const htmlResponse = (html: string) => new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
async function transform(html: string, rewriter: HTMLRewriter): Promise<string> {
  return rewriter.transform(htmlResponse(html)).text(); // Input was bounded by safe-fetch.
}

export async function analyzeContent(body: string, contentType: string, finalUrl: string, input: Pick<ExtractInput, "selector" | "ignore_selectors" | "ignore_json_paths">) {
  if (body.length > 1000000) throw new ServiceError("content_too_large", "Intelligence services parse at most 1,000,000 characters.", 413);
  const type = contentType.split(";")[0].trim().toLowerCase();
  const kind: ContentKind = type === "text/html" || type === "application/xhtml+xml" ? "html"
    : type === "application/json" || type.endsWith("+json") ? "json" : "text";
  if (kind === "text" && !type.startsWith("text/") && type !== "application/xml" && !type.endsWith("+xml")) {
    throw new ServiceError("unsupported_content_type", "Only HTML, JSON and text resources are supported.", 415);
  }
  if (kind !== "html" && (input.selector || input.ignore_selectors?.length)) throw new ServiceError("html_scope_requires_html", "CSS selectors require HTML.", 422);
  if (kind !== "json" && input.ignore_json_paths?.length) throw new ServiceError("json_paths_require_json", "JSON paths require JSON.", 422);

  let title: string | null = null, description: string | null = null, canonicalUrl: string | null = null;
  let text = "", data: unknown = null;
  const blocks: Block[] = [], headings: Array<{ level: number; text: string }> = [];
  const links: Array<{ url: string; text: string }> = [], structuredData: unknown[] = [], warnings: string[] = [];
  if (kind === "json") {
    try { data = JSON.parse(body); } catch { throw new ServiceError("invalid_upstream_json", "Target returned invalid JSON.", 502); }
    checkJsonComplexity(data);
    data = applyJsonIgnorePaths(data, input.ignore_json_paths ?? []);
    text = stableJsonStringify(data);
  } else if (kind === "text") {
    text = normalizeText(body);
    for (const line of body.split(/\n\s*\n|\r?\n/)) if (normalizeText(line)) {
      if (blocks.length >= 1000) throw new ServiceError("content_too_complex", "At most 1,000 content blocks are supported.", 422);
      blocks.push({ kind: "paragraph", key: null, text: normalizeText(line) });
    }
  } else {
    let titleText = "", ldText = "", ldActive = false, ldBytes = 0;
    let sourceElements = 0;
    await transform(body, new HTMLRewriter()
      .on("*", { element() { if (++sourceElements > 10000) throw new ServiceError("content_too_complex", "At most 10,000 HTML elements are supported.", 422); } })
      .on("title", { text(chunk) { if (titleText.length < 2048) titleText += chunk.text.slice(0, 2048 - titleText.length); } })
      .on('meta[name="description"], meta[property="og:description"]', { element(el) { description ??= el.getAttribute("content")?.slice(0, 2048) ?? null; } })
      .on('link[rel="canonical"]', { element(el) { canonicalUrl ??= safeLink(el.getAttribute("href"), finalUrl); } })
      .on('script[type="application/ld+json"]', {
        element(el) {
          ldText = ""; ldActive = structuredData.length < 20 && ldBytes < 32000;
          el.onEndTag(() => {
            if (!ldActive) return;
            try { const item: unknown = JSON.parse(ldText); checkJsonComplexity(item); structuredData.push(item); }
            catch { warnings.push("invalid_or_oversized_json_ld"); }
            ldActive = false;
          });
        },
        text(chunk) { if (ldActive) { ldBytes += chunk.text.length; if (ldBytes <= 32000) ldText += chunk.text; else { ldActive = false; warnings.push("structured_data_truncated"); } } },
      }));
    title = cleanText(titleText) || null;
    let cleaner = new HTMLRewriter();
    for (const rule of ["script", "style", "noscript", "template", "svg", "canvas", "head", "[hidden]", '[aria-hidden="true"]',
      "nav", "footer", "aside", '[class*="cookie"]', '[class*="consent"]', '[class*="advertisement"]', ...(input.ignore_selectors ?? [])]) {
      cleaner = cleaner.on(rule, { element(el) { el.remove(); } });
    }
    const cleaned = await transform(body, cleaner);
    // Prefer a main/article scope; explicit selectors always win.
    let mainCount = 0, articleCount = 0;
    await transform(cleaned, new HTMLRewriter().on("main", { element() { mainCount++; } }).on("article", { element() { articleCount++; } }));
    const scope = input.selector ?? (mainCount ? "main" : articleCount ? "article" : "body");
    let matches = 0, selectedDepth = 0;
    const textChunks: string[] = [];
    const stack: Block[] = [];
    let looseText = "";
    const flushLoose = () => {
      const text = normalizeText(looseText); looseText = "";
      if (text) {
        if (blocks.length >= 1000) throw new ServiceError("content_too_complex", "At most 1,000 content blocks are supported.", 422);
        blocks.push({ kind: "text", key: null, text });
      }
    };
    let currentLink: { url: string; text: string } | null = null;
    // An element has one end-tag callback. Combining all bookkeeping in one
    // handler prevents nested scope/block handlers from overwriting each other.
    const marker = "data-fresh402-selected";
    const scoped = await transform(cleaned, new HTMLRewriter()
      .on("*", { element(el) { el.removeAttribute(marker); } })
      .on(scope, { element(el) { matches++; el.setAttribute(marker, "1"); } }));
    const voidTags = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);
    const boundaryTags = new Set(["div","section","article","main","ul","ol","table","td","th","blockquote"]);
    const blockTags = new Set(["h1","h2","h3","h4","h5","h6","p","li","pre","tr","dt","dd"]);
    let nodes = 0;
    await transform(scoped, new HTMLRewriter().on("*", { element(el) {
      if (++nodes > 10000) throw new ServiceError("content_too_complex", "At most 10,000 HTML elements are supported.", 422);
      const selected = el.getAttribute(marker) === "1" && !voidTags.has(el.tagName);
      if (selected) selectedDepth++;
      if (!selectedDepth) return;
      const boundary = boundaryTags.has(el.tagName);
      if (boundary || el.tagName === "br") { textChunks.push(" "); if (stack.length) stack[stack.length-1].text += " "; else looseText += " "; }
      let block: Block | undefined;
      if (blockTags.has(el.tagName)) {
        flushLoose();
        if (blocks.length >= 1000) throw new ServiceError("content_too_complex", "At most 1,000 content blocks are supported.", 422);
        block = { kind: el.tagName, key: el.getAttribute("id")?.slice(0,256) ?? null, text: "" };
        stack.push(block); blocks.push(block); textChunks.push(" ");
      }
      const previousLink = currentLink;
      const anchor = el.tagName === "a";
      if (anchor) {
        const url = safeLink(el.getAttribute("href"),finalUrl);
        currentLink = url && links.length < 100 ? {url,text:""} : null;
        if (currentLink) links.push(currentLink);
      }
      if (!voidTags.has(el.tagName)) el.onEndTag(() => {
        if (block) { const index=stack.indexOf(block); if(index>=0) stack.splice(index,1); textChunks.push(" "); }
        if (boundary) { textChunks.push(" "); if(stack.length) stack[stack.length-1].text += " "; else looseText += " "; }
        if (anchor) currentLink=previousLink;
        if (selected) selectedDepth--;
      });
    } }).onDocument({text(chunk) {
      if (!selectedDepth) return;
      textChunks.push(chunk.text);
      if (stack.length) stack[stack.length-1].text += chunk.text; else looseText += chunk.text;
      if (currentLink && currentLink.text.length < 500) currentLink.text += chunk.text.slice(0,500-currentLink.text.length);
    } }));
    flushLoose();
    if (!matches && input.selector) throw new ServiceError("selector_not_found", "The CSS selector did not match any element.", 422);
    // HTML fragments can omit body. Preserve a bounded fallback.
    text = matches ? cleanText(textChunks.join("")) : plainText(cleaned);
    for (const block of blocks) {
      block.text = cleanText(block.text);
      if (/^h[1-6]$/.test(block.kind) && headings.length < 100) headings.push({ level: Number(block.kind[1]), text: block.text.slice(0, 2048) });
    }
    for (const link of links) link.text = cleanText(link.text);
  }
  const meaningful = blocks.filter(b => b.text);
  if (kind === "html" && text.length < 80) warnings.push("limited_static_content_may_require_javascript");
  const document: IntelligenceDocument = { kind, text, data, fidelity: "structural", blocks: meaningful.length ? meaningful : [{ kind: "text", key: null, text }] };
  return { document, title, description, canonical_url: canonicalUrl, headings, links, structured_data: structuredData, warnings: [...new Set(warnings)] };
}

export async function extract(input: ExtractInput, allowedHosts?: string, gateway?: import('./egress').EgressGateway, signal?: AbortSignal) {
  const fetched = await fetchTarget(new URL(input.url), false, undefined, allowedHosts, gateway, signal);
  if (!fetched.response.ok) throw new ServiceError("upstream_error", `Target returned HTTP ${fetched.response.status}.`, 502);
  const analyzed = await analyzeContent(fetched.body, fetched.response.headers.get("content-type") ?? "", fetched.finalUrl, input);
  const { document, ...metadata } = analyzed;
  const truncated = document.text.length > input.max_chars;
  return {
    url: input.url, final_url: fetched.finalUrl, content_kind: document.kind, ...metadata,
    links: input.include_links ? metadata.links : [], structured_data: input.include_structured_data ? metadata.structured_data : [],
    text: document.text.slice(0, input.max_chars), text_length: document.text.length, truncated,
    data: document.kind === "json" && !truncated ? document.data : null,
    data_omitted: document.kind === "json" && truncated,
    hash: await digest(document.text), fetched_at: new Date().toISOString(), extractor_version: 1,
    warnings: [...metadata.warnings, ...(truncated ? ["text_truncated"] : [])],
  };
}
