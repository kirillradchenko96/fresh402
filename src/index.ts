import {
  McpServer,
  createMcpHandler,
} from "@modelcontextprotocol/server";

import {
  createPaymentWrapper,
} from "@x402/mcp";

import {
  ExactEvmScheme,
} from "@x402/evm/exact/server";

import { z } from "zod";
import { BodyReadError, readRequestBody } from "./body";

import { SignJWT, importJWK } from "jose";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import {
    x402ResourceServer,
} from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import {
  FRESH402_VERSION,
  NORMALIZER_VERSION,
  handleCoreRequest,
  type Fresh402CheckInput,
  type Fresh402RegisterInput,
} from "./freshness";

const coreHandler = {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    return handleCoreRequest(
      request,
      env,
    );
  },
} satisfies ExportedHandler<Env>;

const CDP_FACILITATOR_URL =
"https://api.cdp.coinbase.com/platform/v2/x402";

const CDP_FACILITATOR_HOST =
"api.cdp.coinbase.com";

function bytesToBase64Url(bytes: Uint8Array): string {
let binary = "";

for (const byte of bytes) {
binary += String.fromCharCode(byte);
}

return btoa(binary)
.replace(/\+/g, "-")
.replace(/\//g, "_")
.replace(/=+$/g, "");
}

function createNonce(): string {
const bytes = new Uint8Array(16);
crypto.getRandomValues(bytes);

return Array.from(bytes)
.map((byte) => byte.toString(16).padStart(2, "0"))
.join("");
}

async function generateCdpJwt(
apiKeyId: string,
apiKeySecret: string,
method: "GET" | "POST",
path: string,
): Promise<string> {
const cleanSecret = apiKeySecret.replace(/\s+/g, "");

let decoded: Uint8Array;

try {
const binary = atob(cleanSecret);
decoded = Uint8Array.from(
binary,
(char) => char.charCodeAt(0),
);
} catch {
throw new Error(
"CDP API key secret is not valid base64.",
);
}

// Fresh402 currently uses the Ed25519 CDP API key created in Portal.
if (decoded.length !== 64) {
throw new Error(
`Expected a 64-byte Ed25519 CDP secret, received ${decoded.length} bytes.`,
);
}

const seed = decoded.slice(0, 32);
const publicKey = decoded.slice(32);

const jwk = {
kty: "OKP",
crv: "Ed25519",
d: bytesToBase64Url(seed),
x: bytesToBase64Url(publicKey),
};

const signingKey = await importJWK(jwk, "EdDSA");

const now = Math.floor(Date.now() / 1000);

return new SignJWT({
sub: apiKeyId,
iss: "cdp",
uris: [
`${method} ${CDP_FACILITATOR_HOST}${path}`,
],
})
.setProtectedHeader({
alg: "EdDSA",
kid: apiKeyId,
typ: "JWT",
nonce: createNonce(),
})
.setIssuedAt(now)
.setNotBefore(now)
.setExpirationTime(now + 120)
.sign(signingKey);
}

function createFresh402CdpFacilitator(
apiKeyId: string,
apiKeySecret: string,
): HTTPFacilitatorClient {
const auth = async (
method: "GET" | "POST",
path: string,
): Promise<Record<string, string>> => ({
Authorization:
`Bearer ${await generateCdpJwt(
apiKeyId,
apiKeySecret,
method,
path,
)}`,
});

return new HTTPFacilitatorClient({
url: CDP_FACILITATOR_URL,

createAuthHeaders: async () => {
const [verify, settle, supported] =
await Promise.all([
auth(
"POST",
"/platform/v2/x402/verify",
),
auth(
"POST",
"/platform/v2/x402/settle",
),
auth(
"GET",
"/platform/v2/x402/supported",
),
]);

return {
verify,
settle,
supported,
};
},
});
}
const PAY_TO = "0x58B4b483fBE31860335eCeB12CCCF4338b251085";

type Fresh402Bindings = Env & {
CDP_API_KEY_ID?: string;
CDP_API_KEY_SECRET?: string;
};

type Fresh402AppEnv = {
Bindings: Fresh402Bindings;
Variables: {
coreRequest: Request;
};
};

const app = new Hono<Fresh402AppEnv>();

// Preserve an untouched copy of the request body for our existing handler.
app.use("*", async (c, next) => {
c.set("coreRequest", c.req.raw.clone());
await next();
});

let x402GatePromise:
| Promise<ReturnType<typeof paymentMiddleware>>
| undefined;


const TEST_BUYER_ADDRESS =
  "0x493c114566f166241cF75B04526c46083045bF89";

const CHECK_PRICE_ATOMIC = 5000;
const USDC_DECIMALS = 6;

type SettlementForLogging = {
  success?: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
};


type PaymentStatsRow = {
  paid_calls: number | string | null;
  revenue_atomic: number | string | null;
  external_paid_calls: number | string | null;
  external_revenue_atomic: number | string | null;
  last_paid_at: string | null;
  last_external_paid_at: string | null;
};

function decodeX402HeaderForLogging<T>(
  value: string,
): T | null {
  try {
    let normalized = value
      .trim()
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    while (normalized.length % 4) {
      normalized += "=";
    }

    return JSON.parse(atob(normalized)) as T;
  } catch {
    return null;
  }
}

async function recordPaymentEvent(
  db: Fresh402Bindings["DB"],
  settlementHeader: string,
): Promise<void> {
  const settlement =
    decodeX402HeaderForLogging<SettlementForLogging>(
      settlementHeader,
    );

  if (
    !settlement?.success ||
    !settlement.transaction ||
    !settlement.network ||
    !settlement.payer
  ) {
    return;
  }

  const isTestBuyer =
    settlement.payer.toLowerCase() ===
    TEST_BUYER_ADDRESS.toLowerCase()
      ? 1
      : 0;

  await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events
       (
         transaction_hash,
         payer,
         network,
         route,
         amount_atomic,
         is_test_buyer,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      settlement.transaction,
      settlement.payer,
      settlement.network,
      "/v1/check",
      CHECK_PRICE_ATOMIC,
      isTestBuyer,
      new Date().toISOString(),
    )
    .run();
}

async function getX402Gate(
  env: Fresh402Bindings,
) {
  const apiKeyId =
    env.CDP_API_KEY_ID;

  const apiKeySecret =
    env.CDP_API_KEY_SECRET;

  if (!apiKeyId || !apiKeySecret) {
    throw new Error(
      "Fresh402 payment service is missing CDP credentials.",
    );
  }

  if (!x402GatePromise) {
    x402GatePromise =
      (async () => {
        const facilitatorClient =
          createFresh402CdpFacilitator(
            apiKeyId,
            apiKeySecret,
          );

        const x402Server =
          new x402ResourceServer(
            facilitatorClient,
          );

        registerExactEvmScheme(
          x402Server,
        );

        await x402Server.initialize();

        return paymentMiddleware(
          {
            "POST /v1/check": {
              accepts: [
                {
                  scheme: "exact",
                  price: "$0.005",
                  network:
                    "eip155:8453",
                  payTo: PAY_TO,
                },
              ],

              description:
                "Cheap freshness oracle for AI agents. Register a baseline for free, then check whether scoped HTML, JSON, or text changed. Supports caller hashes, deterministic diffs, shared freshness cache, noise filtering, and HTTP revalidation.",

              mimeType:
                "application/json",

              serviceName:
                "Fresh402 Freshness Oracle",

              tags: [
                "url-freshness",
                "page-change-detection",
                "website-monitoring",
                "json-monitoring",
                "semantic-diff",
                "ai-agents",
              ],

              extensions: {
                ...declareDiscoveryExtension({
                  bodyType:
                    "json",

                  input: {
                    watch_id:
                      "w_0123456789abcdef0123456789abcdef",
                    max_age_seconds:
                      300,
                    include_diff:
                      true,
                  },

                  inputSchema: {
                    type: "object",

                    properties: {
                      watch_id: {
                        type: "string",
                        description:
                          "Persistent watch ID returned by the free /v1/register endpoint or MCP fresh402_register tool.",
                      },

                      url: {
                        type: "string",
                        format: "uri",
                        description:
                          "Absolute HTTP or HTTPS URL. Use either url or watch_id.",
                      },

                      previous_hash: {
                        type: "string",
                        pattern:
                          "^[a-fA-F0-9]{64}$",
                        description:
                          "Optional Fresh402 SHA-256 fingerprint to compare against.",
                      },

                      selector: {
                        type: "string",
                        description:
                          "Optional CSS selector limiting HTML monitoring to a specific part of the page.",
                      },

                      ignore_selectors: {
                        type: "array",
                        items: {
                          type: "string",
                        },
                        maxItems: 20,
                        description:
                          "Optional CSS selectors removed before HTML fingerprinting.",
                      },

                      ignore_json_paths: {
                        type: "array",
                        items: {
                          type: "string",
                        },
                        maxItems: 20,
                        description:
                          "Optional JSON Pointer paths to ignore before canonical JSON fingerprinting. Wildcard * is supported.",
                      },

                      max_age_seconds: {
                        type: "integer",
                        minimum: 0,
                        maximum: 86400,
                        description:
                          "Accept a shared Fresh402 result this many seconds old instead of refetching.",
                      },

                      include_diff: {
                        type: "boolean",
                        description:
                          "Include a compact deterministic diff when comparable prior content is available.",
                      },
                    },

                    oneOf: [
                      {
                        required: [
                          "watch_id",
                        ],
                      },
                      {
                        required: [
                          "url",
                        ],
                      },
                    ],

                    additionalProperties:
                      false,
                  },

                  output: {
                    example: {
                      watch_id:
                        "w_0123456789abcdef0123456789abcdef",
                      url:
                        "https://example.com/",
                      changed: true,
                      comparison_source:
                        "stored_watch",
                      hash:
                        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                      content_kind:
                        "html",
                      cached: false,
                      cache_status:
                        "miss",
                      network_fetched:
                        true,
                      snapshot_saved:
                        true,
                      normalizer_version:
                        NORMALIZER_VERSION,
                      diff: {
                        available:
                          true,
                        changed:
                          true,
                        change_ratio:
                          0.12,
                        removed_excerpt:
                          "Pro $25/month",
                        added_excerpt:
                          "Pro $29/month",
                      },
                    },

                    schema: {
                      type: "object",
                      properties: {
                        watch_id: {
                          type: "string",
                        },
                        url: {
                          type: "string",
                        },
                        changed: {
                          type: "boolean",
                        },
                        hash: {
                          type: "string",
                        },
                        content_kind: {
                          type: "string",
                        },
                        cached: {
                          type: "boolean",
                        },
                        cache_status: {
                          type: "string",
                        },
                        network_fetched: {
                          type: "boolean",
                        },
                        snapshot_saved: {
                          type: "boolean",
                        },
                        normalizer_version: {
                          type: "integer",
                        },
                        diff: {
                          type: "object",
                        },
                      },
                    },
                  },
                }),
              },
            },
          },

          x402Server,
          undefined,
          undefined,
          false,
        );
      })().catch(
        (error) => {
          x402GatePromise =
            undefined;
          throw error;
        },
      );
  }

  return x402GatePromise;
}


type Fresh402McpRequest = {
  method?: string;
  params?: {
    name?: string;
    _meta?: Record<string, unknown>;
  };
};

type Fresh402McpEnvelope = {
  result?: {
    _meta?: Record<string, unknown>;
  };
};

let fresh402McpHandlerPromise:
  | Promise<ReturnType<typeof createMcpHandler>>
  | undefined;


function extractMcpSettlement(
  text: string,
): SettlementForLogging | null {
  const candidates: unknown[] = [];

  try {
    candidates.push(JSON.parse(text));
  } catch {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice(5).trim();

      if (!payload || payload === "[DONE]") {
        continue;
      }

      try {
        candidates.push(JSON.parse(payload));
      } catch {
        // Ignore non-JSON SSE data.
      }
    }
  }

  for (const candidate of candidates) {
    const envelope =
      candidate as Fresh402McpEnvelope;

    const settlement =
      envelope?.result?._meta?.[
        "x402/payment-response"
      ] as SettlementForLogging | undefined;

    if (
      settlement?.success &&
      settlement.transaction &&
      settlement.network &&
      settlement.payer
    ) {
      return settlement;
    }
  }

  return null;
}


