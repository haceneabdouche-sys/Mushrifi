const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

process.env.TZ='Africa/Algiers';
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function agendaValidDate(v){');
const end=html.indexOf('let agendaCurrentView=',start);
assert.ok(start>=0&&end>start,'agenda conflict and alternative-slot helpers exist before UI state');
const sandbox={Date,Map,Set,Number,String,Array,Math,Object,JSON,window:{},document:{querySelectorAll:()=>[]}};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const day='2026-11-26';
const target={id:'target',source:'manual',title:'اجتماع مجلس التربية',date:day,startTime:'09:00',endTime:'10:00',status:'planned'};
const conflict={id:'conflict',source:'summons',title:'حضور ولي',date:day,startTime:'09:30',endTime:'10:30',status:'planned'};
const later={id:'later',source:'manual',title:'موعد لاحق',date:day,startTime:'11:00',endTime:'12:00',status:'planned'};
const all=[target,conflict,later,{id:'all-day',date:day,title:'مهمة طوال اليوم',status:'planned'},{id:'another-date',date:'2026-11-27',startTime:'09:00',endTime:'16:00',status:'planned'}];
const original=JSON.stringify(all);
const options={startTime:'08:00',endTime:'16:00',defaultDuration:30,bufferMinutes:0};
const result=sandbox.agendaAlternativeSlots(all,target,options);
assert.equal(result.valid,true,'valid availability settings produce an alternatives result');
assert.equal(result.duration,60,'appointments with an end time retain their original duration');
assert.ok(result.slots.length>0&&result.slots.length<=3,'up to three safe suggestions are returned');
assert.ok(result.slots.every(slot=>slot.end-slot.start===60),'suggestions preserve the target duration exactly');
assert.ok(result.slots.every(slot=>slot.start>=480&&slot.end<=960),'every suggested slot remains inside user-selected availability hours');
assert.ok(result.slots.every(slot=>slot.start%15===0),'suggestions use a consistent 15-minute grid');
assert.ok(result.slots.every(slot=>slot.start!==540),'the current conflicting start time is not suggested again');
assert.ok(result.slots.every(slot=>{
 const overlaps=(a,b)=>Math.max(slot.start,a)<Math.min(slot.end,b);
 return !overlaps(570,630)&&!overlaps(660,720);
}),'suggested slots do not overlap the other appointment or the separate fixed appointment');
assert.equal(result.ignoredWithoutTime,1,'all-day task is reported as not included in timed availability');
assert.equal(JSON.stringify(all),original,'alternative suggestions do not mutate or save source appointments');

const withBuffer=sandbox.agendaAlternativeSlots(all,target,{...options,bufferMinutes:10});
assert.ok(withBuffer.slots.every(slot=>slot.end<=560||slot.start>=730),'10-minute safety buffer is applied before and after existing timed appointments');

const pointTarget={id:'point-target',date:day,title:'حضور ولي دون نهاية',startTime:'09:30',endTime:'',status:'planned'};
const pointBlock={id:'point-block',date:day,title:'مقابلة محددة',startTime:'11:00',endTime:'',status:'planned'};
const pointOptions={startTime:'08:00',endTime:'12:00',defaultDuration:45,bufferMinutes:10};
const pointResult=sandbox.agendaAlternativeSlots([pointTarget,pointBlock],pointTarget,pointOptions);
assert.equal(pointResult.duration,45,'appointments without an end use only the user-selected default duration');
assert.ok(pointResult.slots.every(slot=>slot.end-slot.start===45),'point appointment recommendations use the selected duration');
assert.ok(pointResult.slots.every(slot=>slot.end<=650||slot.start>=670),'buffered point appointments block the corresponding safety window');

const noEnd={id:'missing-end',date:day,startTime:'09:00',endTime:'',title:'موعد بلا نهاية',status:'planned'};
const longEnough=sandbox.agendaAlternativeSlots([noEnd],noEnd,{startTime:'08:00',endTime:'09:30',defaultDuration:90,bufferMinutes:0});
assert.equal(longEnough.duration,90,'default duration is honored when the target is a point appointment');
assert.ok(longEnough.slots.every(x=>x.end-x.start===90),'90-minute selected duration is used exactly');

const done={id:'done',date:day,startTime:'08:00',endTime:'16:00',status:'done'};
const cancelled={id:'cancelled',date:day,startTime:'08:00',endTime:'16:00',status:'cancelled'};
const inactiveResult=sandbox.agendaAlternativeSlots([target,done,cancelled],target,options);
assert.ok(inactiveResult.slots.length>0,'completed and cancelled records do not block free suggestions');

const noSlots=sandbox.agendaAlternativeSlots([target,conflict],target,{startTime:'09:00',endTime:'10:00',defaultDuration:60,bufferMinutes:0});
assert.equal(noSlots.slots.length,0,'a window with no safe alternative yields no fabricated slot');
const invalidStart=sandbox.agendaAlternativeSlots([target],target,{startTime:'8:00',endTime:'16:00',defaultDuration:30,bufferMinutes:0});
assert.equal(invalidStart.valid,false,'invalid availability start time is rejected');
const reversed=sandbox.agendaAlternativeSlots([target],target,{startTime:'16:00',endTime:'08:00',defaultDuration:30,bufferMinutes:0});
assert.equal(reversed.valid,false,'availability end must be later than availability start');
const invalidDuration=sandbox.agendaAlternativeSlots([target],target,{startTime:'08:00',endTime:'16:00',defaultDuration:20,bufferMinutes:0});
assert.equal(invalidDuration.valid,false,'unsupported default duration is rejected');
const invalidBuffer=sandbox.agendaAlternativeSlots([target],target,{startTime:'08:00',endTime:'16:00',defaultDuration:30,bufferMinutes:45});
assert.equal(invalidBuffer.valid,false,'unbounded buffer settings are rejected');
const invalidTarget=sandbox.agendaAlternativeSlots([{id:'bad',date:day,startTime:'bad',title:'موعد'}],{id:'bad',date:day,startTime:'bad'},{startTime:'08:00',endTime:'16:00',defaultDuration:30,bufferMinutes:0});
assert.equal(invalidTarget.valid,false,'a target with an invalid clock time cannot receive alternative slots');

const recurrent=[
 {id:'daily-series::2026-11-26',baseId:'daily-series',eventId:'daily-series::2026-11-26',source:'manual',title:'مهمة متكررة',date:day,startTime:'09:00',endTime:'10:00',status:'planned',repeatOccurrence:true},
 {id:'other',source:'manual',title:'اجتماع',date:day,startTime:'09:30',endTime:'10:30',status:'planned'}
];
const recurringResult=sandbox.agendaAlternativeSlots(recurrent,recurrent[0],options);
assert.ok(recurringResult.slots.length>0,'recurring occurrence can receive read-only alternative suggestions');
assert.ok(html.includes('هذا الموعد جزء من سلسلة متكررة؛ الاقتراح لا يغيّر السلسلة'),'UI warns that suggestions do not edit or move a recurring series');

const sameDateOnly=sandbox.agendaAlternativeSlots([target,{id:'other-day-block',date:'2026-11-27',startTime:'08:00',endTime:'16:00'}],target,options);
assert.ok(sameDateOnly.slots.length>0,'appointments on another date do not block this date');

assert.ok(html.includes('function agendaAlternativeSlots(events,target,options)'),'alternative time calculation is implemented as a pure function');
assert.ok(html.includes('id="agendaAlternativeStart"')&&html.includes('id="agendaAlternativeEnd"'),'availability period requires explicit user input');
assert.ok(!html.includes('id="agendaAlternativeStart" value=')&&!html.includes('id="agendaAlternativeEnd" value='),'working hours are not guessed or silently defaulted');
assert.ok(html.includes('id="agendaAlternativeDuration"')&&html.includes('id="agendaAlternativeBuffer"'),'duration and safety buffer are configurable');
assert.ok(html.includes('id="agendaComputeAlternatives"')&&html.includes('computeAgendaAlternatives'),'user explicitly triggers the alternative calculation');
assert.ok(html.includes('هذه اقتراحات فقط. لا تُحفظ التغييرات'),'UI states that suggestions do not automatically change saved appointments');
assert.ok(html.includes('function computeAgendaAlternatives()')&&!html.slice(html.indexOf('function computeAgendaAlternatives()'),html.indexOf('function renderAgendaConflicts')).includes('save()'),'computing alternative slots never saves or modifies the database');
assert.ok(html.includes('const alternatives=$(\'#agendaAlternativeList\')'),'suggestions are rendered in their own panel');
assert.ok(html.includes("if(!total){list.innerHTML='<p class=\"agenda-conflict-empty\">لا توجد تعارضات زمنية مؤكدة في الفترة المعروضة.</p>';const emptyAlternatives="),'stale suggestions are cleared when the conflicts disappear');

console.log('PASS: user-configured working hours, duration preservation, point-event duration, safety buffers, no-overlap guarantees, date isolation, inactive-event filtering, no fabricated slots, read-only suggestions and safe empty states.');
