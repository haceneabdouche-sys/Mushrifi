const assert=require('node:assert/strict');
const vm=require('node:vm');
const source=String.raw`function getUnjustifiedStreaks(){
 // لا تبدأ السلسلة إلا بغياب يوم كامل غير مبرر.
 // يجب وجود غياب يوم كامل في كل يوم دراسة تالٍ؛ الجمعة والسبت والأيام
 // التي لا توجد فيها ساعات مبرمجة لا تتطلب سجلاً، لكنها تدخل في المدة التقويمية.
 // الحضور أو التأخر أو التبرير يقطع السلسلة، وله الأولوية داخل اليوم نفسه.
 const grouped=new Map();
 for(const r of db.attendance){
  if(!r.date||String(r.date)>dateISO())continue;
  const st=student(r.student);if(!st)continue;
  const key=String(st.id);
  if(!grouped.has(key))grouped.set(key,{student:st,events:new Map()});
  const item=grouped.get(key),date=String(r.date);
  // تجاهل أي سجل يقع داخل عطلة مدرسية معتمدة؛ لا يبدأ الغياب ولا ينقطع بسبب يوم عطلة.
  if(isSchoolHolidayDate(date))continue;
  if(!item.events.has(date))item.events.set(date,{hasBreak:false,unjustifiedHours:0,explicitFullDay:false});
  const day=item.events.get(date);
  if(r.type==='حضور'||r.type==='تأخر'){day.hasBreak=true;continue;}
  if(r.type!=='غياب')continue;
  if(String(r.justified||'غير مبرر')==='مبرر'){day.hasBreak=true;continue;}
  const hours=Number(parseHours(r.hours))||0;
  const period=String(r.period||'').replace(/[\u0640\s]/g,'');
  if(r.fullDay===true||['اليومكاملاً','اليومكاملا','يومكامل'].includes(period))day.explicitFullDay=true;
  if(hours>0)day.unjustifiedHours+=hours;
 }
 const out=[];
 for(const item of grouped.values()){
  const events=item.events;
  for(const [date,event] of events){
   const scheduled=scheduledHoursForStudentDate(item.student,date);
   // الغياب المسجل صراحةً «اليوم كاملاً» يُعتد به حتى عند غياب التوقيت الأسبوعي.
   // أما الساعات الجزئية فلا تثبت يوماً كاملاً إلا بمقارنتها بتوقيت القسم.
   event.fullDayAbsence=!event.hasBreak&&(
    (event.explicitFullDay&&scheduled!==0)||
    (scheduled!==null&&scheduled>0&&event.unjustifiedHours>=scheduled)
   );
  }
  const ordered=[...events.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const lastBreak=ordered.reduce((last,[date,event])=>event.hasBreak&&date>last?date:last,'');
  // افحص البدايات من الأحدث إلى الأقدم؛ حتى لا تخفي فجوة غير مبررة
  // سلسلة جديدة بدأت بعد فجوة سابقة لم تسجل كحضور أو تبرير.
  const candidates=ordered.filter(([date,event])=>date>lastBreak&&event.fullDayAbsence);
  let active=null;
  for(const [start] of candidates){
   let last=start,valid=true;
   for(let cursor=dateFromISO(start);;cursor.setDate(cursor.getDate()+1)){
    const date=cursor.getFullYear()+'-'+String(cursor.getMonth()+1).padStart(2,'0')+'-'+String(cursor.getDate()).padStart(2,'0');
    if(date>dateISO())break;
    // العطلة المدرسية المصرح بها لا تتطلب تسجيل غياب، لكنها تبقى ضمن المدة التقويمية.
    if(isSchoolHolidayDate(date)){last=date;continue;}
    const weekday=cursor.getDay();
    if(weekday===5||weekday===6){last=date;continue;}
    const scheduled=scheduledHoursForStudentDate(item.student,date);
    if(scheduled===0){last=date;continue;}
    // إذا كان اليوم مسجلاً صراحةً كاملاً، فلا نحتاج إلى توقيت القسم لإثبات هذا اليوم.
    const event=events.get(date);
    if(scheduled===null&&(!event||!event.explicitFullDay)){valid=false;break;}
    if(!event||event.hasBreak||!event.fullDayAbsence){valid=false;break;}
    last=date;
   }
   if(valid){active={student:item.student,start,last,days:Math.max(1,calendarDaysBetween(start,last)+1),thursdayStart:dateFromISO(start).getDay()===4};break;}
  }
  if(active)out.push(active);
 }
 return out.sort((a,b)=>b.days-a.days||a.start.localeCompare(b.start));
}`;
const fixedToday='2026-11-18';
let attendance=[],holidays=[],schedule={};
const st={id:'student-1'};
const ctx={
 db:{attendance:[]},
 dateISO:()=>fixedToday,
 student:id=>String(id)==='student-1'?st:null,
 parseHours:v=>Number(v)||0,
 scheduledHoursForStudentDate:(_s,date)=>Object.prototype.hasOwnProperty.call(schedule,date)?schedule[date]:6,
 isSchoolHolidayDate:date=>holidays.some(h=>h.start<=date&&date<=h.end),
 dateFromISO:date=>new Date(date+'T12:00:00'),
 calendarDaysBetween:(a,b)=>Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000)
};
vm.createContext(ctx);vm.runInContext(source,ctx);
const dateValidationSource=String.raw`function dateFromISO(v){const [y,m,d]=String(v||'').split('-').map(Number);return new Date(y,m-1,d,12,0,0);}
const isValidISODate=value=>{const v=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const [y,m,d]=v.split('-').map(Number),date=dateFromISO(v);return Number.isFinite(date.getTime())&&date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;};`;
vm.runInContext(dateValidationSource,ctx);
const configuredHolidaySource=String.raw`const schoolHolidayRanges=()=>Array.isArray(db.settings.schoolHolidays)?db.settings.schoolHolidays:[];
function isConfiguredSchoolHolidayDate(date){return schoolHolidayRanges().some(h=>h&&isValidISODate(h.start)&&isValidISODate(h.end)&&h.start<=date&&date<=h.end);}`;
vm.runInContext(configuredHolidaySource,ctx);
ctx.db.settings={schoolHolidays:[]};
ctx.calendarDaysBetween=(a,b)=>Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000);
const deliveryGateSource=String.raw`function hasVerifiedAbsenceNoticeDelivery(streak,stage,requiredDays){
 const notice=db.documents.find(d=>String(d.student)===String(streak.student.id)&&d.absenceStart===streak.start&&Number(d.absenceStage)===Number(stage));
 const delivered=String(notice?.deliveryDate||'');
 if(!notice||!String(notice.deliveryProof||'').trim()||!isValidISODate(delivered)||delivered>dateISO())return false;
 return calendarDaysBetween(delivered,dateISO())>=Number(requiredDays);
}
function canCreateAbsenceStage32(streak){
 return !!streak&&Number(streak.days)>=32&&hasVerifiedAbsenceNoticeDelivery(streak,18,14);
}`;
vm.runInContext(deliveryGateSource,ctx);
ctx.timetableForGroup=()=>({sun:2,mon:2,tue:2,wed:2,thu:2});
ctx.attendanceWeekdays=[['sun'],['mon'],['tue'],['wed'],['thu']];
const monthlyHoursSource=String.raw`function monthScheduledHours(group,month){const t=timetableForGroup(group);if(!t)return null;const [y,m]=month.split('-').map(Number),days=new Date(y,m,0).getDate();let sum=0;for(let day=1;day<=days;day++){const date=y+'-'+String(m).padStart(2,'0')+'-'+String(day).padStart(2,'0');if(isSchoolHolidayDate(date))continue;const dow=new Date(y,m-1,day,12).getDay();if(dow>=0&&dow<=4)sum+=Number(t[attendanceWeekdays[dow][0]]||0);}return sum;}`;
vm.runInContext(monthlyHoursSource,ctx);
ctx.attendanceRecordGroupKey=a=>a.groupKey;
const monthlyRecordsSource=String.raw`function monthlyAbsenceRecords(group,month){return db.attendance.filter(a=>a.type==='غياب'&&String(a.date||'').slice(0,7)===month&&!isSchoolHolidayDate(String(a.date||''))&&attendanceRecordGroupKey(a)===group.key);}`;
vm.runInContext(monthlyRecordsSource,ctx);
function run(rows,hs=[],sc={}){ctx.db.attendance=rows.map((x,i)=>({id:String(i),student:'student-1',type:'غياب',justified:'غير مبرر',hours:6,...x}));holidays=hs;schedule=sc;return JSON.parse(JSON.stringify(ctx.getUnjustifiedStreaks()));}
function absence(date,extra={}){return {date,...extra};}
function test(name,fn){try{fn();console.log('PASS',name)}catch(e){console.error('FAIL',name,e.message);process.exitCode=1;}}
test('a single explicit full-day start continues through unrecorded scheduled days',()=>{const x=run([absence('2026-11-08',{fullDay:true})]);assert.equal(x.length,1);assert.equal(x[0].start,'2026-11-08');assert.equal(x[0].last,'2026-11-18');assert.equal(x[0].days,11);});
test('a later attendance record interrupts an inferred continuous absence',()=>{const x=run([absence('2026-11-08',{fullDay:true}),{date:'2026-11-16',type:'حضور',hours:0}]);assert.equal(x.length,0);});
test('a later justified absence interrupts an inferred continuous absence',()=>{const x=run([absence('2026-11-08',{fullDay:true}),absence('2026-11-16',{justified:'مبرر'})]);assert.equal(x.length,0);});
test('three consecutive scheduled school days',()=>{const x=run([absence('2026-11-16'),absence('2026-11-17'),absence('2026-11-18')]);assert.equal(x.length,1);assert.equal(x[0].start,'2026-11-16');assert.equal(x[0].days,3);});
test('weekend remains inside calendar-day duration',()=>{const x=run([absence('2026-11-12'),absence('2026-11-15'),absence('2026-11-16'),absence('2026-11-17'),absence('2026-11-18')]);assert.equal(x.length,1);assert.equal(x[0].days,7);});
test('attendance breaks the previous streak',()=>{const x=run([absence('2026-11-16'),absence('2026-11-17'),{date:'2026-11-17',type:'حضور',hours:0},absence('2026-11-18')]);assert.equal(x.length,1);assert.equal(x[0].start,'2026-11-18');});
test('declared holiday does not require absence and stays in duration',()=>{const x=run([absence('2026-11-16'),absence('2026-11-17'),absence('2026-11-18')],[{start:'2026-11-17',end:'2026-11-17'}]);assert.equal(x.length,1);assert.equal(x[0].days,3);});
test('missing timetable prevents extending a streak beyond an unknown school day',()=>{const x=run([absence('2026-11-16')],[],{'2026-11-17':null});assert.equal(x.length,0);});
test('new active streak after an unrecorded weekday gap is found',()=>{const x=run([absence('2026-11-16'),absence('2026-11-18')]);assert.equal(x.length,1);assert.equal(x[0].start,'2026-11-18');assert.equal(x[0].days,1);});
test('full-day flag is ignored when timetable has zero hours',()=>{const x=run([absence('2026-11-18',{fullDay:true})],[],{'2026-11-18':0});assert.equal(x.length,0);});
test('justified absence breaks the streak',()=>{const x=run([absence('2026-11-16'),absence('2026-11-17',{justified:'مبرر'}),absence('2026-11-18')]);assert.equal(x.length,1);assert.equal(x[0].start,'2026-11-18');});
test('valid ISO calendar date is accepted',()=>{assert.equal(vm.runInContext("isValidISODate('2026-11-18')",ctx),true);});
test('invalid calendar day is rejected',()=>{assert.equal(vm.runInContext("isValidISODate('2026-02-30')",ctx),false);});
test('invalid month is rejected',()=>{assert.equal(vm.runInContext("isValidISODate('2026-13-01')",ctx),false);});
test('non-ISO date format is rejected',()=>{assert.equal(vm.runInContext("isValidISODate('18/11/2026')",ctx),false);});
test('empty holiday date is rejected',()=>{assert.equal(vm.runInContext("isValidISODate('')",ctx),false);});
test('configured holiday helper matches dates inside a valid range',()=>{ctx.db.settings.schoolHolidays=[{start:'2026-12-20',end:'2026-12-31'}];assert.equal(vm.runInContext("isConfiguredSchoolHolidayDate('2026-12-25')",ctx),true);assert.equal(vm.runInContext("isConfiguredSchoolHolidayDate('2027-01-01')",ctx),false);});
test('invalid holiday ranges are ignored by the date matcher',()=>{ctx.db.settings.schoolHolidays=[{start:'2026-02-30',end:'2026-03-05'}];assert.equal(vm.runInContext("isConfiguredSchoolHolidayDate('2026-03-02')",ctx),false);});
function setNotice(stage,deliveryDate,deliveryProof='وصل تبليغ رقم 1'){ctx.db.documents=[{student:'student-1',absenceStart:'2026-11-01',absenceStage:stage,deliveryDate,deliveryProof}];}
const streak={student:st,start:'2026-11-01',days:18};
test('second notice waits seven days after verified first delivery',()=>{setNotice(4,'2026-11-11');assert.equal(vm.runInContext("hasVerifiedAbsenceNoticeDelivery(streak,4,7)",Object.assign(ctx,{streak})),true);});
test('second notice is blocked before seven full days',()=>{setNotice(4,'2026-11-12');assert.equal(vm.runInContext("hasVerifiedAbsenceNoticeDelivery(streak,4,7)",Object.assign(ctx,{streak})),false);});
test('delivery without proof is rejected',()=>{setNotice(4,'2026-11-11','');assert.equal(vm.runInContext("hasVerifiedAbsenceNoticeDelivery(streak,4,7)",Object.assign(ctx,{streak})),false);});
test('future delivery date is rejected',()=>{setNotice(4,'2026-11-19');assert.equal(vm.runInContext("hasVerifiedAbsenceNoticeDelivery(streak,4,7)",Object.assign(ctx,{streak})),false);});
test('warning delivery also requires seven full days after second notice',()=>{setNotice(11,'2026-11-11');assert.equal(vm.runInContext("hasVerifiedAbsenceNoticeDelivery(streak,11,7)",Object.assign(ctx,{streak})),true);});
test('warning stage is blocked without proof of second notice delivery',()=>{setNotice(11,'2026-11-11','');assert.equal(vm.runInContext("hasVerifiedAbsenceNoticeDelivery(streak,11,7)",Object.assign(ctx,{streak})),false);});
test('stage 32 requires day 32 and fourteen full days after warning delivery',()=>{setNotice(18,'2026-11-04');assert.equal(vm.runInContext("canCreateAbsenceStage32(streak)",Object.assign(ctx,{streak:{...streak,days:32}})),true);});
test('stage 32 is blocked on day 31 even if warning period elapsed',()=>{setNotice(18,'2026-11-04');assert.equal(vm.runInContext("canCreateAbsenceStage32(streak)",Object.assign(ctx,{streak:{...streak,days:31}})),false);});
test('stage 32 is blocked when warning delivery proof is absent',()=>{setNotice(18,'2026-11-04','');assert.equal(vm.runInContext("canCreateAbsenceStage32(streak)",Object.assign(ctx,{streak:{...streak,days:32}})),false);});
test('monthly scheduled-hours denominator excludes declared school holidays',()=>{holidays=[{start:'2026-11-15',end:'2026-11-19'}];assert.equal(vm.runInContext("monthScheduledHours({},'2026-11')",ctx),34);});
test('overlapping holiday ranges do not subtract scheduled hours twice',()=>{holidays=[{start:'2026-11-15',end:'2026-11-18'},{start:'2026-11-17',end:'2026-11-19'}];assert.equal(vm.runInContext("monthScheduledHours({},'2026-11')",ctx),34);});
test('monthly absence numerator ignores records dated in declared holidays',()=>{holidays=[{start:'2026-11-16',end:'2026-11-16'}];ctx.db.attendance=[{id:'holiday',type:'غياب',date:'2026-11-16',groupKey:'g'},{id:'valid',type:'غياب',date:'2026-11-17',groupKey:'g'},{id:'other-month',type:'غياب',date:'2026-10-31',groupKey:'g'},{id:'other-group',type:'غياب',date:'2026-11-17',groupKey:'x'},{id:'present',type:'حضور',date:'2026-11-17',groupKey:'g'}];assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext("monthlyAbsenceRecords({key:'g'},'2026-11')",ctx))).map(x=>x.id),['valid']);});

test('manually entered hours with full-day period count as full-day absence without timetable',()=>{const x=run([absence('2026-11-16',{fullDay:true}),absence('2026-11-17',{fullDay:true}),absence('2026-11-18',{fullDay:true})],[],{'2026-11-16':null,'2026-11-17':null,'2026-11-18':null});assert.equal(x.length,1);assert.equal(x[0].start,'2026-11-16');assert.equal(x[0].days,3);});
test('partial absence without timetable does not count as a full day',()=>{const x=run([absence('2026-11-18',{fullDay:false,hours:2})],[],{'2026-11-18':null});assert.equal(x.length,0);});
