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
assert.equal(helpers.validateSummonsReminder(appointment, '2026-11-21T10:00', now), '',
  'user-selected reminder after appointment is permitted by the form');
assert.match(helpers.validateSummonsReminder(appointment, '2026-11-17T10:00', now), /في المستقبل/);
assert.match(helpers.validateSummonsReminder('2026-11-17T10:00', '2026-11-19T10:00', now), /موعد حضور الولي في المستقبل/);
assert.match(helpers.validateSummonsReminder(appointment, '2026-02-30T10:00', now), /غير صحيح/);
assert.equal(helpers.parseLocalDateTime(appointment), new Date(2026, 10, 20, 10, 0).getTime(),
  'datetime-local must be parsed in device-local time');
assert.ok(html.includes("reminderMs=oneHourBefore>now?oneHourBefore:now+5*60*1000"),
  'near-term summons should not receive an automatically expired reminder suggestion');
console.log('Summons reminder validation regression tests passed.');
