import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { ServiceError, SERVICES, type ServiceId } from "./contracts";
import { digest } from "./extract";
import { stableJsonStringify } from "./freshness";
import { statements, type SqlWrite } from "./sql";
import type { PreparedOperation } from "./operations";

const NETWORK = "eip155:8453";
const TEST_BUYER = "0x493c114566f166241cf75b04526c46083045bf89";
export const RESULT_RETENTION_MS = 7 * 86400000;
interface OperationRow {
  claim_hash: string; request_hash: string; proof_hash: string; recovery_hash: string | null;
  service: ServiceId; transport: "rest" | "mcp"; payer: string; asset: string; nonce: string;
  state: string; response_json: string | null; writes_json: string | null; receipt_json: string | null;
  result_expires: number; created_at: number; updated_at:number;lease_owner:string|null;resource_key: string | null;
}
function authorization(payload: PaymentPayload) {
  const auth = payload.payload?.authorization;
  if (!auth || typeof auth !== "object") throw new ServiceError("unsupported_authorization", "Only EIP-3009 authorizations are supported.", 402);
  const fields = auth as Record<string, unknown>;
  if (typeof fields.from !== "string" || !/^0x[\da-f]{40}$/i.test(fields.from) || typeof fields.nonce !== "string" || !/^0x[\da-f]{64}$/i.test(fields.nonce)) {
    throw new ServiceError("invalid_authorization", "Invalid authorization identity.", 402);
  }
  return { payer: fields.from.toLowerCase(), nonce: fields.nonce.toLowerCase(), expiry: Number(fields.validBefore) };
}
async function identity(payload: PaymentPayload) {
  const auth = authorization(payload);
  const asset = payload.accepted?.asset;
  if (typeof asset !== "string" || !/^0x[\da-f]{40}$/i.test(asset) || payload.accepted.network !== NETWORK) throw new ServiceError("invalid_authorization", "Invalid payment asset or network.", 402);
  return { ...auth, asset: asset.toLowerCase(), claim: await digest(`${NETWORK}:${asset.toLowerCase()}:${auth.payer}:${auth.nonce}`), proof: await digest(stableJsonStringify(payload.payload)) };
}
export async function resourceKey(db: D1Database, input: unknown): Promise<string | null> {
  if (!input || typeof input !== "object") return null;
  const fields = input as Record<string, unknown>;
  let url = typeof fields.url === "string" ? fields.url : null;
  if (!url && typeof fields.watch_id === "string") url = await db.prepare("SELECT url FROM watches WHERE watch_id = ?").bind(fields.watch_id).first<string>("url");
  if (!url) return null;
  try { const target = new URL(url); target.hash = ""; return digest(target.href); } catch { return null; }
}
export function validateRecoveryToken(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new ServiceError("invalid_recovery_token", "Use a random recovery token of at least 32 bytes, encoded as base64url or hex.");
  return value;
}

