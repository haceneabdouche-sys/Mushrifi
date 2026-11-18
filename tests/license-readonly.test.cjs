const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manager = read('android/app/src/main/java/dz/mushrifi/app/LicenseManager.java');
const activity = read('android/app/src/main/java/dz/mushrifi/app/MainActivity.java');
const html = read('android/app/src/main/assets/index.html');

assert.match(manager, /if \(!hasStoredLicense\(context\)\) return true/,
  'Installations without an issued license must retain existing write access.');
assert.match(manager, /\.put\("hasLicense", true\)/,
  'A stored token must be distinguishable from an installation without a token.');
assert.match(manager, /static boolean canWrite\(Context context\)/,
  'Native license write policy must be available.');
assert.match(manager, /AES\/GCM\/NoPadding/,
  'Signed license tokens must be encrypted with Android Keystore AES-GCM.');
assert.match(manager, /putString\("license_token_enc"/,
  'The stored token must use the encrypted preference field.');
assert.match(manager, /\.remove\("license_token"\)/,
  'The legacy plaintext token must be removed after migration.');
assert.match(manager, /static boolean hasStoredLicense\(Context context\)/,
  'Encrypted and legacy token presence must both trigger license enforcement.');
assert.match(manager, /return status\(context\)\.optBoolean\("activated", false\)/,
  'Stored licenses may write only while the signed license is active.');
assert.match(activity, /if \(json == null \|\| !LicenseManager\.canWrite\(MainActivity\.this\)\) return false/,
  'The native encrypted database bridge must reject writes in read-only mode.');
assert.match(html, /if\(licenseReadOnly\)\{alert\('وضع القراءة فقط/,
  'The web save function must block writes in read-only mode.');
assert.match(html, /if\(!licenseReadOnly&&!save\(\)\)/,
  'Backup export must remain available without saving over the existing database.');
assert.match(html, /action\.includes\('studentHistory'\)/,
  'Student records must remain viewable in read-only mode.');
assert.match(html, /setLicenseControlDisabled\(importButton,true\)/,
  'Backup restore must be disabled in read-only mode.');
assert.match(html, /allowed\.has\(el\.id\)/,
  'Backup export, report viewing, and license actions must remain available.');

assert.match(manager, /static String deviceId\\(Context context\\)/,
  'A device fingerprint must be available for support requests.');
assert.match(activity, /requestLicenseWhatsApp\\(String requestType\\)/,
  'Activation and renewal requests must reach the owner through WhatsApp.');
assert.match(html, /requestLicenseActivationBtn/);
assert.match(html, /requestLicenseRenewalBtn/);
assert.match(html, /licenseDeviceId/);
console.log('PASS: license read-only policy, native database write guard, student viewing, and backup export safeguards.');
