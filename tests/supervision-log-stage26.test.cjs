const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const java=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java','utf8');
const gradle=fs.readFileSync('android/app/build.gradle','utf8');
function runSlice(source,startMarker,endMarker,expose){
 const start=source.indexOf(startMarker),end=source.indexOf(endMarker,start);
 assert.ok(start>=0&&end>start,'helper boundary: '+startMarker);
 const sandbox={};vm.createContext(sandbox);
 vm.runInContext(source.slice(start,end)+'\nthis.__test={'+expose+'};',sandbox);
 return sandbox.__test;
}
const parser=runSlice(html,'function parseMushrifiDatabase(raw){','\nlet db;','parseMushrifiDatabase');
const legacy=parser.parseMushrifiDatabase(JSON.stringify({students:[{id:'s1'}],attendance:[{id:'a1'}],documents:[],violations:[],agenda:[{id:'g1'}],followups:[{id:'f1'}],settings:{school:'مؤسسة'}}));
assert.deepEqual(JSON.parse(JSON.stringify(legacy.supervisionLogs)),[]);
assert.equal(legacy.students.length,1);assert.equal(legacy.attendance.length,1);assert.equal(legacy.agenda.length,1);
const current=parser.parseMushrifiDatabase(JSON.stringify({students:[],supervisionLogs:[{id:'sl1'}],settings:{}}));
assert.equal(current.supervisionLogs[0].id,'sl1');
assert.throws(()=>parser.parseMushrifiDatabase(JSON.stringify({students:[],supervisionLogs:{},settings:{}})),/supervisionLogs/);

const auditStart=html.indexOf('const AUDIT_LOG_LIMIT=500;'),auditEnd=html.indexOf('let auditBaselineSnapshot=',auditStart);
assert.ok(auditStart>=0&&auditEnd>auditStart);
const auditSandbox={};vm.createContext(auditSandbox);
vm.runInContext(html.slice(auditStart,auditEnd)+'\nthis.__test={buildAuditEvents,auditCanRevert};',auditSandbox);
const before={students:[],attendance:[],documents:[],violations:[],followups:[],agenda:[],supervisionLogs:[
 {id:'sl1',type:'حراسة الامتحانات',date:'2026-11-27',period:'صباحية',location:'قاعة 2',section:'1 علوم',notes:'ملاحظة خاصة قبل التعديل',actionTaken:'إجراء أول'}]};
const after=JSON.parse(JSON.stringify(before));
after.supervisionLogs[0].type='الإشراف أثناء الاستراحة';
after.supervisionLogs[0].notes='نص خاص لا يجوز عرضه';
after.supervisionLogs[0].actionTaken='إجراء خاص لا يجوز عرضه';
const events=auditSandbox.__test.buildAuditEvents(before,after,'2026-11-27T10:00:00.000Z',()=>'evt1');
assert.equal(events.length,1);assert.equal(events[0].entity,'supervisionLogs');assert.equal(events[0].action,'update');
assert.match(events[0].summary,/مهمة إشرافية/);
assert.ok(!JSON.stringify(events).includes('نص خاص لا يجوز عرضه'));
assert.ok(!JSON.stringify(events).includes('إجراء خاص لا يجوز عرضه'));
assert.ok(events[0].restrictedFields.includes('ملاحظة المهمة'));
assert.ok(events[0].restrictedFields.includes('الإجراء المدوّن'));
assert.equal(auditSandbox.__test.auditCanRevert(events[0],after.supervisionLogs[0]),true);

const recovery=runSlice(html,'function parseRecoverySnapshot(raw){','\nfunction refreshUndoPanel','parseRecoverySnapshot');
const validDb={students:[],attendance:[],documents:[],violations:[],settings:{},supervisionLogs:[{id:'sl1'}]};
assert.ok(recovery.parseRecoverySnapshot(JSON.stringify({version:1,database:validDb})));
assert.equal(recovery.parseRecoverySnapshot(JSON.stringify({version:1,database:{...validDb,supervisionLogs:'damaged'}})),null);

const backup=runSlice(html,'function inspectBackupIdentityIntegrity(data){','\nfunction backupUtf8ByteLength','inspectBackupIdentityIntegrity,backupPayloadCounts');
const dup=backup.inspectBackupIdentityIntegrity({students:[{id:'s1'}],attendance:[],documents:[],violations:[],agenda:[],followups:[],supervisionLogs:[{id:'same'},{id:'same'}]});
assert.equal(dup.ok,false);assert.equal(dup.duplicateRecordIds[0].collection,'supervisionLogs');
const oldCounts=backup.backupPayloadCounts({students:[],attendance:[],documents:[],violations:[],agenda:[],followups:[],auditLog:[]});
assert.equal(Object.prototype.hasOwnProperty.call(oldCounts,'supervisionLogs'),false);
const newCounts=backup.backupPayloadCounts({students:[],attendance:[],documents:[],violations:[],agenda:[],followups:[],supervisionLogs:[{id:'sl1'}],auditLog:[]});
assert.equal(newCounts.supervisionLogs,1);

assert.match(html,/data-go="supervisionLog"/);
assert.match(html,/id="supervisionLog" class="page hidden"/);
assert.match(html,/if\(activePage==='supervisionLog'\)renderSupervisionLogs\(\);/);
assert.match(html,/SUPERVISION_LOG_PAGE_SIZE=30/);
assert.match(html,/id="supervisionLogSearch"/);
assert.match(html,/id="supervisionLogDateFilter"/);
assert.match(html,/id="supervisionLogTypeFilter"/);
assert.ok(html.includes("saveUndoSnapshot('حذف مهمة إشرافية')"));
assert.ok(html.includes("licenseReadOnly){$('#supervisionLogStatus').textContent='وضع القراءة فقط"));
assert.ok(html.includes("invalidateRecordOrderCache(['attendance','documents','violations','supervisionLogs','guardianReceptions']"));
assert.ok(java.includes('new String[]{"agenda", "followups", "supervisionLogs", "guardianReceptions", "auditLog"}'));
assert.ok(java.includes('"students", "attendance", "documents", "violations", "agenda", "followups", "supervisionLogs", "guardianReceptions", "auditLog"'));
assert.match(gradle,/versionCode 35[\s\S]*versionName '2\.6'/);
console.log('PASS: Stage26 supervisor duty register, parser migration, audit privacy, undo, recovery and backup compatibility.');
