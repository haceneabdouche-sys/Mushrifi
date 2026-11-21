const assert = require('node:assert/strict');
const audit = require('../app/src/main/assets/student-identity-audit.js');

const section = '1 ج م ع ت 1';
const db = {
  students: [
    { id: 'student-a', last: 'عيسو1', first: 'وائل', class: section, schoolYear: '1', branch: 'جذع مشترك علوم وتكنولوجيا' },
    { id: 'student-b', last: 'عيسو', first: 'وائل', class: section, schoolYear: '1', branch: 'جذع مشترك علوم وتكنولوجيا' },
    { id: 'student-c', last: 'علي', first: 'سامي', class: '2 ج م ع ت', schoolYear: '2', branch: 'علوم تجريبية' }
  ],
  attendance: [
    { id: 'att-a', student: 'student-a', studentName: 'اسم قديم مختلف', class: section, date: '2026-11-01', type: 'غياب', hours: 2 },
    { id: 'att-b', student: 'student-b', studentName: 'اسم آخر', class: section, date: '2026-11-02', type: 'تأخر', minutes: 15 },
    { id: 'att-legacy-ambiguous', student: 'وائل عيسو١', studentName: 'وائل عيسو١', class: section, date: '2026-11-03', type: 'غياب', hours: 1 },
    { id: 'att-legacy-unique', student: 'سامي علي', studentName: 'سامي علي', class: '2 ج م ع ت', date: '2026-11-04', type: 'تأخر', minutes: 10 },
    { id: 'att-legacy-no-section', student: '', studentName: 'وائل عيسو', date: '2026-11-05', type: 'غياب', hours: 1 }
  ],
  documents: [
    { id: 'doc-legacy-unmatched', student: 'وائل عيسو', studentName: 'وائل عيسو', class: '3 آداب', date: '2026-11-06', type: 'استدعاء' },
    { id: 'doc-stable', student: 'student-c', studentName: 'اسم غير مطابق', class: '2 ج م ع ت', date: '2026-11-07', type: 'إشعار' }
  ],
  violations: [],
  settings: {}
};

const before = JSON.parse(JSON.stringify(db));
assert.equal(audit.normalizeNameKey('وائل عيسو١'), audit.normalizeNameKey('عيسو1 وائل'));
assert.equal(audit.normalizeNameKey('وَائِل عيسو'), audit.normalizeNameKey('وائل عيسو1'));
assert.equal(audit.normalizeNameKey('محمد 2 علي') === audit.normalizeNameKey('محمد علي'), false);

const idPriority = audit.resolveStudentForRecord(db.students, db.attendance[0]);
assert.equal(idPriority.reason, 'id');
assert.equal(idPriority.student.id, 'student-a');
const ambiguousMatch = audit.resolveStudentForRecord(db.students, { studentName: 'وائل عيسو1', class: section });
assert.equal(ambiguousMatch.ambiguous.length, 2);

const report = audit.buildStudentNameAuditReport(db);
assert.equal(report.summary.groups, 1);
assert.equal(report.summary.duplicateCards, 2);
assert.equal(report.summary.stableLinked, 3);
assert.equal(report.summary.legacyUnique, 1);
assert.equal(report.summary.ambiguous, 2);
assert.equal(report.summary.unmatched, 1);

const group = report.groups[0];
assert.equal(group.members.length, 2);
assert.equal(group.members.find(x => x.id === 'student-a').stable.attendance.filter(x => x.type === 'غياب').length, 1);
assert.equal(group.members.find(x => x.id === 'student-b').stable.attendance.filter(x => x.type === 'تأخر').length, 1);
assert.equal(group.ambiguousRecords.length, 2);
assert.equal(report.ambiguousRecords.some(x => x.id === 'att-legacy-ambiguous'), true);
assert.equal(report.unmatchedRecords.some(x => x.id === 'doc-legacy-unmatched'), true);
assert.deepEqual(db, before, 'audit must never mutate student or attendance data');

console.log('Student identity audit tests passed.');
