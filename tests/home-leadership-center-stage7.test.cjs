const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const file = 'android/app/src/main/assets/index.html';
const html = fs.readFileSync(file, 'utf8');

function extractFunction(name, nextName) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const end = html.indexOf('function ' + nextName + '(', start + 1);
  assert.notEqual(end, -1, 'missing boundary function ' + nextName);
  return html.slice(start, end).trim();
}

for (const id of [
  'homeLeadershipPulse', 'homePulseHeading', 'homePulseGreeting', 'homePulseDate',
  'homePulseMessage', 'homePulseStatus', 'homePulseTaskCount', 'homePulseUrgentCount',
  'homePulseAppointmentCount', 'homePulseNext', 'homePulseOpenTasks', 'dailyTasksDetails',
  'dailyTasksHeading', 'upcomingAgenda'
]) {
  const matches = html.match(new RegExp('id=["\\x27]' + id + '["\\x27]', 'g')) || [];
  assert.equal(matches.length, 1, 'expected one #' + id + ', found ' + matches.length);
}
assert.match(html, /<details class="panel daily-tasks-panel" id="dailyTasksDetails"/,
  'daily tasks should be collapsible rather than expanding the home screen');
assert.doesNotMatch(html, /#home\s+\.daily-tasks-panel[^\n]*display\s*:\s*none/i,
  'daily dashboard must not remain hidden on the home screen');
assert.doesNotMatch(html, /#home\s+\.agenda-home-panel[^\n]*display\s*:\s*none/i,
  'upcoming agenda must not remain hidden on the home screen');
assert.match(html, /#home\s+\.home-advanced-panel\{display:none!important\}/,
  'only secondary shortcut content should remain tucked away');

assert.match(html, /const leadership=getHomeLeadershipSnapshot\(overview\.date,Date\.now\(\)\);/);
assert.match(html, /renderHomeLeadershipPulse\(leadership\.daily,leadership\.date,leadership\.now\);/);
assert.match(html, /renderDailyFollowupDashboard\(leadership\.date,leadership\.now,leadership\.daily\);/);
assert.match(html, /renderAgendaHome\(leadership\.date\);/);
assert.match(html, /\$\('#homePulseOpenTasks'\)\?\.addEventListener\('click',openHomePulseTasks\);/);
assert.match(html, /function openHomePulseTasks\(\)[\s\S]*?panel\.open=true/);
assert.match(html, /window\.setInterval\(\(\)=>refreshHomeLeadershipIfDue\(false\),60000\);/);
assert.match(html, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(!document\.hidden\)refreshHomeLeadershipIfDue\(true\);\}\);/);

const cacheContext = {
  homeLeadershipCache: null,
  db: {
    students: [{ id: 's1' }], attendance: [{ id: 'a1' }], documents: [],
    violations: [], agenda: [], followups: []
  },
  student: id => ({ id }),
  buildDailyFollowupSnapshot: (...args) => ({ build: ++cacheContext.builds, args }),
  builds: 0
};
vm.createContext(cacheContext);
vm.runInContext(extractFunction('getHomeLeadershipSnapshot', 'buildHomeLeadershipPulseModel'), cacheContext);
const first = cacheContext.getHomeLeadershipSnapshot('2026-11-28', Date.parse('2026-11-28T09:10:05'));
const sameMinute = cacheContext.getHomeLeadershipSnapshot('2026-11-28', Date.parse('2026-11-28T09:10:55'));
assert.equal(cacheContext.builds, 1, 'same-minute home refresh should reuse daily snapshot');
assert.equal(sameMinute.daily, first.daily, 'cache should return the exact derived snapshot');
cacheContext.getHomeLeadershipSnapshot('2026-11-28', Date.parse('2026-11-28T09:11:00'));
assert.equal(cacheContext.builds, 2, 'a new minute should refresh time-sensitive priorities');
cacheContext.db.agenda = [];
cacheContext.getHomeLeadershipSnapshot('2026-11-28', Date.parse('2026-11-28T09:11:20'));
assert.equal(cacheContext.builds, 3, 'replacing source arrays should rebuild the snapshot');
cacheContext.db.attendance.push({ id: 'a2' });
cacheContext.getHomeLeadershipSnapshot('2026-11-28', Date.parse('2026-11-28T09:11:40'));
assert.equal(cacheContext.builds, 4, 'collection-size changes should invalidate even when references are stable');