async function recordMcpPaymentEvent(
  db: Fresh402Bindings["DB"],
  request: Request,
  response: Response,
): Promise<void> {
  if (request.method !== "POST") {
    return;
  }

  let rpc:
    | Fresh402McpRequest
    | undefined;

  try {
    rpc =
      (await request.json()) as
        Fresh402McpRequest;
  } catch {
    return;
  }

  if (
    rpc.method !== "tools/call" ||
    rpc.params?.name !== "fresh402_check"
  ) {
    return;
  }

  const payment =
    rpc.params?._meta?.[
      "x402/payment"
    ];

  if (!payment) {
    // Unpaid discovery/call attempt.
    return;
  }

  const settlement =
    extractMcpSettlement(
      await response.text(),
    );

  if (!settlement) {
    return;
  }

  const isTestBuyer =
    settlement.payer!.toLowerCase() ===
    TEST_BUYER_ADDRESS.toLowerCase()
      ? 1
      : 0;

  await db
    .prepare(
      `INSERT OR IGNORE INTO payment_events
       (
         transaction_hash,
         payer,
         network,
         route,
         amount_atomic,
         is_test_buyer,
         created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      settlement.transaction,
      settlement.payer,
      settlement.network,
      "/mcp#fresh402_check",
      CHECK_PRICE_ATOMIC,
      isTestBuyer,
      new Date().toISOString(),
    )
    .run();
}


async function runFresh402CoreForMcp(
  path: "/v1/register" | "/v1/check",
  input:
    | Fresh402RegisterInput
    | Fresh402CheckInput,
  env: Fresh402Bindings,
): Promise<Record<string, unknown>> {
  const internalRequest =
    new Request(
      `https://fresh402.internal${path}`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body:
          JSON.stringify(input),
      },
    );

  const response =
    await coreHandler.fetch(
      internalRequest as Parameters<
        typeof coreHandler.fetch
      >[0],
      env,
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `Fresh402 core returned HTTP ${response.status}: ${text}`,
    );
  }

  try {
    return JSON.parse(text) as
      Record<string, unknown>;
  } catch {
    throw new Error(
      "Fresh402 core returned invalid JSON.",
    );
  }
}


