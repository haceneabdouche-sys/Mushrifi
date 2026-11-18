import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

const encoded = process.env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64;
if (!encoded) {
  throw new Error("Set LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64 in your trusted local shell; never paste it into chat or commit it.");
}
const privateKey = createPrivateKey({
  key: Buffer.from(encoded.trim(), "base64"),
  format: "der",
  type: "pkcs8"
});
const derivedPublicDer = createPublicKey(privateKey).export({ type: "spki", format: "der" });
const javaPath = new URL("../../android/app/src/main/java/dz/mushrifi/app/LicenseManager.java", import.meta.url);
const java = readFileSync(javaPath, "utf8");
const block = java.match(/PUBLIC_KEY_PEM\s*=\s*([\s\S]*?);/);
assert.ok(block, "Could not find Android PUBLIC_KEY_PEM.");
const pem = [...block[1].matchAll(/"([^"]*)"/g)].map(m => m[1]).join("").replace(/\\n/g, "\n");
const embeddedPublicDer = createPublicKey(pem).export({ type: "spki", format: "der" });
assert.equal(derivedPublicDer.length, embeddedPublicDer.length, "Worker private key and Android public key do not match.");
assert.ok(timingSafeEqual(derivedPublicDer, embeddedPublicDer), "Worker private key and Android public key do not match.");
console.log("PASS: the Worker PKCS#8 private key matches the RSA public key embedded in the Android app. No key material was printed.");
