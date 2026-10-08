// Target network is mocked; DNS has dedicated security tests.
vi.mock("../src/dns", () => ({ assertPublicDns: vi.fn(async () => {}) }));
import { env } from "cloudflare:workers";
import { applyD1Migrations, SELF, type D1Migration } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCoreRequest, type FreshnessEnv } from "../src/freshness";
import { MAX_REQUEST_BODY_BYTES } from "../src/body";

declare global {
    namespace Cloudflare {
        interface Env { TEST_MIGRATIONS: D1Migration[] }
    }
}

const encoder = new TextEncoder();
let bindings: FreshnessEnv;

function request(path: string, input: unknown, origin = "https://fresh402.example"): Request {
    return new Request(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
    });
}

function register(input: Record<string, unknown>, selectedEnv = bindings) {
    return handleCoreRequest(request("/v1/register", input), selectedEnv);
}

it.each(["lookup", "insert"])("does not expose unexpected D1 %s errors in a registration response or log", async stage => {
    const privateMessage = "D1_ERROR SELECT private_customer_data; api_key=never-expose-this";
    const logs = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValue(textResponse());
    if (stage === "lookup") vi.spyOn(bindings.DB, "prepare").mockImplementationOnce(() => { throw new Error(privateMessage); });
    else vi.spyOn(bindings.DB, "batch").mockRejectedValueOnce(new Error(privateMessage));
    const response = await register({ url: "https://public.example/" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "check_failed", message: "Unable to process the target. Retry later." });
    expect(JSON.stringify(logs.mock.calls)).not.toContain(privateMessage);
});

function check(input: Record<string, unknown>) {
    // Exercises the paid core without contacting the facilitator or settling money.
    return handleCoreRequest(request("/v1/check", input), bindings);
}

async function data(response: Response) {
    expect(response.status).toBe(200);
    return response.json<Record<string, any>>();
}

function textResponse(body = "baseline", headers: Record<string, string> = {}) {
    return new Response(body, { headers: { "content-type": "text/plain", ...headers } });
}

function streamBody(chunks: Uint8Array[], close = true) {
    const cancel = vi.fn();
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else if (close) controller.close();
        },
        cancel,
    }, { highWaterMark: 0 });
    return { stream, cancel };
}

beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
    await env.DB.batch([
        env.DB.prepare("DELETE FROM watch_snapshots"),
        env.DB.prepare("DELETE FROM watches"),
    ]);
    bindings = {
        DB: env.DB,
        REGISTER_TARGET_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
        REGISTER_GLOBAL_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    };
    // No test may accidentally reach a real target or payment service.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected outbound fetch"));
    vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("free registration limits", () => {
    it("enforces the configured host quota before fetching or writing new watches", async () => {
        vi.mocked(fetch).mockImplementation(async () => textResponse());
        let first: Record<string, any> | undefined;
        for (let i = 0; i < 10; i++) {
            const result = await data(await register({ url: `https://quota.example/${i}` }, env));
            first ??= result;
        }
        const response = await register({ url: "https://quota.example/overflow" }, env);
        expect(response.status).toBe(429);
        expect(response.headers.get("retry-after")).toBe("60");
        expect(await response.json()).toMatchObject({ error: "registration_rate_limited" });
        expect(fetch).toHaveBeenCalledTimes(10);
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watches").first("n")).toBe(10);
        expect(await data(await register({ url: "https://quota.example/0" }, env))).toMatchObject({
            created: false, hash: first!.hash,
        });
        expect(fetch).toHaveBeenCalledTimes(10);
    });

    it("uses the same host key for config variants and the MCP core path", async () => {
        vi.mocked(bindings.REGISTER_TARGET_LIMITER.limit).mockResolvedValue({ success: false });
        const variants = [
            { url: "https://PUBLIC.example/a", selector: "#one" },
            { url: "https://public.example./b?q=2", selector: "#two" },
            { url: "http://public.example:8080/c", ignore_selectors: [".noise"] },
            { url: "https://public.example/d", ignore_json_paths: ["/timestamp"] },
        ];
        for (const input of variants) {
            const req = request("/v1/register", input, "https://fresh402.internal");
            req.headers.set("x-forwarded-for", crypto.randomUUID());
            expect((await handleCoreRequest(req, bindings)).status).toBe(429);
        }
        for (const [key] of vi.mocked(bindings.REGISTER_TARGET_LIMITER.limit).mock.calls) {
            expect(key).toEqual({ key: "fresh402:register:host:public.example" });
        }
        expect(fetch).not.toHaveBeenCalled();
    });

    it("applies the global limit across unrelated hosts", async () => {
        vi.mocked(bindings.REGISTER_GLOBAL_LIMITER.limit).mockResolvedValue({ success: false });
        for (const host of ["a.example", "b.example"]) {
            expect((await register({ url: `https://${host}` })).status).toBe(429);
        }
        expect(bindings.REGISTER_GLOBAL_LIMITER.limit).toHaveBeenNthCalledWith(1, { key: "fresh402:register:all" });
        expect(bindings.REGISTER_GLOBAL_LIMITER.limit).toHaveBeenNthCalledWith(2, { key: "fresh402:register:all" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(["missing", "failed"])("fails closed when the limiter is %s", async (mode) => {
        if (mode === "missing") bindings.REGISTER_TARGET_LIMITER = undefined as unknown as RateLimit;
        else vi.mocked(bindings.REGISTER_TARGET_LIMITER.limit).mockRejectedValue(new Error("unavailable"));
        expect((await register({ url: "https://public.example" })).status).toBe(503);
        expect(fetch).not.toHaveBeenCalled();
    });

    it("returns an existing baseline without fetching or spending quota", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("first"));
        const original = await data(await register({ url: "https://public.example" }));
        const targetLimit = vi.mocked(bindings.REGISTER_TARGET_LIMITER.limit);
        targetLimit.mockClear().mockRejectedValue(new Error("offline"));
        vi.mocked(bindings.REGISTER_GLOBAL_LIMITER.limit).mockClear();
        const again = await data(await register({ url: "https://public.example" }));
        expect(again).toMatchObject({ created: false, baseline_created: false, hash: original.hash });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(targetLimit).not.toHaveBeenCalled();
        expect(bindings.REGISTER_GLOBAL_LIMITER.limit).not.toHaveBeenCalled();
    });

    it("does not apply free quotas to a paid core check", async () => {
        vi.mocked(bindings.REGISTER_GLOBAL_LIMITER.limit).mockResolvedValue({ success: false });
        vi.mocked(fetch).mockResolvedValueOnce(textResponse());
        expect((await check({ url: "https://public.example" })).status).toBe(200);
        expect(bindings.REGISTER_TARGET_LIMITER.limit).not.toHaveBeenCalled();
        expect(bindings.REGISTER_GLOBAL_LIMITER.limit).not.toHaveBeenCalled();
    });
});

describe("bounded request bodies", () => {
    it.each(["/v1/register", "/v1/check", "/mcp", "/%6dcp", "/v1/%63heck"])("rejects oversized %s before middleware parses it", async (path) => {
        const response = await SELF.fetch(request(path, { value: "x".repeat(MAX_REQUEST_BODY_BYTES) }));
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({ error: "request_too_large" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([undefined, "1"])("counts streamed bytes with content-length %s", async (length) => {
        const { stream, cancel } = streamBody([encoder.encode("é".repeat(32_769))], false);
        const response = await handleCoreRequest(new Request("https://service.example/v1/register", {
            method: "POST", body: stream,
            headers: length ? { "content-length": length } : {},
        }), bindings);
        expect(response.status).toBe(413);
        expect(cancel).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects a declared oversize without pulling the stream", async () => {
        const pull = vi.fn();
        const cancel = vi.fn();
        const response = await handleCoreRequest(new Request("https://service.example/v1/register", {
            method: "POST",
            headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
            body: new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
        }), bindings);
        expect(response.status).toBe(413);
        expect(pull).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
    });

    it("accepts exactly 64 KiB and preserves invalid_json below the limit", async () => {
        const body = "{}" + " ".repeat(MAX_REQUEST_BODY_BYTES - 2);
        const response = await SELF.fetch("https://service.example/v1/register", { method: "POST", body });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "missing_url" });
        const invalid = await SELF.fetch("https://service.example/v1/register", { method: "POST", body: "{" });
        expect(invalid.status).toBe(400);
        expect(await invalid.json()).toMatchObject({ error: "invalid_json" });
    });

    it("times out a stalled incoming body and cancels it", async () => {
        vi.useFakeTimers();
        const { stream, cancel } = streamBody([], false);
        const pending = handleCoreRequest(new Request("https://service.example/v1/register", { method: "POST", body: stream }), bindings);
        await vi.advanceTimersByTimeAsync(10_000);
        const response = await pending;
        expect(response.status).toBe(408);
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not wait for an unresponsive cancellation callback", async () => {
        vi.useFakeTimers();
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const pending = handleCoreRequest(new Request("https://service.example/v1/register", {
            method: "POST", body: new ReadableStream({ cancel }),
        }), bindings);
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await pending).status).toBe(408);
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("upstream streaming", () => {
    it.each([undefined, "1"])("enforces the byte limit with content-length %s", async (length) => {
        const { stream, cancel } = streamBody([
            encoder.encode("é".repeat(2_500_000)), encoder.encode("x"),
        ], false);
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, {
            headers: { "content-type": "text/plain", ...(length ? { "content-length": length } : {}) },
        }));
        const response = await register({ url: "https://public.example" });
        expect(response.status).toBe(413);
        expect(await response.json()).toMatchObject({ error: "content_too_large" });
        expect(cancel).toHaveBeenCalledOnce();
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watches").first("n")).toBe(0);
    });

    it("accepts exactly 5,000,000 bytes and truncates only stored content", async () => {
        const { stream } = streamBody([encoder.encode("é".repeat(2_500_000))]);
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "text/plain" } }));
        const result = await data(await register({ url: "https://public.example" }));
        expect(result.content_length).toBe(2_500_000);
        expect(result.snapshot_truncated).toBe(true);
        expect(await env.DB.prepare("SELECT length(normalized_content) AS n FROM watches").first("n")).toBe(200_000);
    });

    it("rejects a declared oversize and cancels the unread body", async () => {
        const pull = vi.fn();
        const cancel = vi.fn();
        vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
            headers: { "content-type": "text/plain", "content-length": "5000001" },
        }));
        expect((await register({ url: "https://public.example" })).status).toBe(413);
        expect(pull).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
    });

    it("keeps the deadline active after headers and cancels a stalled body", async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        let fetched!: () => void;
        const reachedFetch = new Promise<void>((resolve) => { fetched = resolve; });
        const { stream, cancel } = streamBody([encoder.encode("partial")], false);
        vi.mocked(fetch).mockImplementationOnce(async (_, init) => {
            signal = init?.signal ?? undefined;
            fetched();
            return new Response(stream, { headers: { "content-type": "text/plain" } });
        });
        const pending = register({ url: "https://public.example" });
        await reachedFetch;
        await vi.advanceTimersByTimeAsync(10_000);
        const response = await pending;
        expect(response.status).toBe(504);
        expect(await response.json()).toMatchObject({ error: "upstream_timeout" });
        expect(signal?.aborted).toBe(true);
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("decodes UTF-8 split across chunks without changing the fingerprint", async () => {
        const bytes = encoder.encode("price €25");
        const { stream } = streamBody(Array.from(bytes, (byte) => new Uint8Array([byte])));
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "text/plain" } }));
        const registered = await data(await register({ url: "https://public.example" }));
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("price €25"));
        expect(await data(await check({ watch_id: registered.watch_id }))).toMatchObject({ hash: registered.hash, changed: false });
    });

    it("uses one deadline across redirects and body reads", async () => {
        vi.useFakeTimers();
        let firstFetch!: () => void;
        const reachedFetch = new Promise<void>((resolve) => { firstFetch = resolve; });
        const { stream, cancel } = streamBody([], false);
        vi.mocked(fetch)
            .mockImplementationOnce(() => {
                firstFetch();
                return new Promise((resolve) => setTimeout(() => resolve(new Response(null, {
                    status: 302, headers: { location: "/final" },
                })), 6_000));
            })
            .mockResolvedValueOnce(new Response(stream, { headers: { "content-type": "text/plain" } }));
        const pending = register({ url: "https://public.example/start" });
        await reachedFetch;
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await pending).status).toBe(504);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("aborts a request stalled before response headers", async () => {
        vi.useFakeTimers();
        let started!: () => void;
        const reachedFetch = new Promise<void>((resolve) => { started = resolve; });
        vi.mocked(fetch).mockImplementationOnce((_, init) => new Promise((_, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
            started();
        }));
        const pending = register({ url: "https://public.example" });
        await reachedFetch;
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await pending).status).toBe(504);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not write a partial baseline after a stream failure", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
            pull(controller) { controller.error(new Error("connection lost")); },
        }), { headers: { "content-type": "text/plain" } }));
        expect((await register({ url: "https://public.example" })).status).toBe(500);
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watches").first("n")).toBe(0);
    });
});

