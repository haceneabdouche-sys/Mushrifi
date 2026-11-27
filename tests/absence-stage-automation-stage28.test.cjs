const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'android/app/src/main/assets/index.html'), 'utf8');
const mainActivity = fs.readFileSync(path.join(root, 'android/app/src/main/java/dz/mushrifi/app/MainActivity.java'), 'utf8');
const notifications = fs.readFileSync(path.join(root, 'android/app/src/main/java/dz/mushrifi/app/SummonsReminderReceiver.java'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');

function test(name, fn) {
  try { fn(); console.log('PASS', name); }
  catch (error) { console.error('FAIL', name, error.message); process.exitCode = 1; }
}

const policyStart = html.indexOf('function hasAbsenceDeliveryRecord(record){');
const policyEnd = html.indexOf("let absenceAutomationRunning=false,absenceAutomationLastKey='';", policyStart);
assert.ok(policyStart >= 0 && policyEnd > policyStart, 'The stage policy block must exist in the packaged application.');

let sequence = 0;
const studentRecord = { id: 'student-1', last: 'اختبار', first: 'تلميذ', class: '1' };
let holidays = [];
const context = {
  db: { documents: [], attendance: [], settings: { schoolHolidays: [] } },
  analysisCache: null,
  getAbsenceAnalysisCache: () => {
    const today = '2026-11-27';
    if (!context.analysisCache || context.analysisCache.today !== today) {
      context.analysisCache = { today, monthly: new Map(), streaks: null };
    }
    return context.analysisCache;
  },
  dateISO: () => '2026-11-27',
  student: id => String(id) === studentRecord.id ? studentRecord : null,
  isSchoolHolidayDate: date => holidays.some(range => range.start <= date && date <= range.end),
  isValidISODate: value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  },
  calendarDaysBetween: (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000),
  crypto: { randomUUID: () => 'stage28-id-' + (++sequence) }
};
vm.createContext(context);
vm.runInContext(html.slice(policyStart, policyEnd), context, { timeout: 1000 });

const streak = (days = 4) => ({ student: studentRecord, start: '2026-11-01', last: '2026-11-' + String(days).padStart(2, '0'), days });
const notice = (stage, issueDate, deliveryDate, response = 'لم يرد الولي') => ({
  id: 'n' + stage, student: studentRecord.id, absenceStart: '2026-11-01',
  absenceStage: stage, date: issueDate, deliveryDate,
  deliveryProof: 'وصل تبليغ محفوظ رقم ' + stage,
  guardianResponseStatus: response
});
function eligible(item) {
  context.item = item;
  return JSON.parse(vm.runInContext('JSON.stringify(getEligibleAbsenceStages(item))', context));
}

test('first absence notice is due on the fourth counted calendar day', () => {
  context.db.documents = [];
  assert.deepEqual(eligible(streak(3)), []);
  assert.deepEqual(eligible(streak(4)), [4]);
});

test('second notice is gated by first-notice delivery proof and seven complete days', () => {
  context.db.documents = [notice(4, '2026-11-10', '2026-11-20')];
  assert.deepEqual(eligible(streak(11)), [11]);
  context.db.documents[0].deliveryDate = '2026-11-21';
  assert.deepEqual(eligible(streak(11)), []);
});

test('second notice cannot proceed when the guardian response has not been recorded', () => {
  context.db.documents = [notice(4, '2026-11-10', '2026-11-20', 'غير مسجل')];
  assert.deepEqual(eligible(streak(11)), []);
  context.db.documents[0].guardianResponseStatus = 'لم يرد الولي';
  assert.deepEqual(eligible(streak(11)), [11]);
});

test('second notice cannot proceed after an accepted excuse or recorded return', () => {
  for (const status of ['تبرير مقبول', 'التحق بالمؤسسة', 'قدم تبريراً قيد الدراسة']) {
    context.db.documents = [notice(4, '2026-11-10', '2026-11-20', status)];
    assert.deepEqual(eligible(streak(11)), [], status);
  }
});

test('registered warning requires second-notice proof, seven days and an explicit response outcome', () => {
  context.db.documents = [
    notice(4, '2026-11-01', '2026-11-08'),
    notice(11, '2026-11-15', '2026-11-20', 'غير مسجل')
  ];
  assert.deepEqual(eligible(streak(18)), []);
  context.db.documents[1].guardianResponseStatus = 'رد غير كافٍ';
  assert.deepEqual(eligible(streak(18)), [18]);
});

test('registered warning is blocked if the second notice received an accepted excuse', () => {
  context.db.documents = [
    notice(4, '2026-11-01', '2026-11-08'),
    notice(11, '2026-11-15', '2026-11-20', 'تبرير مقبول')
  ];
  assert.deepEqual(eligible(streak(18)), []);
});

test('stage 32 review requires warning delivery proof, fourteen full days and unresolved response', () => {
  context.db.documents = [
    notice(4, '2026-11-01', '2026-11-08'),
    notice(11, '2026-11-09', '2026-11-12'),
    notice(18, '2026-11-13', '2026-11-13', 'لم يرد الولي')
  ];
  assert.deepEqual(eligible(streak(31)), []);
  assert.deepEqual(eligible(streak(32)), [32]);
  context.db.documents[2].guardianResponseStatus = 'تبرير مقبول';
  assert.deepEqual(eligible(streak(32)), []);
});

test('delivery before the issue date is rejected even when proof text exists', () => {
  context.db.documents = [notice(4, '2026-11-21', '2026-11-20')];
  context.item = streak(11);
  assert.equal(vm.runInContext('hasVerifiedAbsenceNoticeDelivery(item, 4, 1)', context), false);
});

test('absence notice record creation is idempotent for a student and streak', () => {
  context.db.documents = [];
  context.item = streak(4);
  assert.equal(vm.runInContext('createAbsenceStageNoticeRecord(item, 4)', context), true);
  assert.equal(vm.runInContext('createAbsenceStageNoticeRecord(item, 4)', context), false);
  assert.equal(context.db.documents.length, 1);
  assert.equal(context.db.documents[0].draftStatus, 'مسودة آلية - تنتظر المراجعة والإمضاء والتبليغ');
});

test('monthly Article 17 rule counts distinct days, combines absences and lateness, and excludes justified/pending days', () => {
  context.db.documents = [];
  holidays = [{ start: '2026-11-06', end: '2026-11-06' }];
  context.db.attendance = [
    { student: studentRecord.id, date: '2026-11-02', type: 'غياب', justified: 'غير مبرر' },
    { student: studentRecord.id, date: '2026-11-04', type: 'تأخر', justified: 'غير مبرر' },
    { student: studentRecord.id, date: '2026-11-05', type: 'غياب', justified: 'غير مبرر' },
    { student: studentRecord.id, date: '2026-11-05', type: 'غياب', justified: 'غير مبرر' },
    { student: studentRecord.id, date: '2026-11-06', type: 'غياب', justified: 'غير مبرر' },
    { student: studentRecord.id, date: '2026-11-07', type: 'غياب', justified: 'مبرر' },
    { student: studentRecord.id, date: '2026-11-08', type: 'تأخر', justified: 'قيد التبرير' },
    { student: studentRecord.id, date: '2026-10-31', type: 'غياب', justified: 'غير مبرر' },
    { student: studentRecord.id, date: '2026-11-28', type: 'غياب', justified: 'غير مبرر' }
  ];
  const groups = JSON.parse(vm.runInContext('JSON.stringify(getMonthlyUnjustifiedOccurrences("2026-11"))', context));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].dates, ['2026-11-02', '2026-11-04', '2026-11-05']);
});

