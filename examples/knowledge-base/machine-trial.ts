/** Browserless public contract, no wallet connection, signing or network calls on import. */
type Json=Record<string,any>;
function origin(value:string){const u=new URL(value);if(u.protocol!=='https:'||u.origin!==value||u.username||u.password)throw Error('Use the exact trusted HTTPS API origin');return value;}
async function call(base:string,path:string,body?:Json){const r=await fetch(origin(base)+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});if(!r.body)throw Error('Empty trial response');const reader=r.body.getReader(),parts:Uint8Array[]=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384)throw Error('Trial response exceeds limit');parts.push(value);}}catch(e){void reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}const text=Buffer.concat(parts).toString('utf8');let json;try{json=JSON.parse(text);}catch{throw Error('Invalid machine-trial response');}if(!r.ok)throw Error('Machine trial HTTP '+r.status+'; no payment fallback');return json;}
export async function prepareMachineTrialChallenge(base:string,wallet:string){
 const info=await call(base,'/v3/agent-trial');if(!info.enabled||info.captcha_required!==false||info.payments_automatic!==false)throw Error('Machine trial unavailable; no payment or CAPTCHA fallback');
 if(!/^0x[a-f0-9]{40}$/i.test(wallet))throw Error('Use an existing EOA address');
 const c=await call(base,'/v3/agent-trial/challenge',{wallet});
 const expected='Fresh402 machine trial wallet control\nWallet: '+wallet.toLowerCase()+'\nOrigin: '+origin(base)+'\nChallenge: '+c.challenge_id+'\nExpires: '+new Date(c.expires_at).toISOString()+'\nPurpose: bounded one-time machine trial and credential rotation only. No transfer, approval, funded wallet, purchase or unique-agent claim.';
 if(!/^ma_[a-f0-9]{64}$/.test(c.challenge_id)||c.message!==expected||c.no_payment!==true||c.signature_method!=='personal_sign'||!Number.isSafeInteger(c.expires_at)||c.expires_at<=Date.now()||c.expires_at>Date.now()+300000)throw Error('Unexpected ownership message; do not sign');return c;
}
/** Caller supplies only an explicitly permitted EIP-191 ownership signature. No funding authorization. */
export async function claimMachineTrialKey(base:string,wallet:string,challenge:Json,signature:string,persistPrivate:(record:Json)=>Promise<void>){
 if(!/^ma_[a-f0-9]{64}$/.test(challenge.challenge_id)||!/^0x[a-f0-9]{130}$/i.test(signature))throw Error('Original challenge and EOA ownership signature required');
 const r=await call(base,'/v3/agent-trial/claim',{wallet,challenge_id:challenge.challenge_id,signature});
 if(!/^fm_[a-f0-9]{64}$/.test(r.trial_key)||r.payments_automatic!==false||r.expires_at<=Date.now()||r.expires_at>Date.now()+604800000)throw Error('Unexpected machine-trial credential');
 await persistPrivate({origin:base,trial_key:r.trial_key,expires_at:r.expires_at});return r;
}
