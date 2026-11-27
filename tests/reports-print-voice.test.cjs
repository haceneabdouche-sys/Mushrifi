const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const checks = [
  ['top brand bar uses midnight blue', /<meta name="theme-color" content="#102a43">[\s\S]*?header\{[\s\S]*?background:linear-gradient\(128deg,#0b1f33 0%,#102A43 54%,#183B63 100%\)/],
  ['author name and signature wrapper no longer rotate', /header \.credit-wrap\{[\s\S]*?animation:none!important/],
  ['author name remains fixed in place', /header p\.credit\{[\s\S]*?transform:none/],
  ['signature image remains fixed in place', /header \.credit-signature\{[\s\S]*?transform:none/],


  ['author name has a dedicated overlay aligned to its lettering', /<span class="credit-name-wrap"><p class="credit" dir="ltr">ABDOUCHE HACENE<\/p><svg class="credit-name-glint"/],
  ['name glint is now a fixed decorative detail with no animation', /id="mushrifi-name-trace"[\s\S]*?<g class="glint-point" transform="translate\(180 25\)"/],
  ['signature image remains fixed in place', /header \.credit-signature\{[\s\S]*?transform:none/],
  ['signature glint overlays the exact square image bounds', /<span class="credit-signature-wrap"><img class="credit-signature"[\s\S]*?<svg class="credit-signature-glint" viewBox="0 0 512 512"/],
  ['ten static signature sparkles remain positioned over the original signature', /data-glint="1" transform="translate\(100 145\)"[\s\S]*?data-glint="10" transform="translate\(445 310\)"/],
  ['old free-floating rectangle sparkle animation is removed', /^(?![\s\S]*mushrifi-signature-only-star)(?![\s\S]*signature-light)/],
  ['home keeps the primary student and daily indicators in a compact KPI row', /class="home-kpis grid"[\s\S]*?id="sStudents"[\s\S]*?id="todayAbs"[\s\S]*?id="todayLate"[\s\S]*?id="todaySummons"/],
  ['home keeps all detailed metrics available in the expandable statistics panel', /class="[^"]*home-stat-details"[\s\S]*?id="sAbs"[\s\S]*?id="sLate"[\s\S]*?id="sViol"[\s\S]*?id="sDocs"[\s\S]*?id="sSummons"[\s\S]*?id="sAbsNotices"[\s\S]*?id="sRecords"[\s\S]*?id="todayViol"/],
  ['large daily tasks and appointments are hidden only from the compact home display', /#home \.daily-tasks-panel,#home \.agenda-home-panel,#home \.home-advanced-panel\{display:none!important\}/],
  ['daily tasks identify summons in the next 24 hours and route to documents', /const summons=D\.filter[\s\S]*?t<=end[\s\S]*?page:'documents'/],
  ['daily tasks surface attendance entries awaiting justification and route to attendance', /pendingAll=A\.filter[\s\S]*?قيد التبرير[\s\S]*?page:'attendance'/],
  ['daily task navigation reuses existing page navigation without altering student records', /function openDailyDashboardTask[\s\S]*?go\('attendance'\)[\s\S]*?row\.scrollIntoView/],
  ['upcoming summons remain available outside the home dashboard', /id="agenda"[^>]*class="page hidden"/],
  ['the More page exposes only secondary tools and groups them by purpose', /<section id="more" class="page hidden">[\s\S]*?data-go="agenda"[\s\S]*?data-go="reports"[\s\S]*?data-go="settings"[\s\S]*?data-go="audit"/],
  ['violations are inside the Follow-up workspace rather than a separate More-page destination', /<section id="attendance" class="page hidden">[\s\S]*?data-followup-view="attendance"[\s\S]*?data-followup-view="violations"[\s\S]*?<div id="violations" class="followup-view hidden"/],
  ['bottom navigation is fixed and reserves space for mobile safe areas', /#nav\{position:fixed[\s\S]*?env\(safe-area-inset-bottom\)/],
  ['secondary destinations include the agenda, reports, settings, audit and the new supervision register', /const secondary=\['reports','settings','audit','agenda','supervisionLog'\]\.includes\(route\)/],
  ['More selection follows the secondary-route flag', /button\.dataset\.page==='more'&&secondary/],
  ['top dashboard voice launcher is icon-only and located in the heading', /<div class="home-heading panel">[\s\S]*?<section id="voiceAssistant"[\s\S]*?<button[^>]*id="startVoiceBtn"[^>]*aria-label="التحدث إلى مُشرِفي"[^>]*>🎙️<\/button>/],
  ['duplicate lower voice tile is removed', /^(?![\s\S]*id="quickVoiceAccess")[\s\S]*$/],
  ['report print uses a dedicated preview instead of printing the whole app', /window\.printReport\s*=\s*\(\)=>[\s\S]*?id='mushrifiPrintPreview'[\s\S]*?window\.print\(\)/],
  ['report has summary cards for justified and unjustified absences', /غيابات مبررة[\s\S]*?غيابات غير مبررة/],
  ['report totals absence hours and lateness minutes', /ساعات الغياب[\s\S]*?دقائق التأخر/],
  ['report validates date range before filtering', /if\(from&&to&&from>to\)/],
  ['voice flow requires explicit confirmation before saving attendance', /id="confirmVoiceAttendance">تأكيد الحفظ[\s\S]*?id="cancelVoiceAttendance">إلغاء/],
  ['voice quick access remains on the home screen', /<section id="home" class="page">[\s\S]*?id="voiceAssistant"/],
  ['voice action buttons pass their action key directly to the shared action handler', /window\.studentAction\(button\.dataset\.action,String\(st\.id\)\)/],
  ['student actions dispatch change events so conditional form fields refresh', /form\.elements\.type\.dispatchEvent\(new Event\('change'/]
];
assert.ok(!html.includes('<animateMotion'), 'decorative SVG glints do not consume continuous animation frames');
let failed = 0;

const actionStart = html.indexOf('window.studentAction=(source,id)=>{');
const actionEndMarker = '\n};\nwindow.delStudent=id=>';
const actionEnd = html.indexOf(actionEndMarker, actionStart);
if (actionStart < 0 || actionEnd < 0) {
  process.stderr.write('FAIL voice action handler can be extracted for interaction tests\\n');
  failed++;
} else {
  const actionSource = html.slice(actionStart, actionEnd + 3);
  const control = (value = '', options = []) => ({
    value, options, focused: false, changes: [], children: [],
    focus() { this.focused = true; },
    dispatchEvent(event) { this.changes.push(event.type); },
    appendChild(option) { this.options.push(option); this.children.push(option); }
  });
  const attendanceForm = { id: 'attForm', elements: {
    student: control('', []), type: control('غياب'), date: control(''),
    period: control('الفترة الصباحية'), hours: control(''), minutes: control('')
  }};
  const documentsForm = { id: 'docForm', elements: {
    student: control('', [{ value: 'student-1' }]), type: control('إشعار غياب'),
    date: control(''), appointment: control(''), reminderDate: control(''), reminderTime: control('')
  }};
  const violationsForm = { id: 'violForm', elements: {
    student: control('', [{ value: 'student-1' }]), date: control(''), description: control('')
  }};
  const search = { value: 'بحث سابق لا يطابق التلميذ' };
  const status = { textContent: '' };
  const controls = {
    '#attForm': attendanceForm, '#docForm': documentsForm,
    '#violForm': violationsForm, '#attStudentSearch': search, '#voiceStatus': status
  };
  let currentPage = 'home';
  let openedHistory = '';
  const windowStub = { studentHistory(id) { openedHistory = id; } };
  const dbStub = { students: [{ id: 'student-1', last: 'عيسو', first: 'وائل', class: '1' }] };
  const sandbox = {
    window: windowStub, db: dbStub,
    $: selector => controls[selector] || null,
    go: page => { currentPage = page; },
    Event: class { constructor(type) { this.type = type; } },
    document: { createElement: () => control('') },
    Date, String
  };
  try {
    vm.runInNewContext(actionSource, sandbox);
    const lateOpened = windowStub.studentAction('late', 'student-1');
    if (!lateOpened || currentPage !== 'attendance' ||
        attendanceForm.elements.student.value !== 'student-1' ||
        attendanceForm.elements.type.value !== 'تأخر' ||
        !attendanceForm.elements.type.changes.includes('change') ||
        !attendanceForm.elements.minutes.focused || search.value !== '' ||
        attendanceForm.elements.student.options.length !== 1) {
      throw new Error('late action did not select the student, refresh fields, clear the old filter and focus minutes');
    }
    const absenceOpened = windowStub.studentAction('absence', 'student-1');
    if (!absenceOpened || attendanceForm.elements.type.value !== 'غياب' ||
        !attendanceForm.elements.type.changes.includes('change') ||
        !attendanceForm.elements.hours.focused) {
      throw new Error('absence action did not switch the form and focus hours');
    }
    const summonsOpened = windowStub.studentAction('summons', 'student-1');
    if (!summonsOpened || currentPage !== 'documents' ||
        documentsForm.elements.type.value !== 'استدعاء ولي' ||
        !documentsForm.elements.type.changes.includes('change') ||
        !documentsForm.elements.appointment.focused) {
      throw new Error('summons action did not reveal conditional fields and focus the appointment');
    }
    const violationOpened = windowStub.studentAction('violation', 'student-1');
    if (!violationOpened || currentPage !== 'violations' ||
        !violationsForm.elements.description.focused) {
      throw new Error('violation action did not open and focus the violation form');
    }
    const reportOpened = windowStub.studentAction('report', 'student-1');
    if (!reportOpened || openedHistory !== 'student-1') {
      throw new Error('report action did not open the individual student record');
    }
    process.stdout.write('PASS voice suggested actions execute late, absence, summons, violation and individual-record flows\\n');
  } catch (error) {
    process.stderr.write('FAIL voice suggested action interaction test: ' + error.message + '\\n');
    failed++;
  }
}
for (const [label, pattern] of checks) {
  const ok = pattern.test(html);
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + label + '\n');
  if (!ok) failed++;
}

const signatureGlintCount = (html.match(/class="glint-point signature-glint-point" data-glint="/g) || []).length;
if (signatureGlintCount !== 10) {
  process.stderr.write('FAIL signature has exactly ten individually animated glints\\n');
  failed++;
} else {
  process.stdout.write('PASS signature has exactly ten individually animated glints\\n');
}

const navStart = html.indexOf('<nav');
const navEnd = navStart < 0 ? -1 : html.indexOf('</nav>', navStart);
const navBlock = navEnd < 0 ? '' : html.slice(navStart, navEnd + 6);
if (!navBlock) {
  process.stderr.write('FAIL bottom navigation markup exists\n');
  failed++;
} else {
  const navPages = [...navBlock.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
  const expectedPages = ['home', 'students', 'attendance', 'documents', 'more'];
  const ok = navPages.join(',') === expectedPages.join(',');
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + 'bottom navigation exposes the five primary app destinations\n');
  if (!ok) failed++;
}
const preservedHomeIds = ['sStudents','todayAbs','todayLate','todaySummons','sAbs','sLate','sViol','sDocs','sSummons','sAbsNotices','sRecords','todayViol','upcomingSummons','voiceAssistant','startVoiceBtn','voiceStatus','voiceTranscript','voiceConfirm','smartMonthPeriod','smartMonthAbsences','smartMonthLateness','smartMonthViolations','priorityFollowupCount','priorityFollowupList','recentCount','recent'];
for (const id of preservedHomeIds) {
  const count = (html.match(new RegExp('id="' + id + '"','g')) || []).length;
  const ok = count === 1;
  if (!ok) failed++;
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + 'home integration ID remains unique: ' + id + '\\n');
}

if (failed) process.exit(1);

