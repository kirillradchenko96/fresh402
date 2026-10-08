import { BodyReadError, BODY_TIMEOUT_MS, cancelBody, readBoundedBody } from "./body";
import { assertPublicDns } from "./dns";
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5_000_000;

export class TargetNotAllowedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TargetNotAllowedError";
    }
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split(".").map(Number);

    if (
        parts.length !== 4 ||
        parts.some(
            (part) =>
                !Number.isInteger(part) ||
                part < 0 ||
                part > 255,
        )
    ) {
        return false;
    }

    const [a, b, c] = parts;

    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;

    return false;
}

function isPrivateHostname(hostname: string): boolean {
    const host = hostname
        .toLowerCase()
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .replace(/\.$/, "");

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.endsWith(".lan")
        || !host.includes(".") && !host.includes(":")
    ) {
        return true;
    }

    if (isPrivateIpv4(host)) {
        return true;
    }

    if (
        host.includes(":") && (
            host === "::1" ||
            host === "::" ||
            host.startsWith("fc") ||
            host.startsWith("fd") ||
            host.startsWith("fe8") ||
            host.startsWith("fe9") ||
            host.startsWith("fea") ||
            host.startsWith("feb")
        )
    ) {
        return true;
    }

    if (host.startsWith("::ffff:")) {
        // URL canonicalizes IPv4-mapped addresses to two hexadecimal words.
        const words = host.slice(7).split(":");
        if (words.length === 2) {
            const high = parseInt(words[0], 16);
            const low = parseInt(words[1], 16);
            return isPrivateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
        }
        return isPrivateIpv4(host.slice(7));
    }

    // Only globally routable IPv6 unicast; reject transition, multicast,
    // documentation and other special-purpose ranges conservatively.
    if (host.includes(":")) return !/^[23][0-9a-f]{3}:/.test(host) || host.startsWith("2001:db8:") || host.startsWith("2001:0:") || host.startsWith("2002:");

    return false;
}

export function validateTarget(
    target: URL,
    allowPrivate: boolean,
): string | null {
    if (
        target.protocol !== "http:" &&
        target.protocol !== "https:"
    ) {
        return "Only HTTP and HTTPS URLs are supported.";
    }

    if (target.username || target.password) {
        return "URLs containing usernames or passwords are not supported.";
    }

    const sensitiveQueryNames = new Set([
        "access_token",
        "api_key",
        "apikey",
        "auth",
        "authorization",
        "token",
        "signature",
        "x-amz-signature",
        "x-goog-signature",
    ]);

    for (const name of target.searchParams.keys()) {
        if (sensitiveQueryNames.has(name.toLowerCase())) {
            return "URLs containing likely credentials in query parameters are not supported.";
        }
    }

    const allowedPorts = new Set([
        "",
        "80",
        "443",
        "8080",
        "8443",
    ]);

    if (!allowPrivate && !allowedPorts.has(target.port)) {
        return "This port is not allowed.";
    }

    if (
        !allowPrivate &&
        isPrivateHostname(target.hostname)
    ) {
        return "Private, local, and internal network targets are not allowed.";
    }

    return null;
}

export async function fetchTarget(
    target: URL,
    allowPrivate: boolean,
    validators?: {
        etag?: string | null;
        last_modified?: string | null;
    },
): Promise<{ response: Response; body: string; finalUrl: string }> {
    let current = new URL(target.toString());
    const controller = new AbortController();
    // One deadline includes every redirect, response headers and streamed body.
    const timeout = setTimeout(() => controller.abort(new BodyReadError(
        "upstream_timeout", "Target response timed out.", 504,
    )), BODY_TIMEOUT_MS);

    try {
        for (
            let hop = 0;
            hop <= MAX_REDIRECTS;
            hop++
        ) {
            const validationError =
                validateTarget(current, allowPrivate);

            if (validationError) {
                throw new TargetNotAllowedError(
                    validationError,
                );
            }

            if (!allowPrivate) await assertPublicDns(current.hostname, controller.signal, isPrivateHostname);

            const headers: Record<string, string> = {
                "user-agent": "Fresh402/2.0.0-beta.1",
                accept:
                    "text/html,application/json,text/plain,application/*+json;q=0.9,text/*;q=0.8,*/*;q=0.1",
            };

            if (validators?.etag) {
                headers["if-none-match"] =
                    validators.etag;
            }

            if (validators?.last_modified) {
                headers["if-modified-since"] =
                    validators.last_modified;
            }

            const response = await fetch(current.toString(), {
                redirect: "manual",
                signal: controller.signal,
                headers,
            });

            const redirectStatuses =
                new Set([
                    301,
                    302,
                    303,
                    307,
                    308,
                ]);

            if (
                !redirectStatuses.has(
                    response.status,
                )
            ) {
                if (!response.ok) {
                    cancelBody(response.body);
                    return { response, body: "", finalUrl: current.toString() };
                }
                const bytes = await readBoundedBody(response, MAX_BODY_BYTES, new BodyReadError(
                    "content_too_large",
                    `Target content exceeds the ${MAX_BODY_BYTES / 1_000_000} MB limit.`,
                    413,
                ), controller.signal);
                return { response, body: new TextDecoder().decode(bytes), finalUrl: current.toString() };
            }

            const location =
                response.headers.get("location");

            cancelBody(response.body);

            if (!location) {
                return { response, body: "", finalUrl: current.toString() };
            }

            if (hop >= MAX_REDIRECTS) {
                throw new TargetNotAllowedError(
                    `Too many redirects. Maximum allowed is ${MAX_REDIRECTS}.`,
                );
            }

            const next =
                new URL(location, current);

            if (
                current.protocol === "https:" &&
                next.protocol === "http:"
            ) {
                throw new TargetNotAllowedError(
                    "HTTPS to HTTP redirects are not allowed.",
                );
            }

            const nextValidationError =
                validateTarget(
                    next,
                    allowPrivate,
                );

            if (nextValidationError) {
                throw new TargetNotAllowedError(
                    `Redirect target rejected: ${nextValidationError}`,
                );
            }

            current = next;
        }

        throw new TargetNotAllowedError(
            "Redirect limit exceeded.",
        );
    } catch (error) {
        if (controller.signal.aborted) throw controller.signal.reason;
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

