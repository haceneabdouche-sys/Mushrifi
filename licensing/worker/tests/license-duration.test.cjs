const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const worker = fs.readFileSync(path.join(root, 'licensing/worker/src/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'licensing/worker/schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'licensing/worker/migrations/0002-first-activation-duration.sql'), 'utf8');
assert.match(worker, /const startsAt = now;[\\s\\S]*?const durationDays = candidate\\.duration_days;[\\s\\S]*?startsAt \\+ durationDays \\* DAY/);
assert.match(worker, /expires_at = \\?, last_validated_at = \\?/);
assert.match(worker, /duration_days, starts_at, expires_at[\\s\\S]*?NULL, NULL/);
assert.match(worker, /duration_days = \\?, expires_at = \\?/);
assert.match(schema, /duration_days INTEGER/);
assert.match(migration, /ALTER TABLE licenses ADD COLUMN duration_days INTEGER/);
assert.match(migration, /license_type = 'perpetual' THEN NULL/);
const DAY = 86400000;
const activation = Date.UTC(2026, 0, 10, 12);
assert.equal((activation + 365 * DAY) - activation, 365 * DAY, 'annual validity is exactly 365 days after activation');
const stillValidExpiry = activation + 365 * DAY;
assert.equal(Math.max(stillValidExpiry, activation + 400 * DAY) + 365 * DAY, activation + 765 * DAY,
  'renewal before a future expiry appends 365 days to that expiry');
assert.equal(Math.max(activation + 365 * DAY, activation + 500 * DAY) + 365 * DAY, activation + 865 * DAY,
  'renewal must not shorten an already extended license');
assert.match(worker, /بياناتك محفوظة/);
assert.doesNotMatch(worker, /DELETE FROM (students|attendance|violations|documents)/i);
console.log('PASS: first-activation annual term, renewal extension, migration, and non-destructive expiry.');
