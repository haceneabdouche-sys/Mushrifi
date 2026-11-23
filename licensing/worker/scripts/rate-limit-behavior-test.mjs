import { readFileSync } from "node:fs";
import ts from "typescript";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function body(response) {
  return response.json();
}

// Compile the real Worker entry point in memory; no files or deployments are changed.
const source = readFileSync("src/index.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  },
  reportDiagnostics: true
});
const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert(errors.length === 0, "Worker entry point could not be compiled for the behavior test");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(compiled.outputText).toString("base64");
const { default: worker } = await import(moduleUrl);

function makeLimiter(limit) {
  const counts = new Map();
  const calls = [];
  return {
    calls,
    async limit({ key }) {
      calls.push(key);
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return { success: count <= limit };
    }
  };
}

function makeEnv({ publicLimiter = makeLimiter(2), adminLimiter = makeLimiter(2), testLimiter } = {}) {
  let dbCalls = 0;
  const env = {
    DB: {
      prepare() {
        dbCalls++;
        throw new Error("The isolated rate-limit test must not access D1");
      },
      batch() {
        dbCalls++;
        throw new Error("The isolated rate-limit test must not access D1");
      }
    },
    ADMIN_API_TOKEN: "unit-test-admin-token",
    LICENSE_SIGNING_PRIVATE_KEY_PKCS8_B64: "",
    PUBLIC_RATE_LIMITER: publicLimiter,
    ADMIN_RATE_LIMITER: adminLimiter,
    TEST_RATE_LIMITER: testLimiter
  };
  return { env, getDbCalls: () => dbCalls };
}

async function publicRequest(env, ip = "203.0.113.10") {
  return worker.fetch(new Request("https://unit.test/v1/not-a-real-route", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip
    },
    body: "{}"
  }), env);
}

async function adminRequest(env, ip = "203.0.113.20") {
  return worker.fetch(new Request("https://unit.test/v1/admin/not-a-real-route", {
    method: "GET",
    headers: {
      authorization: "Bearer unit-test-admin-token",
      "cf-connecting-ip": ip
    }
  }), env);
}

async function probeRequest(env, ip = "203.0.113.30") {
  return worker.fetch(new Request("https://unit.test/__test/rate-limit-probe", {
    method: "GET",
    headers: { "cf-connecting-ip": ip }
  }), env);
}

// Public route: allow two requests, then reject the third with HTTP 429.
{
  const publicLimiter = makeLimiter(2);
  const { env, getDbCalls } = makeEnv({ publicLimiter });
  assert((await publicRequest(env)).status === 404, "First public request should pass the limiter and reach the harmless unknown route");
  assert((await publicRequest(env)).status === 404, "Second public request should pass the limiter and reach the harmless unknown route");
  const limited = await publicRequest(env);
  assert(limited.status === 429, "Third public request must be rate limited with HTTP 429");
  assert(limited.headers.get("retry-after") === "60", "Public 429 response must include Retry-After: 60");
  assert((await body(limited)).ok === false, "Public 429 response must use the standard error payload");
  assert(publicLimiter.calls.length === 3 && publicLimiter.calls.every(key => key === "203.0.113.10"),
    "Public limiter must receive the trusted client IP for every request");

  // A separate client key has its own counter in this deterministic mock.
  assert((await publicRequest(env, "203.0.113.11")).status === 404, "A separate client key should have an independent counter");
  assert(getDbCalls() === 0, "Public behavior test must not access D1");
}

// Admin routes use their own limiter and still require the admin token.
{
  const adminLimiter = makeLimiter(2);
  const { env, getDbCalls } = makeEnv({ adminLimiter });
  assert((await adminRequest(env)).status === 404, "First admin request should pass the limiter and reach the harmless unknown route");
  assert((await adminRequest(env)).status === 404, "Second admin request should pass the limiter and reach the harmless unknown route");
  const limited = await adminRequest(env);
  assert(limited.status === 429, "Third admin request must be rate limited with HTTP 429");
  assert(limited.headers.get("retry-after") === "60", "Admin 429 response must include Retry-After: 60");
  assert(adminLimiter.calls.length === 3 && adminLimiter.calls.every(key => key === "203.0.113.20"),
    "Admin limiter must receive the trusted client IP for every request");
  assert(getDbCalls() === 0, "Admin behavior test must not access D1");
}

// Health checks remain available and do not consume either rate-limit bucket.
{
  const publicLimiter = makeLimiter(2);
  const adminLimiter = makeLimiter(2);
  const { env, getDbCalls } = makeEnv({ publicLimiter, adminLimiter });
  const response = await worker.fetch(new Request("https://unit.test/health"), env);
  assert(response.status === 200, "Health endpoint should remain available");
  assert((await body(response)).service === "mushrifi-license-api", "Health endpoint should identify the license API");
  assert(publicLimiter.calls.length === 0 && adminLimiter.calls.length === 0,
    "Health endpoint must not consume rate-limit requests");
  assert(getDbCalls() === 0, "Health behavior test must not access D1");
}

// The staging-only probe has an independent low threshold and never accesses D1.
{
  const testLimiter = makeLimiter(3);
  const { env, getDbCalls } = makeEnv({ testLimiter });
  assert((await probeRequest(env)).status === 200, "Probe request 1 should pass");
  assert((await probeRequest(env)).status === 200, "Probe request 2 should pass");
  assert((await probeRequest(env)).status === 200, "Probe request 3 should pass");
  const limited = await probeRequest(env);
  assert(limited.status === 429, "Probe request 4 must be rate limited");
  assert(limited.headers.get("retry-after") === "60", "Probe 429 must include Retry-After: 60");
  assert(testLimiter.calls.length === 4, "Probe should call only its dedicated limiter");
  assert(getDbCalls() === 0, "Probe behavior test must not access D1");
}

// With no staging-only binding, the probe route is not available (production safe default).
{
  const { env, getDbCalls } = makeEnv();
  assert((await probeRequest(env)).status === 404, "Probe route must be disabled when its binding is absent");
  assert(getDbCalls() === 0, "Disabled probe must not access D1");
}

// Missing or failing protection must fail closed with HTTP 503, not bypass the limit.
{
  const brokenLimiter = { async limit() { throw new Error("simulated limiter outage"); } };
  const { env } = makeEnv({ publicLimiter: brokenLimiter });
  const response = await publicRequest(env);
  assert(response.status === 503, "Public requests must fail closed when the limiter throws");
}

{
  const { env } = makeEnv({ publicLimiter: undefined });
  env.PUBLIC_RATE_LIMITER = undefined;
  const response = await publicRequest(env);
  assert(response.status === 503, "Public requests must fail closed when the limiter binding is missing");
}

{
  const brokenLimiter = { async limit() { throw new Error("simulated limiter outage"); } };
  const { env } = makeEnv({ adminLimiter: brokenLimiter });
  const response = await adminRequest(env);
  assert(response.status === 503, "Admin requests must fail closed when the limiter throws");
}

console.log("PASS: public/admin/probe 429 behavior, client-key isolation, Retry-After, health bypass, production probe disablement, fail-closed handling, and zero D1 access.");
