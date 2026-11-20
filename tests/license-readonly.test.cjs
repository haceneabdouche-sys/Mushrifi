const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const manager = read('android/app/src/main/java/dz/mushrifi/app/LicenseManager.java');
const activity = read('android/app/src/main/java/dz/mushrifi/app/MainActivity.java');
const summonsReceiver = read('android/app/src/main/java/dz/mushrifi/app/SummonsReminderReceiver.java');
const bootReceiver = read('android/app/src/main/java/dz/mushrifi/app/ReminderBootReceiver.java');
const html = read('android/app/src/main/assets/index.html');
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-apk.yml');

assert.ok(manager.includes('private static final String API = BuildConfig.MUSHRIFI_LICENSE_API;'));
assert.ok(gradle.includes('def defaultLicenseApi = "https://mushrifi-license-server.hacene47211.workers.dev"'));
assert.ok(gradle.includes("buildConfigField 'String', 'MUSHRIFI_LICENSE_API'"));
assert.ok(gradle.includes("applicationIdSuffix '.staging'") && gradle.includes("versionNameSuffix '-staging'"));

assert.match(manager, /if\s*\(!hasStoredLicense\(context\)\)\s*return false/,
  'No license must mean no write access.');
assert.doesNotMatch(manager, /if\s*\(!hasStoredLicense\(context\)\)\s*return true/);
assert.match(manager, /\.put\("hasLicense", false\)/);
assert.match(manager, /max_seen_wall_time/);
assert.match(manager, /clockMovedBackwards\(context, now, lastValidatedAt\)/);
assert.match(manager, /return status\(context\)\.optBoolean\("activated", false\)/);
assert.match(manager, /statusCode == 401 \|\| rejected\.statusCode == 403 \|\| rejected\.statusCode == 404/,
  'Explicit server denials must immediately override the cached offline token.');
assert.match(manager, /putBoolean\("server_blocked", true\)/);
assert.match(manager, /\.remove\("server_blocked"\)/,
  'A successful renewal or unsuspension validation must clear the server block.');
assert.match(manager, /if \(prefs\.getBoolean\("server_blocked", false\)\) return true/,
  'A server-blocked phone must retry online validation so renewal can restore access.');

assert.match(manager, /AES\/GCM\/NoPadding/);
assert.match(manager, /putString\("license_token_enc"/);
assert.match(manager, /\.remove\("license_token"\)/);

assert.match(activity, /if \(json == null \|\| !LicenseManager\.canWrite\(MainActivity\.this\)\) return false/);
assert.match(activity, /setPassword\(String password\) \{ if \(!LicenseManager\.canWrite/);
assert.match(activity, /scheduleSummonsReminderAt\(String id, String studentName, long reminderMillis, long appointmentMillis\) \{\s*if \(!LicenseManager\.canWrite/);
assert.match(activity, /saveSignatureImage\(String dataUrl\) \{\s*if \(!LicenseManager\.canWrite/);
assert.match(activity, /startArabicSpeech\(\) \{\s*if \(!LicenseManager\.canWrite/,
  'Arabic voice services must be blocked without an active license.');

assert.match(activity, /replaceSummonsReminders\(String json\) \{\s*if \(!LicenseManager\.canWrite/);
assert.match(activity, /if \(!LicenseManager\.canWrite\(MainActivity\.this\)\) \{\s*for \(String id : stored\.keySet\(\)\) cancelReminder/);

assert.match(summonsReceiver, /onReceive\(Context context, Intent intent\) \{\s*if \(!LicenseManager\.canWrite\(context\)\) return;/);
assert.match(summonsReceiver, /postAbsenceStageNotification\(Context context, String id, String student, int stage\) \{\s*if \(!LicenseManager\.canWrite\(context\)\) return false;/);
assert.match(bootReceiver, /if \(!LicenseManager\.canWrite\(context\)\) \{/);

assert.match(html, /let licenseReadOnly=isAndroidApp;/);
assert.match(html, /licenseReadOnly=!!\(!state\|\|!state\.hasLicense\|\|!state\.activated\)/);
assert.match(html, /if\(licenseReadOnly\)\{alert\('التطبيق غير مفعل/);
assert.match(html, /if\(!licenseReadOnly&&!save\(\)\)/);
assert.match(html, /action\.includes\('studentHistory'\)/);
assert.match(html, /setLicenseControlDisabled\(importButton,true\)/);
assert.match(html, /allowed\.has\(el\.id\)/);

assert.match(html, /id="firstRunLicensePanel"/,
  'The first-run wizard must expose a license activation path before the main navigation is available.');
assert.match(html, /id="firstRunDeviceId"/);
assert.match(html, /id="firstRunActivationCode"/);
assert.match(html, /id="firstRunRequestLicense"/);
assert.match(html, /id="firstRunActivateLicense"/);
assert.match(html, /id="firstRunValidateLicense"/);
assert.match(html, /firstRunRequestLicense','firstRunValidateLicense','firstRunActivateLicense/,
  'First-run activation actions must remain enabled while the app is unlicensed.');
assert.match(html, /firstRunLicensePanel input,#firstRunLicensePanel button/,
  'Only the first-run license panel may remain interactive before activation.');
assert.match(html, /AndroidBridge\.activateLicense\(code,'first-run-activate-/,
  'The first-run activation button must call the native activation bridge.');
assert.match(html, /firstRunLicenseStatus/,
  'The first-run wizard must display activation and validation feedback.');

for (const step of ['Prepare permanent release signing key','Validate release signing secrets','Build signed release APK','Verify release APK signature','Upload signed release APK']) {
  const at = workflow.indexOf('- name: ' + step);
  assert.ok(at >= 0, 'Missing workflow step: ' + step);
  const snippet = workflow.slice(at, at + 110);
  assert.ok(snippet.includes("if: github.ref == 'refs/heads/main'"), 'Production signing step must run only on main: ' + step);
}
console.log('PASS: fail-closed license enforcement, native service guards, backup safeguards, and production signing isolation.');
