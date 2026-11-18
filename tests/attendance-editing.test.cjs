const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

const parserStart = html.indexOf('const parseHours=value=>{');
const parserEnd = html.indexOf(';\nconst esc=', parserStart) + 1;
assert.notEqual(parserStart, -1, 'shared hours parser must exist');
assert.ok(parserEnd > parserStart, 'shared hours parser must be complete');
const parserSource = html.slice(parserStart, parserEnd);
const context = {};
vm.runInNewContext(parserSource + '\nthis.parseHours=parseHours;', context);

for (const [input, expected] of [
  ['7 ساعات', 7],
  ['٧ ساعات', 7],
  ['7 ساعة', 7],
  ['7 ساعات غياب', 7],
  ['عدد الساعات 7', 7],
  ['7,5 ساعات', 7.5],
  ['ساعتان', ''],
  ['', '']
]) {
  const actual = context.parseHours(input);
  if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual), input + ' should be rejected as ambiguous');
  else assert.equal(actual, expected, input);
}

assert.match(html, /const attendanceList=items=>[\s\S]*?تعديل السجل/);
assert.match(html, /window\.editAttendanceFromProfile=id=>\{go\('attendance'\);render\(\);/);
assert.match(html, /onclick="editAttendanceFromProfile\(\\'/);
assert.match(html, /window\.saveAttendanceEdit=id=>\{/);
assert.match(html, /id="editJustified"/);
assert.match(html, /id="editAttendanceNotes"/);
console.log('Individual attendance editing and Arabic hours parsing checks passed.');
