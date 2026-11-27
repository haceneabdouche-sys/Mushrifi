const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function normalizeProfileStudentName(value){');
const end=html.indexOf('function profileKnownAbsenceHours',start);
assert.ok(start>=0&&end>start,'profile identity and record index helpers exist');
const sandbox={attendanceGroupLabel:s=>[s.schoolYear||'',s.branch||'',s.class||''].filter(Boolean).join(' — ')};
vm.createContext(sandbox);vm.runInContext(html.slice(start,end),sandbox);
const one={id:'s-1',last:'وائل',first:'عيسو',class:'١',schoolYear:'أولى',branch:'متوسط'};
const duplicate={id:'s-2',last:'وائل',first:'عيسو',class:'٢',schoolYear:'أولى',branch:'متوسط'};
const unrelated={id:'s-3',last:'تلميذ',first:'آخر',class:'1',schoolYear:'أولى',branch:'متوسط'};
const database={
 students:[one,duplicate,unrelated],
 attendance:[
  {id:'a1',student:'s-1',date:'2026-11-01',type:'غياب'},
  {id:'a2',student:'old-uuid-a',studentName:'وائل عيسو1',class:'1',date:'2026-11-02',type:'غياب'},
  {id:'a3',student:'وائل عيسو ١',class:'١',date:'2026-11-03',type:'تأخر'},
  {id:'a4',student:'s-2',studentName:'وائل عيسو',class:'1',date:'2026-11-04',type:'غياب'},
  {id:'a5',student:'old-uuid-no-section',studentName:'وائل عيسو',date:'2026-11-05',type:'غياب'},
  {id:'a6',student:'وائل عيسو',class:'قسم آخر',date:'2026-11-06',type:'غياب'},
  {id:'a7',student:'s-3',date:'2026-11-07',type:'غياب'},
  {id:'a8',student:'',studentName:'وائل عيسو1',class:'١',date:'2026-11-08',type:'غياب'}
 ],
 violations:[{id:'v1',student:'s-1',date:'2026-11-04'},{id:'v2',student:'old-v',studentName:'وائل عيسو',class:'1'},{id:'v3',student:'s-2'}],
 documents:[{id:'d1',student:'s-1',date:'2026-11-06'},{id:'d2',student:'old-d',studentName:'وائل عيسو1',studentClass:'١'},{id:'d3',student:'s-2'}],
 followups:[{id:'f1',student:'s-1'},{id:'f2',student:'old-f',studentName:'وائل عيسو',sectionLabel:'1'},{id:'f3',student:'s-2'}]
};
const ids=items=>items.map(record=>record.id);
const brute=(target,collection)=>database[collection].filter(record=>sandbox.profileRecordBelongsToStudent(record,target,database.students));
for(const target of database.students){
 const indexed=sandbox.getStudentProfileRecords(target,database);
 for(const collection of ['attendance','violations','documents','followups'])
  assert.deepEqual(ids(indexed[collection]),ids(brute(target,collection)),'indexed '+collection+' preserves existing matching for '+target.id);
}
const first=sandbox.getStudentProfileRecords(one,database),second=sandbox.getStudentProfileRecords(one,database);
assert.equal(second,first,'profile selection is reused when the same profile is reopened');
assert.equal(first.entries.attendance.length,4,'safe legacy records are retained');
assert.deepEqual(ids(first.attendance),['a1','a2','a3','a8'],'original record order is retained before date sorting');
assert.ok(!ids(first.attendance).includes('a4'),'a different active student ID is never claimed by name');
assert.ok(!ids(first.attendance).includes('a5'),'duplicate names without section are not guessed');
assert.ok(!ids(first.attendance).includes('a6'),'a mismatching section is excluded');
const before=sandbox.getStudentProfileRecordIndex(database);
database.attendance[0].notes='تعديل جديد';sandbox.invalidateStudentProfileRecordIndex();
const after=sandbox.getStudentProfileRecordIndex(database);
assert.notEqual(after,before,'saved changes invalidate the lookup index');
const changed=sandbox.getStudentProfileRecords(one,database);
assert.notEqual(changed,first,'the profile result is rebuilt after invalidation');
assert.equal(changed.attendance[0].notes,'تعديل جديد','rebuilt profile sees the latest saved edit');
database.documents=database.documents.concat({id:'d4',student:'s-1',date:'2026-11-11'});
assert.ok(ids(sandbox.getStudentProfileRecords(one,database).documents).includes('d4'),'replaced arrays trigger defensive rebuilding');
const ps=html.indexOf('window.studentHistory=(id,focusFollowupId)=>{'),pe=html.indexOf('window.closeMushrifiPrintPreview',ps);
const profile=html.slice(ps,pe);
assert.ok(profile.includes('getStudentProfileRecords(s,db)'),'interactive profile uses the shared index');
assert.ok(profile.includes('buildStudentTimeline(s,db,profileRecords)'),'timeline reuses the same indexed selection');
assert.ok(!profile.includes('db.attendance.filter(')&&!profile.includes('db.violations.filter(')&&!profile.includes('db.documents.filter('),'profile no longer rescans every linked collection for each opening');
assert.ok(html.includes("if(['students','attendance','documents','violations','followups'].some(entity=>changedEntities.has(entity)))invalidateStudentProfileRecordIndex();"),
 'successful record changes invalidate profile indexes');
console.log('PASS: indexed profile parity, legacy identity safety, cache reuse, stable order and invalidation.');
