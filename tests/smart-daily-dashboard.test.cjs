const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function smartDashboardDateShift(');
const end=html.indexOf('function buildDailyFollowupSnapshot(',start);
assert.ok(start>=0&&end>start,'monthly dashboard helpers exist before daily follow-up calculations');
const sandbox={};vm.createContext(sandbox);vm.runInContext(html.slice(start,end),sandbox);
assert.equal(sandbox.smartDashboardDateShift('2026-11-25',-6),'2026-11-19','daily date shifting remains available');
assert.equal(sandbox.smartDashboardDateShift('2026-02-31',0),'','invalid calendar dates are rejected');
assert.equal(sandbox.smartDashboardDateShift('bad-date',0),'','non-ISO dates are rejected');
const nov=sandbox.smartDashboardMonthWindows('2026-11-25');
assert.equal(nov.currentStart,'2026-11-01');assert.equal(nov.currentEnd,'2026-11-25');
assert.equal(nov.previousStart,'2026-10-01');assert.equal(nov.previousEnd,'2026-10-25','compare month to date against same elapsed period');
assert.equal(sandbox.smartDashboardMonthWindows('2026-02-31'),null,'invalid date has no monthly window');
const jan=sandbox.smartDashboardMonthWindows('2026-01-31');
assert.equal(jan.previousStart,'2025-12-01');assert.equal(jan.previousEnd,'2025-12-31','January correctly compares with previous December');
assert.equal(sandbox.smartDashboardMonthWindows('2026-03-31').previousEnd,'2026-02-28','short previous month is capped at its final day');
assert.equal(sandbox.smartDashboardMonthWindows('2024-03-31').previousEnd,'2024-02-29','leap day is included where applicable');
const students={s1:{id:'s1',last:'أحمد',first:'أمين',class:'1'},s2:{id:'s2',last:'سارة',first:'ليلى',class:'1'},s3:{id:'s3',last:'يوسف',first:'علي',class:'2'},s4:{id:'s4',last:'مريم',first:'نور',class:'2'}};
const attendance=[
 {student:'s1',date:'2026-11-20',type:'غياب',justified:'غير مبرر'},
 {student:'s1',date:'2026-11-21',type:'غياب',justified:'غير مبرر'},
 {student:'s1',date:'2026-11-24',type:'غياب',justified:'غير مبرر'},
 {student:'s1',date:'2026-11-24',type:'غياب',justified:'غير مبرر'},
 {student:'s1',date:'2026-11-22',type:'غياب',justified:'مبرر'},
 {student:'s2',date:'2026-11-20',type:'غياب',justified:'غير مبرر'},
 {student:'s2',date:'2026-11-22',type:'غياب',justified:'غير مبرر'},
 {student:'s3',date:'2026-11-19',type:'تأخر',justified:'غير مبرر'},
 {student:'s3',date:'2026-11-20',type:'تأخر',justified:'غير مبرر'},
 {student:'s3',date:'2026-11-23',type:'تأخر',justified:'غير مبرر'},
 {student:'s3',date:'2026-11-24',type:'تأخر',justified:'مبرر'},
 {student:'s4',date:'2026-11-19',type:'تأخر',justified:'قيد التبرير'},
 {student:'s4',date:'2026-11-20',type:'تأخر',justified:'قيد التبرير'},
 {student:'s4',date:'2026-11-21',type:'تأخر',justified:'قيد التبرير'},
 {student:'unknown',date:'2026-11-20',type:'غياب',justified:'غير مبرر'},
 {student:'unknown',date:'2026-11-21',type:'غياب',justified:'غير مبرر'},
 {student:'unknown',date:'2026-11-22',type:'غياب',justified:'غير مبرر'},
 {student:'s1',date:'2026-11-18',type:'غياب',justified:'غير مبرر'},
 {student:'s3',date:'2026-11-17',type:'تأخر',justified:'غير مبرر'},
 {student:'s2',date:'2026-10-20',type:'غياب',justified:'غير مبرر'},
 {student:'s2',date:'2026-10-22',type:'تأخر',justified:'غير مبرر'}
];
const violations=[{student:'s1',date:'2026-11-20'},{student:'s2',date:'2026-11-16'},{student:'s3',date:'2026-11-10'},{student:'s3',date:'2026-10-15'}];
const snap=sandbox.buildSmartDashboardSnapshot(attendance,violations,'2026-11-25',id=>students[id]||null);
assert.equal(snap.current.absences,11,'current month absences include justified and repeated same-day records');
assert.equal(snap.current.lateness,8,'current month lateness is counted');
assert.equal(snap.current.violations,3,'only current-month violations are counted');
assert.equal(snap.previous.absences,1,'previous month comparison matches elapsed days');
assert.equal(snap.previous.lateness,1,'previous month lateness comparison matches elapsed days');
assert.equal(snap.previous.violations,1,'previous month violation comparison matches elapsed days');
assert.equal(snap.followups.map(x=>x.student.id).join(','),'s1,s3','only safely linked repeat cases are surfaced');
assert.equal(snap.followups.find(x=>x.student.id==='s1').absenceDays,4,'repeats count distinct days only and exclude justified absences');
assert.equal(snap.followups.find(x=>x.student.id==='s3').latenessDays,4,'repeated lateness counts distinct unjustified days');
assert.ok(!snap.followups.some(x=>x.student.id==='s2'),'less than three distinct days are not flagged');
assert.ok(!snap.followups.some(x=>x.student.id==='s4'),'pending justification is not marked unjustified');
assert.ok(!snap.followups.some(x=>x.student.id==='unknown'),'unlinked records are not assigned to a student');
assert.equal(sandbox.smartDashboardTrend(4,2),'زيادة 2 عن الفترة المناظرة من الشهر السابق');
assert.equal(sandbox.smartDashboardTrend(2,4),'انخفاض 2 عن الفترة المناظرة من الشهر السابق');
assert.equal(sandbox.smartDashboardTrend(2,2),'مثل الفترة المناظرة من الشهر السابق');
assert.ok(html.includes('id="smartDashboardHeading">الملخص الشهري'),'homepage labels its summary monthly');
assert.ok(html.includes('id="smartMonthAbsences"')&&html.includes('id="smartMonthLateness"')&&html.includes('id="smartMonthViolations"'),'monthly totals are present');
assert.ok(!html.includes('id="smartWeekAbsences"')&&!html.includes('ملخص الأسبوع ومؤشرات المتابعة'),'weekly summary is removed');
assert.ok(html.includes('renderSmartDashboard(overview.date,overview.monthly);'),'monthly renderer remains connected to the cached dashboard refresh');
assert.ok(html.includes('ثلاثة أيام مختلفة على الأقل خلال الشهر الجاري'),'repeat threshold is explained for the current month');
console.log('PASS: month-to-date dashboard, matching previous-month comparison, calendar boundaries and safe repeat review logic.');

