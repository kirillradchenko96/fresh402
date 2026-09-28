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

export default {
    async fetch(request, env): Promise<Response> {
        const requestUrl = new URL(request.url);
        const allowPrivate = isLocalDevelopmentRequest(requestUrl);

        if (request.method === "GET" && requestUrl.pathname === "/") {
            return json({
                name: "Fresh402",
                status: "ok",
                version: "0.5.1",
                normalizer_version: NORMALIZER_VERSION,
                endpoints: {
                    check: "POST /v1/check",
                    history: "GET /v1/history?url=https://example.com",
                    diff: "GET /v1/diff?url=https://example.com",
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
