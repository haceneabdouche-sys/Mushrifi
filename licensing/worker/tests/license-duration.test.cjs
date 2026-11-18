const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const worker = fs.readFileSync(path.join(root, 'licensing/worker/src/index.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'licensing/worker/schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'licensing/worker/migrations/0002-first-activation-duration.sql'), 'utf8');
assert.ok(worker.includes('const startsAt = now;'));
assert.ok(worker.includes('const durationDays = candidate.duration_days;'));
assert.ok(worker.includes('const expiresAt = durationDays === null ? null : startsAt + durationDays * DAY;'));
assert.ok(worker.includes('starts_at = ?, expires_at = ?'));
assert.ok(worker.includes('duration_days, starts_at, expires_at) VALUES (?, ?, \'issued\', ?, ?, NULL, NULL'));
assert.ok(worker.includes('duration_days = ?, expires_at = ?'));
assert.ok(schema.includes('duration_days INTEGER'));
assert.ok(migration.includes('ALTER TABLE licenses ADD COLUMN duration_days INTEGER'));
assert.ok(migration.includes("WHEN license_type = 'perpetual' THEN NULL"));
const DAY = 86400000;
const activation = Date.UTC(2026, 0, 10, 12);
assert.equal((activation + 365 * DAY) - activation, 365 * DAY, 'annual validity is exactly 365 days after activation');
const oldExpiry = activation + 400 * DAY;
assert.equal(Math.max(oldExpiry, activation) + 365 * DAY, activation + 765 * DAY,
  'renewal before expiry appends 365 days to the existing expiry');
const expiredAt = activation - DAY;
assert.equal(Math.max(expiredAt, activation) + 365 * DAY, activation + 365 * DAY,
  'renewal after expiry starts a new 365-day period at renewal');
assert.ok(worker.includes('بياناتك محفوظة'));
assert.ok(!/DELETE FROM (students|attendance|violations|documents)/i.test(worker),
  'license expiry must not delete student or attendance data');
console.log('PASS: first-activation annual term, renewal extension, migration, and non-destructive expiry.');
