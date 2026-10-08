import { x402ResourceServer, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { type ServiceId, SERVICES, inputJsonSchema, ServiceError } from "./contracts";
import { createFresh402CdpFacilitator } from "./cdp";
import { PaymentJournal } from "./payment-journal";
import { analytics, type TrafficClass } from "./analytics";

export const PAY_TO = "0x58B4b483fBE31860335eCeB12CCCF4338b251085";
export const NETWORK: `${string}:${string}` = "eip155:8453";
export const TEST_BUYER = "0x493c114566f166241cF75B04526c46083045bF89";
export type Bindings = Env & { CDP_API_KEY_ID?: string; CDP_API_KEY_SECRET?: string; STAGING_ACCESS_TOKEN?: string };
export type FacilitatorFactory = (env: Bindings) => FacilitatorClient;
export const defaultFacilitator: FacilitatorFactory = env => {
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) throw new ServiceError("payment_unavailable", "Payment service is not configured.", 503);
  return createFresh402CdpFacilitator(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET);
};
export function paymentConfig(service: ServiceId, transport: "rest" | "mcp", discover = true) {
  const spec = SERVICES[service];
  return {
    accepts: { scheme: "exact", price: spec.price, network: NETWORK as `${string}:${string}`, payTo: PAY_TO },
    description: spec.description, mimeType: "application/json", serviceName: "Fresh402 Web Intelligence",
    extensions: !discover ? {} : transport === "rest"
      ? declareDiscoveryExtension({ bodyType: "json", input: spec.example, inputSchema: inputJsonSchema(service) })
      : declareDiscoveryExtension({ toolName: spec.tool, description: spec.description, transport: "streamable-http", inputSchema: inputJsonSchema(service), example: spec.example }),
  };
}

/** Request-scoped SDK and hooks: no bindings, user state or promises shared across requests. */
export async function paymentServer(env: Bindings, service: ServiceId, transport: "rest" | "mcp", traffic: TrafficClass, factory: FacilitatorFactory, journal: PaymentJournal) {
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
    verify: async (payload, requirements) => {
      const result = await safe(() => upstream.verify(payload, requirements));
      if (!result.isValid) return result;
      // SDK hook exceptions are swallowed. The durable reservation must gate verify here.
      if (!await journal.reserve(payload, requirements)) return { isValid: false, invalidReason: "payment_already_used" };
      await count(service, "payment_verified");
      return result;
    },
    settle: (payload, requirements) => safe(() => journal.settle(() => upstream.settle(payload, requirements))),
  }).register(NETWORK, new ExactEvmScheme());
  server.onAfterSettle(async context => {
    if (context.result.success) await count(service, "payment_settled");
  });
  await server.initialize();
  return { server, wasSettled: () => journal.wasSettled() };
}
