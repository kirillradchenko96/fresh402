import { Hono } from "hono";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { createPaymentWrapper } from "@x402/mcp";
import { paymentMiddleware } from "@x402/hono";
import { z } from "zod";
import { BodyReadError, readRequestBody, MAX_REQUEST_BODY_BYTES } from "./body";
import { handleCoreRequest, FRESH402_VERSION } from "./freshness";
import { buildOpenApiDocument, buildX402Manifest } from "./discovery";
import { SERVICES, type ServiceId, registerSchema, ServiceError } from "./contracts";
import { paymentConfig, paymentServer, defaultFacilitator, type Bindings, type FacilitatorFactory } from "./payments";
import { admitOperation, admittedBindings, prepareOperation, errorResponse, type PreparedOperation, type CapacityRelease } from "./operations";
import { analytics, trafficClass } from "./analytics";
import { stats } from "./stats";
import { PaymentJournal, validateRecoveryToken } from "./payment-journal";
import { cleanupTemporaryData } from "./maintenance";
import {capacityConfiguration} from './capacity-config';
export {Fresh402Egress} from './container-egress';

async function toolResult(response: Response) {
  const result = await response.json<Record<string, unknown>>();
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result, ...(response.ok ? {} : { isError: true }) };
}

function stagingAccessDenied(request: Request, env: Bindings): boolean {
  if (env.ENVIRONMENT !== "staging") return false;
  const expected = env.STAGING_ACCESS_TOKEN, supplied = request.headers.get("authorization")?.replace(/^Bearer /, "");
  return !expected || expected.length < 32 || !supplied || supplied.length !== expected.length || !crypto.subtle.timingSafeEqual(new TextEncoder().encode(supplied), new TextEncoder().encode(expected));
}

