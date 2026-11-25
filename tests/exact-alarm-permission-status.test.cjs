const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const java = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');

assert.ok(html.includes('id="exactAlarmPermissionStatus"'), 'settings show exact-alarm permission status');
assert.ok(html.includes('function renderExactAlarmPermissionStatus(granted)'), 'exact-alarm status has one renderer');
assert.ok(html.includes('التنبيهات الدقيقة متاحة؛ يُضبط التذكير على الوقت المحدد.'), 'granted state explains exact timing');
assert.ok(html.includes('التنبيهات الدقيقة غير مفعّلة؛ قد يصل التذكير في وقت تقريبي حسب نظام الهاتف.'), 'denied state explains inexact fallback');
assert.ok(html.includes('window.onMushrifiExactAlarmPermissionChanged=granted=>renderExactAlarmPermissionStatus(!!granted)'), 'native permission updates reach the interface');
assert.ok(html.includes('refreshExactAlarmPermissionStatus();if(window.AndroidBridge'), 'exact-alarm status is read when the app interface loads');
assert.ok(java.includes('private boolean exactAlarmAccessGranted()'), 'native helper reads the real system permission');
assert.ok(java.includes('alarms != null && alarms.canScheduleExactAlarms()'), 'Android AlarmManager is the permission source');
assert.ok(java.includes('@JavascriptInterface public boolean hasExactAlarmAccess() {\n            return exactAlarmAccessGranted();'), 'the web bridge uses the native permission result');
assert.ok(java.includes('private void notifyExactAlarmPermissionState()'), 'native layer exposes a permission-state callback');
assert.ok(java.includes('window.onMushrifiExactAlarmPermissionChanged && window.onMushrifiExactAlarmPermissionChanged('), 'native callback sends exact-alarm state');
assert.ok(java.includes('rescheduleStoredReminders();\n        notifyExactAlarmPermissionState();\n        checkLicenseWhenDue();'), 'returning from Android settings refreshes permission status');
assert.ok(java.includes('alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderMillis, pending)'), 'exact alarms are used when Android grants access');
assert.ok(java.includes('alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, reminderMillis, pending)'), 'safe inexact fallback remains when exact alarms are unavailable');
assert.ok(java.includes('Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM'), 'user can open Android exact-alarm access settings');

console.log('PASS: exact-alarm permission status, native refresh on resume, and honest inexact fallback are covered.');
