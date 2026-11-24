const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const manifest=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');

assert.match(manifest,/android:allowBackup="false"/,
  'Android cloud backup must stay disabled while app data is encrypted with a device-local keystore key');
assert.match(html,/تنبيه مهم لحماية بياناتك/,
  'the backup screen must clearly show the data-retention warning');
assert.match(html,/صلاحية الترخيص ليست نسخة احتياطية/,
  'users must not confuse persistent license activation with a data backup');
assert.match(html,/قبل حذف التطبيق أو الانتقال إلى هاتف آخر، صدّر نسخة احتياطية/,
  'users must be told to export data before uninstalling or changing phones');
assert.match(html,/لا تحذف النسخة القديمة إلا بعد التأكد من نجاح الاستعادة/,
  'users must be told to retain the old backup until restore is verified');


const mainActivity=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java','utf8');
assert.match(mainActivity,/MessageDigest\.isEqual\(expectedDigest, actualDigest\)/,
  'native backup export must verify saved bytes against the exact exported payload');
assert.match(mainActivity,/last_verified_backup/,
  'the app must record the timestamp only after the saved backup content is verified');
assert.match(html,/window\.onMushrifiBackupVerified/,
  'the verified native backup timestamp must update the app status');
assert.match(html,/backupHealthStatus/,
  'the backup screen must show last backup age and encourage a fresh export after seven days');

console.log('PASS: local backup warnings, byte integrity verification, and backup-age status are covered.');
