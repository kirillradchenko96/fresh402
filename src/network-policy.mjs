// Public Internet policy shared by the Worker and the literal-IP egress gateway.
export function canonicalAddress(value) {
  const host = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.startsWith('::ffff:')) {
    const suffix=host.slice(7);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(suffix)) return suffix;
    const parts=suffix.split(':');
    if(parts.length===2&&parts.every(part=>/^[\da-f]{1,4}$/.test(part))) {const high=parseInt(parts[0],16),low=parseInt(parts[1],16);return `${high>>8}.${high&255}.${low>>8}.${low&255}`;}
  }
  try {return new URL(host.includes(':')?`https://[${host}]/`:`https://${host}/`).hostname.replace(/^\[|\]$/g,'');} catch {return '';}
}
export function isPublicAddress(value) {
  const host=value.toLowerCase().replace(/^\[|\]$/g,'');
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const bytes=host.split('.').map(Number);if(bytes.some((byte,index)=>byte>255||String(byte)!==host.split('.')[index]))return false;
    const [a,b,c]=bytes;
    return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0&&(c===0||c===2)||a===192&&b===88&&c===99||a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113||a>=224||host==='168.63.129.16');
  }
  if(!host.includes(':')||host.includes('%'))return false;
  let normalized;try {normalized=new URL(`https://[${host}]/`).hostname.slice(1,-1);}catch{return false;}
  const words=normalized.split(':'),first=parseInt(words[0],16);
  // Global IPv6 unicast only; exclude transition and special-purpose ranges.
  return first>=0x2000&&first<=0x3fff&&!(first===0x2001&&(parseInt(words[1]||'0',16)<0x200||words[1]==='db8'))&&first!==0x2002&&first!==0x3fff;
}
export function validateHttpsUrl(raw) {
  if(typeof raw!=='string'||raw.length>4096||/[\u0000-\u0020\u007f\\]/.test(raw)||!/^https:\/\//i.test(raw))throw new Error('target_not_allowed');
  let url;try{url=new URL(raw);}catch{throw new Error('target_not_allowed');}
  if(url.protocol!=='https:'||url.port!==''||url.username||url.password)throw new Error('target_not_allowed');
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  if(!host||(!host.includes('.')&&!host.includes(':'))||/(^|\.)(localhost|local|internal|lan)$/.test(host))throw new Error('target_not_allowed');
  if(isServiceHostname(host))throw new Error('target_not_allowed');
  if((host.includes(':')||/^\d+(\.\d+){3}$/.test(host))&&!isPublicAddress(host))throw new Error('target_not_allowed');
  for(const name of url.searchParams.keys())if(['access_token','api_key','apikey','auth','authorization','token','signature','x-amz-signature','x-goog-signature'].includes(name.toLowerCase()))throw new Error('target_not_allowed');
  url.hash='';return url;
}

// Prevent recursion into this service, its previews and privileged account Workers.
// This is a denylist of our own infrastructure, not a public-site allowlist.
export function isServiceHostname(value) {
  const host=value.toLowerCase().replace(/\.$/,'');
  return host==='kirilllabs.workers.dev'||host.endsWith('.kirilllabs.workers.dev')||host==='fresh402-egress.invalid'||host==='gateway';
}
