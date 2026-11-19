import assert from "node:assert/strict";
import { webcrypto, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
async function adminList() {
  const response = await fetch(api + "/v1/admin/licenses", { headers: { authorization: "Bearer " + adminToken } });
  assert.equal(response.status, 200, "admin license list should succeed");
  return (await response.json()).licenses;
}
function forceLocalExpiry(licenseId) {
  // Test-only clock simulation: expire this row in the disposable local D1 database.
  execFileSync("npx", ["wrangler", "d1", "execute", "mushrifi-licenses", "--local", "--command", `UPDATE licenses SET expires_at = 1 WHERE id = '${licenseId.replaceAll("'", "''")}';`], { stdio: "pipe" });
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

const malformedAdmin = await fetch(api + "/v1/admin/licenses", {
  method: "POST",
  headers: { "content-type": "application/json", "authorization": "Bearer " + adminToken },
  body: "{"
});
assert.equal(malformedAdmin.status, 400, "malformed admin JSON should return a client error, not a server error");
const oversizedAdmin = await fetch(api + "/v1/admin/licenses", {
  method: "POST",
  headers: { "content-type": "application/json", "authorization": "Bearer " + adminToken },
  body: JSON.stringify({ licenseType: "trial", padding: "x".repeat(17000) })
});
assert.equal(oversizedAdmin.status, 400, "oversized admin bodies must be rejected before parsing");

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

// Concurrent retries from the same device must return exactly the persisted dates.
const concurrentLicense = await issue("annual", 365);
const concurrentDevice = await newDevice();
const concurrentResults = await Promise.all([
  activate(concurrentLicense.activationCode, concurrentDevice),
  activate(concurrentLicense.activationCode, concurrentDevice)
]);
assert.equal(concurrentResults[0].status, 200);
assert.equal(concurrentResults[1].status, 200);
const concurrentPayloadA = readToken(concurrentResults[0].data.license);
const concurrentPayloadB = readToken(concurrentResults[1].data.license);
assert.equal(concurrentPayloadA.startsAt, concurrentPayloadB.startsAt);
assert.equal(concurrentPayloadA.expiresAt, concurrentPayloadB.expiresAt);

// A different device cannot recover or take the already-bound code.
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

// An expired license must not be revived by same-device activation recovery.
const shortTrial = await issue("trial", 1);
const trialDevice = await newDevice();
const trialActivation = await activate(shortTrial.activationCode, trialDevice);
assert.equal(trialActivation.status, 200);
forceLocalExpiry(shortTrial.licenseId);
const expiredRecovery = await activate(shortTrial.activationCode, trialDevice);
assert.equal(expiredRecovery.status, 403, "same-device recovery must reject an expired license");
assert.match(expiredRecovery.data.error, /انتهت مدة الترخيص/);
const expiredRow = (await adminList()).find(row => row.id === shortTrial.licenseId);
assert.equal(expiredRow.status, "expired", "recovery attempt must persist expired status");
const expiredOtherDevice = await newDevice();
assert.equal((await activate(shortTrial.activationCode, expiredOtherDevice)).status, 409, "another device must not claim an expired code");

const perpetual = await issue("perpetual");
const perpetualDevice = await newDevice();
const perpetualActivation = await activate(perpetual.activationCode, perpetualDevice);
assert.equal(perpetualActivation.status, 200);
const perpetualPayload = readToken(perpetualActivation.data.license);
assert.equal(perpetualPayload.expiresAt, null);
assert.equal((await request("/v1/admin/licenses/" + perpetual.licenseId + "/renew", { durationDays: 365 }, true)).status, 409);

console.log("PASS: local D1 end-to-end activation, RSA token verification, same-device recovery, device binding, validation, renewal, suspend/unsuspend, revoke, and perpetual-term guards.");
