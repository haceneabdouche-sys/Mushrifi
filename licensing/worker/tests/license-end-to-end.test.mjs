import assert from "node:assert/strict";
import { webcrypto, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

const api = process.env.MUSHRIFI_LICENSE_API || "http://127.0.0.1:8787";
const adminToken = process.env.ADMIN_API_TOKEN || "ci-admin-token";
const publicKey = createPublicKey(readFileSync(process.env.MUSHRIFI_TEST_PUBLIC_KEY_FILE || ".ci-license-public.pem"));
const encoder = new TextEncoder();
const DAY = 86400000;

async function request(path, body, admin = false) {
  const headers = { "content-type": "application/json" };
  if (admin) headers.authorization = "Bearer " + adminToken;
  const response = await fetch(api + path, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data };
}
async function issue(type, durationDays) {
  const result = await request("/v1/admin/licenses", { licenseType: type, durationDays }, true);
  assert.equal(result.status, 201, "admin issue should succeed");
  return result.data;
}
async function newDevice() {
  const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { pair, jwk: await webcrypto.subtle.exportKey("jwk", pair.publicKey) };
}
async function signedNonce(device, purpose, extra = {}) {
  const challenge = await request("/v1/challenge", { purpose, ...extra });
  assert.equal(challenge.status, 200, "challenge should be created");
  const signature = await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, device.pair.privateKey, encoder.encode(challenge.data.nonce));
  return { nonce: challenge.data.nonce, signature: Buffer.from(signature).toString("base64url") };
}
function readToken(token) {
  const parts = token.split(".");
  assert.equal(parts.length, 2, "license token should contain payload and signature");
  const payloadBytes = Buffer.from(parts[0], "base64url");
  const signature = Buffer.from(parts[1], "base64url");
  assert.ok(verify("RSA-SHA256", Buffer.from(parts[0]), publicKey, signature), "token must verify with generated RSA public key");
  return JSON.parse(payloadBytes.toString("utf8"));
}
async function activate(code, device) {
  const proof = await signedNonce(device, "activate", { activationCode: code, devicePublicKey: device.jwk });
  return request("/v1/activate", { activationCode: code, devicePublicKey: device.jwk, ...proof });
}
async function validate(licenseId, device) {
  const proof = await signedNonce(device, "validate", { licenseId });
  return request("/v1/validate", { licenseId, ...proof });
}

const issuedOnly = await issue("annual", 365);
assert.equal((await request("/v1/admin/licenses/" + issuedOnly.licenseId + "/suspend", {}, true)).status, 409);
assert.equal((await request("/v1/admin/licenses/" + issuedOnly.licenseId + "/revoke", {}, true)).status, 409);

const annual = await issue("annual", 365);
const device = await newDevice();
const activation = await activate(annual.activationCode, device);
assert.equal(activation.status, 200);
const firstPayload = readToken(activation.data.license);
assert.equal(firstPayload.licenseId, annual.licenseId);
assert.equal(firstPayload.status, "active");
assert.equal(firstPayload.expiresAt - firstPayload.startsAt, 365 * DAY);

const recovered = await activate(annual.activationCode, device);
assert.equal(recovered.status, 200);
assert.equal(readToken(recovered.data.license).licenseId, annual.licenseId);

const otherDevice = await newDevice();
assert.equal((await activate(annual.activationCode, otherDevice)).status, 409);

assert.equal((await validate(annual.licenseId, device)).status, 200);
const renewed = await request("/v1/admin/licenses/" + annual.licenseId + "/renew", { durationDays: 365 }, true);
assert.equal(renewed.status, 200);
assert.equal(renewed.data.expiresAt, firstPayload.expiresAt + 365 * DAY);
const afterRenewal = await validate(annual.licenseId, device);
assert.equal(afterRenewal.status, 200);
assert.equal(readToken(afterRenewal.data.license).expiresAt, renewed.data.expiresAt);

assert.equal((await request("/v1/admin/licenses/" + annual.licenseId + "/suspend", {}, true)).status, 200);
assert.equal((await request("/v1/challenge", { purpose: "validate", licenseId: annual.licenseId })).status, 403);
assert.equal((await request("/v1/admin/licenses/" + annual.licenseId + "/unsuspend", {}, true)).status, 200);
assert.equal((await validate(annual.licenseId, device)).status, 200);

assert.equal((await request("/v1/admin/licenses/" + annual.licenseId + "/revoke", {}, true)).status, 200);
assert.equal((await request("/v1/admin/licenses/" + annual.licenseId + "/revoke", {}, true)).status, 200);
assert.equal((await request("/v1/challenge", { purpose: "validate", licenseId: annual.licenseId })).status, 403);
assert.equal((await request("/v1/admin/licenses/" + annual.licenseId + "/renew", { durationDays: 365 }, true)).status, 409);

const perpetual = await issue("perpetual");
const perpetualDevice = await newDevice();
const perpetualActivation = await activate(perpetual.activationCode, perpetualDevice);
assert.equal(perpetualActivation.status, 200);
const perpetualPayload = readToken(perpetualActivation.data.license);
assert.equal(perpetualPayload.expiresAt, null);
assert.equal((await request("/v1/admin/licenses/" + perpetual.licenseId + "/renew", { durationDays: 365 }, true)).status, 409);

console.log("PASS: local D1 end-to-end activation, RSA token verification, same-device recovery, device binding, validation, renewal, suspend/unsuspend, revoke, and perpetual-term guards.");
