const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const localStart = activity.indexOf('private static class LocalDb');
const bridgeStart = activity.indexOf('public class AndroidBridge');
assert.ok(localStart >= 0 && bridgeStart > localStart, 'native local database and bridge exist');
const localDb = activity.slice(localStart, bridgeStart);

assert.match(localDb, /LocalDb\(Context c\)\s*\{\s*super\(c,\s*"mushrifi_local\.db",\s*null,\s*2\)/,
  'schema version is advanced for the additive recovery-table migration');
assert.match(localDb, /onCreate\(SQLiteDatabase db\)[\s\S]*?CREATE TABLE appdata[\s\S]*?ensureRecoveryTable\(db\)/,
  'new databases create both application data and recovery point tables');
assert.match(localDb, /onUpgrade\(SQLiteDatabase db, int oldVersion, int newVersion\)[\s\S]*?ensureRecoveryTable\(db\)/,
  'existing version 1 databases receive the additive recovery-table migration');
const upgradeStart = localDb.indexOf('onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion)');
const upgradeEnd = localDb.indexOf('private void ensureRecoveryTable', upgradeStart);
const upgrade = localDb.slice(upgradeStart, upgradeEnd);
assert.doesNotMatch(upgrade, /DROP\s+TABLE|DELETE\s+FROM|db\.delete\s*\(|database\.delete\s*\(|UPDATE\s+appdata|INSERT\s+INTO\s+appdata/i,
  'schema migration contains no destructive SQL or appdata replacement statements');

const validateStart = localDb.indexOf('private void validateRecoverySnapshotJson(String json)');
const saveStart = localDb.indexOf('synchronized boolean saveRecoverySnapshot(String json)');
const readStart = localDb.indexOf('synchronized String readRecoverySnapshot()', saveStart);
const clearStart = localDb.indexOf('synchronized boolean clearRecoverySnapshot()', readStart);
assert.ok(validateStart >= 0 && saveStart > validateStart && readStart > saveStart && clearStart > readStart,
  'recovery snapshot validation and lifecycle methods are all present');
const validate = localDb.slice(validateStart, saveStart);
for (const key of ['students','attendance','documents','violations']) {
  assert.ok(validate.includes('"' + key + '"'), 'snapshot validator checks required collection ' + key);
}
assert.match(validate, /optInt\("version",\s*-1\)\s*!=\s*1/,
  'snapshot format must be version 1');
assert.match(validate, /opt\("database"\) instanceof org\.json\.JSONObject/,
  'snapshot must contain its database object');
assert.match(validate, /opt\("settings"\) instanceof org\.json\.JSONObject/,
  'snapshot must contain valid settings');
assert.match(validate, /new String\[\]\{"agenda", "followups", "supervisionLogs", "auditLog"\}/,
  'optional current collections are type-checked without breaking legacy snapshots');
assert.match(validate, /records\.opt\(i\) instanceof org\.json\.JSONObject/,
  'snapshot arrays cannot contain malformed record values');

const save = localDb.slice(saveStart, readStart);
const saveOrder = [
  'validateRecoverySnapshotJson(json)',
  'encryptData(json)',
  'database.beginTransaction()',
  'database.insertWithOnConflict(',
  'SELECT json FROM recovery_snapshot WHERE id=1',
  'verifiedJson = decryptData(cursor.getString(0))',
  'validateRecoverySnapshotJson(verifiedJson)',
  'if (!json.equals(verifiedJson))',
  'database.setTransactionSuccessful()',
  'database.endTransaction()',
  'return saved;'
].map(s => save.indexOf(s));
for (let i=0;i<saveOrder.length;i++) assert.ok(saveOrder[i]>=0, 'snapshot save includes ' + i);
for (let i=1;i<saveOrder.length;i++) assert.ok(saveOrder[i-1]<saveOrder[i], 'snapshot save ordering is safe at step ' + i);
assert.match(save, /if\s*\(transactionStarted\s*&&\s*database\s*!=\s*null\)/,
  'snapshot transaction is closed in all outcomes');
assert.match(save, /if\s*\(saved\)\s*lastError\s*=\s*""/,
  'snapshot errors are cleared only after verified commit');

const read = localDb.slice(readStart, clearStart);
assert.match(read, /getReadableDatabase\(\)/,
  'recovery snapshot reads do not open a write transaction');
assert.match(read, /validateRecoverySnapshotJson\(json\)/,
  'decrypted snapshot is validated before being exposed to undo');
assert.match(read, /decryptData\(cursor\.getString\(0\)\)/,
  'read returns authenticated plaintext from the stored ciphertext');

const clear = localDb.slice(clearStart);
const clearOrder = [
  'database.beginTransaction()',
  'database.delete("recovery_snapshot"',
  'SELECT 1 FROM recovery_snapshot WHERE id=1',
  'database.setTransactionSuccessful()',
  'database.endTransaction()',
  'return cleared;'
].map(s => clear.indexOf(s));
for (let i=0;i<clearOrder.length;i++) assert.ok(clearOrder[i]>=0, 'snapshot clear includes ' + i);
for (let i=1;i<clearOrder.length;i++) assert.ok(clearOrder[i-1]<clearOrder[i], 'snapshot clear ordering is safe at step ' + i);
assert.match(clear, /if\s*\(transactionStarted\s*&&\s*database\s*!=\s*null\)/,
  'clear transaction is always closed');

const bridge = activity.slice(bridgeStart);
assert.match(bridge, /@JavascriptInterface public boolean saveRecoverySnapshot\(String json\)[\s\S]*?LicenseManager\.canWrite\(MainActivity\.this\)[\s\S]*?localDb\.saveRecoverySnapshot\(json\)/,
  'snapshot writes retain the native license guard');
assert.match(bridge, /@JavascriptInterface public boolean clearRecoverySnapshot\(\)\s*\{\s*if \(!LicenseManager\.canWrite\(MainActivity\.this\)\) return false;\s*return localDb\.clearRecoverySnapshot\(\);/,
  'snapshot deletion cannot bypass the native license write guard');
assert.match(bridge, /@JavascriptInterface public String loadRecoverySnapshot\(\)\s*\{\s*return localDb\.readRecoverySnapshot\(\);/,
  'read access remains available for status and undo inspection');

console.log('PASS: Stage 18 recovery snapshot format validation, verified transactional save, read-only access, transactional clear and additive schema migration.');
