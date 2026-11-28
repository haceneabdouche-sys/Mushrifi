const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const java = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');

// 1) No persistent SVG animation/filter/compositor work in the app header.
assert.ok(!html.includes('<animateMotion'), 'all animated SVG path glints are removed');
assert.ok(!html.includes('mushrifi-credit-spin 10s linear infinite'), 'no permanent 3D header spin remains');
assert.ok(html.includes('header .credit-signature{') && html.includes('filter:none;mix-blend-mode:normal;'),
  'the author signature remains but avoids a live filter pass');
assert.ok(html.includes('backdrop-filter:none;'), 'navigation uses an opaque surface rather than backdrop blur');
assert.ok(html.includes('header .credit-name-glint,header .credit-signature-glint{display:none!important}'), 'Android hides static decorative SVG glints while keeping the signature image');
assert.ok(html.includes('header .credit-signature{width:104px!important;height:104px!important;filter:none!important;mix-blend-mode:normal!important}'), 'the signature image avoids expensive mobile filter compositing');
assert.ok(html.includes('header .credit-signature-wrap{width:104px!important;height:104px!important'), 'the mobile header signature uses a smaller fixed layout');
assert.ok(html.includes('const STUDENT_DIRECTORY_COLLATOR=new Intl.Collator'), 'the directory reuses one Arabic sorting collator instead of constructing it repeatedly');

