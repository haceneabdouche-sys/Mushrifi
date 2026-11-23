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

const initStart=html.indexOf('const legacyJson=localStorage.getItem(DBKEY);');
const initEnd=html.indexOf("if(isAndroidApp){if(!nativeJson&&legacyJson",initStart);
assert.notEqual(initStart,-1);
assert.notEqual(initEnd,-1);
const init=html.slice(initStart,initEnd);
assert.match(init,/try\{db=parseMushrifiDatabase\(nativeJson\|\|legacyJson\|\|EMPTY_DB\);\}/,
 'native or legacy data must pass validation before app initialization');
assert.match(init,/توقّف مُشرِفي لحماية بياناتك/,
 'corrupt data must show a clear protective screen');
assert.match(init,/لم ينشئ قاعدة فارغة ولم يحفظ فوق الملف الأصلي/,
 'the error screen must explicitly confirm no empty replacement was saved');

console.log('PASS: malformed database payloads are rejected safely without replacing original data.');
