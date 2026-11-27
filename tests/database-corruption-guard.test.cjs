const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function parseMushrifiDatabase(raw){');
const end=html.indexOf('let db;',start);
assert.notEqual(start,-1,'safe database parser must exist');
assert.notEqual(end,-1,'database initialization must follow safe parser');
const context={};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);

const valid=JSON.parse(JSON.stringify(context.parseMushrifiDatabase(JSON.stringify({
 students:[{id:'s1'}],attendance:[],documents:[],violations:[],settings:{school:'مدرسة'}
}))));
assert.equal(valid.students.length,1);
assert.equal(valid.settings.school,'مدرسة');

const legacy=context.parseMushrifiDatabase(JSON.stringify({students:[{id:'old'}]}));
assert.equal(legacy.students.length,1);
assert.deepEqual(JSON.parse(JSON.stringify(legacy.attendance)),[]);
assert.deepEqual(JSON.parse(JSON.stringify(legacy.documents)),[]);
assert.deepEqual(JSON.parse(JSON.stringify(legacy.violations)),[]);

for(const raw of [
 '{broken json',
 '[]',
 'null',
 JSON.stringify({students:{not:'an array'}}),
 JSON.stringify({attendance:'corrupt'}),
 JSON.stringify({documents:{}}),
 JSON.stringify({violations:4}),
 JSON.stringify({settings:null}),
 JSON.stringify({settings:[]})
]){
 assert.throws(()=>context.parseMushrifiDatabase(raw),
  'malformed or structurally invalid data must be rejected instead of silently replaced with empty arrays');
}

const guardStart=html.indexOf('const nativeJson=isAndroidApp?AndroidBridge.loadDatabase():null;');
const guardEnd=html.indexOf('const legacyJson=localStorage.getItem(DBKEY);',guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart,'native storage is checked before reading legacy browser storage');
const guard=html.slice(guardStart,guardEnd);
assert.match(guard,/if\(nativeJson==='!MUSHRIFI_DB_ERROR!'\)\{showMushrifiDatabaseRecoveryScreen\(\);throw new Error\(/,
 'a missing or unreadable native database blocks normal initialization before EMPTY_DB can be selected');
assert.match(guard,/function showMushrifiDatabaseRecoveryScreen\(\)/,
 'corrupt or missing native data shows a dedicated recovery screen');
assert.match(guard,/أوقف التشغيل بدلاً من إنشاء قائمة فارغة أو حفظ بيانات فوق الملف الموجود/,
 'the recovery screen explains that no empty replacement will be created or saved');
assert.match(guard,/AndroidBridge\.loadRecoverySnapshot/,
 'the protective screen checks the encrypted recovery point');
assert.match(guard,/AndroidBridge\.restoreDatabaseSafely\(JSON\.stringify\(recoveryDatabase\)\)/,
 'the recovery point can only be written after explicit user confirmation');

console.log('PASS: malformed database payloads are rejected safely without replacing original data.');
