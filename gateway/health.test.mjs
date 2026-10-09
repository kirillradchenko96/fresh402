import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway,gatewayCodeHash} from './egress.mjs';
test('authenticated readiness is small, identifies the image code, and performs no target fetch',async()=>{
  const token='x'.repeat(43),events=[],server=await createGateway({token,maxActive:2,trace:event=>events.push(event)}),base='http://127.0.0.1:'+server.address().port;
  try {
    assert.equal((await fetch(base+'/health')).status,403);
    const response=await fetch(base+'/health',{headers:{authorization:'Bearer '+token}}),health=await response.json();
    assert.equal(health.policy,'literal-public-tls-v1');assert.equal(health.code_hash,gatewayCodeHash());assert.equal(health.max_active,2);assert.equal(health.active,0);assert.equal(health.requests,0);assert.equal(health.last_peer,null);assert.deepEqual(events,[]);assert.ok(!JSON.stringify(health).includes(token));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('invalid or excessive instance capacity cannot start a gateway server',async()=>{
  for(const maxActive of [0,5,NaN,1.5])await assert.rejects(createGateway({token:'x'.repeat(43),maxActive}),/capacity/);
});
