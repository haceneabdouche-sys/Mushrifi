const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function buildHomeOverviewSnapshot(today){');
const end=html.indexOf('\nfunction getHomeOverviewSnapshot(today)',start);
assert.ok(start>=0&&end>start,'home overview aggregation is isolated before its cache wrapper');

const attendance=[];
for(let day=27;day>=20;day--)attendance.push({id:'a'+day,student:'a'+day,date:'2026-11-'+String(day).padStart(2,'0'),type:'غياب'});
attendance.push({id:'a-today',student:'a-today',date:'2026-11-28',type:'تأخر'});
const documents=[
 {id:'d-tie',student:'d-tie',date:'2026-11-27',type:'استدعاء ولي'},
 {id:'d-today',student:'d-today',date:'2026-11-28',type:'استدعاء ولي إشعار غياب'},
 {id:'d-old',student:'d-old',date:'2026-11-10',type:'وثيقة'}
];
const violations=[
 {id:'v-newest',student:'v-newest',date:'2026-11-29'},
 {id:'v-tie',student:'v-tie',date:'2026-11-27'},
 {id:'v-today',student:'v-today',date:'2026-11-28'}
];
const nameCalls=[];
const monthlySentinel={marker:'monthly-dashboard'};
const sandbox={
 db:{attendance,documents,violations,students:[]},
 name:id=>{nameCalls.push(String(id));return 'اسم '+String(id);},
 student:id=>({id}),
 buildSmartDashboardSnapshot:(a,v,t,resolve)=>{assert.strictEqual(a,attendance);assert.strictEqual(v,violations);assert.equal(t,'2026-11-28');assert.equal(typeof resolve,'function');return monthlySentinel;}
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);
const snapshot=sandbox.buildHomeOverviewSnapshot('2026-11-28');

// All aggregate counts still include the entire source histories.
assert.equal(snapshot.absCount,8,'all historical absence rows remain counted');
assert.equal(snapshot.lateCount,1,'all lateness rows remain counted');
assert.equal(snapshot.todayAbs,0,'today absence count is unchanged');
assert.equal(snapshot.todayLate,1,'today lateness count is unchanged');
assert.equal(snapshot.todayViol,1,'today violation count is unchanged');
assert.equal(snapshot.summonsCount,2,'all summons remain counted');
assert.equal(snapshot.absenceNoticesCount,1,'absence notices remain counted');
assert.equal(snapshot.todaySummons,1,'today summons count is unchanged');
assert.strictEqual(snapshot.monthly,monthlySentinel,'the monthly dashboard snapshot remains connected');

// Name resolution is deferred until after the six most recent records are known.
assert.equal(nameCalls.length,6,'only the six final recent rows resolve their student names');
assert.deepEqual(nameCalls,['v-newest','a-today','d-today','v-today','a27','d-tie'],
 'name lookups follow the final six recent rows, including stable ordering for equal dates');
assert.deepEqual(
 JSON.parse(JSON.stringify(snapshot.recent.map(item=>[item.date,item.t,item.desc]))),
 [
  ['2026-11-29','اسم v-newest','مخالفة'],
  ['2026-11-28','اسم a-today','تأخر'],
  ['2026-11-28','اسم d-today','استدعاء ولي إشعار غياب'],
  ['2026-11-28','اسم v-today','مخالفة'],
  ['2026-11-27','اسم a27','غياب'],
  ['2026-11-27','اسم d-tie','استدعاء ولي']
 ],
 'recent activity dates, descriptions, names and stable tie order remain identical'
);
assert.equal(snapshot.recent.length,6,'the home view retains exactly six recent items');

console.log('PASS: Stage 5 home overview preserves whole-history counters and recent ordering while resolving names only for the six retained records.');
