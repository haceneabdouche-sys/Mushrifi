import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const productionDatabaseId = "bb241e07-ed80-4a29-b10f-7ebe7b104cf8";
const staging = config.split("[env.staging]")[1];
assert.ok(staging, "wrangler.toml must define an explicit staging environment");
assert.ok(staging.includes('name = "mushrifi-license-server-staging"'), "staging must deploy as a separate Worker");
assert.ok(staging.includes('database_name = "mushrifi-licenses-staging"'), "staging must use a separately named D1 database");
const databaseId = staging.match(/database_id\s*=\s*"([^"]+)"/)?.[1];
assert.ok(databaseId, "staging D1 database ID must be explicitly configured");
assert.notEqual(databaseId, productionDatabaseId, "staging must never bind to the production D1 database");
assert.equal(databaseId, "REPLACE_WITH_STAGING_D1_DATABASE_ID", "staging deployment must remain blocked until a real staging D1 ID is deliberately configured");

const expected = [
  ["RATE_LIMIT_CHALLENGE", "2026111911", 30],
  ["RATE_LIMIT_ACTIVATE", "2026111912", 10],
  ["RATE_LIMIT_VALIDATE", "2026111913", 20],
  ["RATE_LIMIT_ADMIN", "2026111914", 30]
];
const blocks = staging.split("[[env.staging.ratelimits]]").slice(1);
const ids = new Set();
for (const [name, namespaceId, limit] of expected) {
  const block = blocks.find(value => value.includes('name = "' + name + '"'));
  assert.ok(block, "staging must define " + name);
  assert.ok(block.includes('namespace_id = "' + namespaceId + '"'), name + " must use its dedicated staging namespace");
  assert.ok(block.includes("limit = " + limit), name + " must preserve the intended threshold");
  assert.ok(block.includes("period = 60"), name + " must use a 60-second window");
  assert.ok(!ids.has(namespaceId), "staging rate-limit namespace IDs must be unique");
  ids.add(namespaceId);
}
for (const id of ["2026111901", "2026111902", "2026111903", "2026111904"]) {
  assert.ok(!ids.has(id), "staging rate-limit namespaces must not reuse root/production IDs");
}
console.log("PASS: staging uses a separate Worker, a guarded non-production D1 placeholder, and dedicated rate-limit namespaces.");
