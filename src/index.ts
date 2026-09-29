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

import { SignJWT, importJWK } from "jose";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import {
    x402ResourceServer,
} from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
const NORMALIZER_VERSION = 2;

interface ResourceRow {
    url: string;
    hash: string;
    normalized_content: string;
    created_at: string;
    updated_at: string;
    check_count: number;
    raw_hash: string | null;
    normalizer_version: number;
}

interface SnapshotRow {
    id: number;
    hash: string;
    raw_hash: string | null;
    normalized_content: string;
    created_at: string;
    normalizer_version: number;
}

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "content-type": "application/json; charset=UTF-8",
        },
    });
}

async function sha256(text: string): Promise<string> {
    const bytes = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);

    return Array.from(new Uint8Array(hashBuffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function normalizeRawHtml(html: string): string {
    return html
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
}

function htmlToText(html: string): string {
    return html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/\s+/g, " ")
        .trim();
}

async function normalizeContent(html: string): Promise<string> {
    const removeHandler = {
        element(element: Element) {
            element.remove();
        },
    };

    const selectors = [
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "canvas",
        "nav",
        "footer",
        "aside",
        "[hidden]",
        '[aria-hidden="true"]',
        '[class*="cookie"]',
        '[id*="cookie"]',
        '[class*="consent"]',
        '[id*="consent"]',
        '[class*="advertisement"]',
        '[id*="advertisement"]',
    ];

    let rewriter = new HTMLRewriter();

    for (const selector of selectors) {
        rewriter = rewriter.on(selector, removeHandler);
    }

    const cleanedHtml = await rewriter
        .transform(
            new Response(html, {
                headers: {
                    "content-type": "text/html; charset=UTF-8",
                },
            }),
        )
        .text();

    return htmlToText(cleanedHtml);
}

function isLocalDevelopmentRequest(requestUrl: URL): boolean {
    return (
        requestUrl.hostname === "127.0.0.1" ||
        requestUrl.hostname === "localhost" ||
        requestUrl.hostname === "::1"
    );
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split(".").map(Number);

    if (
        parts.length !== 4 ||
        parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
        return false;
    }

    const [a, b] = parts;

    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;

    return false;
}

function isPrivateHostname(hostname: string): boolean {
    const host = hostname
        .toLowerCase()
        .replace(/^\[/, "")
        .replace(/\]$/, "");

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.endsWith(".lan")
    ) {
        return true;
    }

    if (isPrivateIpv4(host)) {
        return true;
    }

    if (
        host === "::1" ||
        host === "::" ||
        host.startsWith("fc") ||
        host.startsWith("fd") ||
        host.startsWith("fe8") ||
        host.startsWith("fe9") ||
        host.startsWith("fea") ||
        host.startsWith("feb")
    ) {
        return true;
    }

    if (host.startsWith("::ffff:")) {
        return isPrivateIpv4(host.slice(7));
    }

    return false;
}

function validateTarget(target: URL, allowPrivate: boolean): string | null {
    if (target.protocol !== "http:" && target.protocol !== "https:") {
        return "Only HTTP and HTTPS URLs are supported.";
    }

    if (target.username || target.password) {
        return "URLs containing usernames or passwords are not supported.";
    }

    const allowedPorts = new Set(["", "80", "443", "8080", "8443"]);

    if (!allowPrivate && !allowedPorts.has(target.port)) {
        return "This port is not allowed.";
    }

    if (!allowPrivate && isPrivateHostname(target.hostname)) {
        return "Private, local, and internal network targets are not allowed.";
    }

    return null;
}

function canonicalizeUrl(target: URL): string {
    const canonical = new URL(target.toString());
    canonical.hash = "";
    return canonical.toString();
}

class TargetNotAllowedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TargetNotAllowedError";
    }
}

const MAX_REDIRECTS = 5;

