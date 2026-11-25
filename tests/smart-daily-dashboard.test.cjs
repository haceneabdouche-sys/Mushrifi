const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function smartDashboardDateShift(');
const end=html.indexOf('function renderSmartDashboard(',start);
assert.ok(start>=0&&end>start,'smart dashboard analysis helpers exist before the renderer');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

assert.equal(sandbox.smartDashboardDateShift('2026-11-25',-6),'2026-11-19','current seven-day window starts six days before today');
assert.equal(sandbox.smartDashboardDateShift('2026-11-25',-13),'2026-11-12','previous comparison window starts thirteen days before today');
assert.equal(sandbox.smartDashboardDateShift('2026-02-31',0),'','invalid calendar dates are rejected');
assert.equal(sandbox.smartDashboardDateShift('bad-date',0),'','non-ISO dates are rejected');

const students={
 s1:{id:'s1',last:'أحمد',first:'أمين',class:'1'},
 s2:{id:'s2',last:'سارة',first:'ليلى',class:'1'},
 s3:{id:'s3',last:'يوسف',first:'علي',class:'2'},
 s4:{id:'s4',last:'مريم',first:'نور',class:'2'}
};
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
 {student:'s3',date:'2026-11-17',type:'تأخر',justified:'غير مبرر'}
];
const violations=[
 {student:'s1',date:'2026-11-20'},
 {student:'s2',date:'2026-11-16'},
 {student:'s3',date:'2026-11-10'}
];
const snapshot=sandbox.buildSmartDashboardSnapshot(attendance,violations,'2026-11-25',id=>students[id]||null);
assert.equal(snapshot.current.absences,10,'current week counts all absence records, including justified and same-day records');
assert.equal(snapshot.current.lateness,7,'current week counts all lateness records');
assert.equal(snapshot.current.violations,1,'current week excludes older violations');
assert.equal(snapshot.previous.absences,1,'previous week absence comparison uses the immediately preceding seven days');
assert.equal(snapshot.previous.lateness,1,'previous week lateness comparison uses the immediately preceding seven days');
assert.equal(snapshot.previous.violations,1,'previous week violation comparison uses the immediately preceding seven days');

const followupIds=snapshot.followups.map(item=>item.student.id);
assert.equal(followupIds.join(','),'s1,s3','only students with three distinct days of unjustified absence or lateness are flagged');
assert.equal(snapshot.followups.find(item=>item.student.id==='s1').absenceDays,3,'multiple records on the same day count as one day for repeated absence');
assert.equal(snapshot.followups.find(item=>item.student.id==='s3').latenessDays,3,'justified lateness does not count toward repeated lateness');
assert.ok(!followupIds.includes('s2'),'two separate days do not trigger a repeated-absence indicator');
assert.ok(!followupIds.includes('s4'),'pending justification is not mislabeled as unjustified');
assert.ok(!followupIds.includes('unknown'),'records not safely linked to a known student are not assigned to another student');
assert.equal(sandbox.smartDashboardTrend(4,2),'زيادة 2 عن الأسبوع السابق','increased activity is described correctly');
assert.equal(sandbox.smartDashboardTrend(2,4),'انخفاض 2 عن الأسبوع السابق','decreased activity is described correctly');
assert.equal(sandbox.smartDashboardTrend(2,2),'مثل الأسبوع السابق','unchanged activity is described neutrally');

assert.ok(html.includes('id="smartDashboardHeading"'),'weekly and smart follow-up dashboard panel is present');
assert.ok(html.includes('id="smartWeekAbsences"')&&html.includes('id="smartWeekLateness"')&&html.includes('id="smartWeekViolations"'),'weekly summary displays all three indicators');
assert.ok(html.includes('id="priorityFollowupList"')&&html.includes('data-smart-student-id'),'priority list can open the exact student profile');
assert.ok(html.includes('renderSmartDashboard(today);'),'smart analysis runs as part of home dashboard refresh');
assert.ok(html.includes('ثلاثة أيام مختلفة على الأقل'),'the indicator threshold is explained to the user');
assert.ok(html.includes("list.querySelectorAll('[data-smart-student-id]').forEach"),'student profile actions are wired after rendering');

console.log('PASS: smart daily dashboard weekly comparison, distinct-day repetition rules, safe student identity matching, and profile navigation.');
