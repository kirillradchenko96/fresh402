// Public protocol identities only. No wallet access, signing keys or RPC on import.
export const BASE_NETWORK='eip155:8453';
export const SOLANA_NETWORK='solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const SOLANA_USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const SOLANA_MERCHANT='9apNBNbDHZZ2isBEq9ZCnipvRdxAh6ZCBRJPqWQ5Rwuj';
export const SOLANA_CDP_FEE_PAYER='BENrLoUbndxoNMUS5JXApGMtNykLjFXXixMtpDwDR9SP';
export type PaymentNetwork=typeof BASE_NETWORK|typeof SOLANA_NETWORK;
export function nativeSolanaRequirement(r:any,amount:string,feePayer=SOLANA_CDP_FEE_PAYER){
 return r?.scheme==='exact'&&r.network===SOLANA_NETWORK&&r.asset===SOLANA_USDC&&r.payTo===SOLANA_MERCHANT&&r.amount===amount&&r.extra?.feePayer===feePayer&&Number.isInteger(r.maxTimeoutSeconds)&&r.maxTimeoutSeconds>=1&&r.maxTimeoutSeconds<=300;
}
export function solanaSignature(value:unknown){return typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);}
