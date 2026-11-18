const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../android/app/src/main/assets/index.html'), 'utf8');
const historyStart = html.indexOf('studentHistory=id=>');
const start = html.indexOf('  const normStudentName=', historyStart);
const end = html.indexOf('  const v=db.violations', start);
assert.ok(historyStart >= 0 && start > historyStart && end > start, 'student history matching block must exist');

const matchingBlock = html.slice(start, end);
const buildHistory = new Function('s', 'sid', 'db', 'attendanceGroupLabel', 'parseHours',
  matchingBlock + `
  return { belongsToStudent, a, abs, late, absHours, lateHours, allHours, justified, unjustified, pending };
`);

const students = [
  { id: 'A', last: 'عيسو', first: 'وائل', class: 'جذع مشترك علوم وتكنولوجيا 1' },
  { id: 'B', last: 'عيسو', first: 'وائل', class: 'جذع مشترك علوم وتكنولوجيا 2' }
];
const records = [
  { id: 'id-a', student: 'A', studentName: 'وائل عيسو', type: 'غياب', hours: 2, justified: 'مبرر' },
  { id: 'id-b', student: 'B', studentName: 'وائل عيسو', class: students[0].class, type: 'غياب', hours: 8 },
  { id: 'legacy-section', studentName: 'وائل عيسو1', class: students[0].class, type: 'غياب', hours: 3, justified: 'قيد التبرير' },
  { id: 'legacy-ambiguous', studentName: 'وائل عيسو', type: 'غياب', hours: 9 },
  { id: 'legacy-late', studentName: 'وائل عيسو', class: students[0].class, type: 'تأخر', hours: 0.5, justified: 'غير مبرر' }
];
const db = { students, attendance: records };
const result = buildHistory(students[0], 'A', db, st => st.class, value => {
  if (value === '' || value == null) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
});

assert.deepEqual(result.a.map(x => x.id).sort(), ['id-a', 'legacy-late', 'legacy-section'].sort(),
  'only ID-linked and correctly section-matched legacy records should attach; ambiguous name-only records must not');
assert.equal(result.a.length, 3, 'each matching record must be counted exactly once');
assert.equal(result.abs.length, 2);
assert.equal(result.late.length, 1);
assert.equal(result.absHours, 5);
assert.equal(result.lateHours, 0.5);
assert.equal(result.allHours, 5.5);
assert.equal(result.justified(result.abs), 1);
assert.equal(result.pending(result.abs), 1);
assert.equal(result.unjustified(result.late), 1);

const uniqueDb = { students: [students[0]], attendance: [
  { id: 'legacy-unique', studentName: 'وائل عيسو', type: 'غياب', hours: 1 }
] };
const unique = buildHistory(students[0], 'A', uniqueDb, st => st.class, value => Number(value));
assert.deepEqual(unique.a.map(x => x.id), ['legacy-unique'],
  'legacy name-only record may attach when the student name is unique');

console.log('Student-history matching and synthetic aggregation tests passed.');