/** Dependency injection is code-only for tests; no environment variable can bypass billing. */
export function createApp(facilitatorFactory: FacilitatorFactory = defaultFacilitator) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.onError(error => errorResponse(error));
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
    if (c.env.ENVIRONMENT === "staging") {
      if (stagingAccessDenied(c.req.raw, c.env)) return c.json({ error: "staging_access_required" }, 403);
      if (c.req.path.startsWith("/.well-known/")) return c.json({ error: "not_found" }, 404);
    }
    {
      const allowed = await c.env.REQUEST_LIMITER.limit({ key: `${c.req.method === "POST" ? "request" : "read"}:${c.req.header("cf-connecting-ip") ?? "unknown"}` });
      if (!allowed.success) { c.header("Retry-After", "60"); return c.json({ error: "request_rate_limited" }, 429); }
    }
    await next();
  });
  app.get("/openapi.json", c => {
    c.executionCtx.waitUntil(analytics(c.env.DB, "rest", trafficClass(c.req.raw))("discovery", "documentation"));
    return c.json(buildOpenApiDocument(new URL(c.req.url).origin));
  });
  app.get("/.well-known/x402", c => {
    c.executionCtx.waitUntil(analytics(c.env.DB, "rest", trafficClass(c.req.raw))("discovery", "discovery"));
    return c.json(buildX402Manifest(new URL(c.req.url).origin));
  });
  app.get("/.well-known/glama.json", c => c.json({ "$schema": "https://glama.ai/mcp/schemas/connector.json", claim: "glama_claim_TphUzhTwuiiTc3VXeWc1uMARmUyUI2zV" }));
  app.get("/v1/stats", c => stats(c.env.DB));
  app.get('/__staging/egress',async c=>{
    if(c.env.ENVIRONMENT!=='staging')return c.json({error:'not_found'},404);
    const config=capacityConfiguration(c.env);
    if(!c.env.EGRESS_CONTAINER)return c.json({enabled:false,pool_size:config.poolSize,running_instances:0});
    const instances=[];for(let instance=0;instance<config.poolSize;instance++)instances.push({instance,metrics:await c.env.EGRESS_CONTAINER.getByName('fresh402-egress-'+instance).diagnostics()});
    return c.json({enabled:config.enabled,pool_size:config.poolSize,instances});
  });
  app.post('/__staging/egress/stop',async c=>{
    if(c.env.ENVIRONMENT!=='staging')return c.json({error:'not_found'},404);
    const config=capacityConfiguration(c.env);
    if(c.env.EGRESS_CONTAINER)for(let instance=0;instance<config.poolSize;instance++)await c.env.EGRESS_CONTAINER.getByName('fresh402-egress-'+instance).shutdown();
    return c.json({stopped:true,pool_size:config.poolSize});
  });
  app.post("/v1/register", async c => {
    const input=await c.req.raw.clone().json().catch(()=>null);let release:CapacityRelease|undefined;
    try {
      const response = await handleCoreRequest(c.req.raw,{...c.env,beforeRegisterFetch:async()=>{release=await admitOperation(c.env,input,true);return admittedBindings(c.env,release);}});
      if (response.ok) {
        const body = await response.clone().json<{ created: boolean }>();
        await analytics(c.env.DB, "rest", trafficClass(c.req.raw))("register", body.created ? "registration_created" : "registration_existing");
      }
      return response;
    } finally { if(release)await release(); }
  });
  for (const service of Object.keys(SERVICES) as ServiceId[]) {
    app.post(SERVICES[service].path, async c => {
      let input: unknown;
      try { input = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
      const parsed = SERVICES[service].schema.safeParse(input);
      if (!parsed.success) return c.json({ error: "invalid_parameters", issues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })) }, 400);
      const count = analytics(c.env.DB, "rest", trafficClass(c.req.raw));
      const attempted = Boolean(c.req.header("payment-signature") || c.req.header("x-payment"));
      if (attempted) await count(service, "payment_attempt");
      const journal = new PaymentJournal(c.env.DB, service, "rest", parsed.data, validateRecoveryToken(c.req.header("x-fresh402-recovery-token")));
      const header = c.req.header("payment-signature") || c.req.header("x-payment");
      let payload;
      try { if (header) payload = JSON.parse(atob(header)); } catch { /* SDK reports malformed payment. */ }
      const recovered = payload ? await journal.recover(payload) : undefined;
      if (recovered) { recovered.response.headers.set("payment-response", btoa(JSON.stringify(recovered.receipt))); return recovered.response; }
      const payment = await paymentServer(c.env, service, "rest", trafficClass(c.req.raw), facilitatorFactory, journal);
      const gate = paymentMiddleware({ [`POST ${SERVICES[service].path}`]: paymentConfig(service, "rest", c.env.ENVIRONMENT !== "staging") }, payment.server, undefined, undefined, false);
      let prepared: PreparedOperation | undefined, release: CapacityRelease | undefined;
      try {
        const result = await gate(c, async () => {
          try {
            release = await admitOperation(c.env, parsed.data);
            prepared = await prepareOperation(service, parsed.data, { ...admittedBindings(c.env,release), requestSignal: c.req.raw.signal });
            await journal.stage(prepared, release.owner);
          }catch(error){await journal.failPreparation();throw error;}
          // SDK consumes the response body before settlement. Keep the original
          // available to report persistence failures after a confirmed charge.
          c.res = prepared.response.clone();
        });
        let response = result instanceof Response ? result : c.res;
        if(payment.wasAdmissionRejected())response=errorResponse(new ServiceError('payment_capacity_exceeded','Verified payment admission is exhausted. Retry later with the original authorization.',429));
        if (response.status === 402 && !attempted) await count(service, "initial_402");
        if (response.ok && payment.wasSettled() && prepared) {
          const committed = await journal.paidResponse();
          if (committed) response = new Response(committed.body, { status: committed.status, headers: response.headers });
          await count(service, "paid_result");
        } else if (journal.wasAttempted()) response = errorResponse(new ServiceError("settlement_pending", "Settlement requires reconciliation. Retry only with the original recovery token and payment; do not sign a replacement.", 503));
        else if (prepared) await count(service, "operation_failed");
        c.res = response;
        return response;
      } finally { if (release) await release(); }
    });
  }
  app.all("/mcp", async c => {
    const origin = c.req.header("origin");
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "origin_not_allowed" }, 403);
    const count = analytics(c.env.DB, "mcp", trafficClass(c.req.raw));
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "Fresh402", version: FRESH402_VERSION });
      server.registerTool("fresh402_register", {
        description: "Create or retrieve a free persistent baseline. Existing registrations never refetch the target. No JavaScript execution.", inputSchema: registerSchema,
      }, async (args, ctx) => {
        let release: CapacityRelease | undefined;
        try {
          const response = await handleCoreRequest(new Request("https://fresh402.internal/v1/register", { method: "POST", body: JSON.stringify(args) }), { ...c.env, requestSignal: ctx.mcpReq.signal,beforeRegisterFetch:async()=>{release=await admitOperation(c.env,args,true);return admittedBindings(c.env,release);} });
          if (response.ok) {
            const body = await response.clone().json<{ created: boolean }>();
            await count("register", body.created ? "registration_created" : "registration_existing");
          }
          return toolResult(response);
        } catch (error) { return toolResult(errorResponse(error)); }
        finally { if (release) await release(); }
      });
      for (const service of Object.keys(SERVICES) as ServiceId[]) {
        server.registerTool(SERVICES[service].tool, {
          description: SERVICES[service].description, inputSchema: SERVICES[service].schema as z.ZodType<Record<string, unknown>>,
        }, async (args, ctx) => {
          let release: CapacityRelease | undefined;
          try {
            const attempted = Boolean(ctx.mcpReq._meta?.["x402/payment"]);
            if (attempted) await count(service, "payment_attempt");
            const journal = new PaymentJournal(c.env.DB, service, "mcp", args, validateRecoveryToken(ctx.mcpReq._meta?.["fresh402/recovery-token"]));
            const payload = ctx.mcpReq._meta?.["x402/payment"];
            const recovered = payload ? await journal.recover(payload as import("@x402/core/types").PaymentPayload) : undefined;
            if (recovered) return { ...await toolResult(recovered.response), _meta: { "x402/payment-response": recovered.receipt } };
            const payment = await paymentServer(c.env, service, "mcp", trafficClass(c.req.raw), facilitatorFactory, journal);
            const config = paymentConfig(service, "mcp", c.env.ENVIRONMENT !== "staging");
            const accepts = await payment.server.buildPaymentRequirements(config.accepts);
            let prepared: PreparedOperation | undefined;
            const paid = createPaymentWrapper(payment.server, {
              accepts, extensions: config.extensions,
              resource: { url: `${new URL(c.req.url).origin}/mcp#${SERVICES[service].tool}`, description: config.description, mimeType: config.mimeType },
            })(async () => {
              try {
                release = await admitOperation(c.env, args);
                prepared = await prepareOperation(service, args, { ...admittedBindings(c.env,release), requestSignal: ctx.mcpReq.signal });
                await journal.stage(prepared, release.owner);
              }catch(error){await journal.failPreparation();throw error;}
              return toolResult(prepared.response.clone());
            });
            const result = await paid(args, { _meta: ctx.mcpReq._meta, signal: ctx.mcpReq.signal, requestId: ctx.mcpReq.id });
            if(payment.wasAdmissionRejected())return toolResult(errorResponse(new ServiceError('payment_capacity_exceeded','Verified payment admission is exhausted. Retry later with the original authorization.',429)));
            if (result.isError && !attempted) await count(service, "initial_402");
            if (!result.isError && payment.wasSettled() && prepared) {
              const committed = await journal.paidResponse();
              const body = await toolResult(committed ?? prepared.response);
              await count(service, "paid_result");
              return { ...result, ...body };
            }
            if (journal.wasAttempted()) return toolResult(errorResponse(new ServiceError("settlement_pending", "Settlement requires reconciliation. Do not sign a replacement payment.", 503)));
            if (prepared) await count(service, "operation_failed");
            return result;
          } catch (error) { return toolResult(errorResponse(error)); }
          finally { if (release) await release(); }
        });
      }
      return server;
    }, { maxRequestBodySize: MAX_REQUEST_BODY_BYTES, maxSubscriptions: 0, onerror: () => console.error("fresh402_mcp_error") });
    if (c.req.method === "POST") {
      const rpc = await c.req.raw.clone().json<{ method?: string }>().catch(() => null);
      if (["initialize", "tools/list", "discovery"].includes(rpc?.method ?? "")) await count("discovery", "discovery");
    }
    return handler.fetch(c.req.raw);
  });
  app.all("*", async c => {
    if (c.req.path === "/" && c.req.method === "GET") c.executionCtx.waitUntil(analytics(c.env.DB, "rest", trafficClass(c.req.raw))("discovery", "discovery"));
    return handleCoreRequest(c.req.raw, c.env);
  });
  return app;
}
const app = createApp();
export async function boundedFetch(request: Request, env: Bindings, ctx: ExecutionContext, application = app): Promise<Response> {
  // Authenticate before allocating or waiting for an attacker-controlled body.
  if (stagingAccessDenied(request, env)) return Response.json({ error: "staging_access_required" }, { status: 403, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  if (request.method === "POST") {
    try { request = new Request(request, { body: await readRequestBody(request) }); }
    catch (error) {
      if (!(error instanceof BodyReadError)) throw error;
      return errorResponse(error);
    }
  }
  return application.fetch(request, env, ctx);
}
export default { fetch: boundedFetch, async scheduled(_event, env) { await cleanupTemporaryData(env.DB); } } satisfies ExportedHandler<Bindings>;