describe("SSRF and redirects", () => {
    it.each([
        "http://localhost/", "http://localhost./", "http://127.1/", "http://0x7f000001/",
        "http://10.0.0.1/", "http://169.254.169.254/", "http://192.168.1.1/",
        "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:a00:1]/",
        "http://[fd00::1]/", "http://[fe80::1]/", "https://test.internal/",
        "file:///etc/passwd", "https://user:pass@public.example/", "https://public.example:22/",
        "https://public.example/?api_key=secret",
    ])("rejects %s without fetching", async (url) => {
        expect((await register({ url })).status).toBe(400);
        expect(fetch).not.toHaveBeenCalled();
        expect(bindings.REGISTER_TARGET_LIMITER.limit).not.toHaveBeenCalled();
    });

    it("allows public DNS names starting with an IPv6-like prefix", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(textResponse());
        expect((await register({ url: "https://fdocs.example/" })).status).toBe(200);
    });

    it.each(["http://127.0.0.1/", "https://[::ffff:7f00:1]/", "http://public.example/plain", "https://public.example:22/"])("rejects redirect to %s", async (location) => {
        const { stream, cancel } = streamBody([], false);
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { status: 302, headers: { location } }));
        const response = await register({ url: "https://public.example/" });
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "target_not_allowed" });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(cancel).toHaveBeenCalledOnce();
    });

    it("follows a relative redirect manually and records its final URL", async () => {
        vi.mocked(fetch)
            .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/final" } }))
            .mockResolvedValueOnce(textResponse());
        expect(await data(await register({ url: "https://public.example/start" }))).toMatchObject({ final_url: "https://public.example/final" });
        expect(fetch).toHaveBeenNthCalledWith(2, "https://public.example/final", expect.objectContaining({ redirect: "manual" }));
    });

    it("stops redirect loops after five hops", async () => {
        vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
        expect((await register({ url: "https://public.example/loop" })).status).toBe(400);
        expect(fetch).toHaveBeenCalledTimes(6);
    });

    it("cancels an upstream error body without reading it", async () => {
        const { stream, cancel } = streamBody([], false);
        vi.mocked(fetch).mockResolvedValueOnce(new Response(stream, { status: 503 }));
        expect((await register({ url: "https://public.example" })).status).toBe(502);
        expect(cancel).toHaveBeenCalledOnce();
    });
});

