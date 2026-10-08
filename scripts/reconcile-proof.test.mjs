import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, keccak256, toBytes } from "viem";
import { AUTH_ABI, BASE_USDC, PAY_TO, reconciliationSql } from "./reconcile-proof.mjs";
const payer = "0x1111111111111111111111111111111111111111";
const nonce = "0x"+"2".repeat(64), tx = "0x"+"3".repeat(64), blockHash = "0x"+"4".repeat(64);
const topic = text => keccak256(toBytes(text));
const addr = address => "0x"+address.slice(2).padStart(64,"0");
function fixture() {
  return {
    operation:{claim_hash:"a".repeat(64),state:"settling",asset:BASE_USDC,payer,nonce,service:"extract",amount_atomic:10000,authorization_expires:2000000000},
    transaction:{hash:tx,to:BASE_USDC,blockHash,blockNumber:"0x10",input:encodeFunctionData({abi:AUTH_ABI,functionName:"transferWithAuthorization",args:[payer,PAY_TO,10000n,0n,2000000000n,nonce,27,"0x"+"1".repeat(64),"0x"+"1".repeat(64)]})},
    receipt:{transactionHash:tx,status:"0x1",blockNumber:"0x10",blockHash,logs:[
      {address:BASE_USDC,topics:[topic("AuthorizationUsed(address,bytes32)"),addr(payer),nonce],data:"0x"},
      {address:BASE_USDC,topics:[topic("Transfer(address,address,uint256)"),addr(payer),addr(PAY_TO)],data:"0x2710"},
    ]},
    chainId:"0x2105",finalized:{number:"0x11"},
  };
}
const run = f => reconciliationSql(f.operation,f.transaction,f.receipt,f.chainId,f.finalized);
test("builds guarded reconciliation SQL from a finalized matching direct USDC authorization",()=>{
  const output=run(fixture());assert.match(output,/state = 'settled'/);assert.match(output,/AND nonce =/);assert.doesNotMatch(output,/response_json|writes_json|INSERT INTO/);
});
for(const [name,mutate] of [
  ["wrong chain",f=>{f.chainId="0x1";}],
  ["reverted transaction",f=>{f.receipt.status="0x0";}],
  ["unfinalized transaction",f=>{f.finalized.number="0x9";}],
  ["different nonce",f=>{f.operation.nonce="0x"+"f".repeat(64);} ],
  ["different payer",f=>{f.operation.payer="0x"+"f".repeat(40);} ],
  ["wrong amount",f=>{f.operation.amount_atomic=5000;}],
  ["wrong token",f=>{f.receipt.logs[0].address=PAY_TO;}],
  ["missing transfer",f=>{f.receipt.logs.pop();}],
  ["unrelated transaction",f=>{f.receipt.transactionHash="0x"+"f".repeat(64);} ],
  ["indirect/batched call",f=>{f.transaction.to=PAY_TO;}],
  ["wrong calldata",f=>{f.transaction.input="0x1234";}],
  ["completed operation",f=>{f.operation.state="completed";}],
  ["SQL injection in identifier",f=>{f.operation.claim_hash="'; DROP TABLE watches; --";}],
]) test("rejects "+name,()=>{const f=fixture();mutate(f);assert.throws(()=>run(f));});
