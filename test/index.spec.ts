import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("Fresh402", () => {
    it("returns the health endpoint", async () => {
        const response = await SELF.fetch("http://example.com/");

        expect(response.status).toBe(200);

        const body = (await response.json()) as {
            name: string;
            status: string;
            version: string;
            normalizer_version: number;
            endpoints: Record<string, string>;
        };

        expect(body.name).toBe("Fresh402");
        expect(body.status).toBe("ok");
        expect(body.version).toBe("0.6.0");
        expect(body.normalizer_version).toBe(2);
        expect(body.endpoints.check).toContain("/v1/check");
        expect(body.endpoints.diff).toContain("/v1/diff");
    });

    it("returns 404 for an unknown route", async () => {
        const response = await SELF.fetch("http://example.com/does-not-exist");

        expect(response.status).toBe(404);
    });
});
