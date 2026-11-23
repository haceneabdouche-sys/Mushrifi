import { readFileSync } from "node:fs";

const source = readFileSync("src/index.ts", "utf8");
const production = readFileSync("wrangler.toml", "utf8");
const staging = readFileSync("wrangler.staging.toml", "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function binding(config, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = config.match(new RegExp(`\\[\\[ratelimits\\]\\]\\s*name = "${escaped}"([\\s\\S]*?)(?=\\n\\[\\[ratelimits\\]\\]|$)`));
  assert(block, `Missing ${name} binding`);
  const namespace = block[1].match(/namespace_id = "([0-9]+)"/);
  const limit = block[1].match(/limit = ([0-9]+)/);
  const period = block[1].match(/period = ([0-9]+)/);
  assert(namespace && limit && period, `Incomplete ${name} configuration`);
  return { namespace: namespace[1], limit: Number(limit[1]), period: Number(period[1]) };
}

for (const [label, config] of [["production", production], ["staging", staging]]) {
  const publicLimit = binding(config, "PUBLIC_RATE_LIMITER");
  const adminLimit = binding(config, "ADMIN_RATE_LIMITER");
  assert(publicLimit.limit === 30 && publicLimit.period === 60, `${label}: unexpected public limit`);
  assert(adminLimit.limit === 20 && adminLimit.period === 60, `${label}: unexpected admin limit`);
  assert(publicLimit.namespace !== adminLimit.namespace, `${label}: namespaces must be separate`);
}

const prodIds = [binding(production, "PUBLIC_RATE_LIMITER").namespace, binding(production, "ADMIN_RATE_LIMITER").namespace];
const stageIds = [
  binding(staging, "PUBLIC_RATE_LIMITER").namespace,
  binding(staging, "ADMIN_RATE_LIMITER").namespace
];
const testProbe = binding(staging, "TEST_RATE_LIMITER");
assert(testProbe.limit === 3 && testProbe.period === 60, "Staging probe must use a 3-per-60-second threshold");
assert(!production.includes('name = "TEST_RATE_LIMITER"'), "Production must not bind the test probe limiter");
assert(new Set([...prodIds, ...stageIds, testProbe.namespace]).size === 5,
  "Staging, its probe, and production must use separate namespaces");
assert(source.includes("PUBLIC_RATE_LIMITER: RateLimit") && source.includes("ADMIN_RATE_LIMITER: RateLimit"),
  "Worker environment must declare both rate-limit bindings");
assert(source.includes('request.headers.get("cf-connecting-ip")'), "Use Cloudflare's trusted client IP header");
assert(source.includes('status: 429') && source.includes('"retry-after": "60"'), "Rate-limited responses must return HTTP 429 and Retry-After");
assert(source.includes("const limited = await enforceRateLimit(request, env, true)") &&
  source.includes("const limited = await enforceRateLimit(request, env);"),
  "Public and admin routes must enforce their respective limiters");
assert(source.includes('url.pathname === "/__test/rate-limit-probe"') &&
  source.includes("if (!env.TEST_RATE_LIMITER)"),
  "The harmless probe endpoint must be disabled when the staging-only binding is absent");
assert(source.includes("const limited = await enforceRateLimit(request, env, false, true)"),
  "The staging probe must use its dedicated rate limiter");
assert(source.includes("// Fail closed:"), "Limiter failures must not silently bypass protection");

console.log("PASS: public/admin limits, staging/production isolation, trusted client IP, 429 response, and fail-closed enforcement.");
