import assert from "node:assert/strict";
import worker from "../src/index.ts";

const routes = [
  { path: "/v1/challenge", method: "POST", binding: "RATE_LIMIT_CHALLENGE" },
  { path: "/v1/activate", method: "POST", binding: "RATE_LIMIT_ACTIVATE" },
  { path: "/v1/validate", method: "POST", binding: "RATE_LIMIT_VALIDATE" },
  { path: "/v1/admin/licenses", method: "GET", binding: "RATE_LIMIT_ADMIN" }
];

for (const route of routes) {
  let calls = 0;
  let receivedKey = "";
  const env = {
    ADMIN_API_TOKEN: "test-admin-token",
    MUSHRIFI_RATE_LIMITS_TEST_BYPASS: "false",
    RATE_LIMIT_CHALLENGE: { limit: async ({ key }) => { calls++; receivedKey = key; return { success: false }; } },
    RATE_LIMIT_ACTIVATE: { limit: async ({ key }) => { calls++; receivedKey = key; return { success: false }; } },
    RATE_LIMIT_VALIDATE: { limit: async ({ key }) => { calls++; receivedKey = key; return { success: false }; } },
    RATE_LIMIT_ADMIN: { limit: async ({ key }) => { calls++; receivedKey = key; return { success: false }; } }
  };
  const request = new Request("https://mushrifi-test.example" + route.path, {
    method: route.method,
    headers: { "cf-connecting-ip": "203.0.113.17" }
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 429, route.path + " must reject a rate-limited request");
  assert.equal(response.headers.get("retry-after"), "60", route.path + " must tell clients when to retry");
  assert.equal(calls, 1, route.path + " must consult exactly one limiter");
  assert.equal(receivedKey, "203.0.113.17", route.path + " must use the connecting client IP");
}

// A limiter backend failure must fail closed instead of allowing the protected request through.
const unavailableEnv = {
  ADMIN_API_TOKEN: "test-admin-token",
  RATE_LIMIT_CHALLENGE: { limit: async () => { throw new Error("simulated unavailable limiter"); } },
  RATE_LIMIT_ACTIVATE: { limit: async () => ({ success: true }) },
  RATE_LIMIT_VALIDATE: { limit: async () => ({ success: true }) },
  RATE_LIMIT_ADMIN: { limit: async () => ({ success: true }) }
};
const unavailableResponse = await worker.fetch(
  new Request("https://mushrifi-test.example/v1/challenge", { method: "POST" }),
  unavailableEnv
);
assert.equal(unavailableResponse.status, 503, "limiter backend failure must fail closed");



// The local-only test bypass must never disable limits on a public hostname.
let publicBypassCalls = 0;
const publicBypassEnv = {
  MUSHRIFI_RATE_LIMITS_TEST_BYPASS: "true",
  RATE_LIMIT_CHALLENGE: { limit: async () => { publicBypassCalls++; return { success: false }; } },
  RATE_LIMIT_ACTIVATE: { limit: async () => ({ success: true }) },
  RATE_LIMIT_VALIDATE: { limit: async () => ({ success: true }) },
  RATE_LIMIT_ADMIN: { limit: async () => ({ success: true }) }
};
const publicBypassResponse = await worker.fetch(
  new Request("https://api.mushrifi.example/v1/challenge", { method: "POST" }),
  publicBypassEnv
);
assert.equal(publicBypassResponse.status, 429, "test bypass must not work on public hostnames");
assert.equal(publicBypassCalls, 1, "public requests must still consult Cloudflare rate limiting");

// On loopback only, the explicit CI bypass avoids requiring Cloudflare's hosted counter.
let localBypassCalls = 0;
const localBypassEnv = {
  MUSHRIFI_RATE_LIMITS_TEST_BYPASS: "true",
  RATE_LIMIT_CHALLENGE: { limit: async () => { localBypassCalls++; return { success: false }; } },
  RATE_LIMIT_ACTIVATE: { limit: async () => ({ success: true }) },
  RATE_LIMIT_VALIDATE: { limit: async () => ({ success: true }) },
  RATE_LIMIT_ADMIN: { limit: async () => ({ success: true }) }
};
const localBypassResponse = await worker.fetch(
  new Request("http://127.0.0.1:8787/v1/challenge", { method: "POST" }),
  localBypassEnv
);
assert.equal(localBypassResponse.status, 400, "loopback bypass should reach normal challenge validation");
assert.equal(localBypassCalls, 0, "loopback test bypass must skip the hosted limiter");

console.log("PASS: runtime rate-limit bindings return 429 with Retry-After, fail closed with 503, and restrict the test bypass to loopback.");
