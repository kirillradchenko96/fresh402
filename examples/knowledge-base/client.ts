import { randomBytes } from 'node:crypto';
type Json = Record<string, any>;
export type Operation = {
    tool: string;
    input: Json;
    payment: Json;
    recoveryToken: string;
    amount: string;
    state: 'authorized' | 'pending' | 'completed';
    result?: Json;
    receipt?: Json;
};
export type Signer = (challenge: Json) => Promise<Json>;
/** Adapt an already configured x402 SDK client with a payer-controlled wallet signer. */
export const signerFromX402Client = (client: {
    createPaymentPayload(challenge: any): Promise<any>;
}): Signer => challenge => client.createPaymentPayload(challenge);
export class PaymentRequired extends Error {
    challenge: Json;
    constructor(challenge: Json) { super('Payment required; no signer/budget enabled'); this.challenge = challenge; }
}
export class PendingPayment extends Error {
    declare operation: Operation;
    constructor(operation: Operation, cause?: unknown) { super('Outcome uncertain. Retry the ORIGINAL stored operation; do not sign again.', { cause }); Object.defineProperty(this, 'operation', { value: operation, enumerable: false }); }
}
export class ApiError extends Error {
    code: string;
    status: number;
    constructor(code: string, status: number) { super(code); this.code = code; this.status = status; }
}
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', RECIPIENT = '0x58b4b483fbe31860335eceb12cccf4338b251085';
const atomic = (value: string) => { if (!/^\d+(\.\d{1,6})?$/.test(value))
    throw new Error('Unsupported advertised price'); const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0')); };
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
function parseRpc(text: string) { if (text.trimStart().startsWith('{'))
    return JSON.parse(text); const data = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n'); return JSON.parse(data); }
async function readResponse(response: Response) { if (!response.body)
    return ''; const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0; try {
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > 1000000)
            throw new Error('Response exceeds client safety limit');
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}
catch (error) {
    await reader.cancel().catch(() => { });
    throw error;
}
finally {
    reader.releaseLock();
} }
/** Public-interface client. No imports from Fresh402 backend or payment secrets. */
export class Fresh402Client {
    base: string;
    transport: 'rest' | 'mcp';
    signer?: Signer;
    budget: bigint;
    reserved = 0n;
    operations = new Map<string, Json>();
    timeoutMs: number;
    sequence = 0;
    persist?: (operation: Operation) => Promise<void>;
    expectedRecipient: string;
    constructor(base: string, options: {
        transport?: 'rest' | 'mcp';
        signer?: Signer;
        maxAtomicUSDC?: bigint;
        timeoutMs?: number;
        persist?: (operation: Operation) => Promise<void>;
        expectedRecipient?: string;
    } = {}) {
        const url = new URL(base);
        if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))
            throw new Error('Use an HTTPS service origin, or a loopback local demo origin');
        this.base = url.origin;
        this.transport = options.transport ?? 'rest';
        this.signer = options.signer;
        this.budget = options.maxAtomicUSDC ?? 0n;
        this.timeoutMs = options.timeoutMs ?? 15000;
        this.persist = options.persist;
        this.expectedRecipient = (options.expectedRecipient ?? RECIPIENT).toLowerCase();
    }
    async request(path: string, body?: Json, headers: Record<string, string> = {}) {
        const response = await fetch(this.base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', headers: { accept: 'application/json, text/event-stream', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(this.timeoutMs) });
        const text = await readResponse(response);
        return { response, json: text ? parseRpc(text) : {} };
    }
    async rpc(method: string, params: Json = {}) { const { response, json } = await this.request('/mcp', { jsonrpc: '2.0', id: ++this.sequence, method, params }); if (!response.ok)
        throw new ApiError(json.error ?? 'mcp_http_error', response.status); if (json.error)
        throw new ApiError(json.error.message ?? 'mcp_protocol_error', 400); return json.result; }
    async discover() {
        const { response, json: api } = await this.request('/openapi.json');
        if (!response.ok || !api.openapi?.startsWith('3.'))
            throw new Error('OpenAPI discovery failed');
        for (const [path, item] of Object.entries(api.paths) as Array<[
            string,
            Json
        ]>) {
            const post = item.post;
            if (post?.operationId?.startsWith('fresh402_'))
                this.operations.set(post.operationId, { path, schema: post.requestBody?.content?.['application/json']?.schema, price: post['x-payment-info']?.price, summary: post.summary });
        }
        for (const name of ['fresh402_register', 'fresh402_check', 'fresh402_extract', 'fresh402_smart_diff'])
            if (!this.operations.has(name))
                throw new Error('Required public operation missing: ' + name);
        if (this.transport === 'mcp') {
            await this.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Fresh402KnowledgeBase', version: '1.0.0' } });
            await this.request('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' });
            const tools = await this.rpc('tools/list');
            for (const tool of tools.tools) {
                const operation = this.operations.get(tool.name);
                if (operation)
                    operation.schema = tool.inputSchema;
            }
            for (const name of this.operations.keys())
                if (['fresh402_register', 'fresh402_check', 'fresh402_extract', 'fresh402_smart_diff'].includes(name) && !tools.tools.some((t: Json) => t.name === name))
                    throw new Error('MCP tool missing: ' + name);
        }
        return { version: api.info.version, operations: [...this.operations].map(([tool, op]) => ({ tool, path: op.path, summary: op.summary, price: op.price, schema: op.schema })) };
    }
    async raw(tool: string, input: Json, operation?: Operation) {
        const op = this.operations.get(tool);
        if (!op)
            throw new Error('Discover before using operations');
        if (this.transport === 'mcp') {
            const params: Json = { name: tool, arguments: input, ...(operation ? { _meta: { 'x402/payment': operation.payment, 'fresh402/recovery-token': operation.recoveryToken } } : {}) };
            // Recovery header is the shared public REST/MCP credential contract.
            const { response, json } = await this.request('/mcp', { jsonrpc: '2.0', id: ++this.sequence, method: 'tools/call', params }, operation ? { 'X-Fresh402-Recovery-Token': operation.recoveryToken } : {});
            if (!response.ok)
                throw new ApiError(json.error ?? 'mcp_http_error', response.status);
            if (json.error)
                throw new ApiError(json.error.message ?? 'mcp_protocol_error', 400);
            const result = json.result;
            if (result.isError) {
                let data = result.structuredContent;
                if (!data && result.content?.[0]?.text) {
                    try {
                        data = JSON.parse(result.content[0].text);
                    }
                    catch { }
                }
                if (data?.x402Version === 2)
                    return { challenge: data };
                const invalidArgs = /MCP error -32602|Input validation error/.test(result.content?.[0]?.text ?? '');
                throw new ApiError(data?.error ?? (invalidArgs ? 'invalid_mcp_arguments' : 'mcp_tool_error'), data?.status ?? (invalidArgs ? 400 : 503));
            }
            return { result: result.structuredContent ?? JSON.parse(result.content[0].text), receipt: result._meta?.['x402/payment-response'] };
        }
        const { response, json } = await this.request(op.path, input, operation ? { 'PAYMENT-SIGNATURE': Buffer.from(JSON.stringify(operation.payment)).toString('base64'), 'X-Fresh402-Recovery-Token': operation.recoveryToken } : {});
        if (response.status === 402) {
            const header = response.headers.get('payment-required');
            if (!header)
                throw new Error('Missing PAYMENT-REQUIRED header');
            return { challenge: JSON.parse(Buffer.from(header, 'base64').toString('utf8')) };
        }
        if (!response.ok)
            throw new ApiError(json.error ?? 'operation_failed', response.status);
        const receipt = response.headers.get('payment-response');
        return { result: json, receipt: receipt ? JSON.parse(Buffer.from(receipt, 'base64').toString('utf8')) : undefined };
    }
    validateChallenge(tool: string, challenge: Json) {
        const op = this.operations.get(tool)!, accepted = challenge.accepts?.[0];
        if (challenge.x402Version !== 2 || challenge.accepts?.length !== 1 || !accepted || accepted.scheme !== 'exact' || accepted.network !== 'eip155:8453' || accepted.asset?.toLowerCase() !== USDC || accepted.payTo?.toLowerCase() !== this.expectedRecipient || !/^[0-9]+$/.test(accepted.amount) || !Number.isInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds < 1 || accepted.maxTimeoutSeconds > 300)
            throw new Error('Unsafe or unexpected x402 challenge');
        const resource = this.base + (this.transport === 'rest' ? op.path : '/mcp#' + tool);
        if (challenge.resource?.url !== resource)
            throw new Error('Payment resource does not match discovered operation');
        const amount = BigInt(accepted.amount);
        if (!op.price || atomic(op.price.amount) !== amount)
            throw new Error('Challenge price differs from discovery');
        if (amount <= 0n)
            throw new Error('Invalid service amount');
        return amount;
    }
    async register(input: Json) { const data = await this.raw('fresh402_register', input); if (data.challenge || typeof data.result?.watch_id !== 'string')
        throw new Error('Registration failed'); return data.result; }
    async quote(tool: string, input: Json) { const data = await this.raw(tool, input); if (!data.challenge)
        throw new Error('Expected unpaid quote'); this.validateChallenge(tool, data.challenge); return data.challenge; }
    async execute(tool: string, input: Json) {
        const challenge = await this.quote(tool, input), amount = this.validateChallenge(tool, challenge);
        if (!this.signer || this.budget === 0n)
            throw new PaymentRequired(challenge);
        if (!this.persist)
            throw new Error('Configure private operation persistence before enabling a signer');
        if (this.reserved + amount > this.budget)
            throw new Error('Explicit client payment cap exceeded');
        // Reserve before invoking a signer; uncertain signatures/outcomes never free this budget.
        this.reserved += amount;
        const payment = await this.signer(challenge);
        if (payment.x402Version !== 2 || canonical(payment.accepted) !== canonical(challenge.accepts[0]) || canonical(payment.resource) !== canonical(challenge.resource) || canonical(payment.extensions ?? {}) !== canonical(challenge.extensions ?? {}))
            throw new Error('Signer altered payment resource, requirements or extensions');
        const operation: Operation = { tool, input: structuredClone(input), payment, recoveryToken: randomBytes(32).toString('hex'), amount: String(amount), state: 'authorized' };
        await this.persist?.(operation);
        return this.recover(operation);
    }
    async recover(operation: Operation) {
        try {
            const data = await this.raw(operation.tool, operation.input, operation);
            if (data.challenge)
                throw new ApiError('original_payment_not_accepted', 402);
            if (data.receipt?.success !== true || data.receipt.network !== 'eip155:8453' || !/^0x[a-fA-F0-9]{64}$/.test(data.receipt.transaction ?? ''))
                throw new Error('Paid result is missing a valid successful settlement receipt');
            operation.state = 'completed';
            operation.result = data.result;
            operation.receipt = data.receipt;
            await this.persist?.(operation);
            return { result: data.result!, operation };
        }
        catch (error) {
            if (error instanceof ApiError && error.status < 500 && error.status !== 409)
                throw error;
            operation.state = 'pending';
            await this.persist?.(operation);
            throw new PendingPayment(operation, error);
        }
    }
}
/** Demonstration signer only: refuses all non-loopback services. Never uses wallet keys. */
export function localMockSigner(base: string): Signer { if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
    throw new Error('Mock signing is restricted to the local lab'); return async (challenge) => ({ x402Version: 2, resource: challenge.resource, accepted: challenge.accepts[0], extensions: challenge.extensions, payload: { signature: '0x' + '1'.repeat(130), authorization: { from: '0x1111111111111111111111111111111111111111', to: challenge.accepts[0].payTo, value: challenge.accepts[0].amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: '0x' + randomBytes(32).toString('hex') } } }); }
export async function syncDocumentation(client: Fresh402Client, url: string, state: Json = {}, scope: Json = {}) {
    if (!state.watch_id) {
        const registration = await client.register({ url, ...scope });
        state.watch_id = registration.watch_id;
        state.baseline_hash = registration.hash;
    }
    const check = state.document ? await client.execute('fresh402_check', { watch_id: state.watch_id, max_age_seconds: 0, include_diff: true }) : null;
    if (!state.document || check?.result.changed) {
        const extraction = await client.execute('fresh402_extract', { url, ...scope, max_chars: 20000, include_links: true, include_structured_data: true });
        state.document = { url, title: extraction.result.title, text: extraction.result.text, hash: extraction.result.hash, untrusted_source: true, truncated: extraction.result.truncated };
        state.refreshes = (state.refreshes ?? 0) + 1;
    }
    state.last_check_hash = check?.result.hash ?? state.baseline_hash;
    state.last_changed = check?.result.changed ?? false;
    return state;
}
