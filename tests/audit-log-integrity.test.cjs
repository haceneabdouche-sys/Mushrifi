const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helperStart=html.indexOf('const AUDIT_LOG_LIMIT=500;');
const helperEnd=html.indexOf('let auditBaselineSnapshot=',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'audit helpers are defined before the transactional save function');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(html.slice(helperStart,helperEnd),sandbox);

const before={
 students:[{id:'stu-1',last:'عيسو',first:'وائل',class:'1',schoolYear:'أولى',branch:'متوسط',parentPhone:'0555000000',identityNumber:'PERSONAL-123'}],
 attendance:[{id:'att-1',student:'stu-1',studentName:'وائل عيسو',class:'1',date:'2026-11-20',type:'غياب',hours:2,justified:'غير مبرر',notes:'ملاحظة خاصة قبل'}],
 documents:[],
 violations:[{id:'viol-1',student:'stu-1',date:'2026-11-20',type:'سلوك',description:'تفاصيل خاصة لا يجب نسخها',action:'تنبيه'}],
 settings:{summonsReminderTime:'18:00',timetables:{}},
 auditLog:[{id:'old-log',summary:'سجل سابق'}]
};
const after=JSON.parse(JSON.stringify(before));
after.students[0].class='2';
after.students[0].parentPhone='0555999999';
after.students[0].identityNumber='PERSONAL-456';
after.students.push({id:'stu-2',last:'أحمد',first:'أمين',class:'3',schoolYear:'أولى',branch:'متوسط',phone:'0555111111'});
after.attendance[0].hours=4;
after.attendance[0].notes='ملاحظة خاصة بعد';
after.attendance.push({id:'att-2',student:'stu-1',studentName:'وائل عيسو',class:'2',date:'2026-11-21',type:'تأخر',minutes:10,justified:'غير مبرر',notes:'محتوى خاص'});
after.documents.push({id:'doc-2',student:'stu-1',date:'2026-11-22',type:'استدعاء ولي',appointment:'2026-11-25T09:00',reminderAt:'2026-11-24T09:00',reason:'سبب خاص وسري',photo:'data:image/jpeg;base64,PRIVATEIMAGE'});
after.violations=[];
after.settings.summonsReminderTime='19:00';

let sequence=0;
const events=sandbox.buildAuditEvents(before,after,'2026-11-25T09:15:00.000Z',()=>('event-'+(++sequence)));
const event=(entity,action)=>events.find(x=>x.entity===entity&&x.action===action);
assert.ok(event('students','update'),'student edits create an update event');
assert.ok(event('students','add'),'student creation creates an add event');
assert.ok(event('attendance','update'),'attendance edits create an update event');
assert.ok(event('attendance','add'),'attendance creation creates an add event');
assert.ok(event('documents','add'),'document creation creates an add event');
assert.ok(event('violations','delete'),'deleting a violation creates a delete event');
assert.ok(event('settings','update'),'settings changes create an event');

const serialized=JSON.stringify(events);
for(const privateValue of ['0555000000','0555999999','PERSONAL-123','PERSONAL-456','ملاحظة خاصة قبل','ملاحظة خاصة بعد','سبب خاص وسري','PRIVATEIMAGE','تفاصيل خاصة لا يجب نسخها']){
 assert.ok(!serialized.includes(privateValue),'sensitive value must not appear in the audit log: '+privateValue);
}
const studentUpdate=event('students','update');
assert.ok(studentUpdate.changes.some(x=>x.key==='class'&&x.before==='1'&&x.after==='2'),'safe student fields store before and after values');
assert.ok(studentUpdate.restrictedFields.includes('رقم هاتف الولي'),'guardian phone change is recorded only as a redacted field name');
assert.ok(studentUpdate.restrictedFields.includes('رقم التعريف'),'identity number is never copied into the audit log');

