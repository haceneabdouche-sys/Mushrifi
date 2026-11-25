const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');

// Calendar and event aggregation helpers are pure and independently testable.
const agendaStart=html.indexOf('function agendaValidDate(v){');
const agendaEnd=html.indexOf('let agendaCurrentView=',agendaStart);
assert.ok(agendaStart>=0&&agendaEnd>agendaStart,'agenda date and aggregation helpers exist before UI state');
const agendaSandbox={Date,String};
vm.createContext(agendaSandbox);
vm.runInContext(html.slice(agendaStart,agendaEnd),agendaSandbox);

assert.equal(agendaSandbox.agendaValidDate('2026-11-25'),true,'valid ISO date is accepted');
assert.equal(agendaSandbox.agendaValidDate('2024-02-29'),true,'leap day is accepted');
assert.equal(agendaSandbox.agendaValidDate('2026-02-29'),false,'non-leap February 29 is rejected');
assert.equal(agendaSandbox.agendaValidDate('2026-04-31'),false,'impossible month dates are rejected');
assert.equal(agendaSandbox.agendaValidDate('bad-date'),false,'non-ISO dates are rejected');
assert.equal(agendaSandbox.agendaValidDate('0001-01-01'),true,'early valid Gregorian dates are not broken by JavaScript 0-99 year parsing');
assert.equal(agendaSandbox.agendaShiftDate('2026-12-31',1),'2027-01-01','date shifting crosses year boundaries safely');
assert.equal(agendaSandbox.agendaShiftDate('2024-02-28',1),'2024-02-29','date shifting respects leap years');
assert.equal(agendaSandbox.agendaShiftDate('bad-date',1),'','invalid input is not shifted');
assert.equal(agendaSandbox.agendaWeekStart('2026-11-25'),'2026-11-22','week starts on Sunday for local school-week layout');
assert.deepEqual(
 JSON.parse(JSON.stringify(agendaSandbox.agendaDateRange('week','2026-11-25'))),
 {from:'2026-11-22',to:'2026-11-28'},
 'weekly range includes seven calendar days'
);
assert.deepEqual(
 JSON.parse(JSON.stringify(agendaSandbox.agendaDateRange('day','2026-11-25'))),
 {from:'2026-11-25',to:'2026-11-25'},
 'daily range contains only the selected date'
);
const monthGrid=agendaSandbox.agendaMonthGrid('2026-11-25');
assert.equal(monthGrid.start,'2026-11-01','month grid starts at the calendar Sunday on or before the first day');
assert.equal(monthGrid.end,'2026-12-12','month grid spans six complete calendar weeks');
assert.equal(monthGrid.month,'2026-11','month identity remains separate from adjacent grid days');
assert.equal(agendaSandbox.agendaDateRange('bad','2026-11-25'),null,'unknown view cannot produce a range');

const student={id:'st-1',last:'عيسو',first:'وائل',class:'1'};
const resolve=id=>String(id)==='st-1'?student:null;
const manual=[
 {id:'ag-1',title:'اجتماع مجلس التربية',type:'meeting',date:'2026-11-24',startTime:'09:00',endTime:'10:30',location:'قاعة الاجتماعات',priority:'high',status:'planned',studentId:''},
 {id:'ag-2',title:'تحضير تقرير المتابعة',type:'task',date:'2026-11-26',startTime:'',endTime:'',priority:'normal',status:'done',notes:'ملاحظة محلية'},
 {id:'ag-3',title:'موعد خارج الفترة',type:'followup',date:'2026-12-02'},
 {id:'bad-date',title:'تاريخ غير صالح',type:'task',date:'2026-02-31'},
 {id:'',title:'دون معرّف',type:'task',date:'2026-11-25'},
 {id:'ag-1',title:'نسخة مكررة بالمعرّف',type:'meeting',date:'2026-11-24',startTime:'09:00'}
];
const documents=[
 {id:'doc-1',student:'st-1',studentName:'وائل عيسو',type:'استدعاء ولي',appointment:'2026-11-25T11:00',reason:'مراجعة الغياب'},
 {id:'doc-1',student:'st-1',type:'استدعاء ولي',appointment:'2026-11-25T11:00'},
 {id:'doc-other',type:'إشعار غياب',appointment:'2026-11-25T12:00'},
 {id:'doc-bad',type:'استدعاء ولي',appointment:'2026-02-31T09:00'}
];
const documentsOriginal=JSON.stringify(documents);
const snap=agendaSandbox.buildAgendaSnapshot(manual,documents,'2026-11-24','2026-11-26',resolve);
assert.equal(snap.valid,true,'valid selected range is accepted');
assert.equal(snap.manualCount,2,'only valid manual appointments in range are counted');
assert.equal(snap.summonsCount,1,'guardian summons are included from documents exactly once');
assert.equal(snap.invalidManual,3,'invalid manual dates, missing IDs and duplicate IDs are flagged');
assert.equal(snap.invalidSummons,1,'summons with invalid dates are flagged without being copied');
assert.deepEqual(
 JSON.parse(JSON.stringify(snap.items.map(x=>({id:x.id,date:x.date,type:x.type,source:x.source})))),
 [
  {id:'ag-1',date:'2026-11-24',type:'meeting',source:'manual'},
  {id:'summons:doc-1',date:'2026-11-25',type:'summons',source:'summons'},
  {id:'ag-2',date:'2026-11-26',type:'task',source:'manual'}
 ],
 'manual tasks and summons are date/time sorted and invalid/out-of-range records are excluded'
);
assert.equal(snap.items[1].readOnly,true,'summons remain a read-only projection of the original document');
assert.equal(snap.items[1].student.id,'st-1','linked summons display the verified student only');
assert.equal(snap.items[1].title,'حضور ولي: عيسو وائل','summons label resolves from the student record');
assert.equal(JSON.stringify(documents),documentsOriginal,'agenda view never mutates original document or summons records');
const invalidRange=agendaSandbox.buildAgendaSnapshot(manual,documents,'2026-11-30','2026-11-01',resolve);
assert.equal(invalidRange.valid,false,'reversed range is rejected');