// 2) Student matching and search indexes: preserve exact IDs and unique-name safety.
const indexStart = html.indexOf('const normalizeStudentKey=');
const indexEnd = html.indexOf('\nlet previousAppPage=', indexStart);
assert.ok(indexStart >= 0 && indexEnd > indexStart, 'student indexes are a self-contained helper block');
const student = { id: 'stu-1', last: 'عيسو', first: 'وائل', class: '1', attribute: 'داخلي', guardian: 'ولي', phone: '0550000000' };
const ambiguousA = { id: 'stu-2', last: 'أحمد', first: 'أمين', class: '2' };
const ambiguousB = { id: 'stu-3', last: 'أحمد', first: 'أمين', class: '3' };
const indexSandbox = {
  db: { students: [student, ambiguousA, ambiguousB], attendance: [{ student: 'deleted-1', studentName: 'تلميذ سابق' }], documents: [], violations: [] },
  normalizeDirectorySearch: value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/\s+/g, ' ').trim(),
  sectionLabel: value => String(value ?? ''),
  STUDENT_DIRECTORY_COLLATOR: new Intl.Collator('ar', { numeric: true })
};
vm.createContext(indexSandbox);
vm.runInContext(html.slice(indexStart, indexEnd), indexSandbox);
indexSandbox.rebuildStudentIndexes();
assert.equal(vm.runInContext('student("stu-1")', indexSandbox).id, student.id, 'exact student ID uses the prebuilt lookup map');
assert.equal(vm.runInContext('student("وائل عيسو")', indexSandbox).id, student.id, 'a unique Arabic full-name alias resolves to its student');
assert.equal(vm.runInContext('student("أحمد أمين")', indexSandbox), null, 'ambiguous full names never guess between two students');
assert.equal(vm.runInContext('name("deleted-1")', indexSandbox), 'تلميذ سابق', 'historical student name fallback is cached by record identity');
assert.ok(vm.runInContext('studentSearchText(db.students[0])', indexSandbox).includes('داخلي'), 'the normalized searchable string is cached per student object');
assert.equal(vm.runInContext('STUDENT_DIRECTORY_PAGE_SIZE', indexSandbox), 30, 'only 30 student rows are materialized per directory page');
assert.ok(html.includes('id="studentsPagination"'), 'the user can navigate directory pages');
assert.ok(html.includes('const ATTENDANCE_LOG_PAGE_SIZE=40,VIOLATION_LOG_PAGE_SIZE=18,DOCUMENT_LOG_PAGE_SIZE=15;'), 'growing attendance, violation and document logs use bounded page sizes');
assert.ok(html.includes('id="attRowsPagination"') && html.includes('id="violRowsPagination"') && html.includes('id="docsRowsPagination"'), 'all three growing history pages expose previous/next controls');
assert.ok(html.includes('const profileHistoryLimits={absences:25,lateness:25,violations:25,documents:25};'), 'student profile history starts with only 25 rows per section');
assert.ok(html.includes('data-profile-history-more=') && html.includes('profileHistoryOutput.onclick=event=>'), 'profile history exposes incremental loading without rebuilding the complete profile');
const profileHistoryStart = html.indexOf('const profileHistoryLimits={absences:25,lateness:25,violations:25,documents:25};');
const profileHistoryEnd = html.indexOf('  const statusOf=', profileHistoryStart);
assert.ok(profileHistoryStart >= 0 && profileHistoryEnd > profileHistoryStart, 'profile pagination helper is isolated for verification');
const profileSandbox = {};
vm.createContext(profileSandbox);
vm.runInContext(html.slice(profileHistoryStart, profileHistoryEnd), profileSandbox);
const initialProfileRows = vm.runInContext('profileHistoryTable(Array.from({length:75},(_,i)=>i), "absences", ["التاريخ"], x=>`<tr data-row=\"${x}\"><td>${x}</td></tr>`)', profileSandbox);
assert.equal((initialProfileRows.match(/data-row=/g)||[]).length, 25, 'student profile initially renders no more than 25 history rows');
assert.ok(initialProfileRows.includes('data-profile-history-more=\"absences\"'), 'the full history remains reachable through incremental loading');
vm.runInContext('profileHistoryLimits.absences=50', profileSandbox);
const extendedProfileRows = vm.runInContext('profileHistoryTable(Array.from({length:75},(_,i)=>i), "absences", ["التاريخ"], x=>`<tr data-row=\"${x}\"><td>${x}</td></tr>`)', profileSandbox);
assert.equal((extendedProfileRows.match(/data-row=/g)||[]).length, 50, 'loading more reveals further history without truncating stored records');
assert.ok(html.includes('loading=\"lazy\" decoding=\"async\"'), 'record photos are decoded lazily instead of blocking table rendering');
assert.ok(html.includes('function orderedRecords(collection,mode)'), 'date ordering and insertion ordering are cached between renders');
assert.ok(html.includes('if(changedEntities.has(\'students\'))rebuildStudentIndexes();'),
  'successful student edits/imports invalidate indexes before the next render');

// 3) Monthly dashboard uses a single pass and only resolves students for relevant follow-ups.
const monthStart = html.indexOf('function smartDashboardDateShift(');
const monthEnd = html.indexOf('\nfunction smartDashboardTrend', monthStart);
assert.ok(monthStart >= 0 && monthEnd > monthStart, 'monthly aggregation helpers are independently testable');
const monthSandbox = {};
vm.createContext(monthSandbox);
vm.runInContext(html.slice(monthStart, monthEnd), monthSandbox);
let resolveCalls = 0;
const linked = { id: 'stu-month', last: 'عيسو', first: 'وائل' };
const attendance = [
  { date: '2026-11-03', type: 'غياب', justified: 'غير مبرر', student: linked.id },
  { date: '2026-11-04', type: 'غياب', justified: 'غير مبرر', student: linked.id },
  { date: '2026-11-05', type: 'غياب', justified: 'غير مبرر', student: linked.id },
  { date: '2026-11-06', type: 'غياب', justified: 'مبرر', student: linked.id },
  { date: '2026-10-06', type: 'غياب', justified: 'غير مبرر', student: linked.id },
  { date: '2026-11-07', type: 'تأخر', justified: 'غير مبرر', student: linked.id },
  ...Array.from({ length: 5000 }, (_, i) => ({ date: '2026-09-15', type: 'غياب', justified: 'غير مبرر', student: linked.id }))
];
const violations = [
  { date: '2026-11-09', student: linked.id },
  { date: '2026-10-09', student: linked.id },
  ...Array.from({ length: 3000 }, () => ({ date: '2026-09-01', student: linked.id }))
];
const snapshot = monthSandbox.buildSmartDashboardSnapshot(attendance, violations, '2026-11-27', () => { resolveCalls++; return linked; });
assert.deepEqual(JSON.parse(JSON.stringify(snapshot.current)), { absences: 4, lateness: 1, violations: 1 },
  'current month metrics remain accurate');
