const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build-apk.yml', 'utf8');
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');

const formStart = html.indexOf('<form id="studentForm">');
const formEnd = html.indexOf('</form>', formStart);
assert.ok(formStart >= 0 && formEnd > formStart, 'student editor form exists');
const form = html.slice(formStart, formEnd);

assert.match(form, /textarea[^>]*name="guardianAddress"[^>]*maxlength="300"/,
  'guardian address is a bounded, editable address field');
for (const [value, label] of [
  ['orphan', 'يتيم'],
  ['medical', 'حالة مرضية'],
  ['peExempt', 'معفى من التربية البدنية'],
  ['repeatYear', 'معيد للسنة']
]) {
  assert.match(form, new RegExp('type="checkbox"[^>]*name="privacyFlags"[^>]*value="' + value + '"'),
    'privacy checkbox exists: ' + value);
  assert.ok(form.includes(label), 'privacy label is present: ' + label);
}
assert.match(form, /لا تكتب التشخيص أو تفاصيل طبية/,
  'medical status does not solicit a diagnosis or free-form clinical detail');

const modelStart = html.indexOf('const STUDENT_PRIVACY_FLAG_DEFINITIONS');
const modelEnd = html.indexOf('function studentAcademicLabel', modelStart);
assert.ok(modelStart >= 0 && modelEnd > modelStart, 'privacy flag allowlist and form reader are defined');
const model = html.slice(modelStart, modelEnd);
assert.match(model, /value:'orphan'/);
assert.match(model, /value:'medical'/);
assert.match(model, /value:'peExempt'/);
assert.match(model, /value:'repeatYear'/);
assert.match(model, /normalizeStudentPrivacyFlags\(value\)/);
assert.match(model, /new Set\(value\.filter\(flag=>typeof flag==='string'&&STUDENT_PRIVACY_FLAG_VALUES\.has\(flag\)\)\)/,
  'only the four approved privacy flags are stored, without duplicates');
assert.match(model, /studentCardFieldNames=[\s\S]*?'guardianAddress'/,
  'guardian address is included in saved student card fields');
assert.match(model, /v\.privacyFlags=normalizeStudentPrivacyFlags\(Array\.from\(form\.querySelectorAll\('input\[name="privacyFlags"\]:checked'\)/,
  'checked privacy flags are read as a normalized list');

const editStart = html.indexOf('window.editStudent=id=>');
const editEnd = html.indexOf("$('#cancelStudentEdit').onclick", editStart);
assert.ok(editStart >= 0 && editEnd > editStart, 'student edit handler is available');
const edit = html.slice(editStart, editEnd);
assert.match(edit, /'guardianAddress'/, 'editing restores the guardian address');
assert.match(edit, /normalizeStudentPrivacyFlags\(s\.privacyFlags\)/,
  'editing safely normalizes existing or legacy flag arrays');
assert.match(edit, /input\.checked=selectedPrivacyFlags\.has\(input\.value\)/,
  'editing restores each saved checkbox selection');

const auditStart = html.indexOf('const AUDIT_PRIVATE_FIELDS=');
const auditEnd = html.indexOf('const AUDIT_REVERSIBLE_FIELDS=', auditStart);
assert.ok(auditStart >= 0 && auditEnd > auditStart, 'audit privacy map exists');
const auditPrivate = html.slice(auditStart, auditEnd);
assert.match(auditPrivate, /guardianAddress:'عنوان الولي'/,
  'guardian address is excluded from audit value details');
assert.match(auditPrivate, /privacyFlags:'علامات الخصوصية'/,
  'privacy markers are excluded from audit value details');
const auditDefinitions = html.slice(html.indexOf('const AUDIT_FIELD_DEFINITIONS='), auditStart);
assert.doesNotMatch(auditDefinitions, /guardianAddress|privacyFlags/,
  'sensitive address and flags are not copied into audit before/after values');

const historyStart = html.indexOf('window.studentHistory=(id,focusFollowupId)=>');
const historyEnd = html.indexOf('window.', historyStart + 40);
assert.ok(historyStart >= 0, 'student profile handler exists');
const history = html.slice(historyStart, historyStart + 15000);
assert.match(history, /s\.guardianAddress/,
  'guardian address is displayed in the selected student profile');
assert.match(history, /student-profile-private-flags/,
  'private flags have a separate block in the student profile');
assert.match(history, /normalizeStudentPrivacyFlags\(s\.privacyFlags\)/,
  'only supported flags are displayed');
assert.match(history, /no-print/,
  'private flag block is excluded from direct print output');

const listStart = html.indexOf("const searchable=s=>");
const listEnd = html.indexOf("$('#studentsRows').innerHTML", listStart);
assert.ok(listStart >= 0 && listEnd > listStart, 'general student directory renderer exists');
const directory = html.slice(listStart, listEnd + 2500);
assert.doesNotMatch(directory, /guardianAddress|privacyFlags/,
  'private address and markers do not leak into the general student list or search');

const printableStart = html.indexOf('function buildStudentPrintableReportMarkup');
const printableEnd = html.indexOf('window.studentHistory=', printableStart);
assert.ok(printableStart >= 0 && printableEnd > printableStart, 'printable student report builder exists');
const printable = html.slice(printableStart, printableEnd);
assert.doesNotMatch(printable, /guardianAddress|privacyFlags|علامات الخصوصية/,
  'private markers and guardian address are not inserted into the standard printable report');

assert.match(html, /ملف النسخة بصيغة JSON غير مشفّر بكلمة مرور/,
  'backup UI warns that exported JSON containing sensitive data is not password-encrypted');
assert.match(html, /const payload=\{\.\.\.db\}/,
  'normal backup serialization keeps all student fields for complete restore');
assert.match(html, /const normalized=\{\.\.\.obj/,
  'backup restoration preserves additional student properties');

assert.match(html, /guardianAddress:'',privacyFlags:\[\]/,
  'CSV-created cards initialize the new fields safely');
assert.match(html, /for\(const key of fields\)\{if\(data\[key\]!==''\|\|!Object\.prototype\.hasOwnProperty\.call\(target,key\)\)target\[key\]=data\[key\];\}/,
  'CSV refresh does not erase privacy markers or guardian address on existing students');
assert.match(workflow, /Run Stage 21 student privacy markers and guardian address tests[\s\S]*?node tests\/student-privacy-markers-guardian-address-stage21\.test\.cjs/,
  'CI runs the Stage 21 student card privacy regression tests');
assert.match(gradle, /versionCode 25[\s\S]*?versionName '2\.6'/,
  'internal build code increments while visible application version remains 2.6');

console.log('PASS: Stage 21 student privacy markers, guardian address, legacy compatibility, edit/save, audit redaction, directory/print privacy, CSV preservation and backup warning.');
