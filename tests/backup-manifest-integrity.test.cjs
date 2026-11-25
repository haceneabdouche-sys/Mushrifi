const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const helperStart = html.indexOf('function backupPayloadCounts(data){');
const helperEnd = html.indexOf('async function importBackupText(raw,bytes){', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'backup manifest helpers exist before import');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(helperStart, helperEnd), context);

const payload = {
  students: [{ id: 's-1', last: 'عبدوش', first: 'حسن' }],
  attendance: [{ id: 'a-1', student: 's-1', note: 'غياب صباحي' }],
  documents: [],
  violations: [],
  agenda: [{ id: 'g-1' }],
  followups: [{ id: 'f-1', student: 's-1' }],
  auditLog: [{ id: 'log-1' }],
  settings: { school: 'مؤسسة تربوية' }
};
const manifest = context.createMushrifiBackupManifest(payload, '2026-11-25T12:30:00.000Z');
assert.equal(manifest.format, 'mushrifi-backup');
assert.equal(manifest.formatVersion, 1);
assert.equal(manifest.dataSchemaVersion, 1);
assert.equal(manifest.appVersion, '2.6');
assert.ok(manifest.payloadBytes > JSON.stringify(payload).length, 'UTF-8 byte count accounts for Arabic text');
assert.deepEqual(JSON.parse(JSON.stringify(manifest.counts)), {
  students: 1, attendance: 1, documents: 0, violations: 0,
  agenda: 1, followups: 1, auditLog: 1
});

const envelope = { ...payload, mushrifiBackup: manifest };
const valid = context.verifyMushrifiBackupManifest(envelope);
assert.equal(valid.ok, true, 'the unmodified manifest and payload validate');
assert.equal(valid.present, true);
assert.equal(valid.exportedAt, manifest.exportedAt);

const changedPayload = JSON.parse(JSON.stringify(envelope));
changedPayload.attendance[0].note = 'غياب كامل';
assert.equal(context.verifyMushrifiBackupManifest(changedPayload).ok, false,
  'editing a record after export invalidates its content fingerprint');

const changedCount = JSON.parse(JSON.stringify(envelope));
changedCount.mushrifiBackup.counts.students = 8;
assert.equal(context.verifyMushrifiBackupManifest(changedCount).ok, false,
  'manifest record counts must match the actual arrays');

const changedLength = JSON.parse(JSON.stringify(envelope));
changedLength.mushrifiBackup.payloadBytes += 1;
assert.equal(context.verifyMushrifiBackupManifest(changedLength).ok, false,
  'payload byte count must match');

const futureSchema = JSON.parse(JSON.stringify(envelope));
futureSchema.mushrifiBackup.dataSchemaVersion = 999;
assert.equal(context.verifyMushrifiBackupManifest(futureSchema).ok, false,
  'unknown data schema versions are rejected');

const legacy = context.verifyMushrifiBackupManifest(payload);
assert.equal(legacy.ok, true, 'legacy backups remain eligible for the existing structural and identity checks');
assert.equal(legacy.present, false);
assert.equal(legacy.legacy, true);

const importAt = html.indexOf('const manifestCheck=verifyMushrifiBackupManifest(obj);');
const recoverAt = html.indexOf('const recovered=recoverStudentsFromHistory(obj);', importAt);
assert.ok(importAt > 0 && recoverAt > importAt,
  'manifest validation occurs before legacy recovery and before data is staged');
assert.match(html.slice(importAt, recoverAt), /delete obj\.mushrifiBackup/,
  'backup metadata is removed before it can be persisted as ordinary application data');
assert.match(html, /نسخة من إصدار سابق/,
  'legacy backups are clearly identified in the restore preview');
assert.match(html, /let restoreInProgress=false;/,
  'restore operations have an explicit re-entry guard');
assert.match(html, /جارٍ حفظ النسخة واستبدال البيانات/,
  'the restore button visibly reports the active restore operation');
assert.match(html, /replace\(\/\^\\uFEFF\//,
  'the import reader strips a real UTF-8 BOM before JSON parsing');

console.log('PASS: backup manifest detects content/count/size/schema changes, reports legacy compatibility, and is checked before restore staging.');