test('Article 17 warning is created once and retains the dates that caused the threshold', () => {
  const item = { student: studentRecord, month: '2026-11', dates: ['2026-11-02', '2026-11-04', '2026-11-05'], absenceCount: 3, latenessCount: 1 };
  assert.equal(vm.runInContext('createMonthlyRepetitionWarning(item)', Object.assign(context, { item })), true);
  assert.equal(vm.runInContext('createMonthlyRepetitionWarning(item)', context), false);
  assert.equal(context.db.documents.length, 1);
  assert.equal(context.db.documents[0].absenceStage, 17);
  assert.equal(context.db.documents[0].absenceStageKind, 'monthly-repetition');
});

test('packaged UI runs automation after licence status is known and exposes an in-app alert panel', () => {
  assert.match(html, /if\(!absenceAutomationRunning\)runAbsenceStageAutomation\(\)/);
  assert.match(html, /let licenseStateKnown=!isAndroidApp/);
  assert.match(html, /id="absenceStageDashboardList"/);
  assert.match(html, /notifyAbsenceStage\(String\(st\.id\)/);
});

test('monthly repetition alerts keep the dashboard compact and reveal dates only on demand', () => {
  assert.ok(html.includes('function renderMonthlyAbsenceDateDetails(item)'), 'A shared collapsible date-details renderer must exist.');
  assert.ok(html.includes('class="monthly-occurrence-details"'), 'Recorded dates must be inside a collapsible details element.');
  assert.ok(html.includes('عرض الأيام المسجلة ('), 'The user must have a clear way to expand the dates.');
  assert.ok(html.includes('monthly-occurrence-count'), 'The number of affected days must be prominent.');
  const dashboardStart = html.indexOf('function renderAbsenceStageDashboard()');
  const dashboardEnd = html.indexOf('function renderAbsenceFollowup()', dashboardStart);
  const followupStart = dashboardEnd;
  const followupEnd = html.indexOf('function renderSchoolHolidays()', followupStart);
  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart && followupEnd > followupStart);
  const dashboard = html.slice(dashboardStart, dashboardEnd);
  const followup = html.slice(followupStart, followupEnd);
  assert.ok(!dashboard.includes('esc(item.dates.join('), 'The home screen must not print the full date list by default.');
  assert.ok(!followup.includes('esc(item.dates.join('), 'The follow-up page must not print the full date list by default.');
  assert.ok(dashboard.includes('renderMonthlyAbsenceDateDetails(item)'));
  assert.ok(followup.includes('renderMonthlyAbsenceDateDetails(item)'));
});

