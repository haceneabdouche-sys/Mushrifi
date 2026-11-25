const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function smartDashboardDateShift(');
const end=html.indexOf('function openDailyDashboardTask(',start);
assert.ok(start>=0&&end>start,'daily dashboard pure date and snapshot helpers are present');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);
const students={
 a:{id:'a',last:'عيسو',first:'وائل',schoolYear:'الأولى متوسط',class:'1'},
 b:{id:'b',last:'سارة',first:'ليلى',schoolYear:'الأولى متوسط',class:'2'}
};
const resolve=id=>students[String(id)]||null;
const today='2026-11-25',now=Date.parse('2026-11-25T10:00:00+01:00');
const attendance=[
 {id:'att1',student:'a',date:today,type:'غياب',justified:'غير مبرر',class:'1'},
 {id:'att2',student:'a',date:today,type:'تأخر',justified:'قيد التبرير',class:'1'},
 {id:'att3',student:'b',date:today,type:'غياب',justified:'مبرر',class:'2'},
 {id:'att4',student:'unknown',date:today,type:'غياب',justified:'غير مبرر',class:'X'},
 {id:'att5',student:'b',date:'2026-11-20',type:'تأخر',justified:'قيد التبرير',class:'2'},
 {id:'att6',student:'unknown',date:'2026-11-19',type:'غياب',justified:'قيد التبرير',class:'X'},
 {id:'att7',student:'a',date:'2026-02-31',type:'غياب',justified:'قيد التبرير'}
];
const documents=[
 {id:'doc1',student:'a',type:'استدعاء ولي',appointment:'2026-11-25T16:00+01:00',reason:'حضور الولي'},
 {id:'doc2',student:'missing',type:'استدعاء ولي',appointment:'2026-11-26T09:00+01:00',reason:'سجل قديم غير مرتبط'},
 {id:'doc3',student:'a',type:'استدعاء ولي',appointment:'2026-11-26T11:01+01:00',reason:'خارج 24 ساعة'},
 {id:'doc4',student:'a',type:'استدعاء ولي',appointment:'2026-11-25T13:00+01:00',status:'cancelled'},
 {id:'doc5',student:'a',type:'وثيقة أخرى',appointment:'2026-11-25T14:00'}
];
const agenda=[
 {id:'ag1',title:'اجتماع الفريق',date:today,startTime:'12:30',status:'planned',priority:'high'},
 {id:'ag2',title:'مهمة منجزة',date:today,status:'done'},
 {id:'ag3',title:'غدًا',date:'2026-11-26',status:'planned'}
];
const snapshot=sandbox.buildDailyFollowupSnapshot(attendance,documents,agenda,today,now,resolve);
assert.deepEqual(JSON.parse(JSON.stringify(snapshot.today)),{absences:3,lateness:1,unjustified:2,pending:3},'daily metrics count records and keep pending justification separate');
assert.equal(snapshot.summonsNext24h,2,'two upcoming summons fall within the next 24 hours; cancelled and later appointments are excluded');
assert.equal(snapshot.unlinkedSummons,1,'an upcoming summons with unverified student identity remains visible without being linked');
assert.equal(snapshot.unlinkedPending,1,'pending record with unsafe student link is counted for identity review');
assert.equal(snapshot.agendaToday,1,'only open agenda tasks scheduled for today are counted');
assert.equal(snapshot.sections.find(x=>x.label.includes('الأولى متوسط')&&x.label.endsWith('1')).absences,1,'known attendance is grouped by its verified section');
assert.ok(snapshot.sections.some(x=>x.classified===false&&x.absences===1),'unlinked daily records are shown in an unclassified bucket, not assigned to a class');
assert.ok(snapshot.tasks.some(x=>x.documentId==='doc2'&&!x.studentId),'unlinked summons remains actionable via documents but has no guessed student profile');
assert.ok(snapshot.tasks.some(x=>x.recordId==='att6'&&x.kind==='unlinked'),'unlinked pending attendance remains actionable for data review');
assert.ok(snapshot.tasks.some(x=>x.recordId==='att1'&&x.kind==='today'),'today unexcused record is included as an actionable task');
assert.ok(snapshot.tasks.some(x=>x.agendaDate===today&&x.kind==='agenda'),'today agenda item is actionable');
assert.equal(snapshot.totalTasks,snapshot.tasks.length,'task count equals complete task list before UI display limit');
assert.equal(sandbox.buildDailyFollowupSnapshot(attendance,documents,agenda,'bad-date',now,resolve).totalTasks,0,'invalid dashboard date safely returns an empty snapshot');
assert.equal(sandbox.buildDailyFollowupSnapshot(attendance,documents,agenda,today,NaN,resolve).totalTasks,0,'invalid clock input safely returns an empty snapshot');
assert.ok(html.includes('id="dailyTodayAbsences"')&&html.includes('id="dailyTodayUnjustified"')&&html.includes('id="dailyPendingReasons"'),'dashboard displays same-day attendance and pending justification indicators');
assert.ok(html.includes('id="dailySectionBreakdown"')&&html.includes('data-daily-record-id'),'section breakdown and record-specific follow-up actions are wired');
assert.ok(html.includes('function openDailyDashboardTask')&&html.includes('row.scrollIntoView'),'attendance action navigates to and highlights the exact record');
assert.ok(html.includes('renderDailyFollowupDashboard(today,Date.now());'),'smart daily dashboard refreshes with the home screen');
console.log('PASS: smart daily follow-up metrics, due summons, pending justifications, section grouping, safe unlinked records, agenda tasks and exact-record navigation.');
