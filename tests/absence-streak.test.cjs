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
   // لا نثبت الغياب الكامل إلا في يوم توجد فيه ساعات دراسة فعلية ومعلومة.
   // حتى اختيار «اليوم كاملاً» لا يكفي إذا كان توقيت القسم غير مضبوط أو اليوم عطلة.
   event.fullDayAbsence=!event.hasBreak&&scheduled!==null&&scheduled>0&&
    (event.explicitFullDay||event.unjustifiedHours>=scheduled);
  }
  const ordered=[...events.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const lastBreak=ordered.reduce((last,[date,event])=>event.hasBreak&&date>last?date:last,'');
  // افحص البدايات من الأحدث إلى الأقدم؛ حتى لا تخفي فجوة غير مبررة
  // سلسلة جديدة بدأت بعد فجوة سابقة لم تسجل كحضور أو تبرير.
  const candidates=ordered.filter(([date,event])=>date>lastBreak&&event.fullDayAbsence).reverse();
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
    // غياب التوقيت الأسبوعي يجعل التحقق غير ممكن؛ لا نحتسب يوماً غير مثبت.
    if(scheduled===null){valid=false;break;}
    const event=events.get(date);
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
const isValidISODate=value=>{const v=String(value||'');if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(v))return false;const [y,m,d]=v.split('-').map(Number),date=dateFromISO(v);return Number.isFinite(date.getTime())&&date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;};`;
vm.runInContext(dateValidationSource,ctx);
function run(rows,hs=[],sc={}){ctx.db.attendance=rows.map((x,i)=>({id:String(i),student:'student-1',type:'غياب',justified:'غير مبرر',hours:6,...x}));holidays=hs;schedule=sc;return JSON.parse(JSON.stringify(ctx.getUnjustifiedStreaks()));}
function absence(date,extra={}){return {date,...extra};}
function test(name,fn){try{fn();console.log('PASS',name)}catch(e){console.error('FAIL',name,e.message);process.exitCode=1;}}
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