describe("D1 baseline races and history", () => {
    it("returns one winning baseline and snapshot for concurrent registrations", async () => {
        const count = 6;
        let arrivals = 0;
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => { release = resolve; });
        vi.mocked(fetch).mockImplementation(async () => {
            const id = ++arrivals;
            if (arrivals === count) release();
            await barrier;
            return textResponse(`candidate ${id}`);
        });
        const results = await Promise.all(Array.from({ length: count }, async () => data(await register({ url: "https://public.example" }))));
        expect(results.filter((result) => result.created)).toHaveLength(1);
        expect(new Set(results.map((result) => result.hash)).size).toBe(1);
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watches").first("n")).toBe(1);
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_snapshots").first("n")).toBe(1);
        expect(await env.DB.prepare("SELECT hash FROM watch_snapshots").first("hash")).toBe(results[0].hash);
        expect(await env.DB.prepare("SELECT check_count FROM watches").first("check_count")).toBe(1);
    });

    it("preserves validators and creates no snapshot on a 304", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("original", { etag: '"v1"', "last-modified": "Wed, 07 Oct 2026 10:00:00 GMT" }));
        const baseline = await data(await register({ url: "https://public.example" }));
        vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 304 }));
        const result = await data(await check({ watch_id: baseline.watch_id, include_diff: true }));
        expect(result).toMatchObject({
            changed: false, hash: baseline.hash, snapshot_saved: false, network_fetched: true,
            cache_status: "revalidated_not_modified", upstream_not_modified: true, check_count: 2,
        });
        expect(fetch).toHaveBeenLastCalledWith("https://public.example/", expect.objectContaining({ headers: expect.objectContaining({
            "if-none-match": '"v1"', "if-modified-since": "Wed, 07 Oct 2026 10:00:00 GMT",
        }) }));
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_snapshots").first("n")).toBe(1);
    });

    it("handles a paid first check that loses a race to registration", async () => {
        let paidStarted!: () => void;
        const paidFetched = new Promise<void>((resolve) => { paidStarted = resolve; });
        let releasePaid!: (response: Response) => void;
        vi.mocked(fetch).mockImplementationOnce(() => {
            paidStarted();
            return new Promise<Response>((resolve) => { releasePaid = resolve; });
        });
        const paid = check({ url: "https://public.example" });
        await paidFetched;
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("free baseline"));
        const baseline = await data(await register({ url: "https://public.example" }));
        releasePaid(textResponse("paid update"));
        const result = await data(await paid);
        expect(result).toMatchObject({
            baseline_created: false, first_seen: false, changed: true,
            previous_hash: baseline.hash, check_count: 2, snapshot_saved: true,
        });
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watches").first("n")).toBe(1);
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_snapshots").first("n")).toBe(2);
        expect(await env.DB.prepare("SELECT hash FROM watches").first("hash")).toBe(result.hash);
    });

    it("serves a fresh cache and honors caller hashes without a network fetch", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("original"));
        const baseline = await data(await register({ url: "https://public.example" }));
        const result = await data(await check({ watch_id: baseline.watch_id, max_age_seconds: 300, previous_hash: "f".repeat(64), include_diff: true }));
        expect(result).toMatchObject({ cached: true, network_fetched: false, changed: true, comparison_source: "caller_hash", snapshot_saved: false });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(await env.DB.prepare("SELECT check_count FROM watches").first("check_count")).toBe(1);
    });

    it("keeps only the latest 20 snapshots for the changed watch", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("other"));
        const other = await data(await register({ url: "https://other.example" }));
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("version 0"));
        const baseline = await data(await register({ url: "https://public.example" }));
        for (let i = 1; i <= 22; i++) {
            vi.mocked(fetch).mockResolvedValueOnce(textResponse(`version ${i}`));
            expect(await data(await check({ watch_id: baseline.watch_id }))).toMatchObject({ changed: true, snapshot_saved: true });
        }
        const rows = await env.DB.prepare("SELECT normalized_content FROM watch_snapshots WHERE watch_id = ? ORDER BY id").bind(baseline.watch_id).all<{ normalized_content: string }>();
        expect(rows.results).toHaveLength(20);
        expect(rows.results[0].normalized_content).toBe("version 3");
        expect(rows.results[19].normalized_content).toBe("version 22");
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_snapshots WHERE watch_id = ?").bind(other.watch_id).first("n")).toBe(1);
        const cached = await data(await check({ watch_id: baseline.watch_id, max_age_seconds: 300, previous_hash: baseline.hash, include_diff: true }));
        expect(cached.diff).toMatchObject({ available: false, reason: "previous_content_unavailable" });
    });

    it("refreshes an expired cache and compares a caller hash on 304", async () => {
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("original"));
        const baseline = await data(await register({ url: "https://public.example" }));
        await env.DB.prepare("UPDATE watches SET checked_at = ?").bind("2000-01-01T00:00:00.000Z").run();
        vi.mocked(fetch).mockResolvedValueOnce(textResponse("updated"));
        const updated = await data(await check({ watch_id: baseline.watch_id, max_age_seconds: 300 }));
        expect(updated).toMatchObject({ cached: false, changed: true, network_fetched: true });
        vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 304 }));
        const result = await data(await check({ watch_id: baseline.watch_id, previous_hash: baseline.hash, include_diff: true }));
        expect(result).toMatchObject({ changed: true, hash: updated.hash, snapshot_saved: false, upstream_not_modified: true });
        expect(result.diff).toMatchObject({ available: true, changed: true });
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM watch_snapshots").first("n")).toBe(2);
    });
});
