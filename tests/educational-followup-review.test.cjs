const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function buildDailyFollowupSnapshot(');
const end=html.indexOf('function renderSmartDashboard(',start);
assert.ok(start>=0&&end>start,'daily dashboard review engine and navigation helpers exist');
const today='2026-11-25';
const validDate=value=>{
 const m=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(!m)return false;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),v=new Date(Date.UTC(y,mo-1,d));
 return v.getUTCFullYear()===y&&v.getUTCMonth()===mo-1&&v.getUTCDate()===d;
};
const students=[
 {id:'s1',last:'أحمد',first:'أمين',class:'1',schoolYear:'أولى',branch:'متوسط'},
 {id:'s2',last:'سارة',first:'ليلى',class:'2',schoolYear:'أولى',branch:'متوسط'},
 {id:'s3',last:'وائل',first:'عيسو',class:'3',schoolYear:'أولى',branch:'متوسط'},
 {id:'s4',last:'وائل',first:'عيسو',class:'4',schoolYear:'أولى',branch:'متوسط'}
];
const normName=value=>String(value??'').normalize('NFKC').replace(/[أإآٱ]/g,'ا').replace(/[ىي]/g,'ي').replace(/ة/g,'ه').replace(/\s*\d+$/,'').replace(/\s+/g,' ').trim();
const normSection=value=>String(value??'').normalize('NFKC').replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\s+/g,'').trim();
const belongs=(record,target,all)=>{
 const sid=String(target.id),rid=String(record.student??'').trim();
 if(rid===sid)return true;
 if(rid&&all.some(x=>String(x.id)===rid))return false;
 const name=normName(record.studentName||rid);
 const targetName=normName((target.last||'')+' '+(target.first||''));
 if(!name||name!==targetName)return false;
 const section=normSection(record.class||record.studentClass||record.sectionLabel||record.section||'');
 if(section)return [target.class,target.section,target.className].map(normSection).includes(section);
 return all.filter(x=>normName((x.last||'')+' '+(x.first||''))===name).length===1;
};
const byId=id=>students.find(x=>String(x.id)===String(id))||null;
const sandbox={
 Date,Map,Set,Number,String,Array,Math,window:{studentHistory:(...args)=>sandbox.actions.push(['profile',...args])},
 document:{querySelectorAll:()=>[]},actions:[],smartDashboardValidDate:validDate,
 profileRecordBelongsToStudent:belongs,
 agendaExpandOccurrences:()=>({items:[]}),
 dateISO:()=>today,agendaSelectedDate:'',agendaCurrentView:'month',
 go:page=>sandbox.actions.push(['go',page]),openAgendaSummons:id=>sandbox.actions.push(['document',id])
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const records=[
 {id:'f-overdue',student:'s1',date:'2026-11-20',category:'المواظبة والحضور',status:'قيد المتابعة',nextDate:'2026-11-24',observation:'مضمون تربوي سري',actionTaken:'إجراء داخلي'},
 {id:'f-today',student:'s2',date:'2026-11-24',category:'التواصل مع الولي',status:'قيد المتابعة',nextDate:today,observation:'ملاحظة سرية اليوم'},
 {id:'f-week',student:'s3',date:'2026-11-24',category:'السلوك والانضباط',status:'قيد المتابعة',nextDate:'2026-12-02',observation:'ملاحظة سرية قادمة'},
 {id:'f-far',student:'s1',date:'2026-11-20',category:'متابعة تربوية عامة',status:'قيد المتابعة',nextDate:'2026-12-03'},
 {id:'f-complete',student:'s1',date:'2026-11-20',category:'المواظبة والحضور',status:'تمت المتابعة',nextDate:'2026-11-24'},
 {id:'f-closed',student:'s1',date:'2026-11-20',category:'السلوك والانضباط',status:'أغلقت الحالة',nextDate:'2026-11-24'},
 {id:'f-invalid',student:'s1',date:'2026-11-20',category:'متابعة تربوية عامة',status:'قيد المتابعة',nextDate:'2026-02-30'},
 {id:'f-ambiguous',student:'unknown-id',studentName:'وائل عيسو',class:'',date:'2026-11-20',category:'المواظبة والحضور',status:'قيد المتابعة',nextDate:'2026-11-23'}
];
const before=JSON.stringify(records);
const snapshot=sandbox.buildDailyFollowupSnapshot([],[],[],[],today,Date.parse('2026-11-25T08:00:00+01:00'),byId,records,students);
assert.deepEqual(JSON.parse(JSON.stringify(snapshot.followupReviews)),{overdue:2,dueToday:1,upcoming7Days:1,unlinked:1},'overdue, due-today, seven-day and ambiguous-link counts are kept separately');
assert.ok(snapshot.tasks.some(x=>x.kind==='followup-overdue'&&x.followupId==='f-overdue'&&x.studentId==='s1'),'overdue follow-up links to the exact verified student record');
assert.ok(snapshot.tasks.some(x=>x.kind==='followup-dueToday'&&x.followupId==='f-today'&&x.studentId==='s2'),'due-today follow-up is surfaced');
assert.ok(snapshot.tasks.some(x=>x.kind==='followup-upcoming7Days'&&x.followupId==='f-week'&&x.studentId==='s3'),'seventh-day boundary is included');
assert.ok(snapshot.tasks.some(x=>x.kind==='followup-unlinked'&&x.recordId==='f-ambiguous'&&!x.studentId),'ambiguous legacy identity is never auto-assigned');
assert.ok(!snapshot.tasks.some(x=>['f-far','f-complete','f-closed','f-invalid'].includes(x.followupId)),'future beyond seven days, completed, closed and invalid-date records are excluded');
assert.equal(snapshot.tasks[0].followupId,'f-overdue','overdue follow-ups receive urgent priority');
assert.ok(!JSON.stringify(snapshot.tasks).includes('مضمون تربوي سري')&&!JSON.stringify(snapshot.tasks).includes('إجراء داخلي'),'daily dashboard never exposes private observation or action content');
assert.equal(JSON.stringify(records),before,'dashboard calculation never mutates stored follow-up records');

const legacy={id:'f-legacy',student:'اسم قديم',studentName:'أحمد أمين',class:'1',date:'2026-11-21',category:'متابعة تربوية عامة',status:'قيد المتابعة',nextDate:today};
const legacySnapshot=sandbox.buildDailyFollowupSnapshot([],[],[],[],today,Date.parse('2026-11-25T08:00:00+01:00'),byId,[legacy],students);
assert.ok(legacySnapshot.tasks.some(x=>x.kind==='followup-dueToday'&&x.studentId==='s1'),'legacy name plus matching section can link only when unique');
const duplicateLegacy={...legacy,student:'unknown-id',studentName:'وائل عيسو',class:''};
const ambiguousSnapshot=sandbox.buildDailyFollowupSnapshot([],[],[],[],today,Date.parse('2026-11-25T08:00:00+01:00'),byId,[duplicateLegacy],students);
assert.equal(ambiguousSnapshot.followupReviews.unlinked,1,'same-name records with ambiguous section membership remain unlinked');

const empty=sandbox.buildDailyFollowupSnapshot([],[],[],[],today,Date.parse('2026-11-25T08:00:00+01:00'),byId,null,students);
assert.deepEqual(JSON.parse(JSON.stringify(empty.followupReviews)),{overdue:0,dueToday:0,upcoming7Days:0,unlinked:0},'missing follow-up collection is backward-compatible');
const invalid=sandbox.buildDailyFollowupSnapshot([],[],[],[],'2026-02-30',Date.parse('2026-11-25T08:00:00+01:00'),byId,records,students);
assert.equal(invalid.totalTasks,0,'invalid dashboard date returns safe empty state');

sandbox.openDailyDashboardTask({dataset:{dailyStudentId:'s1',dailyFollowupId:'f-overdue'}});
assert.deepEqual(sandbox.actions.pop(),['profile','s1','f-overdue'],'review action opens exact student and follow-up record');
sandbox.openDailyDashboardTask({dataset:{dailyPage:'students'}});
assert.deepEqual(sandbox.actions.pop(),['go','students'],'unlinked follow-up routes to manual identity review, not an inferred profile');

for(const id of ['dailyFollowupOverdue','dailyFollowupDueToday','dailyFollowupUpcoming'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'follow-up review KPI ID is unique: '+id);
assert.ok(html.includes('مواعيد المراجعة التربوية')&&html.includes('متابعات تربوية متأخرة'),'home dashboard visibly summarizes follow-up reviews');
assert.ok(html.includes('buildDailyFollowupSnapshot(db.attendance,db.documents,db.agenda,db.violations,today,nowValue,id=>student(id),db.followups,db.students)'),'dashboard reads saved follow-up records and the student identity source');
assert.ok(html.includes("window.studentHistory=(id,focusFollowupId)=>{")&&html.includes("String(row.dataset.followupId||'')===String(focusFollowupId)"),'the dashboard can focus the exact entry in the student profile');
assert.ok(html.includes('data-daily-followup-id=')&&html.includes('فتح سجل المتابعة'),'follow-up action is explicitly wired to profile navigation');
assert.ok(html.includes("replace(/\\s+/g,'').includes('استدعاء')"),'existing summons matching remains present');

console.log('PASS: phase 8 educational review dashboard, seven-day date windows, safe student matching, private-content redaction, non-mutating aggregation and exact profile navigation.');
