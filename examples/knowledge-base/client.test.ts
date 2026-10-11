import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { Fresh402Client, localMockSigner, syncDocumentation, PendingPayment, PaymentRequired } from './client.ts';
import { startContractDemo } from './demo.ts';
for (const transport of ['rest', 'mcp'] as const)
    test('public-contract ' + transport + ' discovery, noise filtering and private recovery', async () => {
        const demo = await startContractDemo(), operations = new Map<string, any>();
        try {
            const client = new Fresh402Client(demo.base, { transport, maxAtomicUSDC: 100000n, signer: localMockSigner(demo.base), persist: async (op) => { operations.set(op.recoveryToken, structuredClone(op)); } });
            assert.equal((await client.discover()).version, '2.0.0');
            let state = await syncDocumentation(client, 'https://documentation.fixture.example/');
            assert.equal(state.refreshes, 1);
            assert.equal(client.reserved, 10000n);
            demo.set(1, '11:00');
            state = await syncDocumentation(client, 'https://documentation.fixture.example/', state);
            assert.equal(state.refreshes, 1);
            demo.set(2, '12:00');
            state = await syncDocumentation(client, 'https://documentation.fixture.example/', state);
            assert.equal(state.refreshes, 2);
            assert.ok(state.document.text.includes('seven days'));
            const op = [...operations.values()].at(-1), replay = await client.recover(op);
            assert.deepEqual(replay.result, op.result);
            const token = op.recoveryToken, error = new PendingPayment(op, new Error('timeout'));
            assert.ok(!inspect(error).includes(token), 'Error logs must not expose recovery tokens');
        }
        finally {
            await demo.close();
        }
    });
test('live mock signer cannot be created, no-budget mode cannot sign', async () => { assert.throws(() => localMockSigner('https://fresh402.kirilllabs.workers.dev')); const demo = await startContractDemo(); try {
    const client = new Fresh402Client(demo.base);
    await client.discover();
    await assert.rejects(client.execute('fresh402_extract', { url: 'https://documentation.fixture.example/' }), PaymentRequired);
}
finally {
    await demo.close();
} });
test('explicit cap and persisted authorization precede signing/delivery', async () => { const demo = await startContractDemo(); let called = 0; try {
    const client = new Fresh402Client(demo.base, { signer: async (c) => { called++; return localMockSigner(demo.base)(c); }, maxAtomicUSDC: 5000n, persist: async () => { } });
    await client.discover();
    await assert.rejects(client.execute('fresh402_extract', { url: 'https://documentation.fixture.example/' }), /cap exceeded/);
    assert.equal(called, 0);
}
finally {
    await demo.close();
} });
test('semantically identical reordered SDK requirements remain compatible', async () => { const demo = await startContractDemo(); try {
    const sign = localMockSigner(demo.base), client = new Fresh402Client(demo.base, { maxAtomicUSDC: 10000n, persist: async () => { }, signer: async (c) => { const payload = await sign(c); payload.accepted = Object.fromEntries(Object.entries(payload.accepted).reverse()); return payload; } });
    await client.discover();
    assert.equal((await client.execute('fresh402_extract', { url: 'https://documentation.fixture.example/' })).operation.state, 'completed');
}
finally {
    await demo.close();
} });