async function getFresh402McpHandler(
  env: Fresh402Bindings,
) {
  const apiKeyId =
    env.CDP_API_KEY_ID;

  const apiKeySecret =
    env.CDP_API_KEY_SECRET;

  if (!apiKeyId || !apiKeySecret) {
    throw new Error(
      "Fresh402 MCP payment service is missing CDP credentials.",
    );
  }

  if (!fresh402McpHandlerPromise) {
    fresh402McpHandlerPromise =
      (async () => {
        const facilitatorClient =
          createFresh402CdpFacilitator(
            apiKeyId,
            apiKeySecret,
          );

        const resourceServer =
          new x402ResourceServer(
            facilitatorClient,
          );

        resourceServer.register(
          "eip155:*",
          new ExactEvmScheme(),
        );

        await resourceServer.initialize();

        const accepts =
          await resourceServer
            .buildPaymentRequirements({
              scheme: "exact",
              network: "eip155:8453",
              payTo: PAY_TO,
              price: "$0.005",
              extra: {
                name: "USD Coin",
                version: "2",
              },
            });

        const paid =
          createPaymentWrapper(
            resourceServer,
            {
              accepts,

              resource: {
                url:
                  "https://fresh402.kirilllabs.workers.dev/mcp",

                description:
                  "Cheap freshness oracle for AI agents. Register a baseline for free, then cheaply decide whether scoped HTML, JSON, or text changed before spending browser or LLM resources.",

                mimeType:
                  "application/json",

                serviceName:
                  "Fresh402 Freshness Oracle",

                tags: [
                  "url-freshness",
                  "page-change-detection",
                  "website-monitoring",
                  "json-monitoring",
                  "semantic-diff",
                  "ai-agents",
                ],
              },

              extensions:
                declareDiscoveryExtension({
                  toolName:
                    "fresh402_check",

                  description:
                    "Check whether a registered URL or scoped web resource materially changed. Supports watch IDs, caller fingerprints, CSS scoping, JSON ignore paths, shared freshness caching, deterministic inline diffs, and conditional HTTP revalidation. Costs $0.005 USDC.",

                  transport:
                    "streamable-http",

                  inputSchema: {
                    type: "object",

                    properties: {
                      watch_id: {
                        type: "string",
                        description:
                          "Watch ID returned by the free fresh402_register tool.",
                      },

                      url: {
                        type: "string",
                        format: "uri",
                        description:
                          "Absolute HTTP or HTTPS URL. Use either url or watch_id.",
                      },

                      previous_hash: {
                        type: "string",
                        pattern:
                          "^[a-fA-F0-9]{64}$",
                        description:
                          "Optional Fresh402 fingerprint to compare against.",
                      },

                      selector: {
                        type: "string",
                        description:
                          "Optional CSS selector limiting monitoring to part of an HTML page.",
                      },

                      ignore_selectors: {
                        type: "array",
                        items: {
                          type: "string",
                        },
                        maxItems: 20,
                      },

                      ignore_json_paths: {
                        type: "array",
                        items: {
                          type: "string",
                        },
                        maxItems: 20,
                        description:
                          "JSON Pointer paths to ignore before canonical JSON fingerprinting. Wildcard * is supported.",
                      },

                      max_age_seconds: {
                        type: "integer",
                        minimum: 0,
                        maximum: 86400,
                        description:
                          "Accept shared Fresh402 state this many seconds old instead of refetching.",
                      },

                      include_diff: {
                        type: "boolean",
                      },
                    },

                    oneOf: [
                      {
                        required: [
                          "watch_id",
                        ],
                      },
                      {
                        required: [
                          "url",
                        ],
                      },
                    ],

                    additionalProperties:
                      false,
                  },

                  example: {
                    watch_id:
                      "w_0123456789abcdef0123456789abcdef",
                    max_age_seconds:
                      300,
                    include_diff:
                      true,
                  },
                }),
            },
          );

        return createMcpHandler(
          () => {
            const server =
              new McpServer({
                name: "Fresh402",
                version:
                  FRESH402_VERSION,
              });

            server.registerTool(
              "fresh402_register",
              {
                description:
                  "Create or retrieve a free Fresh402 baseline and persistent watch_id. Existing baselines are returned without refetching, so this tool cannot be used as a free repeated change check.",

                inputSchema:
                  z.object({
                    url:
                      z.string().url(),

                    selector:
                      z.string()
                        .min(1)
                        .max(256)
                        .optional(),

                    ignore_selectors:
                      z.array(
                        z.string()
                          .min(1)
                          .max(256),
                      )
                        .max(20)
                        .optional(),

                    ignore_json_paths:
                      z.array(
                        z.string()
                          .min(1)
                          .max(256),
                      )
                        .max(20)
                        .optional(),
                  }),
              },

              async (args) => {
                const result =
                  await runFresh402CoreForMcp(
                    "/v1/register",
                    args as Fresh402RegisterInput,
                    env,
                  );

                return {
                  content: [
                    {
                      type:
                        "text" as const,
                      text:
                        JSON.stringify(
                          result,
                        ),
                    },
                  ],

                  structuredContent:
                    result,
                };
              },
            );

            const paidFresh402Check =
              paid(
                async (
                  args:
                    Fresh402CheckInput,
                ) => {
                  const result =
                    await runFresh402CoreForMcp(
                      "/v1/check",
                      args,
                      env,
                    );

                  return {
                    content: [
                      {
                        type:
                          "text" as const,
                        text:
                          JSON.stringify(
                            result,
                          ),
                      },
                    ],

                    structuredContent:
                      result,
                  };
                },
              );

            server.registerTool(
              "fresh402_check",
              {
                description:
                  "Check whether a registered or caller-supplied web resource changed. Costs $0.005 USDC. Use fresh402_register first for a free baseline when starting a new watch.",

                inputSchema:
                  z.object({
                    watch_id:
                      z.string()
                        .regex(
                          /^w_[a-f0-9]{32}$/,
                        )
                        .optional(),

                    url:
                      z.string()
                        .url()
                        .optional(),

                    previous_hash:
                      z.string()
                        .regex(
                          /^[a-fA-F0-9]{64}$/,
                        )
                        .optional(),

                    selector:
                      z.string()
                        .min(1)
                        .max(256)
                        .optional(),

                    ignore_selectors:
                      z.array(
                        z.string()
                          .min(1)
                          .max(256),
                      )
                        .max(20)
                        .optional(),

                    ignore_json_paths:
                      z.array(
                        z.string()
                          .min(1)
                          .max(256),
                      )
                        .max(20)
                        .optional(),

                    max_age_seconds:
                      z.number()
                        .int()
                        .min(0)
                        .max(86400)
                        .optional(),

                    include_diff:
                      z.boolean()
                        .optional(),
                  }),
              },

              async (
                args,
                ctx,
              ) => {
                const legacyExtra = {
                  _meta:
                    ctx.mcpReq._meta,

                  signal:
                    ctx.mcpReq.signal,

                  requestId:
                    ctx.mcpReq.id,
                } as Parameters<
                  typeof paidFresh402Check
                >[1];

                const paidArgs: Record<string, unknown> = {
                  ...args,
                };

                return paidFresh402Check(
                  paidArgs,
                  legacyExtra,
                );
              },
            );

            return server;
          },
        );
      })().catch(
        (error) => {
          fresh402McpHandlerPromise =
            undefined;

          throw error;
        },
      );
  }

  return fresh402McpHandlerPromise;
}


