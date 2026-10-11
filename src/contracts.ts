import { z } from "zod";
import { validateTarget } from "./safe-fetch";
import { validateHttpsUrl } from "./network-policy.mjs";

export class ServiceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
  }
}

const selector = z.string().min(1).max(256).refine(value => {
  try { new HTMLRewriter().on(value, {}); return true; } catch { return false; }
}, "Invalid or unsupported CSS selector");
const url = z.string().max(4096).url().refine(value => {
  try { return !validateTarget(validateHttpsUrl(value), false); } catch { return false; }
}, "Public HTTPS URL on port 443 required; credentials are forbidden");
const rules = {
  selector: selector.optional(),
  ignore_selectors: z.array(selector).max(20).optional(),
  ignore_json_paths: z.array(z.string().min(1).max(256).regex(/^\//)).max(20).optional(),
};
export const registerSchema = z.object({ url, ...rules });
export const checkSchema = z.object({
  url: url.optional(), watch_id: z.string().regex(/^w_[a-f0-9]{32}$/).optional(), ...rules,
  previous_hash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  max_age_seconds: z.number().int().min(0).max(86400).optional(), include_diff: z.boolean().optional(),
}).refine(v => Boolean(v.url) !== Boolean(v.watch_id), "Provide either url or watch_id");
export const extractSchema = z.object({
  url, ...rules, max_chars: z.number().int().min(100).max(50000).default(20000),
  include_links: z.boolean().default(true), include_structured_data: z.boolean().default(true),
}).strict();
export const smartDiffSchema = z.object({
  watch_id: z.string().regex(/^w_[a-f0-9]{32}$/),
  compare_to: z.enum(["previous", "baseline"]).default("previous"),
  previous_hash: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
}).strict();
export type ExtractInput = z.infer<typeof extractSchema>;
export type SmartDiffInput = z.infer<typeof smartDiffSchema>;
export type ServiceId = "check" | "extract" | "smart_diff";
export const SERVICES = {
  check: { id: "check", path: "/v1/check", tool: "fresh402_check", price: "$0.005", atomic: 5000,
    description: "Check a persistent watch or URL for changes, with noise filtering, conditional HTTP and a compact deterministic diff. $0.005 USDC.", schema: checkSchema,
    example: { url: "https://example.com/", include_diff: true } },
  extract: { id: "extract", path: "/v2/extract", tool: "fresh402_extract", price: "$0.01", atomic: 10000,
    description: "Extract main text, metadata, headings, links and JSON-LD from a public URL without executing JavaScript. HTML, JSON and text; CSS scoping. $0.01 USDC.", schema: extractSchema,
    example: { url: "https://example.com/", max_chars: 20000 } },
  smart_diff: { id: "smart_diff", path: "/v2/smart-diff", tool: "fresh402_smart_diff", price: "$0.015", atomic: 15000,
    description: "Compare a watch with its previous Smart Diff snapshot or fixed baseline. JSON Pointer changes, HTML block changes and explained significance rules; deterministic, no LLM. $0.015 USDC.", schema: smartDiffSchema,
    example: { watch_id: "w_0123456789abcdef0123456789abcdef", compare_to: "previous" } },
} as const;
export function inputJsonSchema(service: ServiceId): Record<string, unknown> {
  const schema = z.toJSONSchema(SERVICES[service].schema, { io: "input" });
  if (service === "check") Object.assign(schema, { oneOf: [{ required: ["url"] }, { required: ["watch_id"] }] });
  return schema;
}
