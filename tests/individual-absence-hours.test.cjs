const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helperStart=html.indexOf('const parseHours=');
const helperEnd=html.indexOf('const esc=',helperStart);
assert.notEqual(helperStart,-1,'Arabic-aware hours parser must exist');
assert.notEqual(helperEnd,-1,'hours helpers must end before HTML escaping helper');

const context={};
vm.createContext(context);
vm.runInContext(html.slice(helperStart,helperEnd),context);

const result=(period,value,timetable)=>JSON.parse(JSON.stringify(
  context.resolveIndividualAbsenceHours(period,value,timetable)
));

assert.equal(vm.runInContext("isFullDayAbsence('غياب','اليوم كاملاً')",context),true,
  'a full-day absence period must be recognized');
assert.equal(vm.runInContext("isFullDayAbsence('غياب','الفترة الصباحية')",context),false,
  'editing an absence to a partial period must clear the full-day flag');
assert.equal(vm.runInContext("isFullDayAbsence('تأخر','اليوم كاملاً')",context),false,
  'a lateness record must never retain a full-day absence flag');

assert.deepEqual(result('اليوم كاملاً','7',6),{
  ok:true,hours:7,fullDay:true
},'user-entered hours must override the timetable estimate for a full-day individual absence');

assert.deepEqual(result('اليوم كاملاً','٦ ساعات',6),{
  ok:true,hours:6,fullDay:true
},'Arabic digits and the Arabic hours word must parse');

assert.deepEqual(result('الفترة الصباحية','2.5',null),{
  ok:true,hours:2.5,fullDay:false
},'partial-day absence must accept a manually entered fractional duration');

assert.deepEqual(result('الفترة المسائية','٧ ساعات',null),{
  ok:true,hours:7,fullDay:false
},'custom absence duration must accept Arabic digits');

assert.equal(result('اليوم كاملاً','6',null).reason,'missing-timetable',
  'full-day entry must still require a configured timetable');
assert.equal(result('اليوم كاملاً','6',0).reason,'no-school-hours',
  'full-day entry must still reject a date with no scheduled school hours');

for(const value of ['', '0', '0.1', '24.5', 'سبع', '2 ساعات ونصف']){
  assert.equal(result('الفترة الصباحية',value,null).reason,'invalid-hours',
    'invalid or out-of-range hours must be rejected: '+JSON.stringify(value));
}

// Guard the real form wiring as well as the isolated calculation helper:
// this prevents a future refactor from silently substituting timetable hours at save time.
const submitStart=html.indexOf("$('#attForm').onsubmit=");
const submitEnd=html.indexOf('function dateFromISO',submitStart);
assert.notEqual(submitStart,-1,'individual attendance form handler must exist');
assert.notEqual(submitEnd,-1,'individual attendance form handler must be bounded');
const submit=html.slice(submitStart,submitEnd);
assert.match(submit,/resolveIndividualAbsenceHours\(period,f\.get\('hours'\),timetableHours\)/,
  'the individual form must validate and save the entered hours');
assert.match(submit,/hours=resolved\.hours;fullDay=resolved\.fullDay/,
  'the value returned from the input must be what is stored in the record');
assert.doesNotMatch(submit,/hours=scheduledHoursForStudentDate/,
  'the timetable estimate must never overwrite the manually edited input');

const editStart=html.indexOf('window.saveAttendanceEdit=id=>');
const editEnd=html.indexOf('window.studentHistory=',editStart);
assert.notEqual(editStart,-1,'attendance edit handler must exist');
const edit=html.slice(editStart,editEnd);
assert.match(edit,/r\.fullDay=isFullDayAbsence\(type,period\)/,
  'editing a record must recompute its full-day state from the edited type and period');

console.log('PASS: individual absence hours are editable, validated, Arabic-digit aware, and saved exactly as entered.');