app.all("/mcp", async (c) => {
  const originalRequest =
    c.req.raw;

  const accountingRequest =
    originalRequest.clone();

  const mcpHandler =
    await getFresh402McpHandler(
      c.env,
    );

  const response =
    await mcpHandler.fetch(
      originalRequest,
    );

  try {
    // Clone so accounting never consumes the
    // actual MCP response body.
    await recordMcpPaymentEvent(
      c.env.DB,
      accountingRequest,
      response.clone(),
    );
  } catch (error) {
    // Analytics must never break a valid MCP call.
    console.error(
      "Fresh402 MCP payment logging failed:",
      error,
    );
  }

  return response;
});


app.get("/.well-known/glama.json", (c) => {
  return c.json({"$schema":"https://glama.ai/mcp/schemas/connector.json","claim":"glama_claim_TphUzhTwuiiTc3VXeWc1uMARmUyUI2zV"});
});
app.get("/v1/stats", async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT
         COUNT(*) AS paid_calls,
         COALESCE(SUM(amount_atomic), 0) AS revenue_atomic,
         COALESCE(
           SUM(
             CASE
               WHEN is_test_buyer = 0 THEN 1
               ELSE 0
             END
           ),
           0
         ) AS external_paid_calls,
         COALESCE(
           SUM(
             CASE
               WHEN is_test_buyer = 0
               THEN amount_atomic
               ELSE 0
             END
           ),
           0
         ) AS external_revenue_atomic,
         MAX(created_at) AS last_paid_at,
         MAX(
           CASE
             WHEN is_test_buyer = 0
             THEN created_at
             ELSE NULL
           END
         ) AS last_external_paid_at
       FROM payment_events`,
    )
    .first<PaymentStatsRow>();

  const paidCalls =
    Number(row?.paid_calls ?? 0);

  const revenueAtomic =
    Number(row?.revenue_atomic ?? 0);

  const externalPaidCalls =
    Number(row?.external_paid_calls ?? 0);

  const externalRevenueAtomic =
    Number(row?.external_revenue_atomic ?? 0);

  return c.json({
    paid_calls: paidCalls,
    test_paid_calls:
      paidCalls - externalPaidCalls,
    external_paid_calls:
      externalPaidCalls,

    revenue_usdc:
      revenueAtomic / 10 ** USDC_DECIMALS,

    external_revenue_usdc:
      externalRevenueAtomic /
      10 ** USDC_DECIMALS,

    last_paid_at:
      row?.last_paid_at ?? null,

    last_external_paid_at:
      row?.last_external_paid_at ?? null,
  });
});

app.use("/v1/check", async (c, next) => {
  const paymentGate =
    await getX402Gate(c.env);

  const result =
    await paymentGate(c, next);

  const response =
    result instanceof Response
      ? result
      : c.res;

  const settlementHeader =
    response.headers.get("payment-response");

  if (
    response.ok &&
    settlementHeader
  ) {
    try {
      await recordPaymentEvent(
        c.env.DB,
        settlementHeader,
      );
    } catch (error) {
      // Analytics must never break a successfully
      // paid customer request.
      console.error(
        "Fresh402 payment logging failed:",
        error,
      );
    }
  }

  return result;
});
app.all("*", (c) => {
    return coreHandler.fetch(
        c.get("coreRequest") as Parameters<
            typeof coreHandler.fetch
        >[0],
        c.env,
    );
});

export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      try {
        // Bound the body before Hono, payment/MCP parsing or any request.clone().
        const body = await readRequestBody(request);
        request = new Request(request, { body });
      } catch (error) {
        if (!(error instanceof BodyReadError)) throw error;
        return Response.json({ error: error.code, message: error.message }, { status: error.status });
      }
    }
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Fresh402Bindings>;

