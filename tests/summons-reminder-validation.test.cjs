const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const start = html.indexOf('function parseLocalDateTime(value){');
const end = html.indexOf('function scheduleSummonsReminder(d){', start);
assert.ok(start >= 0 && end > start, 'summons reminder validation helpers must exist');
const helpers = new Function(html.slice(start, end) + '; return {parseLocalDateTime, validateSummonsReminder, localDateTimeValue};')();
const now = new Date(2026, 10, 18, 10, 0).getTime();
const appointment = '2026-11-20T10:00';
assert.equal(helpers.validateSummonsReminder(appointment, '2026-11-19T10:00', now), '');
assert.match(helpers.validateSummonsReminder(appointment, '2026-11-21T10:00', now), /يسبق التنبيه/);
assert.match(helpers.validateSummonsReminder(appointment, '2026-11-20T10:00', now), /يسبق التنبيه/);
assert.match(helpers.validateSummonsReminder(appointment, '2026-11-17T10:00', now), /في المستقبل/);
assert.match(helpers.validateSummonsReminder('2026-11-17T10:00', '2026-11-19T10:00', now), /موعد حضور الولي في المستقبل/);
assert.match(helpers.validateSummonsReminder(appointment, '2026-02-30T10:00', now), /غير صحيح/);
assert.equal(helpers.parseLocalDateTime(appointment), new Date(2026, 10, 20, 10, 0).getTime(),
  'datetime-local must be parsed in device-local time');
assert.ok(html.includes("Math.min(now+5*60*1000,appointmentMs-1000)"),
  'near-term summons must receive a reminder suggestion strictly before the appointment when possible');
const main = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');
const boot = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/ReminderBootReceiver.java', 'utf8');
assert.match(main, /static boolean isValidReminderTime\(long reminderMillis, long appointmentMillis\)/);
assert.match(main, /!isValidReminderTime\(reminderMillis, appointmentMillis\)/);
assert.match(main, /if \(!isValidReminderTime\(reminder, appointment\)\)/);
assert.match(boot, /MainActivity\.isValidReminderTime\(reminder, appointment\)/);
console.log('Summons reminder validation regression tests passed.');
