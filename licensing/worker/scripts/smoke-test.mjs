import { webcrypto } from "node:crypto";

const api = process.env.MUSHRIFI_LICENSE_API || "https://mushrifi-license-server-staging.hacene47211.workers.dev";
const encoder = new TextEncoder();
const code = "MSH-SMOKE-TEST-NOT-ISSUED-" + Date.now().toString(36).toUpperCase();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function post(path, body) {
  const response = await fetch(api + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { status: response.status, data };
}

const pair = await webcrypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"]
);
const publicJwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);

const challenge = await post("/v1/challenge", {
  purpose: "activate",
  activationCode: code,
  devicePublicKey: publicJwk
});
assert(challenge.status === 200 && challenge.data.ok === true && challenge.data.nonce,
  "Activation challenge endpoint did not return a valid nonce.");

const signatureBytes = await webcrypto.subtle.sign(
  { name: "ECDSA", hash: "SHA-256" },
  pair.privateKey,
  encoder.encode(challenge.data.nonce)
);
const signature = Buffer.from(signatureBytes).toString("base64url");

const activation = await post("/v1/activate", {
  activationCode: code,
  devicePublicKey: publicJwk,
  nonce: challenge.data.nonce,
  signature
});
assert(activation.status === 409 && activation.data.ok === false &&
  String(activation.data.error || "").includes("رمز التفعيل غير صحيح"),
  "Expected the valid device proof to reach the safe 'unknown code' rejection; no license should be issued.");

const replay = await post("/v1/activate", {
  activationCode: code,
  devicePublicKey: publicJwk,
  nonce: challenge.data.nonce,
  signature
});
assert(replay.status === 409 && replay.data.ok === false,
  "A consumed challenge was unexpectedly accepted on replay.");

console.log("PASS: challenge created; P-256 device proof verified; unknown code rejected; replay rejected; no license issued.");
