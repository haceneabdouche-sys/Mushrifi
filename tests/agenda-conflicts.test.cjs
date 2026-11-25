const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

process.env.TZ='Africa/Algiers';
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function agendaValidDate(v){');
const end=html.indexOf('let agendaCurrentView=',start);
assert.ok(start>=0&&end>start,'agenda date, recurrence, snapshot and conflict helpers exist before UI state');
const sandbox={Date,Map,Set,Number,String,Array,Math,Object,JSON,window:{},document:{querySelectorAll:()=>[]},
 esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const day='2026-11-26';
const events=[
 {id:'meeting-a',source:'manual',title:'اجتماع مجلس التربية',date:day,startTime:'09:00',endTime:'10:00',status:'planned'},
 {id:'meeting-b',source:'manual',title:'متابعة الإدارة',date:day,startTime:'09:30',endTime:'10:30',status:'planned'},
 {id:'point-inside',source:'summons',title:'حضور ولي',date:day,startTime:'09:45',endTime:'',status:'planned'},
 {id:'point-at-end',source:'manual',title:'موعد عند العاشرة',date:day,startTime:'10:00',endTime:'',status:'planned'},
 {id:'point-exact-a',source:'manual',title:'استقبال أول',date:day,startTime:'13:00',endTime:'',status:'planned'},
 {id:'point-exact-b',source:'summons',title:'استقبال ثان',date:day,startTime:'13:00',endTime:'',status:'planned'},
 {id:'point-near',source:'manual',title:'موعد بعد دقيقة',date:day,startTime:'13:01',endTime:'',status:'planned'},
 {id:'touching-after',source:'manual',title:'موعد تال',date:day,startTime:'10:30',endTime:'11:00',status:'planned'},
 {id:'all-day',source:'manual',title:'مهمة طوال اليوم',date:day,startTime:'',endTime:'',status:'planned'},
 {id:'done-event',source:'manual',title:'موعد منجز',date:day,startTime:'09:15',endTime:'11:00',status:'done'},
 {id:'cancelled-event',source:'manual',title:'موعد ملغى',date:day,startTime:'09:15',endTime:'11:00',status:'cancelled'},
 {id:'other-day',source:'manual',title:'موعد في اليوم التالي',date:'2026-11-27',startTime:'09:15',endTime:'11:00',status:'planned'},
 {id:'bad-time',source:'manual',title:'وقت غير صالح',date:day,startTime:'29:90',endTime:'30:00',status:'planned'},
 {id:'bad-end',source:'manual',title:'نهاية قبل البداية',date:day,startTime:'12:00',endTime:'11:00',status:'planned'},
 {id:'no-id',source:'manual',title:'وقت مكرر بلا معرف',date:day,startTime:'12:00',endTime:'12:30',status:'planned'}
];
const original=JSON.stringify(events);
const result=sandbox.buildAgendaConflictSnapshot(events);
assert.equal(result.total,result.conflicts.length,'total equals the number of reported conflict pairs');
const byPair=new Map(result.conflicts.map(x=>[[x.first.id,x.second.id].sort().join('|'),x]));
assert.ok(byPair.has('meeting-a|meeting-b'),'overlapping timed appointments are detected');
assert.equal(byPair.get('meeting-a|meeting-b').minutes,30,'overlap duration is calculated in minutes');
assert.equal(byPair.get('meeting-a|meeting-b').startTime,'09:30','overlap start is the later appointment start');
assert.equal(byPair.get('meeting-a|meeting-b').endTime,'10:00','overlap end is the earlier appointment end');
assert.ok(byPair.has('meeting-a|point-inside'),'a point appointment inside a timed meeting is a conflict');
assert.ok(byPair.get('meeting-a|point-inside').point,'a point-in-interval conflict is not assigned a fabricated duration');
assert.ok(byPair.has('meeting-b|point-at-end'),'the point at 10:00 is inside the second 09:30–10:30 meeting');
assert.ok(!byPair.has('meeting-a|point-at-end'),'an appointment exactly at the first meeting end is not a conflict');
assert.ok(!byPair.has('meeting-b|touching-after'),'back-to-back appointments that only touch at the boundary are not a conflict');
assert.ok(byPair.has('point-exact-a|point-exact-b'),'two untimed-duration appointments at the exact same start are a conflict');
assert.ok(!byPair.has('point-exact-a|point-near'),'appointments one minute apart are not falsely marked as conflicting');
assert.ok(!result.conflicts.some(x=>x.first.id==='all-day'||x.second.id==='all-day'),'all-day items without a start are not treated as timed conflicts');
assert.ok(!result.conflicts.some(x=>['done-event','cancelled-event','other-day','bad-time','bad-end'].includes(x.first.id)||['done-event','cancelled-event','other-day','bad-time','bad-end'].includes(x.second.id)),'completed, cancelled, other-date and invalid-time records are excluded');
assert.equal(JSON.stringify(events),original,'conflict detection never mutates source agenda or document events');
assert.equal(result.ignoredWithoutTime,1,'all-day entries are explicitly counted as not compared');
assert.ok(result.ignoredInvalidTime>=2,'invalid time and reversed intervals are excluded from confirmed conflict detection');

const direct=sandbox.agendaConflictPair(
 {id:'a',date:day,startTime:'09:00',endTime:'10:00',status:'planned'},
 {id:'b',date:day,startTime:'10:00',endTime:'11:00',status:'planned'}
);
assert.equal(direct,null,'touching boundaries return no conflict');
assert.equal(sandbox.agendaConflictTimeMinutes('09:07'),547,'time parser converts valid local time to minutes after midnight');
assert.equal(sandbox.agendaConflictTimeMinutes('24:00'),null,'24:00 is not accepted as a clock time');
assert.equal(sandbox.agendaConflictTimeMinutes('9:07'),null,'clock time must use a strict two-digit hour');

const recurrent=[
 {id:'daily-series',title:'عمل يومي',type:'task',date:'2026-11-25',startTime:'09:30',endTime:'10:30',status:'planned',repeatFrequency:'daily',repeatInterval:1,repeatUntil:'2026-11-27'},
 {id:'daily-meeting',title:'اجتماع يومي',type:'meeting',date:'2026-11-26',startTime:'10:00',endTime:'10:45',status:'planned'}
];
const recurrentSnapshot=sandbox.buildAgendaSnapshot(recurrent,[],'2026-11-26','2026-11-26',()=>null);
const recurrentConflicts=sandbox.buildAgendaConflictSnapshot(recurrentSnapshot.items);
assert.equal(recurrentConflicts.total,1,'a recurring occurrence is compared against a one-off meeting on the actual date');
assert.equal(recurrentConflicts.conflicts[0].first.id,'daily-series::2026-11-26','conflict identifies the concrete occurrence, not just its series');
assert.equal(recurrentConflicts.conflicts[0].second.id,'daily-meeting','one-off appointment keeps its original ID');

const docs=[
 {id:'summons-1',student:'s1',type:'استدعاء ولي',appointment:day+'T09:45',reason:'مراجعة الغياب'},
 {id:'summons-duplicate',student:'s1',type:'استدعاء ولي',appointment:day+'T09:45'},
 {id:'summons-no-time',student:'s1',type:'استدعاء ولي',appointment:day},
];
const before=JSON.stringify(docs);
const summonsSnapshot=sandbox.buildAgendaSnapshot([{id:'meeting',title:'اجتماع',date:day,startTime:'09:00',endTime:'10:00'}],docs,day,day,id=>({id:'s1',last:'عيسو',first:'وائل'}));
const summonsConflicts=sandbox.buildAgendaConflictSnapshot(summonsSnapshot.items);
assert.equal(summonsSnapshot.summonsCount,1,'duplicate source summons are represented only once');
assert.equal(summonsConflicts.total,1,'original guardian summons are checked against agenda meetings');
assert.ok(summonsConflicts.conflicts[0].first.source==='manual'||summonsConflicts.conflicts[0].second.source==='manual','conflict retains a direct agenda source');
assert.ok(summonsConflicts.conflicts[0].first.source==='summons'||summonsConflicts.conflicts[0].second.source==='summons','conflict retains the original summons source');
assert.equal(JSON.stringify(docs),before,'summons remain untouched by conflict detection');

const overlappingThree=sandbox.buildAgendaConflictSnapshot([
 {id:'a',date:day,startTime:'09:00',endTime:'11:00',status:'planned'},
 {id:'b',date:day,startTime:'09:30',endTime:'10:30',status:'planned'},
 {id:'c',date:day,startTime:'10:00',endTime:'12:00',status:'planned'}
]);
assert.equal(overlappingThree.total,3,'three mutually overlapping appointments produce three unique conflict pairs');

assert.ok(html.includes('id="agendaConflictPanel"')&&html.includes('id="agendaConflictCount"')&&html.includes('id="agendaConflictList"'),'agenda includes a dedicated conflict detection panel');
assert.ok(html.includes('function renderAgendaConflicts(result,range)'),'conflict results are shown to the user in the agenda');
assert.ok(html.includes('function agendaFocusConflict(date,firstId,secondId)'),'conflict action navigates to the actual day');
assert.ok(html.includes('data-agenda-conflict-focus="true"'),'each conflict offers a focus action');
assert.ok(html.includes('renderAgendaConflicts(conflictResult,range)'),'the conflict panel refreshes as the displayed calendar range changes');
assert.ok(html.includes('buildAgendaConflictSnapshot(conflictSource.items)'),'detection uses all events in the current displayed range, not only the current type filter');
assert.ok(html.includes("agendaCurrentTypeFilter='all'"),'focus navigation resets the type filter so both conflicting items are visible');
assert.ok(html.includes('agenda-conflict-focus'),'the two events are highlighted after navigating');
assert.ok(html.includes('لا توجد تعارضات زمنية مؤكدة'),'a no-conflicts state is explicitly displayed');
assert.ok(html.includes('الموعد ذو ساعة واحدة بلا نهاية يُعامل كنقطة زمنية'),'point appointment semantics are explained in the UI');

const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);
for(const id of ['agendaConflictPanel','agendaConflictCount','agendaConflictHint','agendaConflictList'])assert.equal(ids.filter(x=>x===id).length,1,'conflict panel ID remains unique: '+id);

console.log('PASS: timed interval overlap, boundary rules, point events, missing and invalid times, done/cancelled exclusions, recurring occurrence identity, original guardian summons, multi-pair ordering and non-mutating conflict display.');