const attendanceUpdate=event('attendance','update');
assert.ok(attendanceUpdate.changes.some(x=>x.key==='hours'&&x.before===2&&x.after===4),'attendance duration edits retain safe before and after values');
assert.ok(attendanceUpdate.restrictedFields.includes('الملاحظات'),'private notes changes are recorded without content');
const documentAdd=event('documents','add');
assert.ok(documentAdd.restrictedFields.includes('موضوع الوثيقة وتفاصيلها'),'document reasons are redacted');
assert.ok(documentAdd.restrictedFields.includes('صورة الوثيقة'),'document photos are redacted');
const linkedRecordEvents=events.filter(x=>x.entity!=='students');
assert.ok(!JSON.stringify(linkedRecordEvents).includes('stu-1'),'student IDs are not copied into attendance, document, or violation history');

const revertable={id:'att-1',hours:4,justified:'غير مبرر',notes:'ملاحظة خاصة بعد'};
assert.equal(sandbox.auditCanRevert(attendanceUpdate,revertable),true,'a safe edit can be reverted while current values still match its recorded after values');
assert.equal(sandbox.auditApplyRevert(attendanceUpdate,revertable),true,'guarded rollback applies the previous safe fields');
assert.equal(revertable.hours,2,'rollback restores prior duration');
assert.equal(revertable.notes,'ملاحظة خاصة بعد','rollback never changes redacted private notes');
assert.equal(sandbox.auditCanRevert(attendanceUpdate,{id:'att-1',hours:9,justified:'غير مبرر'}),false,'rollback refuses to overwrite a record that has since changed');
assert.equal(sandbox.auditCanRevert(event('attendance','add'),{id:'att-2'}),false,'audit log does not offer unsafe deletion rollback for created records');

const bulkBefore={students:[],attendance:[],documents:[],violations:[],settings:{}};
const bulkAfter=JSON.parse(JSON.stringify(bulkBefore));
for(let i=0;i<20;i++)bulkAfter.students.push({id:'bulk-'+i,last:'اسم خاص '+i,first:'تلميذ',class:'1'});
const bulk=sandbox.buildAuditEvents(bulkBefore,bulkAfter,'2026-11-25T10:00:00.000Z',()=>('bulk-'+(++sequence)));
assert.equal(bulk.length,1,'large imports are grouped into one operation instead of flooding the history');
assert.equal(bulk[0].action,'bulk','bulk import is clearly identified');
assert.equal(bulk[0].totals.added,20,'bulk summary retains the added-record count');
assert.ok(!JSON.stringify(bulk).includes('اسم خاص'),'bulk history does not copy every imported student name');

const privateOnly=sandbox.buildAuditEvents(
 {students:[{id:'s',last:'لقب',first:'اسم',parentPhone:'111'}]},
 {students:[{id:'s',last:'لقب',first:'اسم',parentPhone:'222'}]},
 '2026-11-25T11:00:00.000Z',()=>('private-'+(++sequence))
)[0];
assert.equal(privateOnly.changes.length,0,'private-only changes do not store values');
assert.ok(privateOnly.restrictedFields.includes('رقم هاتف الولي'),'private-only changes still leave an audit trace');
assert.equal(sandbox.auditCanRevert(privateOnly,{id:'s',parentPhone:'222'}),false,'private-only edits cannot be reverted from redacted data');

const baseline=sandbox.auditComparableDatabase({...after,auditLog:[{id:'new'}]});
assert.equal(Object.prototype.hasOwnProperty.call(baseline,'auditLog'),false,'audit history is excluded from change comparison to avoid self-logging');
const compactText=JSON.stringify(sandbox.auditComparableDatabase(after));
for(const privateValue of ['0555000000','0555999999','PERSONAL-123','PERSONAL-456','ملاحظة خاصة قبل','ملاحظة خاصة بعد','سبب خاص وسري','PRIVATEIMAGE']){
 assert.ok(!compactText.includes(privateValue),'the in-memory comparison baseline stores fingerprints, not private values: '+privateValue);
}
assert.ok(compactText.includes('__auditFingerprint'),'private values are represented by compact change fingerprints');

