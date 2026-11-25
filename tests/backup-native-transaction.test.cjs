const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const helper = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/BackupIntegrity.java', 'utf8');
const localDbStart = activity.indexOf('private static class LocalDb');
const bridgeStart = activity.indexOf('public class AndroidBridge');
assert.ok(localDbStart >= 0 && bridgeStart > localDbStart, 'native local database and bridge exist');
const localDb = activity.slice(localDbStart, bridgeStart);
const restoreStart = localDb.indexOf('synchronized boolean restoreSafely(String json)');
const restoreEnd = localDb.indexOf('synchronized boolean saveRecoverySnapshot(String json)', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'safe restore implementation exists inside LocalDb');
const restore = localDb.slice(restoreStart, restoreEnd);

assert.match(helper, /MessageDigest\.getInstance\("SHA-256"\)/, 'native digest uses the standard SHA-256 implementation');
assert.match(helper, /StandardCharsets\.UTF_8/, 'native digest hashes UTF-8 bytes');
assert.match(activity, /@JavascriptInterface public String sha256Utf8\(String value\)/,
  'Android WebView bridge exposes the SHA-256 helper');
assert.match(activity, /@JavascriptInterface public boolean restoreDatabaseSafely\(String json\)[\s\S]*?LicenseManager\.canWrite\(MainActivity\.this\)[\s\S]*?localDb\.restoreSafely\(json\)/,
  'native transaction remains protected by the existing license write policy');
assert.match(restore, /database\.beginTransaction\(\)/, 'restore opens a SQLite transaction');
assert.match(restore, /SELECT json FROM recovery_snapshot WHERE id=1/,
  'restore requires the pre-existing encrypted undo snapshot');
assert.match(restore, /recoveryEnvelope\.optInt\("version", -1\) != 1/,
  'the encrypted undo snapshot must retain its expected versioned envelope');
assert.match(restore, /database\.insertWithOnConflict\("appdata"/,
  'the replacement database is written inside the transaction');
assert.match(restore, /if \(!json\.equals\(verifiedJson\)\)/,
  'the newly written database is decrypted and compared before commit');
assert.match(restore, /database\.setTransactionSuccessful\(\)/,
  'SQLite only commits after the read-back check');
assert.match(restore, /database\.endTransaction\(\)/,
  'failed or completed transactions are always closed');
assert.doesNotMatch(restore, /delete\("recovery_snapshot"/,
  'restore does not erase the encrypted recovery point');

console.log('PASS: native restore transaction contract, encrypted recovery preservation, read-back verification, and license guard.');
