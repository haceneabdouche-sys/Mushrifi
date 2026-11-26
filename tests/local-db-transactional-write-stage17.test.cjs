const assert = require('node:assert/strict');
const fs = require('node:fs');

const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const start = activity.indexOf('synchronized boolean write(String json) {');
const end = activity.indexOf('synchronized boolean restoreSafely(String json) {', start);
assert.ok(start >= 0 && end > start, 'LocalDb write method is present and independently inspectable');

const write = activity.slice(start, end);
const begin = write.indexOf('database.beginTransaction()');
const insert = write.indexOf('database.insertWithOnConflict(');
const readBack = write.indexOf('SELECT json FROM appdata WHERE id=1');
const decrypt = write.indexOf('verifiedJson = decryptData(cursor.getString(0))');
const compare = write.indexOf('if (!json.equals(verifiedJson))');
const markSuccessful = write.indexOf('database.setTransactionSuccessful()');
const finallyBlock = write.indexOf('finally');
const endTransaction = write.indexOf('database.endTransaction()');
const returnSaved = write.lastIndexOf('return saved;');

for (const [name, index] of Object.entries({
  begin, insert, readBack, decrypt, compare, markSuccessful, finallyBlock, endTransaction, returnSaved
})) assert.ok(index >= 0, 'verified transactional write contains ' + name);

assert.ok(begin < insert, 'SQLite transaction starts before replacing the current row');
assert.ok(insert < readBack, 'stored row is queried after insertion');
assert.ok(readBack < decrypt, 'the persisted ciphertext is decrypted from SQLite, not verified in memory');
assert.ok(decrypt < compare, 'the decrypted stored JSON is compared with the exact submitted JSON');
assert.ok(compare < markSuccessful, 'a mismatch aborts before the transaction is marked successful');
assert.ok(markSuccessful < finallyBlock, 'the transaction is marked successful only after read-back verification');
assert.ok(finallyBlock < endTransaction, 'endTransaction is performed from the finally block');
assert.ok(endTransaction < returnSaved, 'the method returns only after SQLite closes or rolls back the transaction');
assert.match(write, /if\s*\(transactionStarted\s*&&\s*database\s*!=\s*null\)/,
  'only an actually started transaction is ended');
assert.match(write, /catch\s*\(Exception\s+error\)[\s\S]*?lastError\s*=/,
  'write and verification failures are exposed in the native database error state');
assert.match(write, /saved\s*=\s*false/);
assert.match(write, /if\s*\(saved\)\s*lastError\s*=\s*""/,
  'the last error is cleared only after a verified commit');
assert.doesNotMatch(write, /database\.delete\(/,
  'failed verification does not manually delete the current record');

const bridgeStart = activity.indexOf('public class AndroidBridge');
const bridge = activity.slice(bridgeStart);
assert.match(bridge, /@JavascriptInterface public boolean saveDatabase\(String json\)[\s\S]*?LicenseManager\.canWrite\(MainActivity\.this\)[\s\S]*?localDb\.write\(json\)/,
  'the existing native license write guard remains enforced for all application saves');
assert.match(activity, /restoreSafely\(json\)/,
  'the separately guarded restore path remains intact');

console.log('PASS: Stage 17 SQLite write transaction, encrypted read-back verification, rollback-on-failure contract and license guard.');
