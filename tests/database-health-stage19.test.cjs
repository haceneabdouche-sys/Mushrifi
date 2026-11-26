const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build-apk.yml', 'utf8');
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');

const methodStart = activity.indexOf('synchronized String inspectHealth()');
assert.ok(methodStart >= 0, 'native read-only database inspection exists');
const inspect = activity.slice(methodStart, activity.indexOf('    private LocalDb localDb;', methodStart));
assert.match(inspect, /SQLiteDatabase\.openDatabase\([\s\S]*?SQLiteDatabase\.OPEN_READONLY/,
  'inspection opens the existing database file strictly read-only');
assert.match(inspect, /getDatabasePath\("mushrifi_local\.db"\)/,
  'inspection uses the exact application database file');
assert.match(inspect, /PRAGMA quick_check\(1\)/,
  'SQLite quick_check is run');
assert.match(inspect, /hasExpectedColumns\(database, "appdata", new String\[\]\{"id", "json"\}\)/,
  'main table schema is checked');
assert.match(inspect, /validateApplicationDatabaseJson\(decryptData\(stored\)\)/,
  'decrypted primary payload is structurally checked');
assert.match(inspect, /validateRecoverySnapshotJson\(decryptData\(stored\)\)/,
  'an existing recovery snapshot is authenticated and structurally validated');
assert.match(inspect, /hasDataEncryptionKey\(\)/,
  'the keystore alias is inspected without creating a replacement key');
assert.doesNotMatch(inspect, /getWritableDatabase|beginTransaction|setTransactionSuccessful|insertWithOnConflict|\.delete\s*\(|execSQL/,
  'diagnostic contains no writable database handle or mutation SQL');
assert.match(activity, /private static boolean hasDataEncryptionKey\(\)[\s\S]*?ks\.containsAlias\("mushrifi_data_key"\)/,
  'missing encryption keys are detected without generating a new key');
assert.match(activity, /@JavascriptInterface public void inspectDatabaseHealth\(String callbackId\)[\s\S]*?databaseHealthExecutor\.execute[\s\S]*?JSONObject\.quote\(callbackId\)[\s\S]*?runOnUiThread/,
  'inspection is asynchronous and returns through a safely quoted callback');

assert.match(html, /id="databaseIntegrityStatus"[\s\S]*?id="inspectDatabaseHealth"/,
  'backup settings show a dedicated database health status and action');
assert.match(html, /الفحص تشخيصي للقراءة فقط؛ لا يصلح البيانات ولا يحذفها ولا يستبدلها/,
  'the UI accurately describes the non-destructive diagnostic');
assert.match(html, /window\.onMushrifiDatabaseHealth=/,
  'the UI handles the native diagnostic result');
assert.match(html, /AndroidBridge\.inspectDatabaseHealth\(callbackId\)/,
  'the button invokes the native read-only inspector');
assert.match(workflow, /Run Stage 19 read-only database health diagnostics tests[\s\S]*?node tests\/database-health-stage19\.test\.cjs/,
  'CI runs the Stage 19 regression test');
assert.match(gradle, /versionCode\s+\d+[\s\S]*?versionName '2\.6'/,
  'an internal build number is configured while the visible app version remains 2.6');

console.log('PASS: Stage 19 read-only SQLite quick_check, schema/data/decryption/recovery validation, async UI callback, and no-mutation contract.');
