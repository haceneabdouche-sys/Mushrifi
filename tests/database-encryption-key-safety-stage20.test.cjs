const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build-apk.yml', 'utf8');
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');

function methodBody(signature, nextSignature) {
  const start = activity.indexOf(signature);
  assert.ok(start >= 0, 'method exists: ' + signature);
  const end = activity.indexOf(nextSignature, start);
  assert.ok(end > start, 'method boundary exists after: ' + signature);
  return activity.slice(start, end);
}

const existing = methodBody(
  'private static SecretKey existingDataKey() throws Exception {',
  'private static synchronized SecretKey dataKey() throws Exception {'
);
assert.match(existing, /ks\.containsAlias\("mushrifi_data_key"\)/,
  'existing key lookup requires the original Android Keystore alias');
assert.match(existing, /if\s*\(!ks\.containsAlias\("mushrifi_data_key"\)\)\s*\{[\s\S]*?throw new java\.security\.GeneralSecurityException/,
  'missing key fails closed with a clear security exception');
assert.match(existing, /ks\.getEntry\("mushrifi_data_key",\s*null\)/,
  'existing key entry is retrieved without generating a new key');
assert.match(existing, /instanceof KeyStore\.SecretKeyEntry/,
  'entry type is checked before use');
assert.doesNotMatch(existing, /KeyGenerator|generateKey|kg\.init/,
  'existing-key lookup never creates or replaces an encryption key');

const creation = methodBody(
  'private static synchronized SecretKey dataKey() throws Exception {',
  'private static String encryptData(String plain) throws Exception {'
);
assert.match(creation, /if\s*\(hasDataEncryptionKey\(\)\)\s*return existingDataKey\(\)/,
  'existing key is reused during encryption');
assert.match(creation, /KeyGenerator\.getInstance\("AES",\s*"AndroidKeyStore"\)/,
  'new AES key generation remains available for first encryption');
assert.match(creation, /return kg\.generateKey\(\)/,
  'first-use key creation remains explicit and confined to the encryption provider');

const encrypt = methodBody(
  'private static String encryptData(String plain) throws Exception {',
  'private static String decryptData(String stored) throws Exception {'
);
assert.match(encrypt, /Cipher\.ENCRYPT_MODE,\s*dataKey\(\)/,
  'encryption obtains or creates a key through the encryption-only method');
assert.match(encrypt, /AES\/GCM\/NoPadding/,
  'AES-GCM algorithm and stored encryption format remain unchanged');

const decrypt = methodBody(
  'private static String decryptData(String stored) throws Exception {',
  'private static class LocalDb'
);
assert.match(decrypt, /if\s*\(stored\s*==\s*null\s*\|\|\s*!stored\.startsWith\("enc:"\)\)\s*return stored/,
  'legacy plaintext remains readable without requiring a key');
assert.match(decrypt, /Cipher\.DECRYPT_MODE,\s*existingDataKey\(\)/,
  'ciphertext decryption only uses the pre-existing key');
assert.doesNotMatch(decrypt, /dataKey\s*\(|KeyGenerator|generateKey/,
  'ciphertext read can never create or replace a missing key');
assert.match(decrypt, /GCMParameterSpec\(128,\s*iv\)/,
  'AES-GCM authentication tag validation remains active');
assert.match(decrypt, /c\.doFinal\(ciphertext\)/,
  'authentication and decryption are performed by the crypto provider');

assert.match(activity, /private static boolean hasDataEncryptionKey\(\)[\s\S]*?ks\.containsAlias\("mushrifi_data_key"\)/,
  'the non-creating key-presence check remains available to Stage 19 diagnostics');
assert.match(workflow, /Run Stage 20 Android encryption key lifecycle safety tests[\s\S]*?node tests\/database-encryption-key-safety-stage20\.test\.cjs/,
  'CI includes the Stage 20 key lifecycle regression test');
assert.match(gradle, /versionCode\s+\d+[\s\S]*?versionName '2\.6'/,
  'an internal build number is configured while the visible app version stays 2.6');

console.log('PASS: Stage 20 Android Keystore key lifecycle separation; decryption fails closed without key creation; AES-GCM and legacy plaintext behavior remain compatible.');
