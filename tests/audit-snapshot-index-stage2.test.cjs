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
 students:[
  {id:'stu-1',last:'عيسو',first:'وائل'},
  {id:'stu-1',last:'مكرر',first:'اسم'}
 ],
 attendance:[
  {id:'att-update',student:'stu-1',date:'2026-11-26',type:'غياب',hours:2},
  {student:'missing-id',studentName:'اسم قديم محفوظ',date:'2026-11-26',type:'تأخر',minutes:5},
  {id:'duplicate',student:'stu-1',date:'2026-11-25',type:'غياب',hours:1},
  {id:'duplicate',student:'stu-1',date:'2026-11-25',type:'غياب',hours:2},
  {id:'att-delete',student:'stu-1',date:'2026-11-24',type:'غياب',hours:1}
 ],
 documents:[],
 violations:[],
 followups:[],
 agenda:[],
 supervisionLogs:[],
 guardianReceptions:[],
 settings:{school:'ثانوية الاختبار',timetables:{'1':{sun:6}}}
};
const after=JSON.parse(JSON.stringify(before));
after.attendance=[
 {id:'att-update',student:'stu-1',date:'2026-11-26',type:'غياب',hours:3},
 {student:'missing-id',studentName:'اسم قديم محفوظ',date:'2026-11-26',type:'تأخر',minutes:5},
 {id:'duplicate',student:'stu-1',date:'2026-11-25',type:'غياب',hours:1},
 {id:'duplicate',student:'stu-1',date:'2026-11-25',type:'غياب',hours:4},
 {id:'att-add',student:'stu-1',date:'2026-11-27',type:'تأخر',minutes:10}
];
after.settings.timetables['1'].sun=5;

const beforeSnapshot=sandbox.auditComparableDatabase(before);
const afterSnapshot=sandbox.auditComparableDatabase(after);
assert.equal(Object.prototype.propertyIsEnumerable.call(beforeSnapshot,'__auditIndexes'),false,
 'internal audit indexes are non-enumerable and do not become part of stored database data');
assert.equal(JSON.stringify(beforeSnapshot).includes('__auditIndexes'),false,
 'audit index metadata is excluded from JSON serialization');
assert.equal(Object.prototype.toString.call(beforeSnapshot.__auditIndexes.collections.attendance),'[object Map]',
 'the projected snapshot contains a prebuilt record identity map');
assert.equal(beforeSnapshot.__auditIndexes.collections.attendance.get('id:duplicate').hours,2,
 'duplicate IDs preserve the existing last-record-wins map behavior');
assert.equal(beforeSnapshot.__auditIndexes.collections.attendance.get('legacy:1').studentName,'اسم قديم محفوظ',
 'records without IDs preserve their original positional identity');
assert.equal(beforeSnapshot.__auditIndexes.studentsById.get('stu-1').last,'عيسو',
 'student-label lookup preserves the existing first-matching-student behavior');

const makeIds=()=>{let next=0;return ()=>('stage2-'+(++next));};
const referenceEvents=sandbox.buildAuditEvents(before,after,'2026-11-27T21:00:00.000Z',makeIds());
const indexedEvents=sandbox.buildAuditEvents(beforeSnapshot,after,'2026-11-27T21:00:00.000Z',makeIds(),{
 precomputedSnapshots:true,
 afterSnapshot
});
assert.equal(JSON.stringify(indexedEvents),JSON.stringify(referenceEvents),
 'preindexed and fallback audit paths produce identical event payloads and ordering');

for(const snapshot of [beforeSnapshot,afterSnapshot]){
 for(const collection of ['students','attendance','documents','violations','followups','agenda','supervisionLogs','guardianReceptions']){
  snapshot[collection].forEach=()=>{throw new Error('audit comparison rescanned '+collection+' instead of using its prebuilt index');};
 }
}
assert.doesNotThrow(()=>{
 sandbox.buildAuditEvents(beforeSnapshot,after,'2026-11-27T21:01:00.000Z',makeIds(),{
  precomputedSnapshots:true,
  afterSnapshot
 });
},'indexed audit comparison reuses record and student maps without iterating the projected arrays again');

const keySet=vm.runInContext('AUDIT_FIELD_KEY_SETS.students',sandbox);
for(let i=0;i<30;i++)sandbox.auditFieldDiff('students',{last:'أ'},{last:'ب'});
assert.strictEqual(vm.runInContext('AUDIT_FIELD_KEY_SETS.students',sandbox),keySet,
 'audit field-key sets are shared rather than allocated for every compared record');

const unchanged=sandbox.buildAuditEvents(afterSnapshot,after,'2026-11-27T21:02:00.000Z',makeIds(),{
 precomputedSnapshots:true,
 afterSnapshot
});
assert.equal(unchanged.length,0,'unchanged data does not produce audit entries');

console.log('PASS: Stage 2 preindexed audit comparisons preserve event parity, duplicate and legacy identities, student-name precedence, JSON privacy, and shared field-key sets.');
