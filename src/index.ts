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
import { acquireCapacity, prepareOperation, errorResponse, type PreparedOperation } from "./operations";
import { analytics, trafficClass } from "./analytics";
import { stats } from "./stats";

async function commitResult(prepared: PreparedOperation): Promise<Response> {
  if (!prepared.commit) return prepared.response;
  try { await prepared.commit(); return prepared.response; }
  catch {
    console.error("fresh402_paid_persistence_failed");
    const body = await prepared.response.json<Record<string, unknown>>();
    return Response.json({ ...body, snapshot_saved: false, persistence_error: "Snapshot could not be saved. The returned result is valid." });
  }
}
async function toolResult(response: Response) {
  const result = await response.json<Record<string, unknown>>();
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result, ...(response.ok ? {} : { isError: true }) };
}

/** Dependency injection is code-only for tests; no environment variable can bypass billing. */
export function createApp(facilitatorFactory: FacilitatorFactory = defaultFacilitator) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.onError(() => errorResponse(new ServiceError("service_unavailable", "Service temporarily unavailable.", 503)));
  app.use("*", async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Cache-Control", "no-store");
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
  app.post("/v1/register", async c => {
    const release = await acquireCapacity(c.env.DB, await c.req.raw.clone().json().catch(() => null));
    try {
      const response = await handleCoreRequest(c.req.raw, c.env);
      if (response.ok) {
        const body = await response.clone().json<{ created: boolean }>();
        await analytics(c.env.DB, "rest", trafficClass(c.req.raw))("register", body.created ? "registration_created" : "registration_existing");
      }
      return response;
    } finally { await release(); }
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
      const payment = await paymentServer(c.env, service, "rest", trafficClass(c.req.raw), facilitatorFactory);
      const gate = paymentMiddleware({ [`POST ${SERVICES[service].path}`]: paymentConfig(service, "rest") }, payment.server, undefined, undefined, false);
      let prepared: PreparedOperation | undefined, release: (() => Promise<void>) | undefined;
      try {
        const result = await gate(c, async () => {
          release = await acquireCapacity(c.env.DB, parsed.data);
          prepared = await prepareOperation(service, parsed.data, c.env);
          // SDK consumes the response body before settlement. Keep the original
          // available to report persistence failures after a confirmed charge.
          c.res = prepared.response.clone();
        });
        let response = result instanceof Response ? result : c.res;
        if (response.status === 402 && !attempted) await count(service, "initial_402");
        if (response.ok && payment.wasSettled() && prepared) {
          const committed = await commitResult(prepared);
          if (committed !== prepared.response) response = new Response(committed.body, { status: committed.status, headers: response.headers });
          await count(service, "paid_result");
        } else if (prepared) await count(service, "operation_failed");
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
      }, async args => {
        let release: (() => Promise<void>) | undefined;
        try {
          release = await acquireCapacity(c.env.DB, args);
          const response = await handleCoreRequest(new Request("https://fresh402.internal/v1/register", { method: "POST", body: JSON.stringify(args) }), c.env);
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
          let release: (() => Promise<void>) | undefined;
          try {
            const attempted = Boolean(ctx.mcpReq._meta?.["x402/payment"]);
            if (attempted) await count(service, "payment_attempt");
            const payment = await paymentServer(c.env, service, "mcp", trafficClass(c.req.raw), facilitatorFactory);
            const config = paymentConfig(service, "mcp");
            const accepts = await payment.server.buildPaymentRequirements(config.accepts);
            let prepared: PreparedOperation | undefined;
            const paid = createPaymentWrapper(payment.server, {
              accepts, extensions: config.extensions,
              resource: { url: `${new URL(c.req.url).origin}/mcp#${SERVICES[service].tool}`, description: config.description, mimeType: config.mimeType },
            })(async () => {
              release = await acquireCapacity(c.env.DB, args);
              prepared = await prepareOperation(service, args, c.env);
              return toolResult(prepared.response.clone());
            });
            const result = await paid(args, { _meta: ctx.mcpReq._meta, signal: ctx.mcpReq.signal, requestId: ctx.mcpReq.id });
            if (result.isError && !attempted) await count(service, "initial_402");
            if (!result.isError && payment.wasSettled() && prepared) {
              const committed = await commitResult(prepared);
              const body = await toolResult(committed);
              await count(service, "paid_result");
              return { ...result, ...body };
            }
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
  if (request.method === "POST") {
    try { request = new Request(request, { body: await readRequestBody(request) }); }
    catch (error) {
      if (!(error instanceof BodyReadError)) throw error;
      return errorResponse(error);
    }
  }
  return application.fetch(request, env, ctx);
}
export default { fetch: boundedFetch } satisfies ExportedHandler<Bindings>;
