import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
    applyJsonIgnorePaths,
    buildTextDiff,
    stableJsonStringify,
} from "../src/freshness";

describe("Fresh402", () => {
    it("returns the v1.1 health endpoint", async () => {
        const response = await SELF.fetch("http://example.com/");

        expect(response.status).toBe(200);

        const body = (await response.json()) as {
            name: string;
            status: string;
            version: string;
            normalizer_version: number;
            pricing: Record<string, string>;
            endpoints: Record<string, string>;
            features: string[];
        };

        expect(body.name).toBe("Fresh402");
        expect(body.status).toBe("ok");
        expect(body.version).toBe("1.1.1");
        expect(body.normalizer_version).toBe(2);
        expect(body.pricing.register).toBe("free");
        expect(body.pricing.check).toContain("0.005");
        expect(body.endpoints.register).toContain("/v1/register");
        expect(body.endpoints.check).toContain("/v1/check");
        expect(body.endpoints.diff).toContain("/v1/diff");
        expect(body.endpoints.mcp).toContain("/mcp");
        expect(body.features.length).toBeGreaterThan(5);
    });

    it("returns 400 when register is missing a URL", async () => {
        const response = await SELF.fetch(
            "http://example.com/v1/register",
            {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: "{}",
            },
        );

        expect(response.status).toBe(400);

        const body = (await response.json()) as {
            error: string;
        };

        expect(body.error).toBe("missing_url");
    });

    it("canonicalizes JSON independent of object key order", () => {
        expect(
            stableJsonStringify({
                z: 1,
                a: {
                    y: 2,
                    x: 3,
                },
            }),
        ).toBe(
            '{"a":{"x":3,"y":2},"z":1}',
        );
    });

    it("ignores JSON Pointer paths with wildcards", () => {
        const value = applyJsonIgnorePaths(
            {
                updated_at: "now",
                items: [
                    {
                        id: 1,
                        timestamp: "a",
                    },
                    {
                        id: 2,
                        timestamp: "b",
                    },
                ],
            },
            [
                "/updated_at",
                "/items/*/timestamp",
            ],
        );

        expect(
            stableJsonStringify(value),
        ).toBe(
            '{"items":[{"id":1},{"id":2}]}',
        );
    });

    it("produces a compact deterministic diff", () => {
        const diff = buildTextDiff(
            "Pro plan costs $25 per month",
            "Pro plan costs $29 per month",
        );

        expect(diff.changed).toBe(true);
        expect(diff.change_ratio).toBeGreaterThan(0);
        expect(diff.removed_excerpt).toContain("5");
        expect(diff.added_excerpt).toContain("9");
    });

    it("serves Glama verification JSON", async () => {
        const response = await SELF.fetch(
            "http://example.com/.well-known/glama.json",
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type"))
            .toContain("application/json");

        const body = (await response.json()) as {
            "$schema": string;
            claim: string;
        };

        expect(body["$schema"]).toBe(
            "https://glama.ai/mcp/schemas/connector.json",
        );
        expect(body.claim).toMatch(/^glama_claim_/);
    });
    it("publishes x402scan OpenAPI metadata", async () => {
        const response = await SELF.fetch(
            "http://example.com/openapi.json",
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type"))
            .toContain("application/json");

        const spec = (await response.json()) as {
            openapi: string;
            servers: Array<{ url: string }>;
            paths: {
                "/v1/register": {
                    post: { security?: unknown };
                };
                "/v1/check": {
                    post: {
                        "x-payment-info": {
                            protocols: Array<{ x402: Record<string, never> }>;
                            price: {
                                mode: string;
                                currency: string;
                                amount: string;
                            };
                        };
                        responses: Record<string, unknown>;
                    };
                };
            };
        };

        expect(spec.openapi).toBe("3.1.0");
        expect(spec.servers[0].url).toBe("http://example.com");
        expect(spec.paths["/v1/register"].post.security)
            .toEqual([]);

        const paid = spec.paths["/v1/check"].post;
        expect(paid).toHaveProperty("security", [{ x402Payment: [] }]);
        expect(paid.responses).toHaveProperty("402");
        expect(paid["x-payment-info"].protocols)
            .toEqual([{ x402: {} }]);
        expect(paid["x-payment-info"].price).toEqual({
            mode: "fixed",
            currency: "USD",
            amount: "0.005",
        });
    });

    it("publishes x402 resource manifest", async () => {
        const response = await SELF.fetch(
            "http://example.com/.well-known/x402",
        );

        expect(response.status).toBe(200);

        const manifest = (await response.json()) as {
            version: number;
            resources: string[];
        };

        expect(manifest.version).toBe(1);
        expect(manifest.resources).toEqual([
            "http://example.com/v1/check",
        ]);
    });
    it("returns 404 for an unknown route", async () => {
        const response = await SELF.fetch(
            "http://example.com/does-not-exist",
        );

        expect(response.status).toBe(404);
    });
});

