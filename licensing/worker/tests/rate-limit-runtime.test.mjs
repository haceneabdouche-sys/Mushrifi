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

console.log("PASS: runtime rate-limit bindings return 429 with Retry-After for all protected routes and fail closed with 503.");