/** All settlement gates are in the facilitator adapter: SDK hooks can fail open. */
export class PaymentJournal {
  private claim?: string;
  private readonly owner = crypto.randomUUID();
  private settled = false;
  private attempted = false;
  constructor(private db: D1Database, private service: ServiceId, private transport: "rest" | "mcp", private input: unknown, private token?: string) {}
  private requestHash() { return digest(stableJsonStringify({ service: this.service, transport: this.transport, input: this.input })); }
  async reserve(payload: PaymentPayload, requirements: PaymentRequirements): Promise<boolean> {
    const id = await identity(payload), now = Date.now();
    const seconds = Math.floor(now / 1000);
    if (!Number.isSafeInteger(id.expiry) || id.expiry <= seconds || id.expiry > seconds + 86400 || requirements.asset.toLowerCase() !== id.asset) {
      throw new ServiceError("authorization_expiry_out_of_range", "Authorization must expire within 24 hours.", 402);
    }
    const result = await this.db.batch([
      this.db.prepare("INSERT OR IGNORE INTO payment_claims(claim_hash, expires_at) VALUES (?, ?)").bind(id.claim, id.expiry + 300),
      this.db.prepare(`INSERT OR IGNORE INTO payment_operations(claim_hash, request_hash, proof_hash, recovery_hash, service, transport, payer, asset, nonce,
        amount_atomic, resource_key, state, owner, authorization_expires, created_at, updated_at, result_expires)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'preparing', ?, ?, ?, ?, ? WHERE changes() = 1`)
        .bind(id.claim, await this.requestHash(), id.proof, this.token ? await digest(this.token) : null, this.service, this.transport, id.payer, id.asset, id.nonce,
          SERVICES[this.service].atomic, await resourceKey(this.db, this.input), this.owner, id.expiry, now, now, now + RESULT_RETENTION_MS),
    ]);
    if (result[1].meta.changes !== 1) {
      if(!this.token)return false;
      // Only pre-settlement work may be retried. A prepared result is discarded
      // and recomputed after its capacity lease ends, avoiding stale writes.
      // Failed/ambiguous settlement remains in settling and never passes.
      // The facilitator has already reverified this original authorization.
      const retry=await this.db.prepare(`UPDATE payment_operations SET state='preparing',owner=?,lease_owner=NULL,response_json=NULL,writes_json=NULL,updated_at=?
        WHERE claim_hash=? AND receipt_json IS NULL AND recovery_hash=? AND request_hash=? AND proof_hash=? AND authorization_expires>?
        AND (state='failed' OR state='prepared' AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE owner=payment_operations.lease_owner AND expires_at>?)
          OR state='preparing' AND updated_at<=? AND NOT EXISTS(SELECT 1 FROM operation_leases WHERE resource_key=payment_operations.resource_key AND expires_at>?))`)
        .bind(this.owner,now,id.claim,await digest(this.token),await this.requestHash(),id.proof,seconds,now,now-120000,now).run();
      if(retry.meta.changes!==1)return false;
    }
    this.claim = id.claim;
    return true;
  }
  async stage(prepared: PreparedOperation, leaseOwner: string): Promise<void> {
    if (!this.claim) throw new ServiceError("payment_not_reserved", "Payment was not reserved.", 503);
    if (!prepared.response.ok) {
      await this.db.prepare("UPDATE payment_operations SET state = 'failed', updated_at = ? WHERE claim_hash = ? AND owner = ? AND state = 'preparing'").bind(Date.now(), this.claim, this.owner).run();
      return;
    }
    const body = await prepared.response.clone().text(), writes = JSON.stringify(prepared.writes ?? []);
    // Bound every stored value before crossing the irreversible settlement boundary.
    if (new TextEncoder().encode(body).length > 524288 || new TextEncoder().encode(writes).length > 1048576) throw new ServiceError("result_too_large", "Durable result exceeds its storage budget.", 413);
    const result = await this.db.prepare(`UPDATE payment_operations SET state = 'prepared', response_json = ?, writes_json = ?, updated_at = ?, lease_owner = ?
      WHERE claim_hash = ? AND owner = ? AND state = 'preparing'
      AND EXISTS (SELECT 1 FROM operation_leases WHERE owner = ? AND expires_at > ?)`)
      .bind(body, writes, Date.now(), leaseOwner, this.claim, this.owner, leaseOwner, Date.now()).run();
    if (result.meta.changes !== 1) throw new ServiceError("payment_reservation_lost", "Operation reservation was lost.", 503);
  }
  async failPreparation():Promise<void> {
    if(!this.claim)return;
    await this.db.prepare("UPDATE payment_operations SET state='failed',updated_at=? WHERE claim_hash=? AND owner=? AND state='preparing' AND receipt_json IS NULL").bind(Date.now(),this.claim,this.owner).run();
  }
  async settle(operation: () => Promise<SettleResponse>): Promise<SettleResponse> {
    const result = await this.db.prepare(`UPDATE payment_operations SET state = 'settling', updated_at = ?
      WHERE claim_hash = ? AND owner = ? AND state = 'prepared' AND authorization_expires > ?
      AND EXISTS (SELECT 1 FROM operation_leases WHERE owner = lease_owner AND expires_at > ?)`)
      .bind(Date.now(), this.claim ?? "", this.owner, Math.floor(Date.now()/1000), Date.now()).run();
    if (result.meta.changes !== 1) throw new ServiceError("settlement_not_started", "Durable result is unavailable; payment was not submitted.", 503);
    this.attempted = true;
    const receipt = await operation(); // Exactly one call. Never retry a timeout.
    if (!receipt.success) return receipt; // Conservative: keep ambiguous/failed submissions quarantined.
    const row = await this.row(this.claim!);
    if (!row || receipt.network !== NETWORK || receipt.payer?.toLowerCase() !== row.payer || !/^0x[\da-f]{64}$/i.test(receipt.transaction)) throw new ServiceError("invalid_settlement_receipt", "Settlement requires reconciliation.", 503);
    await this.db.batch([
      this.db.prepare("UPDATE payment_operations SET state = 'settled', receipt_json = ?, updated_at = ? WHERE claim_hash = ? AND state = 'settling'")
        .bind(JSON.stringify(receipt), Date.now(), this.claim),
      this.paymentEvent(row, receipt),
    ]);
    this.settled = true;
    await this.finalize(this.claim!);
    return receipt;
  }
  private row(claim: string) { return this.db.prepare("SELECT * FROM payment_operations WHERE claim_hash = ?").bind(claim).first<OperationRow>(); }
  private paymentEvent(row: OperationRow, receipt: SettleResponse) {
    return this.db.prepare(`INSERT OR IGNORE INTO payment_events(transaction_hash, payer, network, route, amount_atomic, is_test_buyer, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(receipt.transaction, row.payer, NETWORK, row.transport === "rest" ? SERVICES[row.service].path : `/mcp#${SERVICES[row.service].tool}`,
      SERVICES[row.service].atomic, row.payer === TEST_BUYER ? 1 : 0, new Date(row.created_at).toISOString());
  }
  private async finalize(claim: string): Promise<void> {
    const row = await this.row(claim);
    if (!row || row.state === "completed") return;
    if (row.state !== "settled" || !row.receipt_json || !row.writes_json) return;
    const receipt = JSON.parse(row.receipt_json) as SettleResponse;
    try {
      await this.db.batch([
        this.paymentEvent(row, receipt),
        ...statements(this.db, JSON.parse(row.writes_json) as SqlWrite[]),
        this.db.prepare("UPDATE payment_operations SET state = 'completed', writes_json = NULL, updated_at = ? WHERE claim_hash = ?").bind(Date.now(), claim),
      ]);
    } catch { console.error("fresh402_paid_finalization_pending"); }
  }
  private response(row: OperationRow): Response {
    if (!row.response_json || row.result_expires <= Date.now()) throw new ServiceError("paid_result_expired", "Recovery retention is seven days. Contact the operator; do not pay again automatically.", 410);
    const body = row.state === "completed" ? row.response_json : JSON.stringify({ ...JSON.parse(row.response_json), snapshot_saved: false, persistence_error: "Snapshot finalization is pending. Retry with the same recovery token and payment." });
    return new Response(body, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  }
  async recover(payload: PaymentPayload): Promise<{ response: Response; receipt: SettleResponse } | undefined> {
    if (!this.token) return undefined;
    let id: Awaited<ReturnType<typeof identity>>;
    try { id = await identity(payload); } catch { return undefined; }
    let row = await this.row(id.claim);
    // A signature becomes public onchain. It is NOT a recovery credential.
    if (!row || !row.recovery_hash || !crypto.subtle.timingSafeEqual(new TextEncoder().encode(row.recovery_hash), new TextEncoder().encode(await digest(this.token)))) return undefined;
    if (row.request_hash !== await this.requestHash() || row.proof_hash !== id.proof) throw new ServiceError("payment_request_mismatch", "Recovery must use the original input, transport and payment.", 409);
    // Failed preparation has not submitted a settlement. It must go through
    // verification and the exact-identity reservation gate again, not replay.
    if(row.state==='failed'&&!row.receipt_json)return undefined;
    if(!row.receipt_json&&row.state==='prepared'&&!await this.db.prepare('SELECT owner FROM operation_leases WHERE owner=? AND expires_at>?').bind(row.lease_owner,Date.now()).first('owner'))return undefined;
    if(!row.receipt_json&&row.state==='preparing'&&row.updated_at<=Date.now()-120000&&!await this.db.prepare('SELECT owner FROM operation_leases WHERE resource_key=? AND expires_at>?').bind(row.resource_key,Date.now()).first('owner'))return undefined;
    if (!["settled", "completed"].includes(row.state)) throw new ServiceError("settlement_pending", "Operation is pending or requires reconciliation. Do not sign a replacement payment.", 409);
    await this.finalize(id.claim);
    row = (await this.row(id.claim))!;
    return { response: this.response(row), receipt: JSON.parse(row.receipt_json!) as SettleResponse };
  }
  async paidResponse(): Promise<Response | undefined> {
    if (!this.settled || !this.claim) return undefined;
    return this.response((await this.row(this.claim))!);
  }
  wasSettled() { return this.settled; }
  wasAttempted() { return this.attempted; }
}
