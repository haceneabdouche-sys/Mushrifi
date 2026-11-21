const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manager = read('android/app/src/main/java/dz/mushrifi/app/LicenseManager.java');
const activity = read('android/app/src/main/java/dz/mushrifi/app/MainActivity.java');
const html = read('android/app/src/main/assets/index.html');

assert.match(manager, /if \(!hasStoredLicense\(context\)\) return false/,
  'Installations without an issued license must be read-only until activation.');
assert.match(manager, /\.put\("hasLicense", false\).*\.put\("activated", false\)/,
  'An installation without a stored license must report itself as not activated.');
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

console.log('PASS: license read-only policy, native database write guard, student viewing, and backup export safeguards.');
