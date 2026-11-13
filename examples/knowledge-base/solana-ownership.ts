import {SOLANA_NETWORK} from './payment-networks.ts';
type Json=Record<string,any>;
export function validateSolanaOwnershipChallenge(c:Json,wallet:string,origin:string){
 const lines=typeof c?.message==='string'?c.message.split('\n'):[],issued=Number(lines[10]?.slice('Issued At: '.length)),nonce=lines[9]?.slice('Nonce: '.length),environment=lines[7]?.slice('Environment: '.length);
 const expected=['Fresh402 Account Ownership','Version: 1','Action: Authenticate Fresh402 customer','This signature authenticates ownership only. It does not authorize a payment or token approval.',`Network: ${SOLANA_NETWORK}`,`Wallet: ${wallet}`,`Origin: ${origin}`,`Environment: ${environment}`,`Challenge: ${c?.challenge_id}`,`Nonce: ${nonce}`,`Issued At: ${issued}`,`Expires At: ${c?.expires_at}`].join('\n');
 if(!/^cc_[a-f0-9]{64}$/.test(c?.challenge_id)||!['production','staging','local-lab'].includes(environment)||c.network!==SOLANA_NETWORK||c.signing_method!=='signMessage'||c.signature_encoding!=='base64'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)||!/^0x[a-f0-9]{64}$/.test(nonce)||!Number.isSafeInteger(issued)||issued>Date.now()+5000||c.expires_at-issued!==300000||c.expires_at<=Date.now()||c.message!==expected)throw Error('Unexpected Solana ownership challenge; do not sign');
 return c;
}