assert.deepEqual(JSON.parse(JSON.stringify(snapshot.previous)), { absences: 1, lateness: 0, violations: 1 },
  'previous comparable month metrics remain accurate');
assert.equal(resolveCalls, 4, 'previous-month and older records are counted without resolving student profiles');
assert.equal(snapshot.followups[0].absenceDays, 3, 'distinct unjustified absence days still trigger the correct follow-up');

// A repeated return to Home reuses its computed overview until a successful data save invalidates it.
let homeNameCalls = 0, homeStudentCalls = 0;
monthSandbox.db = { students: [linked], attendance: attendance.slice(0, 6), documents: [{ date: '2026-11-10', type: 'استدعاء ولي', student: linked.id, studentName: 'قديم' }], violations: violations.slice(0, 2) };
monthSandbox.name = id => { homeNameCalls++; return id === linked.id ? 'وائل عيسو' : 'تلميذ محذوف'; };
monthSandbox.student = id => { homeStudentCalls++; return id === linked.id ? linked : null; };
const homeStart = html.indexOf('function buildHomeOverviewSnapshot(today)');
const homeEnd = html.indexOf('function render(){', homeStart);
assert.ok(homeStart >= 0 && homeEnd > homeStart, 'home overview aggregation and cache helpers are isolated');
vm.runInContext('let homeOverviewCache=null;\n' + html.slice(homeStart, homeEnd), monthSandbox);
const homeFirst = vm.runInContext('getHomeOverviewSnapshot("2026-11-27")', monthSandbox);
const callsAfterFirstHome = { names: homeNameCalls, students: homeStudentCalls };
const homeSecond = vm.runInContext('getHomeOverviewSnapshot("2026-11-27")', monthSandbox);
assert.equal(homeSecond, homeFirst, 'repeated Home rendering reuses the same computed snapshot');
assert.deepEqual({ names: homeNameCalls, students: homeStudentCalls }, callsAfterFirstHome, 'cached Home navigation does not rescan/re-resolve student history');
vm.runInContext('homeOverviewCache=null', monthSandbox);
vm.runInContext('getHomeOverviewSnapshot("2026-11-27")', monthSandbox);
assert.ok(homeNameCalls > callsAfterFirstHome.names, 'a committed data change can force a fresh overview snapshot');

// 4) The compact home uses cached leadership/agenda snapshots; recent activity remains bounded.
const renderStart = html.indexOf('function render(){');
const renderEnd = html.indexOf('\nasync function compressPhoto', renderStart);
assert.ok(renderStart >= 0 && renderEnd > renderStart, 'render function can be inspected independently');
const render = html.slice(renderStart, renderEnd);
assert.ok(render.includes('getHomeLeadershipSnapshot(overview.date,Date.now())') && render.includes('renderDailyFollowupDashboard(leadership.date,leadership.now,leadership.daily)'), 'daily task analysis is rendered from one cached leadership snapshot');
assert.ok(render.includes('renderAgendaHome(leadership.date);'), 'upcoming agenda preview is rendered from its own cached seven-day snapshot');
assert.ok(html.includes('function getHomeLeadershipSnapshot(today,nowValue)') && html.includes('function renderAgendaHome(today)'), 'leadership and agenda snapshots have explicit cache-aware builders');
assert.ok(render.includes('const overview=getHomeOverviewSnapshot(dateISO());') && !render.includes('for(const record of db.attendance)'), 'Home reuses its cached overview instead of walking every attendance row on each navigation');
assert.ok(html.includes("if(['students','attendance','documents','violations'].some(entity=>changedEntities.has(entity)))homeOverviewCache=null;"), 'saved data changes invalidate the cached Home overview');
const homeHelpers = html.slice(homeStart, homeEnd);
assert.ok(homeHelpers.includes('const keepRecent=') && homeHelpers.includes('if(position<6){recent.splice'),
  'home recent activity keeps only six rows instead of merging and sorting every record');
