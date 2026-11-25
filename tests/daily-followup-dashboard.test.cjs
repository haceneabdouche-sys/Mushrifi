const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

process.env.TZ='Africa/Algiers';
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const dailyStart=html.indexOf('function smartDashboardDateShift(');
const dailyEnd=html.indexOf('function openDailyDashboardTask(',dailyStart);
assert.ok(dailyStart>=0&&dailyEnd>dailyStart,'daily dashboard pure helpers exist before navigation actions');

const sandbox={Date,Map,Set,Number,String,Array,Math};
vm.createContext(sandbox);
vm.runInContext(html.slice(dailyStart,dailyEnd),sandbox);
const today='2026-11-25';
const now=Date.parse('2026-11-25T08:00:00+01:00');

const students={
 s1:{id:'s1',last:'أحمد',first:'أمين',schoolYear:'السنة الأولى متوسط',class:'1',branch:''},
 s2:{id:'s2',last:'ليلى',first:'سارة',schoolYear:'السنة الأولى متوسط',class:'1',branch:''},
 s3:{id:'s3',last:'يوسف',first:'علي',schoolYear:'السنة الثانية متوسط',class:'2',branch:''}
};
const resolve=id=>students[String(id)]||null;
const attendance=[
 {id:'a1',student:'s1',date:today,type:'غياب',justified:'غير مبرر',class:'1'},
 {id:'a2',student:'s1',date:today,type:' غياب ',justified:'مبرر',class:'1'},
 {id:'a3',student:'s2',date:today,type:'غياب',justified:'مبرر',class:'1'},
 {id:'a4',student:'s3',date:today,type:'تأخر',justified:'غير مبرر',class:'2'},
 {id:'a5',student:'orphan',date:today,type:'غياب',justified:'غير مبرر',class:'?'},
 {id:'a6',student:'s2',date:today,type:'تأخر',justified:'قيد التبرير',class:'1'},
 {id:'a7',student:'s1',date:'2026-11-20',type:'غياب',justified:'قيد التبرير',class:'1'},
 {id:'a8',student:'orphan',date:'2026-11-21',type:'تأخر',justified:'قيد التبرير',class:'?'},
 {id:'old',student:'s1',date:'2026-11-18',type:'غياب',justified:'غير مبرر',class:'1'}
];
const documents=[
 {id:'d1',student:'s1',type:'استدعاء ولي',reason:'مراجعة الغياب',appointment:'2026-11-26T07:30:00+01:00'},
 {id:'d2',student:'missing',type:'استدعاء ولي',reason:'ملف غير مرتبط',appointment:'2026-11-25T23:00:00+01:00'},
 {id:'d3',student:'s2',type:'استدعاء ولي',appointment:'2026-11-26T09:01:00+01:00'},
 {id:'d4',student:'s3',type:'استدعاء ولي',appointment:'2026-11-25T21:00:00+01:00',status:'cancelled'},
 {id:'d5',student:'s1',type:'إشعار غياب',appointment:'2026-11-25T12:00:00+01:00'}
];
const agenda=[
 {id:'g1',title:'اجتماع مجلس التربية',date:today,startTime:'10:00',priority:'high',status:'planned',studentId:'s3'},
 {id:'g2',title:'مهمة منجزة',date:today,startTime:'09:00',priority:'normal',status:'done'},
 {id:'g3',title:'موعد الغد',date:'2026-11-26',startTime:'11:00',priority:'urgent',status:'planned'}
];
const violations=[
 {id:'v1',student:'s1',date:today,type:'مشاجرة'},
 {id:'v2',student:'s3',date:today,type:'تأخر عن النظام'},
 {id:'v3',student:'s2',date:'2026-11-24',type:'أخرى'}
];

const snap=sandbox.buildDailyFollowupSnapshot(attendance,documents,agenda,violations,today,now,resolve);
assert.deepEqual(JSON.parse(JSON.stringify(snap.today)),{absences:4,lateness:2,unjustified:3,pending:3,violations:2},'today cards count individual records and include current pending justifications');
assert.equal(snap.summonsNext24h,2,'summons are limited to the upcoming rolling 24-hour window');
assert.equal(snap.unlinkedSummons,1,'unlinked summons stay visible without inventing a student');
assert.equal(snap.agendaToday,1,'completed appointments and future-day appointments are excluded from today agenda count');
assert.equal(snap.unlinkedPending,1,'pending records with unknown identity are counted separately');
assert.equal(snap.sections.length,3,'section breakdown groups students by school year and class, plus one unclassified bucket');
const classOne=snap.sections.find(x=>x.label.includes('السنة الأولى متوسط'));
assert.deepEqual(JSON.parse(JSON.stringify(classOne)),{label:'السنة الأولى متوسط — 1',absences:3,lateness:1,students:2,classified:true},'multiple students in the same section are aggregated together with record and student counts');
const classTwo=snap.sections.find(x=>x.label.includes('السنة الثانية متوسط'));
assert.deepEqual(JSON.parse(JSON.stringify(classTwo)),{label:'السنة الثانية متوسط — 2',absences:0,lateness:1,students:1,classified:true},'a separate class remains a separate section');
const unclassified=snap.sections.find(x=>!x.classified);
assert.deepEqual(JSON.parse(JSON.stringify(unclassified)),{label:'غير مصنف (هوية غير مؤكدة)',absences:1,lateness:0,students:0,classified:false},'unlinked student records remain visible as unclassified instead of being assigned by guess');
assert.equal(snap.totalTasks,snap.tasks.length,'task total matches all actionable tasks before the UI display limit');
assert.equal(snap.tasks[0].kind,'summons','urgent guardian visits sort before normal follow-ups');
assert.equal(snap.tasks[1].kind,'summons','both upcoming guardian visits remain in the task list');
assert.ok(snap.tasks.some(x=>x.kind==='unlinked'&&x.recordId==='a8'),'unlinked pending justification is surfaced for identity verification');
assert.ok(snap.tasks.some(x=>x.kind==='summons'&&x.documentId==='d2'&&!x.studentId),'unlinked summons retains the original document action without an unsafe student link');
assert.ok(snap.tasks.some(x=>x.kind==='agenda'&&x.title==='اجتماع مجلس التربية'&&x.studentId==='s3'),'today agenda tasks retain safe student linkage');
assert.ok(!snap.tasks.some(x=>x.title==='مهمة منجزة'||x.title==='موعد الغد'),'completed and non-today appointments are excluded');

