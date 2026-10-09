import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {checkImageBoundary,verifyImageConfiguration} from './container-build-check.mjs';
test('private records/history and secrets are excluded from the reviewed image context',async()=>{assert.equal((await verifyImageConfiguration()).build_context,'passed');});
test('build validation rejects a floating image tag or broad context copy',async()=>{
  const image=await readFile(new URL('../gateway/Dockerfile',import.meta.url),'utf8'),ignore=await readFile(new URL('../.dockerignore',import.meta.url),'utf8');
  assert.throws(()=>checkImageBoundary(image.replace(/@sha256:[a-f\d]{64}/,''),ignore));assert.throws(()=>checkImageBoundary(image+'\nCOPY . /app\n',ignore));assert.throws(()=>checkImageBoundary(image,ignore+'\n!.env\n'));
});