const settingsBefore={
 students:[],attendance:[],documents:[],violations:[],
 settings:{school:'ثانوية الشيخ بوعمامة',location:'بوسكن',summonsReminderTime:'18:00',timetables:{'1':{sun:6}},internalToken:'DO-NOT-EXPORT-SETTING'}
};
const settingsAfter=JSON.parse(JSON.stringify(settingsBefore));
settingsAfter.settings.school='ثانوية جديدة';
settingsAfter.settings.location='المدية';
settingsAfter.settings.summonsReminderTime='19:30';
settingsAfter.settings.timetables['1'].sun=5;
settingsAfter.settings.internalToken='NEW-PRIVATE-SETTING';
const settingsBaseline=sandbox.auditComparableDatabase(settingsBefore);
assert.equal(settingsBaseline.settings.school,'ثانوية الشيخ بوعمامة','institution name is retained as a safe searchable setting value');
assert.equal(settingsBaseline.settings.location,'بوسكن','school location is retained as a safe setting value');
assert.equal(settingsBaseline.settings.summonsReminderTime,'18:00','reminder time is retained as a safe setting value');
assert.ok(!JSON.stringify(settingsBaseline).includes('sun'),'timetable details remain fingerprinted rather than copied into the audit baseline');
assert.ok(!JSON.stringify(settingsBaseline).includes('DO-NOT-EXPORT-SETTING'),'unknown/private setting values remain fingerprinted');
const settingsEvents=sandbox.buildAuditEvents(settingsBaseline,settingsAfter,'2026-11-25T12:00:00.000Z',()=>('settings-'+(++sequence)));
const settingsEvent=settingsEvents.find(x=>x.entity==='settings');
assert.ok(settingsEvent,'settings changes generate a dedicated event');
const schoolChange=settingsEvent.changes.find(x=>x.key==='school');
const locationChange=settingsEvent.changes.find(x=>x.key==='location');
const reminderChange=settingsEvent.changes.find(x=>x.key==='summonsReminderTime');
assert.deepEqual(
 [schoolChange.before,schoolChange.after,locationChange.before,locationChange.after,reminderChange.before,reminderChange.after],
 ['ثانوية الشيخ بوعمامة','ثانوية جديدة','بوسكن','المدية','18:00','19:30'],
 'approved scalar settings expose precise old and new values'
);
assert.ok(settingsEvent.changes.find(x=>x.key==='timetables').before==='قيمة محفوظة','complex timetable change reveals no timetable content');
const settingsEventJson=JSON.stringify(settingsEvents);
for(const privateSetting of ['DO-NOT-EXPORT-SETTING','NEW-PRIVATE-SETTING','sun']){
 assert.ok(!settingsEventJson.includes(privateSetting),'private or complex settings are never exposed in audit events: '+privateSetting);
}
const safeSettings={...settingsAfter.settings};
assert.equal(sandbox.auditCanRevertSettings(
 {entity:'settings',action:'update',changes:[
  {key:'school',after:'ثانوية جديدة',before:'ثانوية الشيخ بوعمامة'},
  {key:'location',after:'المدية',before:'بوسكن'},
  {key:'summonsReminderTime',after:'19:30',before:'18:00'}
 ]},safeSettings),true,'approved scalar settings can be restored while their latest values remain unchanged');
const safeSettingsEntry={entity:'settings',action:'update',changes:[
 {key:'school',after:'ثانوية جديدة',before:'ثانوية الشيخ بوعمامة'},
 {key:'location',after:'المدية',before:'بوسكن'},
 {key:'summonsReminderTime',after:'19:30',before:'18:00'}
]};
assert.equal(sandbox.auditApplyRevertSettings(safeSettingsEntry,safeSettings),true,'guarded settings rollback applies only approved scalar fields');
assert.equal(safeSettings.school,'ثانوية الشيخ بوعمامة','settings rollback restores the previous institution name');
assert.equal(safeSettings.location,'بوسكن','settings rollback restores the previous school location');
assert.equal(safeSettings.summonsReminderTime,'18:00','settings rollback restores the previous reminder time');
assert.equal(sandbox.auditCanRevertSettings(safeSettingsEntry,{...settingsAfter.settings,school:'تم تغييرها لاحقاً'}),false,'settings rollback refuses to overwrite a newer unrelated change');
assert.equal(sandbox.auditCanRevertSettings({entity:'settings',action:'update',changes:[{key:'timetables',before:{},after:{}}]},settingsAfter.settings),false,'complex timetable settings are never auto-restored from the audit log');

