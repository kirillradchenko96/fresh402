import { SignJWT, importJWK } from "jose";
import { HTTPFacilitatorClient } from "@x402/core/server";
const CDP_FACILITATOR_URL =
"https://api.cdp.coinbase.com/platform/v2/x402";

const CDP_FACILITATOR_HOST =
"api.cdp.coinbase.com";

function bytesToBase64Url(bytes: Uint8Array): string {
let binary = "";

for (const byte of bytes) {
binary += String.fromCharCode(byte);
}

return btoa(binary)
.replace(/\+/g, "-")
.replace(/\//g, "_")
.replace(/=+$/g, "");
}

function createNonce(): string {
const bytes = new Uint8Array(16);
crypto.getRandomValues(bytes);

return Array.from(bytes)
.map((byte) => byte.toString(16).padStart(2, "0"))
.join("");
}

async function generateCdpJwt(
apiKeyId: string,
apiKeySecret: string,
method: "GET" | "POST",
path: string,
): Promise<string> {
const cleanSecret = apiKeySecret.replace(/\s+/g, "");

let decoded: Uint8Array;

try {
const binary = atob(cleanSecret);
decoded = Uint8Array.from(
binary,
(char) => char.charCodeAt(0),
);
} catch {
throw new Error(
"CDP API key secret is not valid base64.",
);
}

// Fresh402 currently uses the Ed25519 CDP API key created in Portal.
if (decoded.length !== 64) {
throw new Error(
`Expected a 64-byte Ed25519 CDP secret, received ${decoded.length} bytes.`,
);
}

const seed = decoded.slice(0, 32);
const publicKey = decoded.slice(32);

const jwk = {
kty: "OKP",
crv: "Ed25519",
d: bytesToBase64Url(seed),
x: bytesToBase64Url(publicKey),
};

const signingKey = await importJWK(jwk, "EdDSA");

const now = Math.floor(Date.now() / 1000);

return new SignJWT({
sub: apiKeyId,
iss: "cdp",
uris: [
`${method} ${CDP_FACILITATOR_HOST}${path}`,
],
})
.setProtectedHeader({
alg: "EdDSA",
kid: apiKeyId,
typ: "JWT",
nonce: createNonce(),
})
.setIssuedAt(now)
.setNotBefore(now)
.setExpirationTime(now + 120)
.sign(signingKey);
}

export function createFresh402CdpFacilitator(
apiKeyId: string,
apiKeySecret: string,
): HTTPFacilitatorClient {
const auth = async (
method: "GET" | "POST",
path: string,
): Promise<Record<string, string>> => ({
Authorization:
`Bearer ${await generateCdpJwt(
apiKeyId,
apiKeySecret,
method,
path,
)}`,
});

return new HTTPFacilitatorClient({
url: CDP_FACILITATOR_URL,
timeoutMs: 15000,

createAuthHeaders: async () => {
const [verify, settle, supported] =
await Promise.all([
auth(
"POST",
"/platform/v2/x402/verify",
),
auth(
"POST",
"/platform/v2/x402/settle",
),
auth(
"GET",
"/platform/v2/x402/supported",
),
]);

return {
verify,
settle,
supported,
};
},
});
}
