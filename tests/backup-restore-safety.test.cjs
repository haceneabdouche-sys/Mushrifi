const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const start = html.indexOf('function restorePendingBackup(){');
const end = html.indexOf('\nwindow.onNativeBackupLoaded', start);
assert.ok(start >= 0 && end > start, 'The native backup restore handler must exist.');
const source = html.slice(start, end);

function runRestore(saveResult) {
  const preview = { hidden: false, innerHTML: '<b>preview</b>', classList: {
    add(name) { if (name === 'hidden') preview.hidden = true; },
    remove(name) { if (name === 'hidden') preview.hidden = false; }
  }};
  const oldDb = { students: [{ id: 'old' }], attendance: [], documents: [], violations: [] };
  const importedDb = { students: [{ id: 'new' }], attendance: [], documents: [], violations: [] };
  const context = {
    db: oldDb,
    pendingBackupData: importedDb,
    pendingBackupInfo: { recoveredCount: 0, missingClassCount: 0 },
    confirm: () => true,
    alert: () => {},
    $: selector => selector === '#backupPreview' ? preview : null,
    save: () => saveResult,
    render: () => {},
    name: () => '',
    AndroidBridge: { replaceSummonsReminders: () => {} },
    window: { AndroidBridge: true }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  context.restorePendingBackup();
  return { context, preview, oldDb, importedDb };
}

const failed = runRestore(false);
assert.equal(failed.context.db, failed.oldDb, 'A failed write must restore the previous in-memory database.');
assert.equal(failed.context.pendingBackupData, failed.importedDb, 'A failed write must retain the imported backup for retry.');
assert.equal(failed.context.pendingBackupInfo.recoveredCount, 0, 'A failed write must retain recovery metadata.');
assert.equal(failed.preview.hidden, false, 'A failed write must restore the preview.');
assert.equal(failed.preview.innerHTML, '<b>preview</b>', 'A failed write must preserve the preview contents.');

const succeeded = runRestore(true);
assert.equal(succeeded.context.db, succeeded.importedDb, 'A successful write must make the imported database active.');
assert.equal(succeeded.context.pendingBackupData, null, 'A successful write may clear the pending backup.');
assert.equal(succeeded.context.pendingBackupInfo, null, 'A successful write may clear recovery metadata.');
assert.equal(succeeded.preview.hidden, true, 'The preview must remain hidden after success.');
console.log('PASS: backup restore rollback and retry safety.');
