const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');

(async () => {
  const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
  const helperStart = html.indexOf('function backupPayloadCounts(data){');
  const helperEnd = html.indexOf('async function importBackupText(raw,bytes){', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'backup manifest helpers exist before import');

  const bridge = {
    sha256Utf8(value) {
      return nodeCrypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
    }
  };
  const context = { window: { AndroidBridge: bridge }, AndroidBridge: bridge, crypto: nodeCrypto.webcrypto, TextEncoder };
  vm.createContext(context);
  vm.runInContext(html.slice(helperStart, helperEnd), context);

  const payload = {
    students: [{ id: 's-1', last: 'عبدوش', first: 'حسن' }],
    attendance: [{ id: 'a-1', student: 's-1', note: 'غياب صباحي' }],
    documents: [],
    violations: [],
    agenda: [{ id: 'g-1' }],
    followups: [{ id: 'f-1', student: 's-1' }],
    supervisionLogs: [{ id: 'sl-1', type: 'حراسة الامتحانات' }],
    auditLog: [{ id: 'log-1' }],
    settings: { school: 'مؤسسة تربوية' }
  };
  const serialized = JSON.stringify(payload);
  const manifest = await context.createMushrifiBackupManifest(payload, '2026-11-25T12:30:00.000Z');
  assert.equal(manifest.format, 'mushrifi-backup');
  assert.equal(manifest.formatVersion, 2, 'new backups use manifest format v2');
  assert.equal(manifest.dataSchemaVersion, 1, 'the application data schema is not changed');
  assert.equal(manifest.appVersion, '2.6');
  assert.ok(manifest.payloadBytes > serialized.length, 'UTF-8 byte count accounts for Arabic text');
  assert.deepEqual(JSON.parse(JSON.stringify(manifest.counts)), {
    students: 1, attendance: 1, documents: 0, violations: 0,
    agenda: 1, followups: 1, supervisionLogs: 1, auditLog: 1
  });
  assert.equal(manifest.checksum.algorithm, 'CRC32');
  assert.equal(manifest.strongChecksum.algorithm, 'SHA-256');
  assert.equal(manifest.strongChecksum.value, nodeCrypto.createHash('sha256').update(serialized, 'utf8').digest('hex'));

  const envelope = { ...payload, mushrifiBackup: manifest };
  const valid = await context.verifyMushrifiBackupManifest(envelope);
  assert.equal(valid.ok, true, 'an unmodified v2 manifest validates');
  assert.equal(valid.present, true);
  assert.equal(valid.strongHashVerified, true);
  assert.equal(valid.integrityLevel, 'sha256+crc32');
  assert.equal(valid.exportedAt, manifest.exportedAt);

  const changedPayload = JSON.parse(JSON.stringify(envelope));
  changedPayload.attendance[0].note = 'غياب كامل';
  assert.equal((await context.verifyMushrifiBackupManifest(changedPayload)).ok, false,
    'editing a record after export invalidates the content digests');

  const changedSha = JSON.parse(JSON.stringify(envelope));
  changedSha.mushrifiBackup.strongChecksum.value = '0'.repeat(64);
  assert.equal((await context.verifyMushrifiBackupManifest(changedSha)).ok, false,
    'a mismatched SHA-256 digest blocks restore');

  const missingSha = JSON.parse(JSON.stringify(envelope));
  delete missingSha.mushrifiBackup.strongChecksum;
  assert.equal((await context.verifyMushrifiBackupManifest(missingSha)).ok, false,
    'v2 backups must contain SHA-256');

  const changedCount = JSON.parse(JSON.stringify(envelope));
  changedCount.mushrifiBackup.counts.students = 8;
  assert.equal((await context.verifyMushrifiBackupManifest(changedCount)).ok, false,
    'manifest record counts must match the actual arrays');

  const changedLength = JSON.parse(JSON.stringify(envelope));
  changedLength.mushrifiBackup.payloadBytes += 1;
  assert.equal((await context.verifyMushrifiBackupManifest(changedLength)).ok, false,
    'payload byte count must match');

  const futureSchema = JSON.parse(JSON.stringify(envelope));
  futureSchema.mushrifiBackup.dataSchemaVersion = 999;
  assert.equal((await context.verifyMushrifiBackupManifest(futureSchema)).ok, false,
    'unknown data schema versions are rejected');

  const futureFormat = JSON.parse(JSON.stringify(envelope));
  futureFormat.mushrifiBackup.formatVersion = 999;
  assert.equal((await context.verifyMushrifiBackupManifest(futureFormat)).ok, false,
    'unknown manifest format versions are rejected');

  // Stage-11 (formatVersion 1) backups remain verifiable and restorable,
  // but the preview must identify that they have CRC32 only.
  const v1 = {
    ...payload,
    mushrifiBackup: {
      format: 'mushrifi-backup',
      formatVersion: 1,
      dataSchemaVersion: 1,
      appVersion: '2.6',
      exportedAt: '2026-11-24T12:30:00.000Z',
      payloadBytes: context.backupUtf8ByteLength(serialized),
      counts: context.backupPayloadCounts(payload),
      checksum: { algorithm: 'CRC32', value: context.backupCrc32(serialized) }
    }
  };
  const v1Result = await context.verifyMushrifiBackupManifest(v1);
  assert.equal(v1Result.ok, true, 'Stage-11 CRC32-only manifests remain supported');
  assert.equal(v1Result.formatVersion, 1);
  assert.equal(v1Result.strongHashVerified, false);
  assert.equal(v1Result.integrityLevel, 'crc32-legacy');

  const noManifest = await context.verifyMushrifiBackupManifest(payload);
  assert.equal(noManifest.ok, true, 'older backups without manifests remain eligible for structural and identity checks');
  assert.equal(noManifest.present, false);
  assert.equal(noManifest.legacy, true);

  // Exercise the WebCrypto fallback used outside the Android native bridge.
  const fallbackContext = { window: {}, crypto: nodeCrypto.webcrypto, TextEncoder };
  vm.createContext(fallbackContext);
  vm.runInContext(html.slice(helperStart, helperEnd), fallbackContext);
  assert.equal(await fallbackContext.backupSha256('مُشرِفي'),
    '8cee3fe390c95b305a7f8db90ab13d6363cd8090a18c4ad53b7c9b568a44fdfb',
    'WebCrypto fallback hashes Arabic as UTF-8');

  const importAt = html.indexOf('const manifestCheck=await verifyMushrifiBackupManifest(obj);');
  const recoverAt = html.indexOf('const recovered=recoverStudentsFromHistory(obj);', importAt);
  assert.ok(importAt > 0 && recoverAt > importAt,
    'manifest validation completes before legacy recovery and before data is staged');
  assert.match(html.slice(importAt, recoverAt), /delete obj\.mushrifiBackup/,
    'backup metadata is removed before it can be persisted as ordinary application data');
  assert.match(html, /await createMushrifiBackupManifest/,
    'export awaits SHA-256 generation before creating the file');
  assert.match(html, /await verifyMushrifiBackupManifest\(JSON\.parse\(json\)\)/,
    'the generated export is self-verified before it is saved');
  assert.match(html, /نسخة من إصدار سابق/,
    'backups without a manifest are clearly identified');
  assert.match(html, /لا تتضمن SHA-256/,
    'Stage-11 v1 manifests are clearly identified as CRC32-only');
  assert.match(html, /let restoreInProgress=false;/,
    'restore operations have an explicit re-entry guard');
  assert.match(html, /جارٍ حفظ النسخة واستبدال البيانات/,
    'the restore button visibly reports the active restore operation');
  assert.match(html, /replace\(\/\^\\uFEFF\//,
    'the import reader strips a real UTF-8 BOM before JSON parsing');

  console.log('PASS: SHA-256 + CRC32 v2 manifests, Stage-11 v1 and legacy compatibility, Arabic UTF-8 digesting, tamper detection, and pre-restore validation.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
