const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const checks = [
  ['quick voice action is present on the home screen', /id="quickVoiceAccess"[^>]*>🎙️<b>التحدث إلى مُشرِفي<\/b>/],
  ['quick voice action launches the Arabic speech button', /\$\('#quickVoiceAccess'\)\?\.addEventListener\('click',[\s\S]*?\$\('#startVoiceBtn'\)\?\.click\(\)/],
  ['report print uses a dedicated preview instead of printing the whole app', /window\.printReport\s*=\s*\(\)=>[\s\S]*?id='mushrifiPrintPreview'[\s\S]*?window\.print\(\)/],
  ['report has summary cards for justified and unjustified absences', /غيابات مبررة[\s\S]*?غيابات غير مبررة/],
  ['report totals absence hours and lateness minutes', /ساعات الغياب[\s\S]*?دقائق التأخر/],
  ['report validates date range before filtering', /if\(from&&to&&from>to\)/],
  ['voice flow requires explicit confirmation before saving attendance', /id="confirmVoiceAttendance">تأكيد الحفظ[\s\S]*?id="cancelVoiceAttendance">إلغاء/],
  ['voice quick access remains on the home screen', /<section id="home" class="page">[\s\S]*?id="voiceAssistant"/],
  ['voice action buttons pass their action key directly to the shared action handler', /window\.studentAction\(button\.dataset\.action,String\(st\.id\)\)/],
  ['student actions dispatch change events so conditional form fields refresh', /form\.elements\.type\.dispatchEvent\(new Event\('change'/]
];
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
if (failed) process.exit(1);
