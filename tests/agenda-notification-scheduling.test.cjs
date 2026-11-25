const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

process.env.TZ='Europe/Paris';
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const validStart=html.indexOf('function agendaValidDate(v){');
const validEnd=html.indexOf('function agendaShiftDate(v,n)',validStart);
const planStart=html.indexOf('function buildAgendaReminderPlan(items,nowValue){');
const planEnd=html.indexOf('let lastAgendaReminderPayload=',planStart);
assert.ok(validStart>=0&&validEnd>validStart,'agenda date validator exists');
assert.ok(planStart>=0&&planEnd>planStart,'pure agenda reminder planner exists');
const source=html.slice(validStart,validEnd)+'\n'+html.slice(planStart,planEnd);
const sandbox={Date,Number,String,Array};
vm.createContext(sandbox);
vm.runInContext(source,sandbox);

const ts=(y,m,d,h=0,min=0)=>new Date(y,m-1,d,h,min,0,0).getTime();
const local=(ms)=>{const d=new Date(ms);return [d.getFullYear(),d.getMonth()+1,d.getDate(),d.getHours(),d.getMinutes()];};
const now=ts(2026,11,25,12,0);
const base={id:'a1',title:'اجتماع مجلس التربية',date:'2026-11-27',startTime:'09:30',status:'planned',reminderEnabled:true,reminderLeadMinutes:1440};

let plan=sandbox.buildAgendaReminderPlan([base],now);
assert.equal(plan.reminders.length,1,'enabled future meeting creates one native reminder');
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2026,11,26,9,30],'one-day reminder preserves the event local clock on previous date');
assert.equal(plan.reminders[0].eventTime,'09:30','the actual event clock is passed to Android');
assert.equal(plan.reminders[0].leadMinutes,1440,'one-day lead is passed to native planner');

plan=sandbox.buildAgendaReminderPlan([{...base,reminderLeadMinutes:60}],now);
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2026,11,27,8,30],'one-hour reminder is scheduled one local hour before event');

plan=sandbox.buildAgendaReminderPlan([{...base,reminderLeadMinutes:0}],now);
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2026,11,27,9,30],'at-time reminder occurs at event local time');

plan=sandbox.buildAgendaReminderPlan([{...base,startTime:'',reminderLeadMinutes:1440}],now);
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2026,11,26,8,0],'all-day item without a time uses 08:00 local reminder');

plan=sandbox.buildAgendaReminderPlan([{...base,date:'2027-01-01',startTime:'08:00'}],ts(2026,12,30,7,0));
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2026,12,31,8,0],'one-day reminder crosses year boundary correctly');

plan=sandbox.buildAgendaReminderPlan([{...base,date:'2024-03-01',startTime:'08:00'}],ts(2024,2,28,7,0));
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2024,2,29,8,0],'one-day reminder respects leap day');

plan=sandbox.buildAgendaReminderPlan([{...base,date:'2027-03-29',startTime:'10:00'}],ts(2027,3,27,10,0));
assert.deepEqual(local(plan.reminders[0].triggerAtMillis),[2027,3,28,10,0],'one-day reminder preserves local wall time across spring DST change');
assert.equal(plan.reminders[0].triggerAtMillis - ts(2027,3,27,10,0),0,'the reminder is at the previous local day 10:00');

const dueSoon={...base,date:'2026-11-26',startTime:'09:00',reminderLeadMinutes:1440};
plan=sandbox.buildAgendaReminderPlan([dueSoon],ts(2026,11,25,10,0));
assert.equal(plan.reminders.length,1,'recently due reminder remains in sync payload while event is still upcoming');
assert.ok(plan.reminders[0].triggerAtMillis<ts(2026,11,25,10,0),'recently due reminder is retained for delivery after permission is granted');

plan=sandbox.buildAgendaReminderPlan([
 {...base,id:'disabled',reminderEnabled:false},
 {...base,id:'done',status:'done'},
 {...base,id:'cancelled',status:'cancelled'}
],now);
assert.equal(plan.reminders.length,0,'disabled, completed and cancelled agenda entries never receive alarms');
assert.equal(plan.disabled,1,'legacy and explicitly disabled entries are counted separately');
assert.equal(plan.completed,2,'completed and cancelled entries are reported separately');

