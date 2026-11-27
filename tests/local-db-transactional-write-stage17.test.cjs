const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const start = activity.indexOf('synchronized boolean write(String json, boolean clearRecoverySnapshot) {');
const wrapper = activity.indexOf('synchronized boolean write(String json) {');
const end = activity.indexOf('synchronized boolean restoreSafely(String json) {', start);
assert.ok(start >= 0 && end > start && wrapper >= 0 && wrapper < start, 'LocalDb retains a compatibility write overload and a policy-aware write method');
const write = activity.slice(start, end);
const begin = write.indexOf('database.beginTransaction()');
const insert = write.indexOf('database.insertWithOnConflict(');
const readBack = write.indexOf('SELECT json FROM appdata WHERE id=1');
const compare = write.indexOf('if (!encryptedJson.equals(verifiedCiphertext))');
const clearRecovery = write.indexOf('if (clearRecoverySnapshot)');
const deleteSnapshot = write.indexOf('database.delete("recovery_snapshot", "id=1", null)');
const markSuccessful = write.indexOf('database.setTransactionSuccessful()');
const finallyBlock = write.indexOf('finally');
const endTransaction = write.indexOf('database.endTransaction()');
const returnSaved = write.lastIndexOf('return saved;');
for (const [name, index] of Object.entries({begin,insert,readBack,compare,clearRecovery,deleteSnapshot,markSuccessful,finallyBlock,endTransaction,returnSaved}))
  assert.ok(index >= 0, 'policy-aware transactional write contains ' + name);
assert.ok(begin < insert && insert < readBack, 'SQLite transaction begins before insert and reads back the exact stored row');
assert.ok(readBack < compare && compare < clearRecovery && clearRecovery < deleteSnapshot && deleteSnapshot < markSuccessful,
  'the row is verified before optional undo cleanup, and both operations commit atomically');
assert.doesNotMatch(write, /decryptData\(/, 'ordinary saves avoid a second full-size decrypt after encryption');
assert.ok(markSuccessful < finallyBlock && finallyBlock < endTransaction && endTransaction < returnSaved,
  'the transaction returns only after a successful commit or rollback');
assert.match(write, /if\s*\(transactionStarted\s*&&\s*database\s*!=\s*null\)/, 'only a started transaction is ended');
assert.match(write, /catch\s*\(Exception\s+error\)[\s\S]*?lastError\s*=/, 'write and verification failures are exposed in native database error state');
assert.match(write, /if\s*\(saved\)\s*lastError\s*=\s*""/, 'last error clears only after a verified commit');
assert.match(activity, /synchronized boolean write\(String json\)\s*\{\s*\/\/ Preserve the original bridge contract for legacy callers\.\s*return write\(json, true\);/, 'legacy callers retain the old clear-undo default');

const bridgeStart = activity.indexOf('public class AndroidBridge');
const bridge = activity.slice(bridgeStart);
assert.match(bridge, /@JavascriptInterface public boolean saveDatabase\(String json\)[\s\S]*?LicenseManager\.canWrite\(MainActivity\.this\)[\s\S]*?localDb\.write\(json\)/, 'the legacy native license guard remains enforced');
assert.match(bridge, /@JavascriptInterface public boolean saveDatabaseWithPolicy\(String json, boolean clearRecoverySnapshot\)[\s\S]*?LicenseManager\.canWrite\(MainActivity\.this\)[\s\S]*?localDb\.write\(json, clearRecoverySnapshot\)/, 'the fast policy bridge keeps the license guard and atomically applies undo cleanup');
assert.match(activity, /restoreSafely\(json\)/,
  'the separately guarded restore path remains intact');

console.log('PASS: Stage 17 SQLite ciphertext verification, atomic optional undo cleanup, rollback-on-failure contract and license guard.');

