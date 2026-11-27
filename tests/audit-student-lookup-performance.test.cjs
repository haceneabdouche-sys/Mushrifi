const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('const AUDIT_LOG_LIMIT=500;');
const end=html.indexOf('let auditBaselineSnapshot=',start);
assert.ok(start>=0&&end>start,'audit helpers exist before the transactional save function');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const before={
 students:[
  {id:'student-1',last:'عيسو',first:'وائل'},
  {id:'student-1',last:'اسم خاطئ',first:'مكرر'}
 ],
 attendance:[{id:'old-attendance',student:'student-1',studentName:'اسم غير صحيح',date:'2026-11-20',type:'غياب'}],
 documents:[],
 violations:[],
 followups:[],
 agenda:[],
 supervisionLogs:[],
 guardianReceptions:[],
 settings:{}
};
const after=JSON.parse(JSON.stringify(before));
after.attendance=[
 {id:'new-attendance-1',student:'student-1',studentName:'اسم غير صحيح',date:'2026-11-21',type:'غياب'},
 {id:'new-attendance-2',student:'student-1',studentName:'اسم غير صحيح',date:'2026-11-22',type:'تأخر'}
];
after.documents=[{id:'new-document',student:'student-1',studentName:'اسم غير صحيح',date:'2026-11-23',type:'استدعاء ولي'}];
after.followups=[{id:'legacy-followup',student:'missing-student-id',studentName:'اسم احتياطي صحيح',date:'2026-11-24',category:'متابعة'}];

const beforeSnapshot=sandbox.auditComparableDatabase(before);
const afterSnapshot=sandbox.auditComparableDatabase(after);
let beforeFindCalls=0,afterFindCalls=0,beforeLookupBuilds=0,afterLookupBuilds=0;
beforeSnapshot.students.find=function(){beforeFindCalls++;throw new Error('before student list was rescanned');};
afterSnapshot.students.find=function(){afterFindCalls++;throw new Error('after student list was rescanned');};
const originalLookupBuilder=sandbox.auditBuildStudentLookup;
sandbox.auditBuildStudentLookup=function(snapshot){
 if(snapshot===beforeSnapshot)beforeLookupBuilds++;
 if(snapshot===afterSnapshot)afterLookupBuilds++;
 return originalLookupBuilder(snapshot);
};

const events=sandbox.buildAuditEvents(beforeSnapshot,after,'2026-11-27T20:00:00.000Z',()=> 'event-'+Math.random(),{
 precomputedSnapshots:true,
 afterSnapshot
});
const bySummary=summary=>events.find(event=>event.summary===summary);
assert.ok(bySummary('حذف سجل غياب أو تأخر: عيسو وائل'),'delete event resolves its student name from the before snapshot');
assert.ok(bySummary('إضافة سجل غياب أو تأخر: عيسو وائل'),'add event resolves its student name from the after snapshot');
assert.ok(bySummary('إضافة وثيقة أو استدعاء: عيسو وائل'),'other linked record types reuse the after student lookup');
assert.ok(bySummary('إضافة متابعة تربوية: اسم احتياطي صحيح'),'legacy records still fall back to their stored student name');
assert.equal(beforeFindCalls,0,'before snapshot is not searched repeatedly with Array.find');
assert.equal(afterFindCalls,0,'after snapshot is not searched repeatedly with Array.find');
assert.equal(beforeLookupBuilds,1,'the before student lookup is built once even when several audit events need it');
assert.equal(afterLookupBuilds,1,'the after student lookup is shared by all related event collections');

const noEvents=sandbox.buildAuditEvents(afterSnapshot,after,'2026-11-27T20:01:00.000Z',()=> 'unused',{
 precomputedSnapshots:true,
 afterSnapshot
});
assert.equal(noEvents.length,0,'an unchanged database still creates no audit entries');

console.log('PASS: audit student names use one lazy lookup per snapshot, retain first-match semantics, and preserve legacy fallback labels.');