async function fetchTarget(
    target: URL,
    allowPrivate: boolean,
): Promise<Response> {
    let current = new URL(target.toString());

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const validationError = validateTarget(current, allowPrivate);

        if (validationError) {
            throw new TargetNotAllowedError(validationError);
        }

        const controller = new AbortController();

        const timeout = setTimeout(() => {
            controller.abort();
        }, 10_000);

        let response: Response;

        try {
            response = await fetch(current.toString(), {
                redirect: "manual",
                signal: controller.signal,
                headers: {
                    "user-agent": "Fresh402/0.5.1",
                    accept: "text/html,text/plain;q=0.9,*/*;q=0.1",
                },
            });
        } finally {
            clearTimeout(timeout);
        }

        const redirectStatuses = new Set([301, 302, 303, 307, 308]);

        if (!redirectStatuses.has(response.status)) {
            return response;
        }

        const location = response.headers.get("location");

        if (!location) {
            return response;
        }

        if (hop >= MAX_REDIRECTS) {
            throw new TargetNotAllowedError(
                `Too many redirects. Maximum allowed is ${MAX_REDIRECTS}.`,
            );
        }

        const next = new URL(location, current);

        if (
            current.protocol === "https:" &&
            next.protocol === "http:"
        ) {
            throw new TargetNotAllowedError(
                "HTTPS to HTTP redirects are not allowed.",
            );
        }

        const nextValidationError = validateTarget(next, allowPrivate);

        if (nextValidationError) {
            throw new TargetNotAllowedError(
                `Redirect target rejected: ${nextValidationError}`,
            );
        }

        current = next;
    }

    throw new TargetNotAllowedError("Redirect limit exceeded.");
}

