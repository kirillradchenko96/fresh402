// Standalone public-contract simulator. This is NOT the Fresh402 backend or real settlement.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const defs = [['fresh402_register', '/v1/register', 0], ['fresh402_check', '/v1/check', 5000], ['fresh402_extract', '/v2/extract', 10000], ['fresh402_smart_diff', '/v2/smart-diff', 15000]] as const;
const recipient = '0x58B4b483fBE31860335eCeB12CCCF4338b251085', asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export async function startContractDemo() {
    let version = 1, clock = '10:00', origin = '';
    const watches = new Map<string, {
        hash: string;
        text: string;
    }>(), ledger = new Map<string, any>();
    const document = () => ({ title: 'Service Handbook', text: version === 1 ? 'Install the stable API package and save the configuration.' : 'Install the stable API package and save the configuration. Recovery is available for seven days.', clock });
    function challenge(tool: string, transport: string) { const def = defs.find(d => d[0] === tool)!; return { x402Version: 2, resource: { url: origin + (transport === 'mcp' ? '/mcp#' + tool : def[1]), description: 'Local contract demonstration', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: String(def[2]), asset, payTo: recipient, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } }] }; }
    function invoke(tool: string, input: any, payment: any, key: string, transport: string) {
        const doc = document(), id = 'w_' + hash(input.url ?? 'https://documentation.fixture.example/').slice(0, 32);
        if (tool === 'fresh402_register') {
            if (input.url !== 'https://documentation.fixture.example/')
                return { error: 'invalid_demo_target', status: 400 };
            const previous = watches.get(id);
            if (!previous)
                watches.set(id, { hash: hash(doc.text), text: doc.text });
            return { result: { watch_id: id, url: input.url, created: !previous, baseline_created: !previous, hash: watches.get(id)!.hash } };
        }
        const quote = challenge(tool, transport);
        if (!payment)
            return { challenge: quote };
        if (!/^[a-f0-9]{64}$/.test(key) || payment.accepted?.amount !== quote.accepts[0].amount || payment.accepted?.network !== 'eip155:8453' || payment.accepted?.asset?.toLowerCase() !== asset.toLowerCase() || payment.accepted?.payTo?.toLowerCase() !== recipient.toLowerCase() || payment.resource?.url !== quote.resource.url)
            return { error: 'invalid_mock_payment', status: 402 };
        const nonce = payment.payload?.authorization?.nonce, fingerprint = hash(JSON.stringify({ tool, input })), previous = ledger.get(nonce);
        if (previous) {
            if (previous.key !== hash(key))
                return { error: 'private_recovery_required', status: 402 };
            if (previous.fingerprint !== fingerprint)
                return { error: 'payment_request_mismatch', status: 409 };
            return previous.delivery;
        }
        let result;
        if (tool === 'fresh402_extract')
            result = { url: input.url, final_url: input.url, content_kind: 'html', title: doc.title, text: doc.text, hash: hash(doc.text), truncated: false, headings: [], links: [], structured_data: [], warnings: ['contract_simulation_only'] };
        else {
            const watch = watches.get(input.watch_id);
            if (!watch)
                return { error: 'watch_not_found', status: 404 };
            const changed = watch.hash !== hash(doc.text);
            result = tool === 'fresh402_check' ? { watch_id: input.watch_id, hash: hash(doc.text), changed } : { watch_id: input.watch_id, hash: hash(doc.text), changed, changes: { added: [], removed: [], modified: changed ? [{ path: '/document', before: watch.text, after: doc.text }] : [] }, counts: { added: 0, removed: 0, modified: changed ? 1 : 0 }, significance: { score: changed ? 20 : 0, level: changed ? 'low' : 'none', reasons: [], rules_version: 2 }, semantic_model_used: false };
            if (tool === 'fresh402_check')
                watches.set(input.watch_id, { hash: hash(doc.text), text: doc.text });
        }
        const delivery = { result, receipt: { success: true, payer: '0x1111111111111111111111111111111111111111', transaction: '0x' + hash(String(nonce)), network: 'eip155:8453' } };
        ledger.set(nonce, { key: hash(key), fingerprint, delivery });
        return delivery;
    }
    const server = createServer(async (req, res) => {
        const send = (status: number, body: any, headers: any = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
        try {
            if (req.method === 'GET' && req.url === '/openapi.json') {
                send(200, { openapi: '3.1.0', info: { version: '2.0.0', title: 'Fresh402 public-contract demo' }, paths: Object.fromEntries(defs.map(([tool, path, amount]) => [path, { post: { operationId: tool, summary: 'Local ' + tool + ' simulation', requestBody: { content: { 'application/json': { schema: { type: 'object' } } } }, ...(amount ? { 'x-payment-info': { price: { amount: String(amount / 1e6), currency: 'USD' } } } : {}) } }])) });
                return;
            }
            let bytes = 0, chunks: Buffer[] = [];
            for await (const chunk of req) {
                bytes += chunk.length;
                if (bytes > 65536) {
                    send(413, { error: 'request_too_large' });
                    return;
                }
                chunks.push(chunk);
            }
            const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
            if (req.url === '/mcp') {
                if (body.method === 'notifications/initialized') {
                    res.writeHead(202);
                    res.end();
                    return;
                }
                const result = body.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'Fresh402 Contract Demo', version: '2.0.0' } } : body.method === 'tools/list' ? { tools: defs.map(([name]) => ({ name, description: 'Local simulation', inputSchema: { type: 'object' } })) } : null;
                if (result) {
                    send(200, { jsonrpc: '2.0', id: body.id, result });
                    return;
                }
                const meta = body.params?._meta ?? {}, r = invoke(body.params.name, body.params.arguments, meta['x402/payment'], meta['fresh402/recovery-token'] ?? '', 'mcp');
                const data = r.challenge ?? (r.error ? { error: r.error, status: r.status } : r.result);
                send(200, { jsonrpc: '2.0', id: body.id, result: { ...(r.challenge || r.error ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(r.receipt ? { _meta: { 'x402/payment-response': r.receipt } } : {}) } });
                return;
            }
            const def = defs.find(d => d[1] === req.url);
            if (!def) {
                send(404, { error: 'not_found' });
                return;
            }
            const signature = req.headers['payment-signature'], payment = signature ? JSON.parse(Buffer.from(String(signature), 'base64').toString()) : undefined, r = invoke(def[0], body, payment, String(req.headers['x-fresh402-recovery-token'] ?? ''), 'rest');
            if (r.challenge)
                send(402, r.challenge, { 'payment-required': Buffer.from(JSON.stringify(r.challenge)).toString('base64') });
            else if (r.error)
                send(r.status, { error: r.error });
            else
                send(200, r.result, r.receipt ? { 'payment-response': Buffer.from(JSON.stringify(r.receipt)).toString('base64') } : {});
        }
        catch {
            send(400, { error: 'invalid_demo_request' });
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = 'http://127.0.0.1:' + (server.address() as any).port;
    return { base: origin, set: (newVersion: number, newClock: string) => { version = newVersion; clock = newClock; }, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