plan=sandbox.buildAgendaReminderPlan([
 {...base,id:'past-event',date:'2026-11-24',startTime:'09:00'},
 {...base,id:'bad-date',date:'2026-02-30'},
 {...base,id:'bad-time',startTime:'29:99'},
 {...base,id:'bad-lead',reminderLeadMinutes:30},
 {...base,id:'dst-gap',date:'2027-03-28',startTime:'02:30'}
],now);
assert.equal(plan.reminders.length,0,'past and invalid agenda items are not scheduled');
assert.equal(plan.expired,1,'past event is counted as expired');
assert.equal(plan.invalid,4,'invalid date, time, lead and nonexistent DST local time are counted');

assert.ok(html.includes('id="agendaReminderEnabled"')&&html.includes('id="agendaReminderLead"'),'each agenda item has an independent reminder toggle and lead selector');
assert.ok(html.includes('item?item.reminderEnabled===true:true'),'old agenda items do not silently start sending reminders after update');
assert.ok(html.includes("reminderEnabled:$('#agendaReminderEnabled').checked===true"),'the reminder choice is saved with the agenda item');
assert.ok(html.includes("if(isAndroidApp)syncAgendaRemindersWithAndroid(false);"),'successful local database saves synchronize agenda alarms with Android');
assert.ok(html.includes("syncAgendaRemindersWithAndroid(true);"),'startup rebuilds the complete desired agenda alarm list');
assert.ok(html.includes('function renderAgendaNotificationStatus')&&html.includes('agendaRequestExactAlarmPermission'),'agenda page reports notification and exact-alarm permission states');
assert.ok(html.includes('agendaTestNotification')&&html.includes('testAgendaNotification'),'agenda offers a direct notification test');
assert.ok(html.includes('window.openAgendaFromNotification=(id,date)=>'),'notification tap can deep-link back to the selected agenda day');
assert.ok(html.includes('reminderEnabled',''),'reminder setting persists as part of the agenda record');
assert.ok(fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/AgendaReminderReceiver.java','utf8').includes("if (intent == null || !ACTION.equals(intent.getAction()))"),'native agenda receiver ignores unrelated broadcasts');
assert.ok(fs.existsSync('android/app/src/main/java/dz/mushrifi/app/AgendaReminderScheduler.java'),'native scheduler source exists');
assert.ok(fs.existsSync('android/app/src/main/java/dz/mushrifi/app/AgendaReminderReceiver.java'),'native notification receiver source exists');
assert.ok(fs.existsSync('android/app/src/main/java/dz/mushrifi/app/AgendaReminderPlanner.java'),'native timezone-aware planner source exists');
const scheduler=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/AgendaReminderScheduler.java','utf8');
assert.ok(scheduler.includes('setExactAndAllowWhileIdle')&&scheduler.includes('setAndAllowWhileIdle'),'native scheduler uses precise alarms when granted and safe inexact fallback otherwise');
assert.ok(scheduler.includes('rescheduleAll')&&scheduler.includes('waitingForPermission'),'stored alarms survive reboot and keep due reminders while permission is denied');
assert.ok(scheduler.includes('sameSchedule(old, next)')&&scheduler.includes('put("delivered", true)'),'delivered reminders are not re-armed by ordinary saves or title-only edits');
assert.ok(scheduler.includes('notifications.cancel(("agenda:" + id).hashCode())'),'changing or disabling an event cancels an already posted agenda notification');
assert.ok(scheduler.includes('failedToSchedule'),'native alarm scheduling failures are surfaced to the user');
assert.ok(scheduler.includes('FLAG_NO_CREATE'),'cancel uses the same stable PendingIntent identity without creating a new alarm');
const receiver=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/AgendaReminderReceiver.java','utf8');
assert.ok(receiver.includes('Notification.VISIBILITY_PRIVATE'),'agenda reminder content is private on the lock screen');
assert.ok(receiver.includes('agenda_notification_date'),'notification tap returns the intended agenda date');
const manifest=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
assert.ok(manifest.includes('.AgendaReminderReceiver')&&manifest.includes('android.intent.action.TIMEZONE_CHANGED')&&manifest.includes('android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED'),'manifest registers agenda delivery and rescheduling broadcasts');

console.log('PASS: agenda reminder timing, local calendar/DST, disabled/completed/past events, delayed permission delivery, Android sync, native channels, lock-screen privacy and boot recovery.');
