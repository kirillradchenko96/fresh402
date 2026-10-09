import { BodyReadError, BODY_TIMEOUT_MS, cancelBody, readBoundedBody } from "./body";
import { assertPublicDns } from "./dns";
import { isPublicAddress, isServiceHostname, validateHttpsUrl } from "./network-policy.mjs";
import {fetchViaGateway,type EgressGateway} from "./egress";
const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 5_000_000;

export class TargetNotAllowedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TargetNotAllowedError";
    }
}

function isPrivateIpv4(hostname: string): boolean { return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !isPublicAddress(hostname); }

function isPrivateHostname(hostname: string): boolean {
    const host = hostname
        .toLowerCase()
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .replace(/\.$/, "");

    if (isServiceHostname(host)) return true;

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

    if (host.includes(":")) return !isPublicAddress(host);

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
    if(!allowPrivate&&(target.protocol!=="https:"||target.port!==""))return "Public URLs require HTTPS on port 443.";

    if (target.username || target.password) {
        return "URLs containing usernames or passwords are not supported.";
    }
    if (!allowPrivate && isServiceHostname(target.hostname)) return "Fresh402 and privileged service targets are not allowed.";

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
        origin?: string;
    },
    allowedHosts?: string,
    gateway?: EgressGateway,
    signal?: AbortSignal,
): Promise<{ response: Response; body: string; finalUrl: string }> {
    let current = new URL(target.toString());
    const controller = new AbortController();
    const abort = () => controller.abort(new BodyReadError("request_cancelled", "Request was cancelled.", 408));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const validatorOrigin = validators?.origin ?? target.origin;
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
            controller.signal.throwIfAborted();
            if (!allowPrivate && (current.protocol !== "https:" || current.port !== "" && current.port !== "443")) {
                throw new TargetNotAllowedError("Approved-host launches require HTTPS on port 443.");
            }
            if (allowedHosts !== undefined && !allowedHosts.split(",").map(host => host.trim().toLowerCase()).includes(current.hostname.toLowerCase())) {
                throw new TargetNotAllowedError("Destination is outside the operator-approved host allowlist.");
            }
            const validationError =
                validateTarget(current, allowPrivate);

            if (validationError) {
                throw new TargetNotAllowedError(
                    validationError,
                );
            }
            if (gateway && current.hostname.toLowerCase().replace(/\.$/, "") === new URL(gateway.url).hostname.toLowerCase().replace(/\.$/, "")) {
                throw new TargetNotAllowedError("Secure egress infrastructure cannot be a target.");
            }

            if (!allowPrivate) await assertPublicDns(current.hostname, controller.signal, isPrivateHostname);

            const headers: Record<string, string> = {
                "user-agent": "Fresh402/2.0.0-rc.1",
                accept:
                    "text/html,application/json,text/plain,application/*+json;q=0.9,text/*;q=0.8,*/*;q=0.1",
            };

            // Validators may identify private content at the prior final origin.
            // Never disclose them to a different redirect destination.
            const scopedValidators = current.origin === validatorOrigin ? { etag: validators?.etag, last_modified: validators?.last_modified } : undefined;
            if (scopedValidators?.etag) {
                headers["if-none-match"] =
                    scopedValidators.etag;
            }

            if (scopedValidators?.last_modified) {
                headers["if-modified-since"] =
                    scopedValidators.last_modified;
            }

            if(!gateway&&!allowPrivate&&allowedHosts===undefined)throw new BodyReadError("egress_unavailable","Unrestricted fetching requires the secure outbound gateway.",503);
            const response = gateway ? await fetchViaGateway(current,scopedValidators,gateway,controller.signal) : await fetch(current.toString(), {
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

            let next: URL;
            try {
                if (/[\u0000-\u0020\u007f\\]/.test(location)) throw new Error();
                next = new URL(location, current);
                if (!allowPrivate) validateHttpsUrl(next.href);
            } catch {
                throw new TargetNotAllowedError("Redirect target is invalid or unsafe.");
            }

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
        signal?.removeEventListener("abort", abort);
    }
}

