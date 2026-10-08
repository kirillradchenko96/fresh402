import { readFile, writeFile } from "node:fs/promises";
import { reconciliationSql } from "./reconcile-proof.mjs";

// Read-only JSON-RPC. No private key, signing, eth_send*, facilitator or D1 write.
const [operationPath, transactionHash, rpcUrl, outputPath] = process.argv.slice(2);
if (!operationPath || !/^0x[\da-f]{64}$/i.test(transactionHash ?? "") || !outputPath || !rpcUrl?.startsWith("https://")) throw new Error("Usage: node scripts/reconcile-payment.mjs operation.json 0xTX HTTPS_RPC output.sql");
const operation = JSON.parse(await readFile(operationPath,"utf8"));
async function rpc(method, params) {
  const response = await fetch(rpcUrl,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  if (!response.ok) throw new Error("RPC unavailable");
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 2*1024*1024) throw new Error("RPC response too large"); chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const bytes = new Uint8Array(size); let offset=0; for(const chunk of chunks) { bytes.set(chunk,offset);offset+=chunk.length; }
  const result = JSON.parse(new TextDecoder().decode(bytes)); if(result.error) throw new Error("RPC query failed"); return result.result;
}
const [chainId,transaction,receipt,finalized] = await Promise.all([rpc("eth_chainId",[]),rpc("eth_getTransactionByHash",[transactionHash]),rpc("eth_getTransactionReceipt",[transactionHash]),rpc("eth_getBlockByNumber",["finalized",false])]);
await writeFile(outputPath,reconciliationSql(operation,transaction,receipt,chainId,finalized),{flag:"wx"});
process.stdout.write("Verified finalized authorization and transfer. Review the generated SQL; no D1 changes were made.\n");