const displaySource=html.slice(html.indexOf('function auditEntriesForDisplay(entries){'),html.indexOf('function renderAuditLog(){'));
const displaySandbox={};vm.createContext(displaySandbox);vm.runInContext(displaySource,displaySandbox);
const mixedEntries=[
 {id:'old-compatible',summary:'سجل قديم'},
 {id:'safe',changes:[{key:'school',before:'أ',after:'ب'}],restrictedFields:[],totals:{added:1}},
 {id:'bad-changes',changes:'not-an-array'},
 {id:'bad-restricted',restrictedFields:{secret:true}},
 {id:'bad-totals',totals:[]},
 null,[],42
];
const visible=displaySandbox.auditEntriesForDisplay(mixedEntries);
assert.deepEqual(JSON.parse(JSON.stringify(visible.map(x=>x.id))),['old-compatible','safe'],'malformed imported history is excluded from display without deleting valid or older compatible entries');


assert.ok(html.includes("const AUDIT_LOG_LIMIT=500;"),'audit history is capped to a bounded size');
assert.ok(html.includes("previousAuditLog.concat(newEntries).slice(-AUDIT_LOG_LIMIT)"),'only the most recent audit entries are retained');
assert.ok(html.includes("db.auditLog=previousAuditLog;"),'a failed database save discards the uncommitted audit event');
assert.ok(html.includes("auditBaselineSnapshot=auditComparableDatabase(db,{retainLargeAttachments:true});"),'the private in-memory audit baseline retains image references rather than re-hashing unchanged photo data');
assert.ok(html.includes('auditBaselineSnapshot=nextAuditSnapshot;'),'the audit baseline moves only after the database save succeeds');
assert.ok(html.includes('precomputedSnapshots:true,afterSnapshot:nextAuditSnapshot'),'each save projects the audit view once and reuses it during comparison');
assert.ok(html.includes('id="audit" class="page hidden"'),'a dedicated audit history page exists');
assert.ok(html.includes('id="auditSearch"')&&html.includes('id="auditEntityFilter"')&&html.includes('id="auditActionFilter"'),'audit history supports search and category filters');
assert.ok(html.includes('AUDIT_SAFE_SETTING_FIELDS')&&html.includes('summonsReminderTime'),'audit history stores readable values only for approved non-sensitive scalar settings');
assert.ok(html.includes('function auditCanRevertSettings')&&html.includes('auditApplyRevertSettings(entry,record)'),'safe scalar settings have concurrency-guarded rollback');
assert.ok(html.includes('function auditEntriesForDisplay(entries)')&&html.includes('تم تجاهل عرض'),'malformed imported audit records cannot crash the history page and remain stored');
assert.ok(html.includes('...searchableChanges'),'search includes safe old and new values to find a field update');
assert.ok(html.includes('entry.revertsId?all.find'),'reverted operations link back to the original audit entry');
assert.ok(html.includes("filtered.length>120?'عرض أحدث 120 من '"),'audit page clearly indicates when the visible result list is capped');
assert.ok(html.includes('التصدير فيشمل جميع العمليات المحتفظ بها'),'audit export is documented as including the full retained history');
assert.ok(html.includes("list.querySelectorAll('[data-audit-revert]')"),'revert actions are wired to guarded rollback');
assert.ok(html.includes("const retainedAudit=Array.isArray(oldDb.auditLog)&&oldDb.auditLog.length?oldDb.auditLog:importedAudit"),'backup restore preserves local audit history or imports history when local history is empty');
assert.ok(html.includes("db={...data,agenda:Array.isArray(data.agenda)?data.agenda:(Array.isArray(oldDb.agenda)?oldDb.agenda.slice():[]),auditLog:Array.isArray(oldDb.auditLog)?oldDb.auditLog.slice():[]}"),'undo recovery preserves current agenda entries when restoring an older snapshot and retains the current audit history');
assert.ok(html.includes("if(obj.auditLog!==undefined&&(!Array.isArray(obj.auditLog)"),'backup import validates the optional audit log before replacing data');
assert.ok(html.includes("const allowed=new Set(['exportData','exportAuditLog'"),'audit export remains available in read-only mode');

console.log('PASS: audit creation, update, deletion, bulk import, sensitive-field redaction, safe guarded rollback, bounded history, failed-save safety, and restore continuity.');

