const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helperStart=html.indexOf('function normalizeProfileStudentName(value){');
const helperEnd=html.indexOf('window.openStudentProfileAttendanceEdit',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'student matching and follow-up/report helpers exist before profile actions');

const parseHours=value=>{
 let text=String(value??'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٫،]/g,'.');
 text=text.replace(/\s*(ساعة|ساعات|ساعتان|ساعتين)\s*/g,'').trim();
 if(text==='')return '';
 return /^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const target={id:'student-1',last:'وائل',first:'عيسو',class:'1',schoolYear:'أولى',branch:'متوسط',phone:'0550000000'};
const sameNameOtherSection={id:'student-2',last:'وائل',first:'عيسو',class:'2',schoolYear:'أولى',branch:'متوسط'};
const other={id:'student-3',last:'تلميذ',first:'آخر',class:'3',schoolYear:'أولى',branch:'متوسط'};
const sandbox={
 window:{},parseHours,esc,
 attendanceGroupLabel:st=>[st.schoolYear||'',st.branch||'',st.class||''].filter(Boolean).join(' — '),
 studentAcademicParts:st=>({schoolYear:st.schoolYear,branch:st.branch,sectionNumber:st.sectionNumber||st.class})
};
vm.createContext(sandbox);
vm.runInContext(html.slice(helperStart,helperEnd),sandbox);

const valid={
 date:'2026-11-20',category:'المواظبة والحضور',observation:'تكرر غياب التلميذ خلال الأسبوع',
 actionTaken:'تم التواصل مع الولي وتوجيه تنبيه بضرورة المتابعة',
 status:'قيد المتابعة',nextDate:'2026-11-27',result:'تحسن الالتزام بالحضور بعد التواصل الأولي'
};
assert.equal(sandbox.validateStudentFollowupInput(valid).valid,true,'valid structured follow-up is accepted');
assert.equal(sandbox.validateStudentFollowupInput({...valid,date:'2026-02-30'}).valid,false,'impossible follow-up date is rejected');
assert.equal(sandbox.validateStudentFollowupInput({...valid,nextDate:'2026-11-19'}).valid,false,'next review date cannot precede the follow-up date');
assert.equal(sandbox.validateStudentFollowupInput({...valid,category:'مجال غير معتمد'}).valid,false,'unknown follow-up categories are rejected');
assert.equal(sandbox.validateStudentFollowupInput({...valid,status:'حالة غير معتمدة'}).valid,false,'unknown follow-up states are rejected');
assert.equal(sandbox.validateStudentFollowupInput({...valid,observation:'  '} ).valid,false,'an empty observation cannot be saved');
assert.equal(sandbox.validateStudentFollowupInput({...valid,actionTaken:''}).valid,false,'an action taken is required');
const long=sandbox.validateStudentFollowupInput({...valid,observation:'م'.repeat(1500),actionTaken:'إ'.repeat(1500),result:'ن'.repeat(2000)});
assert.equal(long.value.observation.length,1200,'observation is safely capped at 1200 characters');
assert.equal(long.value.actionTaken.length,1200,'action text is safely capped at 1200 characters');
assert.equal(long.value.result.length,1600,'result text is safely capped at 1600 characters');

const records=[
 {id:'f-1',student:'student-1',studentName:'وائل عيسو',class:'1',schoolYear:'أولى',branch:'متوسط',...valid,createdAt:'2026-11-20T09:00:00Z'},
 {id:'f-legacy',student:'وائل عيسو',studentName:'وائل عيسو',class:'١',date:'2026-11-18',category:'التواصل مع الولي',observation:'سجل قديم',actionTaken:'تم الاتصال',status:'تمت المتابعة'},
 {id:'f-wrong-section',student:'وائل عيسو',studentName:'وائل عيسو',class:'2',date:'2026-11-19',category:'المواظبة والحضور',observation:'لا يخص القسم',actionTaken:'—',status:'قيد المتابعة'},
 {id:'f-other-id',student:'student-2',studentName:'وائل عيسو',class:'1',date:'2026-11-21',category:'المواظبة والحضور',observation:'معرّف تلميذ آخر',actionTaken:'—',status:'قيد المتابعة'},
 {id:'f-other-student',student:'student-3',date:'2026-11-22',category:'السلوك والانضباط',observation:'تلميذ آخر',actionTaken:'—',status:'قيد المتابعة'}
];
const database={
 students:[target,sameNameOtherSection,other],
 attendance:[{id:'att-1',student:'student-1',date:'2026-11-17',type:'غياب',hours:2,justified:'مبرر'}],
 violations:[{id:'v-1',student:'student-1',date:'2026-11-16',type:'سلوك',description:'ملاحظة'}],
 documents:[],followups:records
};
const followups=sandbox.buildStudentFollowupRecords(target,database);
assert.deepEqual(JSON.parse(JSON.stringify(followups.map(x=>x.id))),['f-1','f-legacy'],'only verified target records are included and sorted newest first');
assert.ok(!followups.some(x=>['f-wrong-section','f-other-id','f-other-student'].includes(x.id)),'wrong-section, other-ID, and other-student follow-ups are excluded');
const data=sandbox.buildStudentReportData(target,database);
assert.equal(data.followups.length,2,'comprehensive student report includes both safe follow-up entries');
assert.equal(data.summary.followups,2,'follow-up total is included in the report summary');
assert.equal(data.summary.followupsPending,1,'open follow-ups are counted separately');
assert.equal(data.summary.followupsCompleted,1,'completed follow-ups are counted separately');
assert.equal(data.timeline.filter(x=>x.source==='followups').length,2,'follow-ups are represented in the unified timeline without replacing legacy event types');
assert.ok(data.timeline.some(x=>x.source==='attendance'&&x.recordId==='att-1'),'existing attendance events remain unchanged');
assert.ok(data.timeline.some(x=>x.source==='violations'&&x.recordId==='v-1'),'existing violation events remain unchanged');

const view=sandbox.profileStudentFollowupView(followups);
assert.equal(view.total,2);
assert.equal(view.pending,1);
assert.equal(view.completed,1,'completed follow-ups appear in interactive status summary');
assert.equal(view.closed,0,'closed follow-up count is independent');
assert.ok(view.html.includes('تعديل المتابعة')&&view.html.includes('data-followup-action="delete"'),'follow-up list exposes direct edit and delete controls');
assert.ok(view.html.includes('تم التواصل')&&view.html.includes('2026-11-27'),'follow-up view displays action and next-review date');
const escapedRecord={...records[0],observation:'<img src=x onerror=alert(1)>'};
const escapedView=sandbox.profileStudentFollowupView([escapedRecord]);
assert.ok(escapedView.html.includes('&lt;img')&&!escapedView.html.includes('<img src=x'),'follow-up text is HTML-escaped');

const filtered=sandbox.profileTimelineView(data.timeline,'followups',20);
assert.equal(filtered.total,2,'timeline filter supports educational follow-up only');
assert.ok(filtered.html.includes('تعديل المتابعة التربوية')&&filtered.html.includes('موعد المراجعة المقبلة'),'timeline labels the follow-up action and its next review correctly');

const printable=sandbox.buildStudentPrintableReportMarkup(data);
assert.ok(printable.includes('سجل المتابعة التربوية')&&printable.includes('الإجراء المتخذ'),'printable student report includes structured follow-up records');
assert.ok(printable.includes('تكرر غياب التلميذ خلال الأسبوع')&&printable.includes('2026-11-27'),'printable report includes observation and next review date');
assert.ok(!printable.includes('0550000000'),'printable report does not expose the guardian phone number');

const dbStart=html.indexOf('function parseMushrifiDatabase(raw){');
const dbEnd=html.indexOf('let db;',dbStart);
assert.ok(dbStart>=0&&dbEnd>dbStart,'database parser is available for follow-up backward-compatibility tests');
const dbSandbox={};vm.createContext(dbSandbox);vm.runInContext(html.slice(dbStart,dbEnd),dbSandbox);
const legacy=dbSandbox.parseMushrifiDatabase(JSON.stringify({students:[{id:'old'}],attendance:[],documents:[],violations:[],settings:{}}));
assert.deepEqual(JSON.parse(JSON.stringify(legacy.followups)),[],'legacy databases without followups migrate in memory with an empty follow-up collection');
const current=dbSandbox.parseMushrifiDatabase(JSON.stringify({students:[],attendance:[],documents:[],violations:[],agenda:[],followups:[{id:'f'}],settings:{}}));
assert.equal(current.followups.length,1,'valid follow-up collection is retained');
assert.throws(()=>dbSandbox.parseMushrifiDatabase(JSON.stringify({students:[],attendance:[],documents:[],violations:[],followups:'broken',settings:{}})),'malformed follow-up collection is rejected instead of silently discarded');

const recoveryStart=html.indexOf('function parseRecoverySnapshot(raw){');
const recoveryEnd=html.indexOf('function refreshUndoPanel(){',recoveryStart);
const recoverySandbox={};vm.createContext(recoverySandbox);
vm.runInContext(html.slice(recoveryStart,recoveryEnd),recoverySandbox);
const legacySnapshot={version:1,createdAt:'2026-11-20T10:00:00Z',database:{students:[],attendance:[],documents:[],violations:[],settings:{}}};
assert.ok(recoverySandbox.parseRecoverySnapshot(JSON.stringify(legacySnapshot)),'old undo snapshots remain readable without a follow-up collection');
const badSnapshot=JSON.parse(JSON.stringify(legacySnapshot));badSnapshot.database.followups='invalid';
assert.equal(recoverySandbox.parseRecoverySnapshot(JSON.stringify(badSnapshot)),null,'malformed follow-up data in an undo snapshot is rejected');

const auditStart=html.indexOf('const AUDIT_LOG_LIMIT=500;');
const auditEnd=html.indexOf('let auditBaselineJson=',auditStart);
assert.ok(auditStart>=0&&auditEnd>auditStart,'audit helpers include follow-up privacy rules');
const auditSandbox={};vm.createContext(auditSandbox);vm.runInContext(html.slice(auditStart,auditEnd),auditSandbox);
const before={students:[target],attendance:[],documents:[],violations:[],followups:[],agenda:[],settings:{}};
const after=JSON.parse(JSON.stringify(before));
after.followups.push({...records[0],id:'audit-followup'});
let sequence=0;
const audit=auditSandbox.buildAuditEvents(before,after,'2026-11-25T10:00:00.000Z',function(){sequence++;return 'audit-'+sequence;});
const followupEvent=audit.find(x=>x.entity==='followups'&&x.action==='add');
assert.ok(followupEvent,'adding a follow-up creates an audit entry');
assert.ok(followupEvent.changes.some(x=>x.key==='status'),'safe follow-up status is visible in audit metadata');
assert.ok(followupEvent.restrictedFields.includes('مضمون الملاحظة التربوية'),'observation content is redacted from the audit log');
assert.ok(followupEvent.restrictedFields.includes('الإجراء التربوي المتخذ'),'action content is redacted from the audit log');
assert.ok(followupEvent.restrictedFields.includes('نتيجة المتابعة'),'result content is redacted from the audit log');
const auditText=JSON.stringify(audit);
for(const privateValue of ['تكرر غياب التلميذ خلال الأسبوع','تم التواصل مع الولي وتوجيه تنبيه','تحسن الالتزام بالحضور بعد التواصل الأولي','student-1']){
 assert.ok(!auditText.includes(privateValue),'audit history must not expose private follow-up content or student identifiers: '+privateValue);
}

assert.ok(html.includes('id="studentFollowupForm"')&&html.includes('name="observation"')&&html.includes('name="actionTaken"'),'student profile provides a structured follow-up form');
assert.ok(html.includes('name="nextDate"')&&html.includes('name="status"'),'follow-up form includes next-review date and status');
assert.ok(html.includes('window.saveStudentFollowup=event=>')&&html.includes('window.deleteStudentFollowup=')&&html.includes('window.editStudentFollowup='),'follow-up form has wired create, edit, and delete actions');
assert.ok(html.includes("if(licenseReadOnly){alert('وضع القراءة فقط: لا يمكن حفظ المتابعة قبل تجديد الترخيص.')")&&html.includes("if(licenseReadOnly)followupForm.querySelectorAll('input,select,textarea,button')"),'follow-up controls respect license read-only mode');
assert.ok(html.includes('<option value="followups">المتابعات التربوية</option>'),'timeline filter includes follow-ups');
assert.ok(html.includes('<option value="followups">المتابعات التربوية</option>')&&html.includes('id="auditEntityFilter"'),'audit filter also includes follow-up records');
assert.ok(html.includes('followups:Array.isArray(pendingBackupData.followups)?pendingBackupData.followups:(Array.isArray(oldDb.followups)?oldDb.followups.slice():[])'),'legacy backup restore preserves current follow-ups instead of erasing them');
assert.ok(html.includes('db.followups=Array.isArray(data.followups)?data.followups:(Array.isArray(oldDb.followups)?oldDb.followups.slice():[])'),'undoing a legacy snapshot preserves current follow-ups');
assert.ok(html.includes('followups:followupsMissingInBackup?(Array.isArray(db.followups)?db.followups.slice():[]):obj.followups'),'legacy backup import retains existing follow-ups');
assert.ok(html.includes('followupRecoveryNote')&&html.includes('المتابعات الموجودة حالياً على الهاتف'),'backup preview explains preservation of current follow-ups');
assert.ok(html.includes('for(const kind of [\'attendance\',\'documents\',\'violations\',\'followups\'])'),'old student recovery can consider follow-up-linked student names');
assert.ok(html.includes('for(const record of (Array.isArray(data[kind])?data[kind]:[])){'),'old backups without the optional follow-up list remain importable');
const recoveryStudentsStart=html.indexOf('function recoverStudentsFromHistory(data){');
const recoveryStudentsEnd=html.indexOf('async function importBackupText',recoveryStudentsStart);
assert.ok(recoveryStudentsStart>=0&&recoveryStudentsEnd>recoveryStudentsStart,'student recovery function can be isolated for legacy backup tests');
const recoveryStudentsSandbox={normalizeStudentKey:value=>String(value??'').trim().toLowerCase().replace(/\\s+/g,' '),makeStudentImportId:()=> 'generated-student-id'};
vm.createContext(recoveryStudentsSandbox);
vm.runInContext(html.slice(recoveryStudentsStart,recoveryStudentsEnd),recoveryStudentsSandbox);
const oldBackupHistory={students:[target],attendance:[],documents:[],violations:[]};
assert.equal(recoveryStudentsSandbox.recoverStudentsFromHistory(oldBackupHistory).recoveredCount,0,'legacy backup without followups is handled without throwing or changing student count');
const followupOnlyHistory={students:[],attendance:[],documents:[],violations:[],followups:[{id:'old-followup',student:'old-student-id',studentName:'وائل عيسو',class:'1'}]};
const recoveredFollowup=recoveryStudentsSandbox.recoverStudentsFromHistory(followupOnlyHistory);
assert.equal(recoveredFollowup.recoveredCount,1,'student names can be recovered safely from follow-up records when necessary');
assert.equal(recoveredFollowup.students[0].id,'old-student-id','follow-up-linked student identity remains stable');
assert.ok(html.includes("for(const collection of ['students','attendance','documents','violations','followups','agenda']){"),'audit snapshot and audit event logic include follow-ups');

console.log('PASS: follow-up validation, student identity and section safety, timeline/report inclusion, audit redaction, legacy database/backup/undo compatibility, and profile UI wiring.');
