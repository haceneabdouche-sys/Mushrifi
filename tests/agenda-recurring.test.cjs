const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

process.env.TZ='Africa/Algiers';
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function agendaValidDate(v){');
const end=html.indexOf('let agendaCurrentView=',start);
assert.ok(start>=0&&end>start,'agenda date, recurrence, snapshot and reminder helpers exist before UI state');
const sandbox={Date,Map,Set,Number,String,Array,Math,Object,JSON,window:{},document:{querySelectorAll:()=>[]}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const daily={id:'daily-1',title:'متابعة يومية',type:'task',date:'2026-11-25',startTime:'08:30',status:'planned',repeatFrequency:'daily',repeatInterval:1,repeatUntil:'2026-11-29',repeatCompletedDates:['2026-11-26'],repeatSkippedDates:['2026-11-28']};
const dailyRange=sandbox.agendaExpandOccurrences([daily],'2026-11-25','2026-11-29',100);
assert.deepEqual(JSON.parse(JSON.stringify(dailyRange.items.map(x=>({date:x.date,status:x.status,baseId:x.baseId,repeat:x.repeatOccurrence})))),[
 {date:'2026-11-25',status:'planned',baseId:'daily-1',repeat:true},
 {date:'2026-11-26',status:'done',baseId:'daily-1',repeat:true},
 {date:'2026-11-27',status:'planned',baseId:'daily-1',repeat:true},
 {date:'2026-11-29',status:'planned',baseId:'daily-1',repeat:true}
],'daily recurrence is inclusive, preserves per-date completion, and omits only skipped occurrences');
assert.equal(new Set(dailyRange.items.map(x=>x.id)).size,4,'each occurrence has a stable unique event identity');
assert.ok(dailyRange.items.every(x=>x.id.includes('daily-1::')),'occurrence IDs carry the template identity and local date');

const weekly={id:'weekly-1',title:'اجتماع أسبوعي',date:'2026-11-25',repeatFrequency:'weekly',repeatInterval:2,repeatUntil:'2026-12-30'};
const weeklyRange=sandbox.agendaExpandOccurrences([weekly],'2026-11-25','2026-12-30',100);
assert.deepEqual(JSON.parse(JSON.stringify(weeklyRange.items.map(x=>x.date))),['2026-11-25','2026-12-09','2026-12-23'],'two-week recurrence preserves the weekday and interval');

const monthly={id:'monthly-1',title:'اجتماع شهري',date:'2024-01-31',repeatFrequency:'monthly',repeatInterval:1,repeatUntil:'2024-04-30'};
const monthlyRange=sandbox.agendaExpandOccurrences([monthly],'2024-01-01','2024-04-30',100);
assert.deepEqual(JSON.parse(JSON.stringify(monthlyRange.items.map(x=>x.date))),['2024-01-31','2024-02-29','2024-03-31','2024-04-30'],'monthly day 31 clamps to each month end and returns to day 31 when available in a leap year');
const monthlyInterval={...monthly,id:'monthly-2',date:'2026-01-30',repeatInterval:2,repeatUntil:'2026-07-30'};
assert.deepEqual(JSON.parse(JSON.stringify(sandbox.agendaExpandOccurrences([monthlyInterval],'2026-01-01','2026-07-31',100).items.map(x=>x.date))),['2026-01-30','2026-03-30','2026-05-30','2026-07-30'],'monthly intervals advance from the original anchor rather than accumulating month-end drift');

const oneOff={id:'one-off',title:'مهمة وحيدة',date:'2026-11-26'};
const oldRecord=sandbox.agendaExpandOccurrences([oneOff],'2026-11-25','2026-11-27',10);
assert.equal(oldRecord.items.length,1,'legacy agenda entries without recurrence metadata remain single events');
assert.equal(oldRecord.items[0].id,'one-off','nonrecurring agenda IDs remain unchanged');

const invalidItems=[
 {...daily,id:'bad-frequency',repeatFrequency:'yearly'},
 {...daily,id:'bad-interval',repeatInterval:0},
 {...daily,id:'missing-end',repeatUntil:''},
 {...daily,id:'end-before-start',repeatUntil:'2026-11-24'},
 {...daily,id:'too-far',repeatUntil:'2032-11-25'}
];
const invalidResult=sandbox.agendaExpandOccurrences(invalidItems,'2026-11-25','2026-12-01',100);
assert.equal(invalidResult.invalid,invalidItems.length,'unsupported frequencies, invalid intervals and unsafe end dates are rejected visibly');
assert.equal(invalidResult.items.length,0,'invalid recurrence rules produce no phantom occurrences');

const bounded=sandbox.agendaExpandOccurrences([{...daily,repeatCompletedDates:[],repeatSkippedDates:[]}],'2026-11-25','2026-11-29',2);
assert.equal(bounded.items.length,2,'calendar occurrence expansion respects its display safety limit');
assert.ok(bounded.truncated>0,'expansion reports truncation rather than silently claiming the whole series is displayed');

const docs=[{id:'doc-1',student:'s1',type:'استدعاء ولي',appointment:'2026-11-26T09:00',reason:'مراجعة'}];
const original=JSON.stringify({agenda:[daily,oneOff],docs});
const snapshot=sandbox.buildAgendaSnapshot([daily,oneOff],docs,'2026-11-25','2026-11-27',id=>id==='s1'?{id:'s1',last:'سعيد',first:'أمين'}:null);
assert.equal(snapshot.manualCount,4,'calendar snapshot counts distinct visible occurrences and one-off events');
assert.equal(snapshot.summonsCount,1,'read-only guardian summons remain visible beside recurring tasks');
assert.ok(snapshot.items.some(x=>x.id==='daily-1::2026-11-26'&&x.status==='done'),'calendar receives completed state for a single occurrence');
assert.ok(snapshot.items.some(x=>x.source==='summons'&&x.readOnly),'recurrence does not turn original summons into editable agenda items');
assert.equal(JSON.stringify({agenda:[daily,oneOff],docs}),original,'calendar projection never creates or mutates saved occurrence records');

const baseNow=new Date(2026,10,25,6,0,0).getTime();
const reminderItem={id:'reminder-series',title:'مهمة يومية',date:'2026-11-25',startTime:'09:00',status:'planned',repeatFrequency:'daily',repeatInterval:1,repeatUntil:'2026-11-28',repeatCompletedDates:['2026-11-26'],repeatSkippedDates:['2026-11-27'],reminderEnabled:true,reminderLeadMinutes:60};
const plan=sandbox.buildAgendaReminderPlan([reminderItem],baseNow);
assert.deepEqual(JSON.parse(JSON.stringify(plan.reminders.map(x=>x.eventDate))),['2026-11-25','2026-11-28'],'native reminder plan includes future repetitions but excludes completed or skipped dates');
assert.ok(plan.reminders.every(x=>x.id.includes('reminder-series::')),'native reminder identity is unique for each occurrence');
assert.ok(plan.reminders.every(x=>x.leadMinutes===60),'the original reminder lead setting applies to all occurrences');

const farOneOff={id:'far',title:'موعد بعد سنة',date:'2028-02-01',startTime:'10:00',status:'planned',reminderEnabled:true,reminderLeadMinutes:1440};
const farPlan=sandbox.buildAgendaReminderPlan([farOneOff],baseNow);
assert.equal(farPlan.reminders.length,1,'one-off reminder scheduling keeps its previous behavior beyond the recurring horizon');

const manySeries=[
 {...reminderItem,id:'series-a',repeatUntil:'2027-11-25',repeatCompletedDates:[],repeatSkippedDates:[]},
 {...reminderItem,id:'series-b',repeatUntil:'2027-11-25',repeatCompletedDates:[],repeatSkippedDates:[]}
];
const cappedPlan=sandbox.buildAgendaReminderPlan(manySeries,baseNow);
assert.equal(cappedPlan.reminders.length,500,'native reminder payload never exceeds the Android scheduler safety cap');
assert.ok(cappedPlan.truncated>0,'additional reminders beyond the 500 cap are explicitly reported');

assert.ok(html.includes('id="agendaRepeatFrequency"')&&html.includes('id="agendaRepeatInterval"')&&html.includes('id="agendaRepeatUntil"'),'agenda form exposes recurrence frequency, interval and final date');
assert.ok(html.includes('function syncAgendaRepeatControls()')&&html.includes("addEventListener('change',syncAgendaRepeatControls)"),'recurrence details and required end date follow the frequency selector');
assert.ok(html.includes("function agendaSkipOccurrence(id,occurrenceDate)"),'a single occurrence can be skipped without deleting the series');
assert.ok(html.includes("function agendaToggleStatus(id,occurrenceDate)"),'a single occurrence can be completed or reopened independently');
assert.ok(html.includes('data-agenda-occurrence-date=')&&html.includes('data-agenda-skip='),'rendered recurrence actions identify the exact occurrence date');
assert.ok(html.includes('repeatCompletedDates:sameRepeat')&&html.includes('repeatSkippedDates:sameRepeat'),'recurrence state is preserved on a same-rule edit and reset when the series definition changes');
assert.ok(html.includes("repeatFrequency:'نمط التكرار'")||html.includes("['repeatFrequency','نمط التكرار']"),'audit history labels recurrence rule changes');
assert.ok(html.includes("agendaExpandOccurrences(G,today,today,500)"),'daily dashboard includes recurring tasks on their actual occurrence date');
assert.ok(html.includes('syncAgendaRemindersWithAndroid(false)')&&html.includes('function buildAgendaReminderPlan'),'recurring reminders remain connected to the existing Android scheduler');
assert.ok(html.includes('const maxReminders=500'),'recurring notification generation has a bounded Android payload');

console.log('PASS: daily, weekly and anchored monthly recurrence, leap and month-end dates, interval and end validation, per-occurrence completion/skip, stable identities, non-mutating calendar projection, Android reminder expansion, one-off compatibility and alarm cap.');