// Legacy database migration adds an empty agenda without overwriting existing records.
const dbStart=html.indexOf('function parseMushrifiDatabase(raw){');
const dbEnd=html.indexOf('\nlet db;',dbStart);
assert.ok(dbStart>=0&&dbEnd>dbStart,'database parser exists');
const dbSandbox={JSON,Array,Object,Error};
vm.createContext(dbSandbox);
vm.runInContext(html.slice(dbStart,dbEnd),dbSandbox);
const oldDatabase={students:[{id:'keep-me'}],attendance:[{id:'a'}],documents:[{id:'d'}],violations:[{id:'v'}],settings:{school:'ثانوية'}};
const migrated=dbSandbox.parseMushrifiDatabase(JSON.stringify(oldDatabase));
assert.deepEqual(JSON.parse(JSON.stringify(migrated.agenda)),[],'older installations get an empty agenda on migration');
assert.equal(migrated.students[0].id,'keep-me','migration preserves student entries');
assert.equal(migrated.attendance[0].id,'a','migration preserves attendance entries');
const agendaDatabase={...oldDatabase,agenda:[{id:'ag-keep',title:'اجتماع',date:'2026-11-25'}]};
assert.equal(dbSandbox.parseMushrifiDatabase(JSON.stringify(agendaDatabase)).agenda[0].id,'ag-keep','valid saved agenda entries survive app restart');
assert.throws(()=>dbSandbox.parseMushrifiDatabase(JSON.stringify({...oldDatabase,agenda:{bad:true}})),/agenda|أجندة|حقل/,'a damaged agenda list is rejected instead of being silently replaced');
assert.throws(()=>dbSandbox.parseMushrifiDatabase(JSON.stringify({...oldDatabase,agenda:[null]})),/أجندة/,'an invalid agenda item is rejected by the database corruption guard');

// Agenda items are part of transactional audit history, with their private notes redacted.
const auditStart=html.indexOf('const AUDIT_LOG_LIMIT=500;');
const auditEnd=html.indexOf('let auditBaselineJson=',auditStart);
assert.ok(auditStart>=0&&auditEnd>auditStart,'audit helpers can be independently loaded');
const auditSandbox={};
vm.createContext(auditSandbox);
vm.runInContext(html.slice(auditStart,auditEnd),auditSandbox);
const before={students:[],attendance:[],documents:[],violations:[],agenda:[{id:'ag-1',title:'اجتماع قديم',type:'meeting',date:'2026-11-24',startTime:'09:00',endTime:'10:00',location:'المكتب',priority:'normal',status:'planned',notes:'ملاحظة سرية',studentId:'stu-private'}],settings:{}};
const after=JSON.parse(JSON.stringify(before));
after.agenda[0].title='اجتماع معدل';after.agenda[0].date='2026-11-26';after.agenda[0].status='done';after.agenda[0].notes='محتوى خاص جديد';after.agenda[0].studentId='stu-private-2';
after.agenda.push({id:'ag-2',title:'مهمة جديدة',type:'task',date:'2026-11-27',status:'planned',notes:'ملاحظة خاصة'});
let seq=0;
const events=auditSandbox.buildAuditEvents(before,after,'2026-11-25T10:00:00.000Z',()=>('agenda-'+(++seq)));
const update=events.find(x=>x.entity==='agenda'&&x.entityId==='ag-1'&&x.action==='update');
const add=events.find(x=>x.entity==='agenda'&&x.entityId==='ag-2'&&x.action==='add');
assert.ok(update,'agenda update creates an audit event');
assert.ok(add,'agenda creation creates an audit event');
assert.ok(update.changes.some(x=>x.key==='title'&&x.before==='اجتماع قديم'&&x.after==='اجتماع معدل'),'agenda title stores previous and new values');
assert.ok(update.changes.some(x=>x.key==='date'&&x.before==='2026-11-24'&&x.after==='2026-11-26'),'agenda date changes are auditable');
assert.ok(update.restrictedFields.includes('ملاحظات الأجندة'),'private agenda notes are redacted but their change is recorded');
assert.ok(update.restrictedFields.includes('ارتباط الموعد بملف التلميذ'),'changed student linkage is redacted rather than copied into the audit event');
for(const privateValue of ['ملاحظة سرية','محتوى خاص جديد','stu-private','ملاحظة خاصة'])assert.ok(!JSON.stringify(events).includes(privateValue),'private agenda value is absent from audit event: '+privateValue);
const rollbackRecord={...after.agenda[0]};
assert.equal(auditSandbox.auditCanRevert(update,rollbackRecord),true,'safe agenda edits can be reverted if no later change was made');
assert.equal(auditSandbox.auditApplyRevert(update,rollbackRecord),true,'guarded agenda rollback succeeds');
assert.equal(rollbackRecord.title,'اجتماع قديم','agenda title rollback returns to prior value');
assert.equal(rollbackRecord.date,'2026-11-24','agenda date rollback returns to prior value');
assert.equal(rollbackRecord.notes,'محتوى خاص جديد','rollback does not change redacted private notes');
assert.equal(auditSandbox.auditCanRevert(update,{...after.agenda[0],title:'تعديل أحدث'}),false,'agenda rollback refuses to overwrite an intervening change');
assert.equal(auditSandbox.auditCanRevert(add,{id:'ag-2'}),false,'adding an agenda item does not expose an unsafe delete rollback');

