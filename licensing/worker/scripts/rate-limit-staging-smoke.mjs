const expectedHost = "mushrifi-license-server-staging.hacene47211.workers.dev";
const configuredUrl = process.env.MUSHRIFI_STAGING_URL || `https://${expectedHost}`;
const base = new URL(configuredUrl);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(base.protocol === "https:", "Staging probe must use HTTPS");
assert(base.hostname === expectedHost, "Refusing to send probe requests to any host other than the known Staging Worker");

async function get(path) {
  return fetch(new URL(path, base), {
    method: "GET",
    headers: { accept: "application/json" },
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

// Exactly four harmless GET requests: the dedicated staging limiter allows three,
// and the fourth must be rejected. This route never reads or writes D1 or license data.
for (let index = 1; index <= 4; index++) {
  const response = await get("/__test/rate-limit-probe");
  if (index <= 3) {
    assert(response.status === 200,
      `Probe request ${index} should pass; got HTTP ${response.status}`);
    const payload = await response.json();
    assert(payload.ok === true && payload.probe === "rate-limit",
      `Probe request ${index} returned an unexpected payload`);
    process.stdout.write(`PASS: staging probe request ${index} allowed (HTTP 200)\n`);
  } else {
    assert(response.status === 429,
      `Probe request 4 should be rate limited; got HTTP ${response.status}`);
    assert(response.headers.get("retry-after") === "60",
      "The live 429 response must include Retry-After: 60");
    const payload = await response.json();
    assert(payload.ok === false, "The live 429 response must use the standard error payload");
    process.stdout.write("PASS: fourth staging probe request rejected (HTTP 429, Retry-After: 60)\n");
  }
}

process.stdout.write("PASS: live Cloudflare Staging rate limiter behaved as configured; no license or D1 operation was invoked.\n");
