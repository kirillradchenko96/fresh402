/** Node.js 24: node --experimental-strip-types examples/client.ts
 * Defaults to an unpaid local extraction request. Never signs a payment.
 */
type PaymentChallenge = {
  x402Version: 2;
  resource: { url: string };
  accepts: Array<{ scheme: string; network: string; asset: string; amount: string; payTo: string }>;
};
async function main(): Promise<void> {
const base = process.env.FRESH402_BASE_URL ?? "http://localhost:8787";
const target = process.env.FRESH402_TARGET_URL ?? "https://example.com/";
const payment = process.argv.includes("--paid") ? process.env.FRESH402_PAYMENT_SIGNATURE : undefined;
if (process.argv.includes("--paid") && !payment) throw new Error("Set a locally generated x402 payment payload; never paste wallet secrets into source.");
const response = await fetch(new URL("/v2/extract", base), {
  method: "POST",
  headers: { "content-type": "application/json", ...(payment ? { "payment-signature": payment } : {}) },
  body: JSON.stringify({ url: target, max_chars: 20000 }),
  signal: AbortSignal.timeout(60000),
  redirect: "error",
});
if (response.status === 402) {
  const header = response.headers.get("payment-required");
  if (!header) throw new Error("Missing x402 challenge");
  const challenge = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentChallenge;
  const offer = challenge.accepts[0];
  if (challenge.x402Version !== 2 || offer.scheme !== "exact" || offer.network !== "eip155:8453" || offer.amount !== "10000") throw new Error("Unexpected price or network");
  console.log("Payment required; no sale occurred.", { resource: challenge.resource.url, ...offer });
  console.log("Inspect recipient, asset and spend policy in your x402 wallet client. This example does not auto-sign or retry.");
} else if (!response.ok) {
  console.error("Fresh402 error", response.status, await response.json());
  process.exitCode = 1;
} else {
  console.log(await response.json());
  console.log("Settlement receipt present:", response.headers.has("payment-response"));
}
}
void main().catch(() => {
  console.error("Cannot complete the Fresh402 request; no automatic payment retry was attempted.");
  process.exitCode = 1;
});
export {};
