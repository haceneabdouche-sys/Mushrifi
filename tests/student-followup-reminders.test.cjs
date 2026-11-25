const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const identityStart=html.indexOf('function normalizeProfileStudentName(value){');
const identityEnd=html.indexOf('function profileJustificationCategory(',identityStart);
assert.ok(identityStart>=0&&identityEnd>identityStart,'strict student identity helpers exist');
const payloadStart=html.indexOf('function buildStudentFollowupReminderPayload(');
const payloadEnd=html.indexOf('let lastStudentFollowupReminderPayload=',payloadStart);
assert.ok(payloadStart>=0&&payloadEnd>payloadStart,'educational follow-up native payload builder exists');

const sandbox={
 Date,Map,Set,Number,String,Array,Math,window:{},
 attendanceGroupLabel:student=>[student.schoolYear||'',student.branch||'',student.class||''].filter(Boolean).join(' — '),
 profileTimelineValidDate:value=>{
  const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return false;
  const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]),date=new Date(Date.UTC(y,m-1,d));
  return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
 }
};
vm.createContext(sandbox);
vm.runInContext(html.slice(identityStart,identityEnd),sandbox);
vm.runInContext(html.slice(payloadStart,payloadEnd),sandbox);

const students=[
 {id:'s1',last:'وائل',first:'عيسو',class:'3',schoolYear:'أولى',branch:'متوسط'},
 {id:'s2',last:'وائل',first:'عيسو',class:'4',schoolYear:'أولى',branch:'متوسط'},
 {id:'s3',last:'أحمد',first:'أمين',class:'1',schoolYear:'أولى',branch:'متوسط'}
];
const records=[
 {id:'r-id',student:'s3',studentName:'أحمد أمين',class:'1',status:'قيد المتابعة',nextDate:'2026-11-28',observation:'نص خاص',actionTaken:'إجراء خاص',result:'نتيجة خاصة'},
 {id:'r-legacy-safe',student:'old-unknown',studentName:'وائل عيسو',class:'٣',status:'قيد المتابعة',nextDate:'2026-11-26',observation:'ملاحظة لا ترسل'},
 {id:'r-ambiguous',student:'old-unknown',studentName:'وائل عيسو',class:'',status:'قيد المتابعة',nextDate:'2026-11-27'},
 {id:'r-no-match',student:'old-unknown',studentName:'اسم غير موجود',class:'9',status:'قيد المتابعة',nextDate:'2026-11-27'},
 {id:'r-done',student:'s3',status:'تمت المتابعة',nextDate:'2026-11-25'},
 {id:'r-closed',student:'s3',status:'أغلقت الحالة',nextDate:'2026-11-25'},
 {id:'r-invalid-date',student:'s3',status:'قيد المتابعة',nextDate:'2026-02-30'},
 {id:'r-no-date',student:'s3',status:'قيد المتابعة',nextDate:''}
];
const original=JSON.stringify(records);
const plan=sandbox.buildStudentFollowupReminderPayload(records,students);
assert.deepEqual(JSON.parse(JSON.stringify(plan.reminders)),[
 {id:'r-legacy-safe',status:'قيد المتابعة',nextDate:'2026-11-26'},
 {id:'r-id',status:'قيد المتابعة',nextDate:'2026-11-28'}
],'only active reviews with one verified student identity are scheduled in date order');
assert.equal(plan.unlinked,2,'ambiguous and unmatched legacy follow-ups are not assigned to a student');
assert.equal(plan.invalid,2,'invalid date and missing date do not create native alarms');
assert.equal(plan.overflow,false,'normal reminder count stays within the native bound');
const nativePayload=JSON.stringify(plan.reminders);
for(const privateText of ['وائل','أحمد','نص خاص','إجراء خاص','نتيجة خاصة','ملاحظة لا ترسل','studentName','observation','actionTaken','result','phone']){
 assert.ok(!nativePayload.includes(privateText),'native reminder payload omits private student data: '+privateText);
}
assert.equal(JSON.stringify(records),original,'payload planning does not mutate existing follow-up records');

const empty=sandbox.buildStudentFollowupReminderPayload(null,null);
assert.deepEqual(JSON.parse(JSON.stringify(empty)),{reminders:[],unlinked:0,invalid:0,overflow:false},'missing legacy follow-up and student lists are backward compatible');

const huge=Array.from({length:2001},(_,i)=>({id:'r-'+i,student:'s3',status:'قيد المتابعة',nextDate:'2026-12-01'}));
const overflow=sandbox.buildStudentFollowupReminderPayload(huge,students);
assert.equal(overflow.overflow,true,'oversized schedules are rejected instead of silently truncating and cancelling valid reminders');
assert.equal(overflow.reminders.length,2001,'overflow detection preserves the complete calculated set');

const javaScheduler=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/StudentFollowupReminderScheduler.java','utf8');
const javaReceiver=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/StudentFollowupReminderReceiver.java','utf8');
const boot=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/ReminderBootReceiver.java','utf8');
const manifest=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
const main=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java','utf8');
assert.ok(javaScheduler.includes('StudentFollowupReminderPlanner.MAX_LATE_DELIVERY_MS'),'native scheduler discards stale reminders after the recovery window');
assert.ok(javaScheduler.includes('old.optBoolean("delivered", false)')&&javaScheduler.includes('item.put("delivered", true)'),'native scheduler persists delivered state to prevent duplicate notifications');
assert.ok(javaScheduler.includes('cancel(context, id)')&&javaScheduler.includes('cancelKeys'),'removed, completed or rescheduled reviews cancel the old alarm and notification');
assert.ok(javaScheduler.includes('waitingForPermission')&&javaScheduler.includes('waitingForScheduling'),'permission and scheduling failures remain recoverable');
assert.ok(javaScheduler.includes('if (old.optBoolean("waitingForScheduling", false))')&&javaScheduler.includes('scheduleKeys.add(id)'),'a later native sync retries a previously failed future alarm');
assert.ok(javaScheduler.includes('item.remove("waitingForScheduling")'),'successful retry clears the scheduling failure marker');
assert.ok(javaReceiver.includes('Notification.VISIBILITY_PRIVATE'),'review notification hides detail on the lock screen');
assert.ok(javaReceiver.includes('يوجد سجل متابعة تربوية يحتاج إلى المراجعة')&&!javaReceiver.includes('item.optString("studentName"'),'notification body is generic and never reads student details');
assert.ok(manifest.includes('.StudentFollowupReminderReceiver'),'Android manifest registers the review reminder receiver');
assert.ok(boot.includes('StudentFollowupReminderScheduler.rescheduleAll(context)'),'reminders are restored after reboot and clock/timezone changes');
assert.ok(main.includes('StudentFollowupReminderScheduler.sync(MainActivity.this, payload)'),'native bridge synchronizes reminder plans');
assert.ok(main.includes('StudentFollowupReminderScheduler.rescheduleAll(this)'),'activity resume and notification permission renewal restore scheduled reviews');
assert.ok(html.includes('syncStudentFollowupRemindersWithAndroid(false)')&&html.includes('syncStudentFollowupRemindersWithAndroid(true)'),'successful saves and initial load synchronize active review reminders');

assert.ok(html.includes('تذكيرات أندرويد العامة للمراجعات النشطة يوم الموعد عند 08:00')&&html.includes('موعد المراجعة المقبلة (التذكير 08:00)'),'the profile explains the local 08:00 reminder time and generic privacy-safe notification');

console.log('PASS: educational follow-up reminder payload identity filtering, privacy minimization, schedule bounds, no-mutation behavior, retryable scheduling, idempotent native delivery, cancellation, permissions and reboot recovery.');
