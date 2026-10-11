import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Fresh402Client, localMockSigner, syncDocumentation, PendingPayment } from './client.ts';
import { startContractDemo } from './demo.ts';
const args = process.argv.slice(2), transport = args.includes('--mcp') ? 'mcp' : 'rest';
if (args.includes('--demo')) {
    const demo = await startContractDemo(), stateDir = join(tmpdir(), 'fresh402-customer-demo-' + randomUUID());
    await mkdir(stateDir, { mode: 0o700 });
    try {
        const client = new Fresh402Client(demo.base, { transport, signer: localMockSigner(demo.base), maxAtomicUSDC: 100000n, persist: async (operation) => { const path = join(stateDir, operation.recoveryToken + '.json'), temporary = path + '.tmp'; await writeFile(temporary, JSON.stringify(operation), { mode: 0o600 }); await rename(temporary, path); } });
        await client.discover();
        let state = {};
        for (const [version, clock] of [[1, '10:00'], [1, '11:00'], [1, '12:00'], [1, '13:00'], [2, '14:00']] as const) {
            demo.set(version, clock);
            state = await syncDocumentation(client, 'https://documentation.fixture.example/', state, { ignore_selectors: ['.clock'] });
            await writeFile(join(stateDir, 'knowledge-base.json'), JSON.stringify(state, null, 2), { mode: 0o600 });
        }
        console.log(JSON.stringify({ mode: 'PUBLIC CONTRACT SIMULATOR, not real Fresh402 execution', real_USDC_moved: 0, transport, polls: 5, extractions: (state as any).refreshes, mock_service_atomic: client.reserved.toString(), private_state_directory: stateDir, knowledge_base_file: join(stateDir, 'knowledge-base.json') }));
    }
    catch (error) {
        console.error(error instanceof PendingPayment ? 'Pending operation retained privately; recover it without new signing.' : error instanceof Error ? error.message : 'Demo failed');
        process.exitCode = 1;
    }
    finally {
        await demo.close();
    }
}
else {
    const client = new Fresh402Client('https://fresh402.kirilllabs.workers.dev', { transport });
    const discovered = await client.discover();
    const products = [];
    for (const tool of ['fresh402_check', 'fresh402_extract', 'fresh402_smart_diff']) {
        const input = transport === 'mcp' ? (tool === 'fresh402_smart_diff' ? { watch_id: 'w_0123456789abcdef0123456789abcdef' } : { url: 'https://example.com/' }) : {};
        const challenge = await client.quote(tool, input);
        products.push({ tool, resource: challenge.resource.url, atomic_USDC: challenge.accepts[0].amount, network: challenge.accepts[0].network });
    }
    console.log(JSON.stringify({ mode: 'LIVE DISCOVERY ONLY; MCP uses schema-valid illustrative arguments, not an existing watch', version: discovered.version, products, real_USDC_moved: 0 }));
}