const empty=sandbox.buildDailyFollowupSnapshot(null,null,null,null,'invalid',now,resolve);
assert.equal(empty.totalTasks,0,'invalid date gives a safe empty dashboard');
const noData=sandbox.buildDailyFollowupSnapshot([],[],[],[],today,now,resolve);
assert.equal(noData.today.violations,0,'empty collections produce zero counts without throwing');

const navSandbox={
 window:{studentHistory:id=>navSandbox.actions.push(['profile',id])},
 actions:[],
 document:{querySelectorAll:()=>[]},
 dateISO:()=>today,
 agendaSelectedDate:'',
 agendaCurrentView:'month',
 go:page=>navSandbox.actions.push(['go',page]),
 openAgendaSummons:id=>navSandbox.actions.push(['document',id])
};
vm.createContext(navSandbox);
const navStart=html.indexOf('function openDailyDashboardTask(button){');
const navEnd=html.indexOf('function renderDailyFollowupDashboard(',navStart);
assert.ok(navStart>=0&&navEnd>navStart,'daily dashboard action router exists');
vm.runInContext(html.slice(navStart,navEnd),navSandbox);
navSandbox.openDailyDashboardTask({dataset:{dailyStudentId:'s1'}});
assert.deepEqual(navSandbox.actions.pop(),['profile','s1'],'explicit student action opens the linked profile');
navSandbox.openDailyDashboardTask({dataset:{dailyPage:'documents',dailyDocumentId:'d1'}});
assert.deepEqual(navSandbox.actions.pop(),['document','d1'],'summons action opens the original document, not only the student profile');
navSandbox.openDailyDashboardTask({dataset:{dailyPage:'agenda',dailyAgendaDate:today}});
assert.deepEqual(navSandbox.actions.pop(),['go','agenda'],'agenda task opens agenda directly');
assert.equal(navSandbox.agendaSelectedDate,today,'agenda action selects the exact appointment day');
assert.equal(navSandbox.agendaCurrentView,'day','agenda action opens a focused day view');
let focused=false,scrolled=false;
const row={scrollIntoView:()=>{scrolled=true;},classList:{add:c=>{focused=c==='daily-task-focus';}},getAttribute:()=> 'a7'};
navSandbox.document.querySelectorAll=()=>[row];
navSandbox.openDailyDashboardTask({dataset:{dailyPage:'attendance',dailyRecordId:'a7'}});
assert.deepEqual(navSandbox.actions.pop(),['go','attendance'],'pending justification action navigates to attendance records');
assert.equal(scrolled,true,'matching attendance record is brought into view');
assert.equal(focused,true,'matching attendance record receives a visible focus highlight');

for(const id of ['dailyTodayAbsences','dailyTodayLateness','dailyTodayUnjustified','dailyPendingReasons','dailyTodayViolations','dailyTasksSubCount','dailySectionBreakdown','dailyTasksList']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'daily dashboard element ID is unique: '+id);
}
assert.ok(html.includes('لوحة المتابعة اليومية الذكية'),'dedicated smart daily dashboard heading is visible');
assert.ok(html.includes('function renderDailyFollowupDashboard(today,nowValue)'),'daily dashboard has a dedicated renderer');
assert.ok(html.includes('renderDailyFollowupDashboard(today,Date.now());'),'dashboard refreshes from saved current database on home view');
assert.ok(html.includes("list.querySelectorAll('[data-daily-page],[data-daily-student-id]')"),'all task and profile buttons are wired after rendering');
assert.ok(html.includes("if(s.totalTasks>10)"),'task list explains when more than ten tasks are available');
assert.ok(html.includes("replace(/\\s+/g,'').includes('استدعاء')"),'summons type matching tolerates spaces in Arabic labels');
assert.ok(html.includes('x.students.size'),'section aggregation counts distinct known students per section');
assert.ok(html.includes('dailyTodayViolations'),'today violations are displayed in their own KPI');

console.log('PASS: smart daily dashboard record counts, section aggregation, unlinked identity protection, rolling summons window, agenda status, task prioritization, action routing and mobile dashboard controls.');
