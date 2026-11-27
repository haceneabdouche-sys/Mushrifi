const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');

// The old duplicate shortcut is no longer referenced by the active page script.
assert.ok(!html.includes('quickVoiceAccess'), 'removed microphone shortcut has no dead JavaScript listener');
assert.ok(html.includes('id="startVoiceBtn"'), 'the single microphone launcher remains available');

const start = html.indexOf('window.studentAction=(source,id)=>{');
const end = html.indexOf('\n};', start);
assert.ok(start >= 0 && end > start, 'actual student action router is present');

function makeFocusTarget() {
  return {
    value: '', focused: false, scrolled: false,
    focus() { this.focused = true; },
    scrollIntoView(options) { this.scrolled = true; this.scrollOptions = options; }
  };
}
function makeSelect() {
  return {
    options: [{ value: 'other-student' }], value: '', events: [],
    appendChild(option) { this.options.push(option); },
    dispatchEvent(event) { this.events.push(event.type); }
  };
}
function makeForm(id, elements, disclosure = null) {
  return {
    id, elements,
    closest(selector) { return selector === 'details' ? disclosure : null; }
  };
}

const target = { id: 'student-24', last: 'عيسو', first: 'وائل', class: '1 علوم' };
const attendanceDisclosure = { open: false };
const attStudent = makeSelect(), attType = { value: '', dispatchEvent() {} }, attDate = { value: '' };
const hours = makeFocusTarget(), minutes = makeFocusTarget(), period = makeFocusTarget();
const attForm = makeForm('attForm', { student: attStudent, type: attType, date: attDate, hours, minutes, period }, attendanceDisclosure);
const violStudent = makeSelect(), violDate = { value: '' }, description = makeFocusTarget();
const violForm = makeForm('violForm', { student: violStudent, date: violDate, description });
const docStudent = makeSelect(), docType = { value: '', events: [], dispatchEvent(event) { this.events.push(event.type); } }, docDate = { value: '' }, appointment = makeFocusTarget();
const docForm = makeForm('docForm', { student: docStudent, type: docType, date: docDate, appointment });
const attendanceSearch = { value: 'previous search filter' };
const status = { textContent: '' };
const routes = [], historyOpened = [];
const context = {
  db: { students: [target] },
  document: { createElement(tag) { assert.equal(tag, 'option'); return { value: '', textContent: '' }; } },
  Event,
  $: selector => ({ '#attForm': attForm, '#attStudentSearch': attendanceSearch,
    '#violForm': violForm, '#docForm': docForm, '#voiceStatus': status })[selector] || null,
  go: route => routes.push(route),
  window: { studentHistory: id => historyOpened.push(String(id)) }
};
vm.createContext(context);
vm.runInContext(html.slice(start, end + 3), context);

// Absence opens the collapsed individual form, selects the student, and scrolls to hours.
assert.equal(context.window.studentAction('absence', target.id), true);
assert.equal(attendanceDisclosure.open, true, 'voice absence opens the collapsed attendance form');
assert.equal(attStudent.value, target.id);
assert.equal(attType.value, 'غياب');
assert.match(attDate.value, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(attendanceSearch.value, '', 'old search filters cannot hide the voice-selected student');
assert.equal(hours.focused, true);
assert.equal(hours.scrolled, true, 'hours field is brought into view');
assert.equal(routes.at(-1), 'attendance');

// Lateness selects the minutes field rather than the absence-hours field.
attendanceDisclosure.open = false;
hours.focused = false; minutes.focused = false; minutes.scrolled = false;
assert.equal(context.window.studentAction('late', target.id), true);
assert.equal(attendanceDisclosure.open, true);
assert.equal(attType.value, 'تأخر');
assert.equal(minutes.focused, true);
assert.equal(minutes.scrolled, true);
assert.equal(routes.at(-1), 'attendance');

// The remaining actions preselect the same student and navigate to their real destinations.
assert.equal(context.window.studentAction('violation', target.id), true);
assert.equal(violStudent.value, target.id);
assert.equal(description.focused, true);
assert.equal(routes.at(-1), 'violations');

assert.equal(context.window.studentAction('summons', target.id), true);
assert.equal(docStudent.value, target.id);
assert.equal(docType.value, 'استدعاء ولي');
assert.ok(docType.events.includes('change'));
assert.equal(appointment.focused, true);
assert.equal(routes.at(-1), 'documents');

assert.equal(context.window.studentAction('report', target.id), true);
assert.deepEqual(historyOpened, [target.id], 'report action opens the selected student file');

const beforeRoutes = routes.length;
assert.equal(context.window.studentAction('absence', 'missing-student'), false);
assert.equal(routes.length, beforeRoutes, 'unknown student IDs never navigate or alter a form');
assert.equal(context.db.students.length, 1, 'navigation actions do not create or mutate student records');

assert.ok(gradle.includes('versionCode 47') && gradle.includes("versionName '2.6'"),
  'The latest performance build advances the Android update code while preserving public version 2.6');
console.log('PASS: Stage 24 real student-action routing, disclosure opening, selected-student integrity and focused controls.');

