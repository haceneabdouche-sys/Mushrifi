import { readFileSync } from "node:fs";
import ts from "typescript";
import assert from "node:assert/strict";

// Compile the actual Worker module so the identity decision is tested as executable code.
const source = readFileSync("src/index.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  },
  reportDiagnostics: true
});
const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, "Worker source must compile before identity tests run");
const moduleUrl = "data:text/javascript;base64," + Buffer.from(compiled.outputText).toString("base64");
const { deviceIdentityMatches } = await import(moduleUrl);

assert.equal(deviceIdentityMatches(null, null), true,
  "Legacy licenses without a stored installation identity must remain compatible");
const stored = "a".repeat(64);
assert.equal(deviceIdentityMatches(stored, stored), true,
  "The exact registered installation identity must be accepted");
assert.equal(deviceIdentityMatches(stored, null), false,
  "A registered identity must not be bypassed by omitting it");
assert.equal(deviceIdentityMatches(stored, "b".repeat(64)), false,
  "A different installation identity must be rejected");

// Guard both entry points so a future refactor cannot leave one path unprotected.
const challengeStart = source.indexOf("async function createChallenge");
const activationStart = source.indexOf("async function activate");
const validateStart = source.indexOf("async function validateLicense");
const adminStart = source.indexOf("async function adminRoute");
assert(challengeStart >= 0 && activationStart > challengeStart, "Challenge handler must exist");
assert(validateStart >= 0 && adminStart > validateStart, "Validation handler must exist");
const challengeHandler = source.slice(challengeStart, activationStart);
const validationHandler = source.slice(validateStart, adminStart);
assert.match(challengeHandler, /device_identity_hash FROM licenses WHERE id = \?/,
  "Validation challenge lookup must read the registered identity hash");
assert.match(challengeHandler, /deviceIdentityMatches\(license\.device_identity_hash, identityHash\)/,
  "Challenge creation must enforce the registered installation identity");
assert.match(validationHandler, /deviceIdentityMatches\(license\.device_identity_hash, identityHash\)/,
  "License validation must enforce the registered installation identity");

console.log("PASS: legacy identity compatibility, exact identity acceptance, omitted/mismatched identity rejection, and enforcement at both challenge and validation.");
