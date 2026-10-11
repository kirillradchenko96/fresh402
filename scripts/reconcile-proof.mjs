import { decodeFunctionData, parseAbi, keccak256, toBytes } from "viem";

export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const PAY_TO = "0x58b4b483fbe31860335eceb12cccf4338b251085";
export const AUTH_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature)",
]);
const transferTopic = keccak256(toBytes("Transfer(address,address,uint256)"));
const usedTopic = keccak256(toBytes("AuthorizationUsed(address,bytes32)"));
const addressTopic = address => `0x${address.slice(2).toLowerCase().padStart(64,"0")}`;
const hex = value => typeof value === "string" && /^0x[\da-f]+$/i.test(value);
const prices = { check: 5000, extract: 10000, smart_diff: 15000 };

/** Offline proof check. Only direct USDC EIP-3009 calls with finalized receipts. */
export function reconciliationSql(operation, transaction, receipt, chainId, finalizedBlock) {
  if (chainId !== "0x2105" || !["settling","settled"].includes(operation.state) || !/^[a-f0-9]{64}$/.test(operation.claim_hash)) throw new Error("Wrong chain or operation state");
  if (operation.asset?.toLowerCase() !== BASE_USDC || !/^0x[\da-f]{40}$/i.test(operation.payer) || !/^0x[\da-f]{64}$/i.test(operation.nonce) || prices[operation.service] !== operation.amount_atomic || !Number.isSafeInteger(operation.authorization_expires) || operation.authorization_expires < 1) throw new Error("Invalid operation identity");
  if (!receipt || receipt.status !== "0x1" || !hex(receipt.blockNumber) || !hex(finalizedBlock?.number) || BigInt(receipt.blockNumber) > BigInt(finalizedBlock.number)) throw new Error("Receipt is missing, failed or not finalized");
  if (!/^0x[\da-f]{64}$/i.test(transaction?.hash) || !/^0x[\da-f]{64}$/i.test(receipt.blockHash) || receipt.transactionHash?.toLowerCase() !== transaction.hash.toLowerCase() || transaction.to?.toLowerCase() !== BASE_USDC || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber) throw new Error("Transaction does not match receipt");
  const call = decodeFunctionData({ abi:AUTH_ABI, data:transaction.input });
  const [from,to,value,,validBefore,nonce] = call.args;
  if (from.toLowerCase() !== operation.payer.toLowerCase() || to.toLowerCase() !== PAY_TO || value !== BigInt(operation.amount_atomic) || nonce.toLowerCase() !== operation.nonce.toLowerCase() || validBefore !== BigInt(operation.authorization_expires)) throw new Error("Authorization call does not match operation");
  const logs = receipt.logs.filter(log => log.address?.toLowerCase() === BASE_USDC);
  if (!logs.some(log => log.topics?.[0] === usedTopic && log.topics[1]?.toLowerCase() === addressTopic(operation.payer) && log.topics[2]?.toLowerCase() === operation.nonce.toLowerCase())) throw new Error("AuthorizationUsed event missing");
  if (!logs.some(log => log.topics?.[0] === transferTopic && log.topics[1]?.toLowerCase() === addressTopic(operation.payer) && log.topics[2]?.toLowerCase() === addressTopic(PAY_TO) && hex(log.data) && BigInt(log.data) === BigInt(operation.amount_atomic))) throw new Error("Matching Transfer event missing");
  const proof = {success:true,network:"eip155:8453",payer:operation.payer.toLowerCase(),transaction:transaction.hash.toLowerCase()};
  // Guard every operator-imported field against concurrent state/identity changes.
  return `UPDATE payment_operations SET state = 'settled', receipt_json = '${JSON.stringify(proof)}', updated_at = ${Date.now()}\nWHERE claim_hash = '${operation.claim_hash}' AND state IN ('settling','settled') AND payer = '${operation.payer.toLowerCase()}' AND nonce = '${operation.nonce.toLowerCase()}' AND asset = '${BASE_USDC}' AND amount_atomic = ${operation.amount_atomic} AND service = '${operation.service}' AND authorization_expires = ${operation.authorization_expires} AND (receipt_json IS NULL OR json_extract(receipt_json, '$.transaction') = '${proof.transaction}');\n`;
}