const coreHandler = {
    async fetch(request, env): Promise<Response> {
        const requestUrl = new URL(request.url);
        const allowPrivate = isLocalDevelopmentRequest(requestUrl);

        if (request.method === "GET" && requestUrl.pathname === "/") {
            return json({
                name: "Fresh402",
                status: "ok",
                version: "1.0.1",
                normalizer_version: NORMALIZER_VERSION,
                endpoints: {
                    check: "POST /v1/check",
                    history: "GET /v1/history?url=https://example.com",
                    diff: "GET /v1/diff?url=https://example.com",
                    stats: "GET /v1/stats",
                    mcp: "POST /mcp",
                },
            });
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/history") {
            const targetUrl = requestUrl.searchParams.get("url");

            if (!targetUrl) {
                return json(
                    {
                        error: "missing_url",
                        message: "Provide ?url=https://example.com",
                    },
                    400,
                );
            }

            const snapshots = await env.DB.prepare(
                `
                SELECT
                    id,
                    url,
                    hash,
                    raw_hash,
                    created_at,
                    normalizer_version
                FROM snapshots
                WHERE url = ?
                  AND normalizer_version = ?
                ORDER BY id DESC
                LIMIT 50
                `,
            )
                .bind(targetUrl, NORMALIZER_VERSION)
                .all();

            return json({
                url: targetUrl,
                normalizer_version: NORMALIZER_VERSION,
                count: snapshots.results.length,
                snapshots: snapshots.results,
            });
        }

        if (request.method === "GET" && requestUrl.pathname === "/v1/diff") {
            const targetUrl = requestUrl.searchParams.get("url");

            if (!targetUrl) {
                return json(
                    {
                        error: "missing_url",
                        message: "Provide ?url=https://example.com",
                    },
                    400,
                );
            }

            const result = await env.DB.prepare(
                `
                SELECT
                    id,
                    hash,
                    raw_hash,
                    normalized_content,
                    created_at,
                    normalizer_version
                FROM snapshots
                WHERE url = ?
                  AND normalizer_version = ?
                ORDER BY id DESC
                LIMIT 2
                `,
            )
                .bind(targetUrl, NORMALIZER_VERSION)
                .all<SnapshotRow>();

            if (result.results.length < 2) {
                return json({
                    url: targetUrl,
                    changed: false,
                    message: "At least two comparable snapshots are required.",
                    snapshots_available: result.results.length,
                    normalizer_version: NORMALIZER_VERSION,
                });
            }

            const after = result.results[0];
            const before = result.results[1];

            const oldText = before.normalized_content;
            const newText = after.normalized_content;

            let prefix = 0;

            while (
                prefix < oldText.length &&
                prefix < newText.length &&
                oldText[prefix] === newText[prefix]
            ) {
                prefix++;
            }

            let suffix = 0;

            while (
                suffix < oldText.length - prefix &&
                suffix < newText.length - prefix &&
                oldText[oldText.length - 1 - suffix] ===
                    newText[newText.length - 1 - suffix]
            ) {
                suffix++;
            }

            return json({
                url: targetUrl,
                changed: before.hash !== after.hash,
                normalizer_version: NORMALIZER_VERSION,

                from: {
                    snapshot_id: before.id,
                    hash: before.hash,
                    created_at: before.created_at,
                },

                to: {
                    snapshot_id: after.id,
                    hash: after.hash,
                    created_at: after.created_at,
                },

                removed: oldText.slice(prefix, oldText.length - suffix),
                added: newText.slice(prefix, newText.length - suffix),

                before: oldText,
                after: newText,
            });
        }

        if (request.method === "POST" && requestUrl.pathname === "/v1/check") {
            let body: { url?: string };

            try {
                body = (await request.json()) as { url?: string };
            } catch {
                return json(
                    {
                        error: "invalid_json",
                        message: "Request body must be valid JSON.",
                    },
                    400,
                );
            }

            if (!body.url) {
                return json(
                    {
                        error: "missing_url",
                        message: 'Provide a URL, for example: {"url":"https://example.com"}',
                    },
                    400,
                );
            }

            let target: URL;

            try {
                target = new URL(body.url);
            } catch {
                return json(
                    {
                        error: "invalid_url",
                        message: "The supplied URL is invalid.",
                    },
                    400,
                );
            }

            const validationError = validateTarget(target, allowPrivate);

            if (validationError) {
                return json(
                    {
                        error: "target_not_allowed",
                        message: validationError,
                    },
                    400,
                );
            }

            const canonicalUrl = canonicalizeUrl(target);
            target = new URL(canonicalUrl);

            try {
                const startedAt = Date.now();
                const response = await fetchTarget(target, allowPrivate);

                if (!response.ok) {
                    return json(
                        {
                            error: "upstream_error",
                            message: `Target returned HTTP ${response.status}.`,
                            status: response.status,
                        },
                        502,
                    );
                }

                const contentType = response.headers.get("content-type") ?? "";

                if (
                    !contentType.includes("text/html") &&
                    !contentType.includes("text/plain")
                ) {
                    return json(
                        {
                            error: "unsupported_content_type",
                            message: `Unsupported content type: ${contentType || "unknown"}`,
                        },
                        415,
                    );
                }

                const contentLengthHeader = response.headers.get("content-length");

                if (
                    contentLengthHeader &&
                    Number(contentLengthHeader) > 5_000_000
                ) {
                    return json(
                        {
                            error: "content_too_large",
                            message: "Target content exceeds the 5 MB MVP limit.",
                        },
                        413,
                    );
                }

                const html = await response.text();

                if (html.length > 5_000_000) {
                    return json(
                        {
                            error: "content_too_large",
                            message: "Target content exceeds the 5 MB MVP limit.",
                        },
                        413,
                    );
                }

                const rawNormalized = normalizeRawHtml(html);
                const normalized = contentType.includes("text/html")
                    ? await normalizeContent(html)
                    : html.replace(/\s+/g, " ").trim();

                const rawHash = await sha256(rawNormalized);
                const contentHash = await sha256(normalized);
                const now = new Date().toISOString();

                const existing = await env.DB.prepare(
                    `
                    SELECT
                        url,
                        hash,
                        normalized_content,
                        created_at,
                        updated_at,
                        check_count,
                        raw_hash,
                        normalizer_version
                    FROM resources
                    WHERE url = ?
                    `,
                )
                    .bind(canonicalUrl)
                    .first<ResourceRow>();

                if (!existing) {
                    await env.DB.batch([
                        env.DB.prepare(
                            `
                            INSERT INTO resources (
                                url,
                                hash,
                                normalized_content,
                                created_at,
                                updated_at,
                                check_count,
                                raw_hash,
                                normalizer_version
                            )
                            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                            `,
                        ).bind(
                            canonicalUrl,
                            contentHash,
                            normalized,
                            now,
                            now,
                            rawHash,
                            NORMALIZER_VERSION,
                        ),

                        env.DB.prepare(
                            `
                            INSERT INTO snapshots (
                                url,
                                hash,
                                normalized_content,
                                created_at,
                                raw_hash,
                                normalizer_version
                            )
                            VALUES (?, ?, ?, ?, ?, ?)
                            `,
                        ).bind(
                            canonicalUrl,
                            contentHash,
                            normalized,
                            now,
                            rawHash,
                            NORMALIZER_VERSION,
                        ),
                    ]);

                    return json({
                        url: canonicalUrl,
                        final_url: response.url,
                        first_seen: true,
                        rebaselined: false,
                        raw_changed: false,
                        changed: false,
                        noise_detected: false,
                        hash: contentHash,
                        raw_hash: rawHash,
                        check_count: 1,
                        snapshot_saved: true,
                        normalizer_version: NORMALIZER_VERSION,
                        content_length: normalized.length,
                        fetch_time_ms: Date.now() - startedAt,
                        checked_at: now,
                    });
                }

                const newCheckCount = existing.check_count + 1;

                if (existing.normalizer_version !== NORMALIZER_VERSION) {
                    await env.DB.batch([
                        env.DB.prepare(
                            `
                            UPDATE resources
                            SET
                                hash = ?,
                                normalized_content = ?,
                                updated_at = ?,
                                check_count = ?,
                                raw_hash = ?,
                                normalizer_version = ?
                            WHERE url = ?
                            `,
                        ).bind(
                            contentHash,
                            normalized,
                            now,
                            newCheckCount,
                            rawHash,
                            NORMALIZER_VERSION,
                            canonicalUrl,
                        ),

                        env.DB.prepare(
                            `
                            INSERT INTO snapshots (
                                url,
                                hash,
                                normalized_content,
                                created_at,
                                raw_hash,
                                normalizer_version
                            )
                            VALUES (?, ?, ?, ?, ?, ?)
                            `,
                        ).bind(
                            canonicalUrl,
                            contentHash,
                            normalized,
                            now,
                            rawHash,
                            NORMALIZER_VERSION,
                        ),
                    ]);

                    return json({
                        url: canonicalUrl,
                        final_url: response.url,
                        first_seen: false,
                        rebaselined: true,
                        raw_changed: false,
                        changed: false,
                        noise_detected: false,
                        hash: contentHash,
                        raw_hash: rawHash,
                        check_count: newCheckCount,
                        snapshot_saved: true,
                        normalizer_version: NORMALIZER_VERSION,
                        message: "Baseline refreshed because the normalizer changed.",
                        content_length: normalized.length,
                        fetch_time_ms: Date.now() - startedAt,
                        checked_at: now,
                    });
                }

                const changed = existing.hash !== contentHash;
                const rawChanged =
                    existing.raw_hash !== null
                        ? existing.raw_hash !== rawHash
                        : null;

                const noiseDetected = rawChanged === true && !changed;

                if (changed) {
                    await env.DB.batch([
                        env.DB.prepare(
                            `
                            UPDATE resources
                            SET
                                hash = ?,
                                normalized_content = ?,
                                updated_at = ?,
                                check_count = ?,
                                raw_hash = ?
                            WHERE url = ?
                            `,
                        ).bind(
                            contentHash,
                            normalized,
                            now,
                            newCheckCount,
                            rawHash,
                            canonicalUrl,
                        ),

                        env.DB.prepare(
                            `
                            INSERT INTO snapshots (
                                url,
                                hash,
                                normalized_content,
                                created_at,
                                raw_hash,
                                normalizer_version
                            )
                            VALUES (?, ?, ?, ?, ?, ?)
                            `,
                        ).bind(
                            canonicalUrl,
                            contentHash,
                            normalized,
                            now,
                            rawHash,
                            NORMALIZER_VERSION,
                        ),
                    ]);
                } else {
                    await env.DB.prepare(
                        `
                        UPDATE resources
                        SET
                            updated_at = ?,
                            check_count = ?,
                            raw_hash = ?
                        WHERE url = ?
                        `,
                    )
                        .bind(
                            now,
                            newCheckCount,
                            rawHash,
                            canonicalUrl,
                        )
                        .run();
                }

                return json({
                    url: canonicalUrl,
                    final_url: response.url,
                    first_seen: false,
                    rebaselined: false,
                    raw_changed: rawChanged,
                    changed,
                    noise_detected: noiseDetected,
                    previous_hash: existing.hash,
                    hash: contentHash,
                    previous_raw_hash: existing.raw_hash,
                    raw_hash: rawHash,
                    check_count: newCheckCount,
                    first_seen_at: existing.created_at,
                    snapshot_saved: changed,
                    normalizer_version: NORMALIZER_VERSION,
                    content_length: normalized.length,
                    fetch_time_ms: Date.now() - startedAt,
                    checked_at: now,
                });
            } catch (error) {
                console.error(error);

                if (error instanceof TargetNotAllowedError) {
                    return json(
                        {
                            error: "target_not_allowed",
                            message: error.message,
                        },
                        400,
                    );
                }

                return json(
                    {
                        error: "check_failed",
                        message:
                            error instanceof Error
                                ? error.message
                                : "Unable to check the target.",
                    },
                    500,
                );
            }
        }

        return json(
            {
                error: "not_found",
            },
            404,
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

const CHECK_PRICE_ATOMIC = 1000;
const USDC_DECIMALS = 6;

type SettlementForLogging = {
  success?: boolean;
  transaction?: string;
  network?: string;
  payer?: string;
};

type PaymentPayloadForLogging = {
  accepted?: {
    amount?: string;
  };
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
  paymentSignature: string | undefined,
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

  const payment = paymentSignature
    ? decodeX402HeaderForLogging<PaymentPayloadForLogging>(
        paymentSignature,
      )
    : null;

  const rawAmount = payment?.accepted?.amount;

  const amountAtomic =
    rawAmount && /^\d+$/.test(rawAmount)
      ? Number(rawAmount)
      : CHECK_PRICE_ATOMIC;

  if (
    !Number.isSafeInteger(amountAtomic) ||
    amountAtomic <= 0
  ) {
    console.error(
      "Fresh402 payment log skipped: invalid amount",
      rawAmount,
    );
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
      amountAtomic,
      isTestBuyer,
      new Date().toISOString(),
    )
    .run();
}

async function getX402Gate(env: Fresh402Bindings) {
const apiKeyId = env.CDP_API_KEY_ID;
const apiKeySecret = env.CDP_API_KEY_SECRET;

if (!apiKeyId || !apiKeySecret) {
throw new Error(
"Fresh402 payment service is missing CDP credentials.",
);
}

if (!x402GatePromise) {
x402GatePromise = (async () => {
const facilitatorClient =
createFresh402CdpFacilitator(
apiKeyId,
apiKeySecret,
);

const x402Server =
new x402ResourceServer(facilitatorClient);

registerExactEvmScheme(x402Server);

await x402Server.initialize();

return paymentMiddleware(
{
"POST /v1/check": {
accepts: [
{
scheme: "exact",
price: "$0.001",
network: "eip155:8453",
payTo: PAY_TO,
},
],
description:
"Detect meaningful content changes in any URL, monitor website and web page changes, check page freshness, filter common boilerplate/noise, and return a change signal for AI agents.",
mimeType: "application/json",
serviceName: "Fresh402 Web Change Monitor",
tags: [
"website-monitoring",
"page-change-detection",
"url-freshness",
"semantic-diff",
"ai-agents",
],
extensions: {
...declareDiscoveryExtension({
bodyType: "json",
input: {
url: "https://example.com",
},
inputSchema: {
type: "object",
properties: {
url: {
type: "string",
format: "uri",
description:
"Absolute HTTP or HTTPS URL to monitor. Send the same URL again to detect meaningful page changes since the previous Fresh402 snapshot.",
},
},
required: ["url"],
additionalProperties: false,
},
output: {
example: {
url: "https://example.com/",
final_url: "https://example.com/",
first_seen: false,
rebaselined: false,
raw_changed: false,
changed: false,
noise_detected: false,
check_count: 3,
snapshot_saved: false,
normalizer_version: 2,
content_length: 182,
fetch_time_ms: 307,
checked_at:
"2026-09-29T01:35:57.534Z",
},
schema: {
type: "object",
properties: {
url: {
type: "string",
},
final_url: {
type: "string",
},
first_seen: {
type: "boolean",
},
rebaselined: {
type: "boolean",
},
raw_changed: {
type: "boolean",
},
changed: {
type: "boolean",
},
noise_detected: {
type: "boolean",
},
check_count: {
type: "integer",
},
snapshot_saved: {
type: "boolean",
},
normalizer_version: {
type: "integer",
},
content_length: {
type: "integer",
},
fetch_time_ms: {
type: "integer",
},
checked_at: {
type: "string",
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
})().catch((error) => {
x402GatePromise = undefined;
throw error;
});
}

return x402GatePromise;
}


type Fresh402McpPaymentPayload = {
  accepted?: {
    amount?: string;
  };
};

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
    ] as Fresh402McpPaymentPayload | undefined;

  if (!payment) {
    // Unpaid discovery/call attempt.
    return;
  }

  const rawAmount =
    payment.accepted?.amount;

  const amountAtomic =
    rawAmount && /^\d+$/.test(rawAmount)
      ? Number(rawAmount)
      : CHECK_PRICE_ATOMIC;

  if (
    !Number.isSafeInteger(amountAtomic) ||
    amountAtomic <= 0
  ) {
    console.error(
      "Fresh402 MCP payment log skipped: invalid amount",
      rawAmount,
    );

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
      amountAtomic,
      isTestBuyer,
      new Date().toISOString(),
    )
    .run();
}


async function runFresh402CheckForMcp(
  url: string,
  env: Fresh402Bindings,
): Promise<Record<string, unknown>> {
  const internalRequest =
    new Request(
      "https://fresh402.internal/v1/check",
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json",
        },
        body: JSON.stringify({
          url,
        }),
      },
    );

  // Call the existing Fresh402 core directly.
  // Payment is handled by the MCP wrapper, so this
  // intentionally bypasses the HTTP x402 middleware.
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
      `Fresh402 check failed with HTTP ${response.status}: ${text}`,
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
              price: "$0.001",
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
                  "mcp://tool/fresh402_check",

                description:
                  "Detect meaningful content changes in a URL while filtering common page noise.",

                mimeType:
                  "application/json",

                serviceName:
                  "Fresh402 Web Change Monitor",

                tags: [
                  "website-monitoring",
                  "page-change-detection",
                  "url-freshness",
                  "semantic-diff",
                  "ai-agents",
                ],
              },

              extensions:
                declareDiscoveryExtension({
                  toolName:
                    "fresh402_check",

                  description:
                    "Detect meaningful content changes in any URL, monitor website and web page changes, check page freshness, filter common boilerplate/noise, and return a change signal for AI agents.",

                  transport:
                    "streamable-http",

                  inputSchema: {
                    type: "object",

                    properties: {
                      url: {
                        type: "string",
                        format: "uri",

                        description:
                          "Absolute HTTP or HTTPS URL to monitor. Send the same URL again to detect meaningful changes since the previous Fresh402 snapshot.",
                      },
                    },

                    required: [
                      "url",
                    ],

                    additionalProperties:
                      false,
                  },

                  example: {
                    url:
                      "https://example.com",
                  },
                }),
            },
          );

        return createMcpHandler(
          () => {
            const server =
              new McpServer({
                name: "Fresh402",
                version: "1.0.1",
              });

            server.registerTool(
              "fresh402_check",
              {
                description:
                  "Detect meaningful web page changes and page freshness while filtering common boilerplate/noise. Costs $0.001 USDC per call.",

                inputSchema:
                  z.object({
                    url:
                      z.string().url(),
                  }),
              },

              paid(
                async ({
                  url,
                }: {
                  url: string;
                }) => {
                  const result =
                    await runFresh402CheckForMcp(
                      url,
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
              ),
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
        c.req.header("payment-signature"),
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

export default app;