test('formal print templates exist for the monthly warning, both notices, registered warning and internal review', () => {
  for (const phrase of [
    'إنذار كتابي بسبب تكرار الغيابات والتأخرات غير المبررة',
    'إشعار أول بغياب التلميذ(ة)',
    'إشعار ثانٍ بغياب التلميذ(ة)',
    'إعذار مضمون بسبب الغياب',
    'مذكرة داخلية لمراجعة ملف الغياب',
    'لا تمثل قرار شطب'
  ]) assert.ok(html.includes(phrase), phrase);
});

test('Android notification bridge supports monthly Article 17 and keeps stage alerts private on lock screen', () => {
  assert.match(mainActivity, /stage != 17/);
  assert.match(notifications, /stage == 17/);
  assert.match(notifications, /Notification\.VISIBILITY_PRIVATE/);
});

test('pending absence-stage reminders are retried after notification permission is granted or restored', () => {
  assert.ok(html.includes('function syncPendingAbsenceStageNotifications()'));
  assert.ok(html.includes('if(granted){syncPendingAbsenceStageNotifications();'));
  assert.ok(html.includes('if(granted)syncPendingAbsenceStageNotifications();'));
  assert.ok(html.includes('AndroidBridge.notifyAbsenceStage(String(st.id)'));
});

test('internal build code increments while public application version remains 2.6', () => {
  assert.match(gradle, /versionCode 46/);
  assert.match(gradle, /versionName '2\.6'/);
});
