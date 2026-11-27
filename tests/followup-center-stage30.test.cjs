
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const gradle=fs.readFileSync('android/app/build.gradle','utf8');
const workflow=fs.readFileSync('.github/workflows/build-apk.yml','utf8');
const start=html.indexOf('function followupCenterValidDate(');
const end=html.indexOf('function ensureFollowupCenterDates(',start);
assert.ok(start>=0&&end>start,'Stage 30 aggregation helpers exist before the renderer');
const sandbox={
 profileRecordBelongsToStudent(record,target,students){
  const id=String(record.student??'').trim();
  if(id&&students.some(item=>String(item.id)===id))return id===String(target.id);
  const stored=String(record.studentName||id).trim().replace(/\s+/g,' ');
  const full=[target.last||'',target.first||''].join(' ').trim().replace(/\s+/g,' ');
  if(!stored||stored!==full)return false;
  const section=String(record.class||record.studentClass||record.section||'').trim();
  if(section)return section===String(target.class||'');
  return students.filter(item=>[item.last||'',item.first||''].join(' ').trim().replace(/\s+/g,' ')===full).length===1;
 },
 attendanceGroupLabel:student=>[student.schoolYear,student.branch,student.class].filter(Boolean).join(' — ')
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end)+'\nthis.__test={followupCenterValidDate,buildFollowupCenterSnapshot};',sandbox);
const {followupCenterValidDate,buildFollowupCenterSnapshot}=sandbox.__test;
assert.equal(followupCenterValidDate('2026-11-27'),true);
assert.equal(followupCenterValidDate('2026-02-30'),false);
assert.equal(followupCenterValidDate('27-11-2026'),false);
const student={id:'s1',last:'وائل',first:'عيسو',class:'1',schoolYear:'أولى',branch:'متوسط'};
const sameNameOtherSection={id:'s2',last:'وائل',first:'عيسو',class:'2',schoolYear:'أولى',branch:'متوسط'};
const database={
 students:[student,sameNameOtherSection],
 attendance:[
  {id:'a1',student:'s1',date:'2026-11-27',type:'غياب',justified:'غير مبرر',period:'صباحية'},
  {id:'a1',student:'s1',date:'2026-11-27',type:'غياب',justified:'غير مبرر',period:'صباحية'},
  {id:'a2',student:'وائل عيسو',studentName:'وائل عيسو',class:'',date:'2026-11-26',type:'تأخر',justified:'قيد التبرير'}
 ],
 violations:[{id:'v1',student:'s1',date:'2026-11-25',type:'سلوك',description:'PRIVATE_VIOLATION_TEXT'}],
 documents:[{id:'d1',student:'s1',date:'2026-11-24',type:'إشعار غياب',absenceStage:4,deliveryDate:'2026-11-25',deliveryProof:'PRIVATE_DELIVERY_PROOF',guardianResponseStatus:'غير مسجل',guardianResponseNotes:'PRIVATE_GUARDIAN_NOTE'}],
 followups:[{id:'f1',student:'s1',date:'2026-11-22',category:'المواظبة والحضور',status:'قيد المتابعة',nextDate:'2026-11-26',observation:'PRIVATE_FOLLOWUP_NOTE',actionTaken:'PRIVATE_FOLLOWUP_ACTION'}],
 guardianReceptions:[{id:'r1',student:'s1',date:'2026-11-23',purpose:'متابعة المواظبة والحضور',status:'يحتاج متابعة',nextDate:'2026-11-27',actionTaken:'PRIVATE_RECEPTION_ACTION'},{id:'r2',student:'s1',date:'2026-11-22',purpose:'متابعة المواظبة والحضور',status:'يحتاج متابعة',nextDate:'2026-11-26',actionTaken:'PRIVATE_RECEPTION_ACTION_2'}],
 supervisionLogs:[{id:'sl1',date:'2026-11-27',type:'الإشراف أثناء الاستراحة',section:'1 متوسط',period:'صباحية',notes:'PRIVATE_SUPERVISION_NOTE',actionTaken:'PRIVATE_SUPERVISION_ACTION'}]
};
const before=JSON.stringify(database);
const snapshot=buildFollowupCenterSnapshot(database,{from:'2026-11-22',to:'2026-11-27'},'2026-11-27');
assert.equal(snapshot.valid,true);
assert.equal(snapshot.total,8,'duplicate IDs within the same source collection are not double-counted');
assert.ok(snapshot.events.some(x=>x.source==='attendance'&&x.recordId==='a1'&&x.studentId==='s1'));
assert.ok(snapshot.events.some(x=>x.source==='documents'&&x.statusKey==='open'&&x.statusLabel.includes('رد الولي غير مسجل')));
assert.ok(snapshot.events.some(x=>x.source==='followups'&&x.dueDate==='2026-11-26'));
assert.ok(snapshot.events.some(x=>x.source==='guardianReceptions'&&x.statusKey==='open'));
assert.ok(snapshot.events.some(x=>x.source==='supervisionLogs'&&x.studentId===''));
assert.equal(snapshot.summary.overdue,2,'overdue follow-up and reception appointments are separately counted');
assert.equal(snapshot.summary.dueToday,1,'today reception review is counted');
const serialized=JSON.stringify(snapshot.events);
for(const secret of ['PRIVATE_VIOLATION_TEXT','PRIVATE_DELIVERY_PROOF','PRIVATE_GUARDIAN_NOTE','PRIVATE_FOLLOWUP_NOTE','PRIVATE_FOLLOWUP_ACTION','PRIVATE_RECEPTION_ACTION','PRIVATE_SUPERVISION_NOTE','PRIVATE_SUPERVISION_ACTION']){
 assert.ok(!serialized.includes(secret),'private record content must never be copied into the unified center: '+secret);
}
assert.ok(!serialized.includes('055'),'guardian contact details are never projected');
assert.equal(JSON.stringify(database),before,'read-only aggregation must not mutate any source collection');
const sectionFiltered=buildFollowupCenterSnapshot(database,{from:'2026-11-22',to:'2026-11-27',section:'أولى — متوسط — 1'},'2026-11-27');
assert.ok(sectionFiltered.events.length>=4,'verified student records can be filtered by their academic section');
const statusFiltered=buildFollowupCenterSnapshot(database,{from:'2026-11-22',to:'2026-11-27',status:'unlinked'},'2026-11-27');
assert.equal(statusFiltered.shown,1,'a same-name legacy record without an explicit section is kept unlinked when identity is ambiguous');
const sourceFiltered=buildFollowupCenterSnapshot(database,{from:'2026-11-22',to:'2026-11-27',source:'supervisionLogs'},'2026-11-27');
assert.equal(sourceFiltered.shown,1);
const inverted=buildFollowupCenterSnapshot(database,{from:'2026-11-27',to:'2026-11-22'},'2026-11-27');
assert.equal(inverted.valid,false,'an inverted date range is rejected');
assert.match(html,/id="followupCenter" class="page hidden"/);
assert.match(html,/data-go="followupCenter"/);
assert.match(html,/function renderFollowupCenter\(\)/);
assert.match(html,/function printFollowupCenter\(\)/);
assert.ok(html.includes("$('#followupCenterPrint')?.addEventListener('click',()=>printFollowupCenter());"),'the print button invokes the dedicated print function only on user action');
assert.match(workflow,/node tests\/followup-center-stage30\.test\.cjs/);
assert.match(gradle,/versionCode 34[\s\S]*versionName '2\.6'/);
console.log('PASS Stage 30 unified follow-up center, filtering, identity safety, privacy redaction, no-mutation and print wiring.');