assert.ok(homeHelpers.includes("const linkedName=name(item.record?.student),displayName=linkedName==='تلميذ محذوف'") && homeHelpers.indexOf('const recentItems=recent.map(item=>{')>homeHelpers.indexOf('for(const record of db.violations)'), 'recent activity resolves linked or historical names only after the final six rows have been selected');

// 5) Saving reuses a private, precomputed audit snapshot and avoids re-hashing unchanged photos.
const auditStart = html.indexOf('const AUDIT_LOG_LIMIT=500;');
const auditEnd = html.indexOf('let auditBaselineSnapshot=', auditStart);
assert.ok(auditStart >= 0 && auditEnd > auditStart, 'audit helpers exist before save');
const auditSandbox = {};
vm.createContext(auditSandbox);
vm.runInContext(html.slice(auditStart, auditEnd), auditSandbox);
const photo = 'data:image/jpeg;base64,' + 'A'.repeat(12000);
const source = { students: [], attendance: [], documents: [{ id: 'doc-1', student: 'x', date: '2026-11-01', type: 'وثيقة', photo }], violations: [], followups: [], agenda: [], settings: {} };
const retained = auditSandbox.auditComparableDatabase(source, { retainLargeAttachments: true });
assert.equal(retained.documents[0].photo, photo, 'large image references are retained only in the in-memory performance snapshot');
const redacted = auditSandbox.auditComparableDatabase(source);
assert.ok(!JSON.stringify(redacted).includes(photo), 'normal audit projections still fingerprint and never expose image data');
const precomputedBefore = auditSandbox.auditComparableDatabase(source);
const precomputedAfter = auditSandbox.auditComparableDatabase({ ...source, settings: { ...source.settings, school: 'ثانوية' } });
auditSandbox.auditComparableDatabase = () => { throw new Error('precomputed save must not project the database twice'); };
assert.doesNotThrow(() => auditSandbox.buildAuditEvents(precomputedBefore, {}, '2026-11-27T10:00:00Z', () => 'e1', {
  precomputedSnapshots: true, afterSnapshot: precomputedAfter
}), 'save compares the two already projected snapshots without another database walk');
assert.ok(html.includes('saveDatabaseWithPolicy(json,clearUndoAfterSave)'), 'regular Android saves use one transaction for database write and recovery policy');
assert.ok(java.includes('database.delete("recovery_snapshot", "id=1", null);'), 'undo cleanup is folded into the successful database transaction');
assert.ok(java.includes('String verifiedCiphertext = null;') && java.includes('encryptedJson.equals(verifiedCiphertext)'),
  'native writes verify the exact encrypted row without a full second decrypt');
const restoreStart = java.indexOf('synchronized boolean restoreSafely(String json) {');
const restoreEnd = java.indexOf('synchronized boolean saveRecoverySnapshot', restoreStart);
assert.ok(restoreStart >= 0 && restoreEnd > restoreStart && java.slice(restoreStart, restoreEnd).includes('decryptData(cursor.getString(0))'),
  'the stricter decrypt-and-compare verification remains for full restore operations');

console.log('PASS: Stage 25 low-cost rendering, indexed directory, single-pass monthly aggregation, bounded home activity, precomputed audit and transactional native save regressions.');