// Integration, navigation, backup compatibility and mobile view assertions.
for(const id of ['agendaStoredCount','agendaTodayCount','agendaWeekCount','agendaOpenCount','agendaDoneCount','agendaPrev','agendaNext','agendaToday','agendaSelectedDate','agendaTypeFilter','agendaAdd','agendaCalendar','agendaSelectedItems','agendaForm','agendaTitle','agendaDate','agendaStartTime','agendaEndTime','agendaStudent','agendaPriority','agendaNotes','agendaCancel','agendaCancelBottom']){
 const count=(html.match(new RegExp('id="'+id+'"','g'))||[]).length;
 assert.equal(count,1,'agenda control ID must be unique: '+id);
}
assert.ok(html.includes('<section id="agenda" class="page hidden">'),'agenda is a dedicated page');
assert.ok(html.includes('data-go="agenda"')&&html.includes("['violations','reports','settings','audit','agenda'].includes(page)"),'agenda is accessible from More and bottom-nav state stays aligned');
assert.ok(html.includes('data-agenda-view="day"')&&html.includes('data-agenda-view="week"')&&html.includes('data-agenda-view="month"'),'day, week and month view selectors are present');
assert.ok(html.includes('function renderAgenda()')&&html.includes("if(activePage==='agenda')renderAgenda();"),'agenda refreshes when opened or data is saved');
assert.ok(html.includes("renderAgendaHome(today);")&&html.includes('id="upcomingAgenda"'),'upcoming agenda items are surfaced on the home dashboard');
assert.ok(html.includes("function openAgendaSummons(id)")&&html.includes("go('documents')"),'summons in agenda open their original document rather than a duplicate record');
assert.ok(html.includes("||endTime&&!/^(?:[01]\\d|2[0-3]):[0-5]\\d$/.test(endTime)")&&html.includes('endTime<=startTime'),'invalid or reversed appointment times are rejected');
assert.ok(html.includes("db.agenda.push({id:crypto.randomUUID()")&&html.includes("db.agenda.splice(index,0,item)"),'agenda CRUD uses saved records and restores in-memory data when a save fails');
assert.ok(html.includes('agenda:Array.isArray(data.agenda)?data.agenda:')&&html.includes('agendaMissingInBackup'),'older backup files without an agenda do not erase current phone appointments');
assert.ok(html.includes('if(data.agenda!==undefined&&(!Array.isArray(data.agenda)'),'backup and recovery readers validate agenda structure when present');
assert.ok(html.includes('agenda:[[')&&html.includes("'agenda'")&&html.includes('AUDIT_ENTITY_LABELS={'),'agenda is included in the audit log model');
assert.ok(html.includes('agenda-read-only-control'),'calendar navigation remains available in license read-only mode');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
assert.equal(ids.filter(x=>x==='agendaForm').length,1,'agenda form remains unique');
assert.equal((html.match(/function initAgendaControls\(\)/g)||[]).length,1,'agenda control listeners are installed only once');

console.log('PASS: agenda calendar date safety, leap years, week/month ranges, manual task sorting, unique IDs, read-only summons projection, student linkage, legacy database migration, audit logging, guarded rollback, old backup continuity, and mobile navigation.');
