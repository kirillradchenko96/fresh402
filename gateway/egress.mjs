import {resolve4,resolve6} from 'node:dns/promises';
import {isIP,connect as connectTcp} from 'node:net';
import {connect as connectTls,checkServerIdentity} from 'node:tls';
import {request as httpsRequest,Agent} from 'node:https';
import {createServer} from 'node:http';
import {createGunzip,createInflate,createBrotliDecompress} from 'node:zlib';
import {timingSafeEqual} from 'node:crypto';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalAddress,isPublicAddress,validateHttpsUrl} from '../src/network-policy.mjs';
const MAX_BYTES=5_000_000,DEADLINE_MS=10_000;
export const gatewayCodeHash=()=>createHash('sha256').update(['./egress.mjs','../src/network-policy.mjs','./server.mjs'].map(file=>readFileSync(new URL(file,import.meta.url),'utf8').replaceAll('\r\n','\n')).join('\0')).digest('hex');
export class EgressError extends Error {constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export async function resolvePublic(host) {
  if(isIP(host)) {if(!isPublicAddress(host))throw new EgressError('target_not_allowed');return [host];}
  const answers=await Promise.all([resolve4(host),resolve6(host)].map(promise=>promise.catch(error=>{if(['ENODATA','ENOTFOUND'].includes(error.code))return [];throw new EgressError('dns_unavailable',502);})));
  const addresses=[...new Set(answers.flat())];
  if(!addresses.length)throw new EgressError('dns_unavailable',502);
  if(addresses.some(address=>!isIP(address)||!isPublicAddress(address)))throw new EgressError('target_not_allowed');
  return addresses.sort((a,b)=>isIP(a)-isIP(b)); // Prefer IPv4, still support native IPv6.
}
export async function readUpstreamBody(response,limit=MAX_BYTES) {
  const declared=response.headers['content-length'];
  if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw new EgressError('content_too_large',413);
  const encoding=response.headers['content-encoding'];
  const decoder=!encoding||encoding==='identity'?null:encoding==='gzip'?createGunzip():encoding==='deflate'?createInflate():encoding==='br'?createBrotliDecompress():undefined;
  if(decoder===undefined)throw new EgressError('unsupported_content_encoding',502);
  let compressed=0,size=0,bytes=Buffer.allocUnsafe(Math.min(65536,limit));
  const count=chunk=>{compressed+=chunk.length;if(compressed>limit)response.destroy(new EgressError('content_too_large',413));};
  const fail=error=>decoder?.destroy(error);
  response.on('data',count);response.on('error',fail);
  try {
    const stream=decoder?response.pipe(decoder):response;
    for await(const chunk of stream) {
      if(chunk.length>limit-size)throw new EgressError('content_too_large',413);
      if(size+chunk.length>bytes.length){const grown=Buffer.allocUnsafe(Math.min(limit,Math.max(bytes.length*2,size+chunk.length)));bytes.copy(grown,0,0,size);bytes=grown;}
      chunk.copy(bytes,size);size+=chunk.length;
    }
    if(declared!==undefined&&Number(declared)!==compressed)throw new EgressError('upstream_error',502);
    return bytes.subarray(0,size);
  } finally {response.off('data',count);response.off('error',fail);decoder?.destroy();}
}
export async function fetchPinned(raw,{validators={},signal,resolver=resolvePublic,trace=()=>{}}={}) {
  let url;try{url=validateHttpsUrl(raw);}catch{throw new EgressError('target_not_allowed');}
  const host=url.hostname.replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!validators||typeof validators!=='object'||Array.isArray(validators)||Object.keys(validators).some(key=>!['etag','last_modified'].includes(key)))throw new EgressError('invalid_validators');
  for(const value of Object.values(validators))if(value!=null&&(typeof value!=='string'||value.length>1024||/[\r\n\u0000]/.test(value)))throw new EgressError('invalid_validators');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new EgressError('upstream_timeout',504)),DEADLINE_MS);
  const abort=()=>controller.abort(new EgressError('request_cancelled',408));signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  let tcp,tls,request,selected;
  const stop=()=>{const error=controller.signal.aborted?new EgressError('upstream_timeout',504):undefined;request?.destroy(error);tls?.destroy(error);tcp?.destroy(error);};
  controller.signal.addEventListener('abort',stop,{once:true});
  try {
    controller.signal.throwIfAborted();
    const addresses=await Promise.race([resolver(host),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new EgressError('upstream_timeout',504)),{once:true}))]);
    if(!addresses.length||addresses.some(address=>!isIP(address)||!isPublicAddress(address)))throw new EgressError('target_not_allowed');
    controller.signal.throwIfAborted();
    selected=canonicalAddress(addresses[0]);
    // The TCP destination is a validated literal. No second hostname resolution.
    tcp=connectTcp({host:selected,port:443,family:isIP(selected)});
    await new Promise((resolve,reject)=>{tcp.once('connect',resolve);tcp.once('error',reject);});
    const peer=canonicalAddress(tcp.remoteAddress??'');
    if(peer!==selected||!isPublicAddress(peer)){trace({event:'peer_denied',selected,peer});throw new EgressError('target_not_allowed');}
    trace({event:'tcp_connected',selected,peer});
    tls=connectTls({socket:tcp,servername:isIP(host)?undefined:host,rejectUnauthorized:true,checkServerIdentity:(_name,certificate)=>checkServerIdentity(host,certificate)});
    await new Promise((resolve,reject)=>{tls.once('secureConnect',resolve);tls.once('error',reject);});
    if(!tls.authorized||checkServerIdentity(host,tls.getPeerCertificate()))throw new EgressError('tls_verification_failed',502);
    trace({event:'connected',selected,peer,tls_verified:true});
    const headers={'user-agent':'Fresh402/2.0.0-rc.1',accept:'text/html,application/json,text/plain,*/*;q=0.1','accept-encoding':'identity'};
    for(const [input,output]of [['etag','if-none-match'],['last_modified','if-modified-since']])if(validators[input]!=null)headers[output]=validators[input];
    const agent=new Agent({keepAlive:false,maxSockets:1});agent.createConnection=()=>tls;
    return await new Promise((resolve,reject)=>{
      request=httpsRequest(url,{agent,method:'GET',headers,maxHeaderSize:16384},async response=>{
        try {
          const status=response.statusCode;if(!status||status<200||status>599)throw new EgressError('upstream_error',502);
          const kept={};for(const name of ['content-type','etag','last-modified','location'])if(typeof response.headers[name]==='string'&&response.headers[name].length<=8192)kept[name]=response.headers[name];
          if(status<200||status>=300){response.destroy();resolve({status,headers:kept,body:Buffer.alloc(0)});return;}
          const body=await readUpstreamBody(response);
          resolve({status,headers:kept,body});
        }catch(error){response.destroy();reject(error);}
      });
      request.once('upgrade',(_response,socket)=>{socket.destroy();reject(new EgressError('upstream_upgrade_not_allowed',502));});
      request.once('error',reject);request.end();
    });
  }catch(error){if(controller.signal.aborted)throw controller.signal.reason;if(error instanceof EgressError)throw error;if(selected?.includes(':')&&['ENETUNREACH','EHOSTUNREACH','EAFNOSUPPORT'].includes(error.code))throw new EgressError('ipv6_unavailable',502);throw new EgressError(error.code?.startsWith('CERT_')||error.code?.includes('CERT')||error.code?.includes('SELF_SIGNED')?'tls_verification_failed':'upstream_error',502);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);stop();}
}
export async function createGateway({token,trace=()=>{},port=0,host='127.0.0.1',maxActive=4}={}) {
  if(typeof token!=='string'||token.length<43)throw new Error('Gateway authentication is required');
  if(!Number.isInteger(maxActive)||maxActive<1||maxActive>4)throw new Error('Gateway capacity is invalid');
  let active=0;
  const metrics={policy:'literal-public-tls-v1',code_hash:gatewayCodeHash(),requests:0,completed:0,rejected:0,bytes:0,cpu_us:0,wall_ms:0,last_peer:null};
  const server=createServer({maxHeaderSize:16384},async(incoming,outgoing)=>{
    outgoing.on('error',()=>{});
    outgoing.setHeader('cache-control','no-store');outgoing.setHeader('x-content-type-options','nosniff');
    const supplied=incoming.headers.authorization?.replace(/^Bearer /,'');
    if(!supplied||Buffer.byteLength(supplied)!==Buffer.byteLength(token)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){outgoing.writeHead(403);outgoing.end();return;}
    if(incoming.method==='GET'&&incoming.url==='/health'){outgoing.writeHead(200,{'content-type':'application/json'});outgoing.end(JSON.stringify({...metrics,active,max_active:maxActive,node:process.version,uptime_s:process.uptime(),rss_bytes:process.memoryUsage().rss}));return;}
    if(incoming.method!=='POST'||incoming.url!=='/fetch'){outgoing.writeHead(405);outgoing.end();return;}
    if(active>=maxActive){metrics.rejected++;outgoing.writeHead(429,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:'egress_capacity_exceeded'}));return;}
    metrics.requests++;const started=Date.now(),cpu=process.cpuUsage();
    active++;const controller=new AbortController();
    const deadline=setTimeout(()=>{controller.abort();outgoing.destroy();},12000);
    let released=false;const release=()=>{if(released)return;released=true;active--;clearTimeout(deadline);};
    incoming.once('aborted',()=>controller.abort());outgoing.once('finish',release);outgoing.once('close',()=>{controller.abort();release();});
    try {
      if(incoming.headers['content-type']!=='application/json')throw new EgressError('invalid_request');
      let size=0;const chunks=[];for await(const chunk of incoming){size+=chunk.length;if(size>8192)throw new EgressError('invalid_request');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['url','validators'].includes(key)))throw new EgressError('invalid_request');
      const result=await fetchPinned(input.url,{validators:input.validators,signal:controller.signal,trace:event=>{if(event.event==='connected')metrics.last_peer={selected:event.selected,peer:event.peer,tls_verified:event.tls_verified};trace(event);}});
      metrics.completed++;metrics.bytes+=result.body.length;
      outgoing.writeHead(200,{'x-fresh402-upstream-status':String(result.status),'x-fresh402-egress-policy':'literal-public-tls-v1',...result.headers});outgoing.end(result.body);
    }catch(error){metrics.rejected++;const code=error instanceof EgressError?error.code:'invalid_request';trace({event:'denied',code});if(!outgoing.destroyed){outgoing.writeHead(error instanceof EgressError?error.status:400,{'content-type':'application/json'});outgoing.end(JSON.stringify({error:code}));}}
    finally {const used=process.cpuUsage(cpu);metrics.cpu_us+=used.user+used.system;metrics.wall_ms+=Date.now()-started;}
  });
  server.on('connect',(_request,socket)=>socket.destroy());server.on('upgrade',(_request,socket)=>socket.destroy());
  server.requestTimeout=12000;server.headersTimeout=10000;server.keepAliveTimeout=1000;server.maxConnections=32;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});return server;
}
