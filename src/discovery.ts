export function buildOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Fresh402 API",
      contact: { url: "https://github.com/kirillradchenko96/fresh402/issues" },
      version: "1.1.1",
      description:
        "On-demand website and API freshness checks for AI agents. " +
        "Register a baseline for free, then pay $0.005 USDC " +
        "per check using x402 on Base mainnet.",
      "x-guidance":
        "First call POST /v1/register with the target URL to obtain " +
        "a free persistent watch_id. Then call POST /v1/check using " +
        "that watch_id or a URL. Each check costs $0.005 USDC " +
        "using x402 on Base mainnet.",
    },
    servers: [{ url: origin }],
    paths: {
      "/v1/register": {
        post: {
          operationId: "fresh402Register",
          security: [],
          summary: "Register a free baseline",
          description:
            "Creates or retrieves a persistent watch ID. " +
            "Existing registrations do not refetch the target.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    selector: { type: "string" },
                    ignore_selectors: {
                      type: "array",
                      items: { type: "string" },
                    },
                    ignore_json_paths: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
                example: {
                  url: "https://example.com/",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Baseline registration result",
            },
            "400": {
              description: "Invalid registration request",
            },
          },
        },
      },
      "/v1/check": {
        post: {
          operationId: "fresh402Check",
          summary: "Check whether a web resource changed",
          description:
            "Paid freshness check with optional caching, " +
            "noise filtering and deterministic diffs. " +
            "Costs $0.005 USDC on Base mainnet (eip155:8453).",
          "x-payment-info": {
            protocols: [{ x402: {} }],
            price: {
              mode: "fixed",
              currency: "USD",
              amount: "0.005",
            },
          },
          security: [{ x402Payment: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    watch_id: {
                      type: "string",
                      description:
                        "ID returned by the free register endpoint.",
                    },
                    url: {
                      type: "string",
                      format: "uri",
                    },
                    previous_hash: {
                      type: "string",
                      pattern: "^[a-fA-F0-9]{64}$",
                    },
                    selector: { type: "string" },
                    ignore_selectors: {
                      type: "array",
                      items: { type: "string" },
                    },
                    ignore_json_paths: {
                      type: "array",
                      items: { type: "string" },
                    },
                    max_age_seconds: {
                      type: "integer",
                      minimum: 0,
                      maximum: 86400,
                    },
                    include_diff: { type: "boolean" },
                  },
                  anyOf: [
                    { required: ["watch_id"] },
                    { required: ["url"] },
                  ],
                },
                example: {
                  url: "https://example.com/",
                  include_diff: true,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Successful paid freshness check",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      watch_id: { type: "string" },
                      changed: { type: "boolean" },
                      hash: { type: "string" },
                      content_kind: { type: "string" },
                      cached: { type: "boolean" },
                      diff: { type: "object" },
                    },
                  },
                },
              },
            },
            "402": {
              description: "x402 payment required",
              headers: {
                "PAYMENT-REQUIRED": {
                  description: "Encoded x402 payment requirements",
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        x402Payment: {
          type: "apiKey",
          in: "header",
          name: "PAYMENT-SIGNATURE",
          description:
            "x402 v2 payment payload. " +
            "Obtain requirements from the HTTP 402 response.",
        },
      },
    },
  };
}

export function buildX402Manifest(origin: string) {
  return {
    version: 1,
    resources: [`${origin}/v1/check`],
  };
}