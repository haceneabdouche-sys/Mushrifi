import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

const expected = [
  ["RATE_LIMIT_CHALLENGE", "2026111901", 30],
  ["RATE_LIMIT_ACTIVATE", "2026111902", 10],
  ["RATE_LIMIT_VALIDATE", "2026111903", 20],
  ["RATE_LIMIT_ADMIN", "2026111904", 30]
];
const blocks = config.split("[[ratelimits]]").slice(1);
const ids = new Set();

for (const [name, namespaceId, limit] of expected) {
  const block = blocks.find(value => value.includes('name = "' + name + '"'));
  assert.ok(block, name + " must be configured in wrangler.toml");
  assert.ok(block.includes('namespace_id = "' + namespaceId + '"'), name + " must use its assigned namespace");
  assert.ok(block.includes("limit = " + limit), name + " must have its intended threshold");
  assert.ok(block.includes("period = 60"), name + " must use a 60-second window");
  assert.ok(!ids.has(namespaceId), "rate-limit namespace IDs must be unique");
  ids.add(namespaceId);
  assert.ok(worker.includes(name + ": RateLimit"), name + " must be declared in the Worker environment");
}

assert.ok(worker.includes("await limiter.limit({ key: clientIp })"), "limits must be keyed by the connecting client IP");
assert.ok(worker.includes(", 429)"), "exceeded limits must return HTTP 429");
assert.ok(worker.includes('response.headers.set("retry-after", "60")'), "429 responses must include Retry-After");
assert.ok(worker.includes('env.MUSHRIFI_RATE_LIMITS_TEST_BYPASS === "true"'), "local test bypass must be explicit");
assert.ok(worker.includes("خدمة الحماية غير متاحة مؤقتاً"), "limiter errors must fail closed");
for (const [name] of expected) assert.ok(worker.includes("env." + name), name + " must be connected to an endpoint");

console.log("PASS: Worker rate-limit bindings, unique namespaces, endpoint routing, 429 response, and fail-closed behavior.");
