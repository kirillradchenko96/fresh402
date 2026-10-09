import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {gzipSync,deflateSync,brotliCompressSync} from 'node:zlib';
import {connect} from 'node:net';
import {fetchPinned,readUpstreamBody,createGateway} from './egress.mjs';
function body(bytes,headers={}) {const stream=Readable.from([bytes]);stream.headers=headers;return stream;}
for(const [encoding,encode] of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]]) {
  test('bounded '+encoding+' decoding preserves valid content',async()=>{const packed=encode(Buffer.from('small public document'));assert.equal((await readUpstreamBody(body(packed,{'content-encoding':encoding,'content-length':String(packed.length)}))).toString(),'small public document');});
  test('decoded '+encoding+' bomb exceeds the output cap',async()=>{await assert.rejects(readUpstreamBody(body(encode(Buffer.alloc(10001)),{'content-encoding':encoding}),10000),{code:'content_too_large'});});
}
test('compressed input independently obeys the transfer cap',async()=>{await assert.rejects(readUpstreamBody(body(gzipSync(Buffer.from('random noncompressible input')),{'content-encoding':'gzip'}),16),{code:'content_too_large'});});
test('declared oversized body is rejected before streaming',async()=>{await assert.rejects(readUpstreamBody(body(Buffer.alloc(1),{'content-length':'10001'}),10000),{code:'content_too_large'});});
test('truncated compressed data cannot become a successful result',async()=>{await assert.rejects(readUpstreamBody(body(gzipSync(Buffer.from('document')).subarray(0,12),{'content-encoding':'gzip'})));});
test('content-length mismatch cannot become a successful result',async()=>{await assert.rejects(readUpstreamBody(body(Buffer.from('short'),{'content-length':'20'})),{code:'upstream_error'});});
test('unsupported stacked encoding fails safely',async()=>{await assert.rejects(readUpstreamBody(body(Buffer.alloc(0),{'content-encoding':'gzip, br'})),{code:'unsupported_content_encoding'});});
for(const validators of [{etag:'a\r\nAuthorization: secret'},{last_modified:'a\0b'},{etag:'x'.repeat(1025)}])test('invalid validators are rejected before DNS or sockets',async()=>{let resolves=0;await assert.rejects(fetchPinned('https://example.com/',{validators,resolver:async()=>{resolves++;return ['8.8.8.8'];}}),{code:'invalid_validators'});assert.equal(resolves,0);});
test('pre-aborted fetch performs no DNS or network work',async()=>{const controller=new AbortController();controller.abort();let resolves=0;await assert.rejects(fetchPinned('https://example.com/',{signal:controller.signal,resolver:async()=>{resolves++;return ['8.8.8.8'];}}),{code:'request_cancelled'});assert.equal(resolves,0);});
test('authenticated slow uploads consume at most four admission slots',async()=>{
  const token='x'.repeat(43),server=await createGateway({token}),port=server.address().port,sockets=[];
  try {
    for(let i=0;i<4;i++) {const socket=connect({host:'127.0.0.1',port});sockets.push(socket);await new Promise(resolve=>socket.once('connect',resolve));socket.write('POST /fetch HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer '+token+'\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n');}
    await new Promise(resolve=>setTimeout(resolve,20));
    const rejected=await fetch('http://127.0.0.1:'+port+'/fetch',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{}'});assert.equal(rejected.status,429);assert.equal((await rejected.json()).error,'egress_capacity_exceeded');
  }finally {for(const socket of sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('inbound headers exceeding 16 KiB are rejected by the HTTP parser',async()=>{
  const server=await createGateway({token:'x'.repeat(43)});
  try {const result=await fetch('http://127.0.0.1:'+server.address().port+'/fetch',{headers:{'x-large':'x'.repeat(17000)}});assert.equal(result.status,431);await result.body?.cancel();}
  finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
for(const url of ['https://fresh402.kirilllabs.workers.dev/','https://fresh402-staging.kirilllabs.workers.dev/','https://preview-fresh402.kirilllabs.workers.dev/',' https://example.com/','https://example.com/\n','https:\\example.com/'])test('gateway denies self or ambiguous URL parsing '+JSON.stringify(url),async()=>{let calls=0;await assert.rejects(fetchPinned(url,{resolver:async()=>{calls++;return ['8.8.8.8'];}}),{code:'target_not_allowed'});assert.equal(calls,0);});
