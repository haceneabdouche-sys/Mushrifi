const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

// The electronic-signature page was intentionally removed at the user's request.
assert.ok(!html.includes('data-page="signature"'), 'signature navigation entry must be removed');
assert.ok(!html.includes('id="signature"'), 'signature page section must be removed');
assert.ok(!html.includes('id="signatureCanvas"'), 'signature drawing canvas must be removed');
assert.ok(!html.includes('initSignaturePad'), 'signature page initialization must be removed');
assert.ok(!html.includes('handwrittenSignature'), 'signature data handling must no longer run in the page');
console.log('Electronic signature page removal guardrails passed.');
