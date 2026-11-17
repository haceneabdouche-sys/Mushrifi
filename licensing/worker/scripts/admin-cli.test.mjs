import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const help = spawnSync(process.execPath, ["scripts/admin.mjs", "help"], {
  encoding: "utf8",
  env: { ...process.env, MUSHRIFI_ADMIN_API_TOKEN: "" }
});
assert.equal(help.status, 0, "help should not require an admin token");
assert.match(help.stdout, /issue annual/);
assert.match(help.stdout, /suspend <license-id>/);
assert.match(help.stdout, /renew <license-id>/);

const noToken = spawnSync(process.execPath, ["scripts/admin.mjs", "list"], {
  encoding: "utf8",
  env: { ...process.env, MUSHRIFI_ADMIN_API_TOKEN: "" }
});
assert.notEqual(noToken.status, 0, "admin actions must fail closed without a token");
assert.match(noToken.stderr, /MUSHRIFI_ADMIN_API_TOKEN/);

const invalid = spawnSync(process.execPath, ["scripts/admin.mjs", "issue", "unknown"], {
  encoding: "utf8",
  env: { ...process.env, MUSHRIFI_ADMIN_API_TOKEN: "test-only-not-a-secret" }
});
assert.notEqual(invalid.status, 0, "unsupported license types must be rejected locally");
assert.match(invalid.stderr, /نوع الترخيص/);

console.log("PASS: admin CLI help, missing-token protection, and input validation.");
