import { randomUUID } from "node:crypto";

const expectedHost = "mushrifi-license-server-staging.hacene47211.workers.dev";
const configuredUrl = process.env.MUSHRIFI_STAGING_URL || `https://${expectedHost}`;
const base = new URL(configuredUrl);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(base.protocol === "https:", "Staging probe must use HTTPS");
assert(base.hostname === expectedHost, "Refusing to send probe requests to any host other than the known Staging Worker");

async function get(path, extraHeaders = {}) {
  return fetch(new URL(path, base), {
    method: "GET",
    headers: { accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(15_000),
    redirect: "error"
  });
}

// Confirm the endpoint is the staging license service before testing its isolated probe.
const health = await get("/health");
assert(health.status === 200, `Staging health check returned HTTP ${health.status}`);
const healthPayload = await health.json();
assert(healthPayload.ok === true && healthPayload.service === "mushrifi-license-api",
  "Staging health response did not identify the expected service");

// Each test run uses a temporary session key so a previous CI attempt or another
// test run from the same runner IP cannot consume this probe's allowance.
const sessionId = randomUUID().replace(/-/g, "");
let blockedOnRequest = null;

// Cloudflare's Workers rate limiter is intentionally approximate. Require the
// first three requests to pass, then allow a small overshoot window while the
// local count synchronizes. Stop immediately once a real 429 is observed.
for (let index = 1; index <= 10; index++) {
  const response = await get("/__test/rate-limit-probe", {
    "x-mushrifi-probe-id": sessionId
  });

  if (response.status === 429) {
    assert(index >= 4, `Probe was blocked too early on request ${index}`);
    assert(response.headers.get("retry-after") === "60",
      "The live 429 response must include Retry-After: 60");
    const payload = await response.json();
    assert(payload.ok === false, "The live 429 response must use the standard error payload");
    blockedOnRequest = index;
    process.stdout.write(`PASS: staging probe was rate limited on request ${index} (HTTP 429, Retry-After: 60)\n`);
    break;
  }

  assert(response.status === 200,
    `Probe request ${index} should pass or be rate limited; got HTTP ${response.status}`);
  const payload = await response.json();
  assert(payload.ok === true && payload.probe === "rate-limit",
    `Probe request ${index} returned an unexpected payload`);
  if (index <= 3) process.stdout.write(`PASS: staging probe request ${index} allowed (HTTP 200)\n`);

  await new Promise(resolve => setTimeout(resolve, 200));
}

assert(blockedOnRequest !== null,
  "No HTTP 429 was observed within 10 harmless probe requests; review the Cloudflare Staging limiter configuration");

process.stdout.write("PASS: live Cloudflare Staging rate limiter enforced the isolated probe; no license or D1 operation was invoked.\n");
