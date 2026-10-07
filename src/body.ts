export const MAX_REQUEST_BODY_BYTES = 65_536;
export const BODY_TIMEOUT_MS = 10_000;

export class BodyReadError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = "BodyReadError";
    }
}

// Do not wait for an untrusted stream's cancellation callback to finish.
export function cancelBody(body: ReadableStream<Uint8Array> | null): void {
    if (body && !body.locked) void body.cancel().catch(() => {});
}

export async function readBoundedBody(
    message: Request | Response,
    limit: number,
    tooLarge: BodyReadError,
    signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
    if (Number(message.headers.get("content-length")) > limit) {
        cancelBody(message.body);
        throw tooLarge;
    }
    if (!message.body) return new Uint8Array(0);

    const reader = message.body.getReader();
    // Cancellation settles pending read() calls even if the source's cancel()
    // promise stalls. Avoid accumulating Promise.race handlers for every chunk.
    const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    // Keep allocation bounded even when the peer sends millions of tiny chunks.
    let bytes = new Uint8Array(Math.min(65_536, limit));
    let length = 0;
    try {
        signal.throwIfAborted();
        while (true) {
            const { value, done } = await reader.read();
            signal.throwIfAborted();
            if (done) return bytes.subarray(0, length);
            if (value.byteLength > limit - length) throw tooLarge;
            if (length + value.byteLength > bytes.byteLength) {
                const grown = new Uint8Array(Math.min(
                    limit,
                    Math.max(bytes.byteLength * 2, length + value.byteLength),
                ));
                grown.set(bytes.subarray(0, length));
                bytes = grown;
            }
            bytes.set(value, length);
            length += value.byteLength;
        }
    } catch (error) {
        void reader.cancel(error).catch(() => {});
        throw error;
    } finally {
        signal.removeEventListener("abort", abort);
        reader.releaseLock();
    }
}

export async function readRequestBody(request: Request): Promise<Uint8Array<ArrayBuffer>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new BodyReadError(
        "request_timeout", "Request body timed out.", 408,
    )), BODY_TIMEOUT_MS);
    try {
        return await readBoundedBody(request, MAX_REQUEST_BODY_BYTES, new BodyReadError(
            "request_too_large",
            `Request body exceeds the ${MAX_REQUEST_BODY_BYTES} byte limit.`,
            413,
        ), controller.signal);
    } finally {
        clearTimeout(timeout);
    }
}
