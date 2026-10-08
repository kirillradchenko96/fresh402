import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { type ServiceId, SERVICES, inputJsonSchema, ServiceError } from "./contracts";
import { createFresh402CdpFacilitator } from "./cdp";
import { digest } from "./extract";
import { analytics, type TrafficClass } from "./analytics";

export const PAY_TO = "0x58B4b483fBE31860335eCeB12CCCF4338b251085";
export const NETWORK: `${string}:${string}` = "eip155:8453";
export const TEST_BUYER = "0x493c114566f166241cF75B04526c46083045bF89";
export type Bindings = Env & { CDP_API_KEY_ID?: string; CDP_API_KEY_SECRET?: string };
export type FacilitatorFactory = (env: Bindings) => FacilitatorClient;
export const defaultFacilitator: FacilitatorFactory = env => {
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) throw new ServiceError("payment_unavailable", "Payment service is not configured.", 503);
  return createFresh402CdpFacilitator(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
};
export function paymentConfig(service: ServiceId, transport: "rest" | "mcp") {
  const spec = SERVICES[service];
  return {
    accepts: { scheme: "exact", price: spec.price, network: NETWORK as `${string}:${string}`, payTo: PAY_TO },
    description: spec.description, mimeType: "application/json", serviceName: "Fresh402 Web Intelligence",
    extensions: transport === "rest"
      ? declareDiscoveryExtension({ bodyType: "json", input: spec.example, inputSchema: inputJsonSchema(service) })
      : declareDiscoveryExtension({ toolName: spec.tool, description: spec.description, transport: "streamable-http", inputSchema: inputJsonSchema(service), example: spec.example }),
  };
}

/** Request-scoped SDK and hooks: no bindings, user state or promises shared across requests. */
export async function paymentServer(env: Bindings, service: ServiceId, transport: "rest" | "mcp", traffic: TrafficClass, factory: FacilitatorFactory) {
  const count = analytics(env.DB, transport, traffic);
  const upstream = factory(env);
  // SDKs may log thrown facilitator errors. Never propagate response bodies or
  // authenticated request details into those diagnostics.
  const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await operation(); }
    catch { throw new ServiceError("payment_unavailable", "Payment facilitator unavailable.", 503); }
  };
  const server = new x402ResourceServer({
    getSupported: () => safe(() => upstream.getSupported()),
    verify: (payload, requirements) => safe(() => upstream.verify(payload, requirements)),
    settle: (payload, requirements) => safe(() => upstream.settle(payload, requirements)),
  }).register(NETWORK, new ExactEvmScheme());
  let settled = false;
  server.onAfterVerify(async context => {
    // Dedupe the authorization identity, not its signature encoding or selected route.
    // This beta explicitly accepts USDC EIP-3009 authorizations (the default exact flow).
    const auth = context.paymentPayload.payload.authorization;
    if (!auth || typeof auth !== "object") return { abort: true, reason: "unsupported_authorization" };
    const fields = auth as Readonly<Record<string, unknown>>;
    if (typeof fields.from !== "string" || typeof fields.nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(fields.nonce)) return { abort: true, reason: "invalid_authorization" };
    const expiry = Number(fields.validBefore), now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + 86400) return { abort: true, reason: "authorization_expiry_out_of_range" };
    const claim = await digest(`${NETWORK}:${context.requirements.asset.toLowerCase()}:${fields.from.toLowerCase()}:${fields.nonce.toLowerCase()}`);
    const inserted = await env.DB.prepare("INSERT OR IGNORE INTO payment_claims(claim_hash, expires_at) VALUES (?, ?)").bind(claim, expiry + 300).run();
    if (!inserted.meta.changes) return { abort: true, reason: "payment_already_used", message: "Authorization already attempted; do not automatically sign a replacement after an uncertain settlement." };
    await count(service, "payment_verified");
  });
  server.onAfterSettle(async context => {
    if (!context.result.success) return;
    settled = true;
    try {
      const receipt = context.result;
      if (!receipt.transaction || !receipt.payer) return;
      const route = transport === "rest" ? SERVICES[service].path : `/mcp#${SERVICES[service].tool}`;
      const payer = receipt.payer.toLowerCase();
      const previous = await env.DB.prepare("SELECT 1 FROM payment_events WHERE lower(payer) = ? LIMIT 1").bind(payer).first();
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO payment_events(transaction_hash, payer, network, route, amount_atomic, is_test_buyer, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(receipt.transaction, payer, receipt.network, route, SERVICES[service].atomic, payer === TEST_BUYER.toLowerCase() ? 1 : 0, new Date().toISOString()).run();
      if (inserted.meta.changes) {
        await count(service, "payment_settled");
        if (previous) await count(service, "repeat_paid_call");
      }
    } catch { console.error("fresh402_settlement_accounting_failed"); }
  });
  await server.initialize();
  return { server, wasSettled: () => settled };
}
