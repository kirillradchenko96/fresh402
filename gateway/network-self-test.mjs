// Bounded operator-only CLI acceptance. No HTTP endpoint enables these resolver
// fixtures. Never signs payments, reads CDP credentials, or mutates databases.
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {Resolver} from 'node:dns/promises';
import {fetchPinned,resolvePublic,gatewayCodeHash} from './egress.mjs';
const results=[];
const deadline=setTimeout(()=>{console.error('network_acceptance_deadline');process.exit(1);},90000);
async function attempt(name,url,options={},expectedError) {
  const events=[],start=Date.now();let fetched,error;
  try {fetched=await fetchPinned(url,{...options,trace:event=>events.push(event)});}catch(caught){error=caught.code;}
  if(expectedError)assert.equal(error,expectedError,name);else assert.equal(fetched?.status,200,name);
  const connected=events.find(event=>event.event==='connected');
  if(!expectedError){assert.ok(connected?.tls_verified);assert.equal(connected.selected,connected.peer);}
  const record={name,status:'passed',wall_ms:Date.now()-start,error,bytes:fetched?.body.length,connection:connected?{selected:connected.selected,peer:connected.peer,tls_verified:true}:undefined};results.push(record);return record;
}
function dnsName(name){return Buffer.concat([...name.split('.').map(part=>Buffer.concat([Buffer.from([part.length]),Buffer.from(part)])),Buffer.from([0])]);}
function record(owner,type,data){const tail=Buffer.alloc(10);tail.writeUInt16BE(type);tail.writeUInt16BE(1,2);tail.writeUInt16BE(data.length,8);return Buffer.concat([owner,tail,data]);}
try {
  await attempt('public Cloudflare IPv4 HTTPS','https://example.com/');
  await attempt('additional public HTTPS','https://www.iana.org/domains/reserved');
  const nonCloudflare=await attempt('public non-Cloudflare HTTPS','https://wordpress.com/');
  const ranges=await (await fetch('https://www.cloudflare.com/ips-v4',{signal:AbortSignal.timeout(5000)})).text();
  const integer=ip=>ip.split('.').reduce((n,part)=>(n*256+Number(part))>>>0,0),peer=integer(nonCloudflare.connection.peer);
  assert.ok(!ranges.trim().split(/\s+/).some(cidr=>{const [network,bits]=cidr.split('/'),shift=32-Number(bits);return (peer>>>shift)===(integer(network)>>>shift);}), 'Non-Cloudflare fixture must use a peer outside published Cloudflare IPv4 ranges');
  await attempt('hostname certificate mismatch','https://wrong.host.badssl.com/',{},'tls_verification_failed');
  await attempt('expired certificate','https://expired.badssl.com/',{},'tls_verification_failed');
  for(const url of ['https://127.1/','https://169.254.169.254/','https://[::1]/','https://[fd00::1]/','https://[::ffff:127.0.0.1]/','https://192.0.2.1/','https://fresh402-staging.kirilllabs.workers.dev/','https://gateway/','https://user:pass@example.com/','https://example.com:8443/'])await attempt('unsafe destination rejected',url,{},'target_not_allowed');
  const addresses=await resolvePublic('example.com'),publicV4=addresses.find(ip=>!ip.includes(':'));
  assert.ok(publicV4);
  let answers=0,chain=false;const dns=createSocket('udp4');
  dns.on('message',(question,peer)=>{
    let offset=12;while(question[offset])offset+=question[offset]+1;const end=offset+5,type=question.readUInt16BE(offset+1),rr=[];
    if(type===1) {
      const address=++answers===1||chain?publicV4:'127.0.0.1';
      if(chain){rr.push(record(Buffer.from([0xc0,0x0c]),5,dnsName('first.public.test')));rr.push(record(dnsName('first.public.test'),5,dnsName('second.public.test')));rr.push(record(dnsName('second.public.test'),1,Buffer.from(address.split('.').map(Number))));}
      else rr.push(record(Buffer.from([0xc0,0x0c]),1,Buffer.from(address.split('.').map(Number))));
    }
    const header=Buffer.alloc(12);question.copy(header,0,0,2);header.writeUInt16BE(0x8180,2);header.writeUInt16BE(1,4);header.writeUInt16BE(rr.length,6);dns.send(Buffer.concat([header,question.subarray(12,end),...rr]),peer.port,peer.address);
  });
  await new Promise(resolve=>dns.bind(0,'127.0.0.1',resolve));
  try {
    const resolver=new Resolver({timeout:1000,tries:1});resolver.setServers(['127.0.0.1:'+dns.address().port]);
    await attempt('DNS rotation stays on the validated literal peer','https://example.com/',{resolver:host=>resolver.resolve4(host)});
    assert.equal(answers,1);assert.deepEqual(await resolver.resolve4('example.com'),['127.0.0.1']);
    await attempt('rotated private answer never connects','https://example.com/',{resolver:host=>resolver.resolve4(host)},'target_not_allowed');
    chain=true;await attempt('controlled CNAME chain retains original hostname TLS','https://example.com/',{resolver:host=>resolver.resolve4(host)});
  }finally{dns.close();}
  const ipv6=addresses.find(ip=>ip.includes(':'));
  if(ipv6) {
    const events=[];try {const result=await fetchPinned('https://example.com/',{resolver:async()=>[ipv6],trace:event=>events.push(event)});assert.equal(result.status,200);const connection=events.find(event=>event.event==='connected');assert.ok(connection?.tls_verified);assert.equal(connection.peer,connection.selected);results.push({name:'native public IPv6 HTTPS',status:'passed',connection});}
    catch(error){results.push({name:'native public IPv6 HTTPS',status:error.code==='ipv6_unavailable'?'unsupported':'unverified',error:error.code??error.name});}
  }else results.push({name:'native public IPv6 HTTPS',status:'no_public_answer'});
  console.log(JSON.stringify({runtime:process.version,platform:process.platform,code_hash:gatewayCodeHash(),results,new_payments:0}));
}catch(error){console.error(JSON.stringify({status:'failed',name:error.name,actual:error.actual,expected:error.expected}));process.exitCode=1;}
finally{clearTimeout(deadline);}
