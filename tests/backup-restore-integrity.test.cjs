const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const helperStart = html.indexOf('function inspectBackupIdentityIntegrity(data){');
const helperEnd = html.indexOf('async function importBackupText(raw,bytes){', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'backup identity integrity scanner exists before import');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);

const valid = {
  students: [{ id: 's-1' }, { id: 's-2' }],
  attendance: [{ id: 'a-1', student: 's-1' }, { student: 'deleted-student', studentName: 'تلميذ سابق' }],
  documents: [{ id: 'd-1', student: 's-2' }],
  violations: [],
  agenda: [{ id: 'g-1' }],
  followups: [{ id: 'f-1', student: 's-1' }]
};
const original = JSON.stringify(valid);
const result = context.inspectBackupIdentityIntegrity(valid);
assert.equal(result.ok, true, 'a valid backup passes the identity scan');
assert.equal(result.duplicateStudentIds.length, 0);
assert.equal(result.duplicateRecordIds.length, 0);
assert.equal(result.unresolvedStudentReferences, 1, 'a historical orphan reference is reported without being rewritten');
assert.equal(result.unresolvedStudentReferencesByCollection.attendance, 1,
  'orphaned historical links are localized to their source collection');
assert.equal(result.legacyRecordsWithoutIds, 1, 'legacy records without independent IDs are reported');
assert.equal(JSON.stringify(valid), original, 'the integrity scan never mutates backup content');

const duplicateStudents = context.inspectBackupIdentityIntegrity({
  students: [{ id: 'same' }, { id: 'same' }], attendance: [], documents: [], violations: []
});
assert.equal(duplicateStudents.ok, false, 'duplicate student IDs block restore');
assert.ok(duplicateStudents.blockers.some(x => x.includes('معرّفات تلاميذ مكررة')));

const missingStudentId = context.inspectBackupIdentityIntegrity({
  students: [{ last: 'اسم بلا معرّف' }], attendance: [], documents: [], violations: []
});
assert.equal(missingStudentId.ok, false, 'student records without stable IDs block restore');
assert.equal(missingStudentId.missingStudentIds, 1);

const duplicateHistoryIds = context.inspectBackupIdentityIntegrity({
  students: [{ id: 's-1' }],
  attendance: [{ id: 'same-record' }, { id: 'same-record' }],
  documents: [], violations: []
});
assert.equal(duplicateHistoryIds.ok, false, 'duplicate event IDs in one collection block restore');
assert.equal(duplicateHistoryIds.duplicateRecordIds.length, 1);

const duplicateFollowupIds = context.inspectBackupIdentityIntegrity({
  students: [{ id: 's-1' }], attendance: [], documents: [], violations: [],
  followups: [{ id: 'f-1' }, { id: 'f-1' }]
});
assert.equal(duplicateFollowupIds.ok, false, 'duplicate educational follow-up IDs block restore');

const importCall = html.indexOf('const integrity=inspectBackupIdentityIntegrity(normalized);');
const setPending = html.indexOf('pendingBackupData=normalized;', importCall);
assert.ok(importCall > 0 && setPending > importCall, 'integrity scan runs after legacy recovery and before data is staged for preview');
assert.match(html.slice(importCall, setPending), /if\(!integrity\.ok\)throw new Error/,
  'a backup with identity collisions is rejected before preview or write');
assert.match(html, /فحص سلامة المعرّفات/,
  'the preview explains integrity status and preserved historical references');

const restoreStart = html.indexOf('function restorePendingBackup(){');
const restoreEnd = html.indexOf('window.onNativeBackupLoaded=importBackupText;', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart, 'restore handler can be isolated');
const restoreSource = html.slice(restoreStart, restoreEnd);

const restoreContext = {
  pendingBackupData: { students: [{ id: 'new' }], attendance: [], documents: [], violations: [], agenda: [], followups: [], settings: {} },
  pendingBackupInfo: {},
  db: { students: [{ id: 'old' }], attendance: [], documents: [], violations: [], agenda: [], followups: [], settings: {} },
  AUDIT_LOG_LIMIT: 500,
  restoreInProgress: false,
  $: () => null,
  confirm: () => true,
  saveUndoSnapshot: () => true,
  save: () => false,
  clearStoredRecoverySnapshot: () => { restoreContext.snapshotCleared = true; return true; },
  refreshUndoPanel: () => { restoreContext.refreshed = true; },
  render: () => { restoreContext.rendered = true; },
  alert: message => { restoreContext.alertMessage = message; },
  snapshotCleared: false,
  window: {}
};
vm.createContext(restoreContext);
vm.runInContext(restoreSource, restoreContext);
const oldDatabase = restoreContext.db;
restoreContext.restorePendingBackup();
assert.equal(restoreContext.db, oldDatabase, 'failed restore returns the in-memory database to its original state');
assert.equal(restoreContext.snapshotCleared, false, 'failed restore never deletes the encrypted recovery snapshot');
assert.equal(restoreContext.refreshed, true);
assert.equal(restoreContext.rendered, true);
assert.equal(restoreContext.restoreInProgress, false, 'a failed restore releases its in-progress guard');
assert.match(restoreContext.alertMessage, /الإبقاء على نقطة الاسترجاع المشفّرة/,
  'the user is told that the recovery point remains available');

// Successful restore must explicitly select the native transactional path.
let observedSaveOptions = null;
const previewElement = { classList: { add() {} }, innerHTML: '' };
const successContext = {
  pendingBackupData: { students: [{ id: 'new' }], attendance: [], documents: [], violations: [], agenda: [], followups: [], settings: {} },
  pendingBackupInfo: {},
  db: { students: [{ id: 'old' }], attendance: [], documents: [], violations: [], agenda: [], followups: [], settings: {} },
  AUDIT_LOG_LIMIT: 500,
  restoreInProgress: false,
  $: selector => selector === '#backupPreview' ? previewElement : null,
  confirm: () => true,
  saveUndoSnapshot: () => true,
  save: options => { observedSaveOptions = options; return true; },
  refreshUndoPanel: () => {},
  render: () => {},
  alert: message => { successContext.alertMessage = message; },
  window: {}
};
vm.createContext(successContext);
vm.runInContext(restoreSource, successContext);
successContext.restorePendingBackup();
assert.equal(observedSaveOptions.restore, true, 'restore uses the transaction-only save mode');
assert.equal(successContext.db.students[0].id, 'new', 'successful restore adopts the staged backup');
assert.equal(successContext.pendingBackupData, null, 'successful restore clears staged import data');
assert.equal(successContext.restoreInProgress, false, 'successful restore releases its in-progress guard');
assert.match(successContext.alertMessage, /تمت استعادة النسخة الاحتياطية بنجاح/);

console.log('PASS: duplicate/missing stable identities are blocked, orphan history is disclosed by collection, and restore selects transaction mode while preserving rollback behavior.');
