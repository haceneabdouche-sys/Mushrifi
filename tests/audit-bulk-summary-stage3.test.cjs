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

// Large imports and removals are summarized without retaining detail diffs
// for individual additions/deletions that the audit UI will not display.
const before={students:[],attendance:[],documents:[],violations:[],followups:[],agenda:[],supervisionLogs:[],guardianReceptions:[],settings:{}};
for(let i=0;i<15;i++)before.students.push({id:'student-'+i,last:'لقب '+i,first:'اسم '+i,class:'1'});
const after=JSON.parse(JSON.stringify(before));
after.students=after.students.filter(item=>item.id!=='student-14');
after.students.find(item=>item.id==='student-0').class='2';
for(let i=0;i<13;i++)after.students.push({id:'new-'+i,last:'مستورد '+i,first:'تلميذ',class:'1'});
const beforeSnapshot=sandbox.auditComparableDatabase(before);
const afterSnapshot=sandbox.auditComparableDatabase(after);
let diffCalls=0;
const originalAuditFieldDiff=sandbox.auditFieldDiff;
sandbox.auditFieldDiff=function(...args){diffCalls++;return originalAuditFieldDiff(...args);};
let generatedId=0;
const bulk=sandbox.buildAuditEvents(beforeSnapshot,after,'2026-11-28T06:00:00.000Z',()=>('stage3-'+(++generatedId)),{
 precomputedSnapshots:true,
 afterSnapshot
});
assert.equal(bulk.length,1,'more than twelve record changes still produce one bulk event');
assert.equal(bulk[0].action,'bulk','the operation remains explicitly marked as a bulk change');
assert.equal(bulk[0].totals.added,13,'bulk event counts every new record');
assert.equal(bulk[0].totals.updated,1,'bulk event counts every modified record');
assert.equal(bulk[0].totals.deleted,1,'bulk event counts every deleted record');
assert.deepEqual(Array.from(bulk[0].changes),[],'bulk summaries do not leak individual record values');
assert.equal(diffCalls,14,'existing records are still compared, while add/delete detail diffs that would be discarded are skipped');
assert.ok(!JSON.stringify(bulk).includes('مستورد'),'bulk summaries do not expose imported student names');

// Small changes remain individually auditable with the same event ordering.
const smallBefore={
 students:[{id:'keep',last:'عيسو',first:'وائل',class:'1'},{id:'remove',last:'قديم',first:'سجل',class:'1'}],
 attendance:[],documents:[],violations:[],followups:[],agenda:[],supervisionLogs:[],guardianReceptions:[],settings:{}
};
const smallAfter=JSON.parse(JSON.stringify(smallBefore));
smallAfter.students[0].class='2';
smallAfter.students=smallAfter.students.filter(item=>item.id!=='remove');
smallAfter.students.push({id:'add',last:'جديد',first:'تلميذ',class:'1'});
const individual=sandbox.buildAuditEvents(smallBefore,smallAfter,'2026-11-28T06:01:00.000Z',()=>('small-'+(++generatedId)));
assert.deepEqual(
 JSON.parse(JSON.stringify(individual.map(item=>[item.action,item.entityId]))),
 [['update','keep'],['delete','remove'],['add','add']],
 'individual audit events preserve prior actions and iteration ordering'
);
assert.ok(individual.find(item=>item.entityId==='keep').changes.some(change=>change.key==='class'&&change.before==='1'&&change.after==='2'),
 'individual updates retain their approved before/after field details');

// The thirteenth changed row keeps the existing individual-versus-bulk boundary.
const boundaryBefore={students:[],attendance:[],documents:[],violations:[],settings:{}};
const boundaryAfter=JSON.parse(JSON.stringify(boundaryBefore));
for(let i=0;i<12;i++)boundaryAfter.students.push({id:'boundary-'+i,last:'لقب',first:String(i),class:'1'});
const twelve=sandbox.buildAuditEvents(boundaryBefore,boundaryAfter,'2026-11-28T06:02:00.000Z',()=>('boundary-'+(++generatedId)));
assert.equal(twelve.length,12,'twelve changes remain individually auditable');
const thirteenAfter=JSON.parse(JSON.stringify(boundaryAfter));
thirteenAfter.students.push({id:'boundary-12',last:'لقب',first:'12',class:'1'});
const thirteen=sandbox.buildAuditEvents(boundaryBefore,thirteenAfter,'2026-11-28T06:03:00.000Z',()=>('boundary-'+(++generatedId)));
assert.equal(thirteen.length,1,'thirteen changes switch to one bulk event');
assert.equal(thirteen[0].totals.added,13,'the bulk boundary includes all thirteen changes');

console.log('PASS: Stage 3 bulk audit generation bounds temporary detail retention, skips discarded add/delete diffs, and preserves small-event parity and ordering.');