const agendaOutput = { innerHTML: '', querySelectorAll: () => [] };
const agendaContext = {
  homeAgendaSnapshotCache: null,
  db: { agenda: [], documents: [], students: [] },
  agendaShiftDate: (date, offset) => date + '+' + offset,
  buildAgendaSnapshot: () => ({ calls: ++agendaContext.calls, items: [] }),
  calls: 0,
  student: () => null,
  $: selector => selector === '#upcomingAgenda' ? agendaOutput : null,
  esc: value => String(value),
  agendaFormatDate: () => '',
  agendaTypeLabel: () => ''
};
vm.createContext(agendaContext);
vm.runInContext(extractFunction('renderAgendaHome', 'initAgendaControls'), agendaContext);
agendaContext.renderAgendaHome('2026-11-28');
agendaContext.renderAgendaHome('2026-11-28');
assert.equal(agendaContext.calls, 1, 'weekly agenda preview should reuse its derived snapshot');
agendaContext.db.documents = [];
agendaContext.renderAgendaHome('2026-11-28');
assert.equal(agendaContext.calls, 2, 'document changes should rebuild agenda preview');
agendaContext.db.students.push({ id: 's1' });
agendaContext.renderAgendaHome('2026-11-28');
assert.equal(agendaContext.calls, 3, 'student changes should rebuild linked agenda preview');

const pulseContext = { Date, Intl };
vm.createContext(pulseContext);
vm.runInContext(extractFunction('buildHomeLeadershipPulseModel', 'renderHomeLeadershipPulse'), pulseContext);
const now = Date.parse('2026-11-28T09:00:00');
const clear = pulseContext.buildHomeLeadershipPulseModel({ totalTasks: 0, tasks: [] }, '2026-11-28', now);
assert.equal(clear.level, 'clear');
assert.equal(clear.greeting, 'صباح الخير');
const urgent = pulseContext.buildHomeLeadershipPulseModel({
  totalTasks: 2, summonsNext24h: 1, agendaToday: 1, tasks: [
    { priority: 'urgent', title: 'موعد استدعاء ولي خلال 24 ساعة', detail: 'موعد مسجل' },
    { priority: 'high', title: 'تبرير ينتظر المراجعة', detail: 'سجل يحتاج مراجعة' }
  ]
}, '2026-11-28', now);
assert.equal(urgent.level, 'urgent');
assert.equal(urgent.urgent, 1);
assert.equal(urgent.appointments, 2);
assert.equal(urgent.nextTitle, 'موعد استدعاء ولي خلال 24 ساعة');
const attention = pulseContext.buildHomeLeadershipPulseModel({
  totalTasks: 1, tasks: [{ priority: 'high', title: 'تحقق من سجل' }]
}, '2026-11-28', now);
assert.equal(attention.level, 'attention');
const upcoming = pulseContext.buildHomeLeadershipPulseModel({
  totalTasks: 1, tasks: [{ priority: 'normal', title: 'موعد قادم' }]
}, '2026-11-28', Date.parse('2026-11-28T19:00:00'));
assert.equal(upcoming.level, 'upcoming');
assert.equal(upcoming.greeting, 'مساء الخير');

assert.match(html, /if\(\['students','attendance','documents','violations','agenda','followups'\]\.some\(entity=>changedEntities\.has\(entity\)\)\)homeLeadershipCache=null;/);
assert.match(html, /if\(\['students','documents','agenda'\]\.some\(entity=>changedEntities\.has\(entity\)\)\)homeAgendaSnapshotCache=null;/);
assert.doesNotMatch(html, /db\.homeLeadership|db\.leadershipPulse|db\.commandCenter/);
console.log('Stage 7 leadership command center tests: PASS');
