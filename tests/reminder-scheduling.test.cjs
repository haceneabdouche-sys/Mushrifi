const assert = require('node:assert/strict');
const fs = require('node:fs');

const java = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

assert.match(java, /private final ExecutorService reminderExecutor = Executors\.newSingleThreadExecutor\(\);/);
assert.match(java, /private final AtomicBoolean reminderRescheduleQueued = new AtomicBoolean\(false\);/);
assert.match(java, /private void rescheduleStoredReminders\(\)[\s\S]*?reminderExecutor\.execute\(\(\) -> \{/);
assert.match(java, /@JavascriptInterface public void replaceSummonsReminders\(String json\)[\s\S]*?reminderExecutor\.execute\(\(\) -> \{/);
assert.match(java, /@Override protected void onResume\(\)[\s\S]*?rescheduleStoredReminders\(\);/);
assert.match(html, /AndroidBridge\.replaceSummonsReminders\(JSON\.stringify\(reminders\)\)/);
assert.doesNotMatch(html, /AndroidBridge\.clearSummonsReminders\(\);\s*if\(window\.AndroidBridge&&typeof AndroidBridge\.scheduleSummonsReminder==='function'\)db\.documents\.filter/);

console.log('Mushrifi reminder scheduling regression tests passed.');
