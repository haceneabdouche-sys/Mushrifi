const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const java = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');

assert.ok(html.includes('الملف الفردي'));
assert.ok(html.includes('window.studentHistory=id=>'));
assert.ok(html.includes("go('reports')"));
for (const label of ['تفصيل الغيابات','تفصيل التأخرات','المخالفات','الاستدعاءات','غيابات مبررة','غيابات غير مبررة','قيد التبرير']) assert.ok(html.includes(label), 'student profile includes ' + label);

const start = html.indexOf("$('#saveDailyAbsences').onclick=()=>{");
const end = html.indexOf('function scheduledHoursForGroupDate', start);
assert.ok(start >= 0 && end > start, 'bulk attendance handler exists');
const bulk = html.slice(start, end);
assert.ok(bulk.includes('alreadyToday=new Set'), 'same-day attendance is guarded against duplication');
assert.ok(bulk.includes('const previous=db.attendance.slice()'), 'prior attendance snapshot is taken');
assert.ok(bulk.includes('if(!save()){db.attendance=previous;render();return;}'), 'failed batch save rolls back all appended records');
assert.ok(bulk.includes('presenceRecords.push'), 'batch workflow preserves return-to-school attendance trace');

assert.ok(html.includes('window.openGuardianWhatsApp=id=>'));
assert.ok(html.includes('student.phone'));
assert.ok(html.includes('encodeURIComponent(message)'));
assert.ok(html.includes('AndroidBridge.openGuardianWhatsApp(phone,message)'));
assert.ok(html.includes('مراسلة الولي عبر واتساب'));
assert.ok(html.includes("onclick=\"openGuardianWhatsApp('${s.id}')\""), 'profile WhatsApp action must use the selected student ID, not a literal placeholder');
assert.ok(java.includes('openGuardianWhatsApp(String phone, String message)'));
assert.ok(java.includes('Intent.ACTION_VIEW'));
assert.ok(java.includes('appendQueryParameter("text", safeMessage)'));

console.log('PASS: student profile, batch attendance rollback and guardian WhatsApp draft integrity.');