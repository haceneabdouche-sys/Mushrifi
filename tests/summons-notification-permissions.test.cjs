const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const java = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const receiver = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/SummonsReminderReceiver.java', 'utf8');
const boot = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/ReminderBootReceiver.java', 'utf8');
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

assert.ok(html.includes('id="notificationPermissionStatus"'), 'settings show notification permission state');
assert.ok(html.includes('id="requestNotificationPermission"'), 'settings expose a dedicated permission request button');
assert.ok(html.includes('function renderNotificationPermissionStatus(granted)'), 'permission state has one renderer');
assert.ok(html.includes("AndroidBridge.hasNotificationPermission()"), 'permission state is read from the native bridge');
assert.ok(html.includes('window.onMushrifiNotificationPermissionChanged=granted=>renderNotificationPermissionStatus(!!granted)'), 'native permission result refreshes the status');
assert.ok(html.includes("AndroidBridge.requestNotificationPermission()"), 'settings button calls the native permission request');
assert.ok(html.includes("refreshNotificationPermissionStatus();refreshExactAlarmPermissionStatus();if(window.AndroidBridge"), 'notification and exact-alarm permission states are refreshed when the dashboard loads');

assert.ok(java.includes('@JavascriptInterface public boolean hasNotificationPermission()'), 'native bridge reports notification permission');
assert.ok(java.includes('Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED'), 'pre-Android 13 devices do not require the runtime permission');
assert.ok(java.includes('@JavascriptInterface public void requestNotificationPermission()'), 'native bridge can request notification permission');
assert.ok(java.includes('requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION)'), 'native bridge requests the Android notification permission');
assert.ok(java.includes('@Override public void onRequestPermissionsResult('), 'permission result is handled');
assert.ok(java.includes('notifyNotificationPermissionState(granted)'), 'permission result is returned to the web UI');
assert.ok(java.includes('if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions'), 'initial app permission request remains in place');

assert.ok(receiver.includes('if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;'), 'scheduled notifications are not posted without permission');
assert.ok(java.includes('putString(id, studentName + "|" + reminderMillis + "|" + appointmentMillis)'), 'scheduled summons reminders are persisted for recovery');
assert.ok(java.includes('rescheduleStoredReminders();'), 'stored reminders are restored when the app resumes');
assert.ok(boot.includes('Intent.ACTION_BOOT_COMPLETED'), 'reminders are restored after device reboot');
assert.ok(boot.includes('MainActivity.scheduleReminder(context, id, parts[0], reminder)'), 'boot receiver re-schedules future reminders');
assert.ok(manifest.includes('android.permission.RECEIVE_BOOT_COMPLETED'), 'boot receiver has the required permission');
assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'), 'manifest declares notification permission');

const deleteStart = html.indexOf('window.delRecord=(kind,id)=>{');
const deleteEnd = html.indexOf('window.editDocument=id=>', deleteStart);
assert.ok(deleteStart >= 0 && deleteEnd > deleteStart, 'document delete handler is present');
assert.ok(html.slice(deleteStart, deleteEnd).includes('AndroidBridge.cancelSummonsReminder(String(id))'), 'deleting a document cancels its pending reminder');

const editStart = html.indexOf('window.saveDocumentEdit=id=>{');
const editEnd = html.indexOf('// مطابقة أسماء التلاميذ', editStart);
assert.ok(editStart >= 0 && editEnd > editStart, 'document edit handler is present');
const editHandler = html.slice(editStart, editEnd);
assert.ok(editHandler.includes('AndroidBridge.cancelSummonsReminder(String(id))'), 'editing a document cancels its previous reminder');
assert.ok(editHandler.includes('scheduleSummonsReminder(d)'), 'editing a summons re-schedules its reminder');
assert.ok(editHandler.includes("d.type==='استدعاء ولي'"), 'only guardian summons are scheduled');

console.log('PASS: notification permission visibility, native permission callback, summons reminder persistence, reboot recovery, edit and delete cancellation.');
