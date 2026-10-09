import {readFile} from 'node:fs/promises';
import {gatewayCodeHash} from '../gateway/egress.mjs';
export function checkImageBoundary(dockerfile,ignore) {
  if(!/^FROM node:24-slim@sha256:[a-f\d]{64}$/m.test(dockerfile)||!/^USER node$/m.test(dockerfile)||/\b(?:ADD|RUN)\b/.test(dockerfile))throw new Error('Gateway image must use the reviewed immutable non-root runtime');
  const rules=ignore.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
  const expected=['**','!src/','!src/network-policy.mjs','!gateway/','!gateway/Dockerfile','!gateway/egress.mjs','!gateway/server.mjs','!gateway/network-self-test.mjs'];
  if(JSON.stringify(rules)!==JSON.stringify(expected))throw new Error('Image build context must exclude source history, secrets and private records');
  const copies=dockerfile.split(/\r?\n/).filter(line=>line.startsWith('COPY '));
  if(copies.join('\n')!=='COPY src/network-policy.mjs ./src/network-policy.mjs\nCOPY gateway/egress.mjs gateway/server.mjs gateway/network-self-test.mjs ./gateway/')throw new Error('Unexpected gateway image content');
}
export async function verifyImageConfiguration() {
  const [dockerfile,ignore,raw]=await Promise.all(['../gateway/Dockerfile','../.dockerignore','../wrangler.jsonc'].map(file=>readFile(new URL(file,import.meta.url),'utf8')));
  checkImageBoundary(dockerfile,ignore);const config=JSON.parse(raw.slice(raw.indexOf('{')));
  if(config.env.staging.vars.GATEWAY_CODE_HASH!==gatewayCodeHash())throw new Error('Staging gateway image source identity is stale');
  return {build_context:'passed',image_layers_built:false,gateway_code_hash:gatewayCodeHash()};
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/container-build-check.mjs'))console.log(JSON.stringify(await verifyImageConfiguration()));
