const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const java = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');

assert.ok(html.includes('data-page="signature">التوقيع</button>'), 'signature page must be reachable from the main navigation');
assert.ok(html.includes('<canvas id="signatureCanvas" width="1200" height="520"'), 'signature pad must have a high-resolution drawing surface');
assert.ok(html.includes('touch-action:none'), 'finger drawing must not scroll the page');
assert.ok(html.includes("ctx.strokeStyle='#000000'"), 'signature ink must be black');
assert.ok(html.includes("ctx.fillStyle='#ffffff'"), 'signature canvas must have a white background');
assert.ok(html.includes("$('#clearSignature').onclick"), 'signature pad must expose a clear action');
assert.ok(html.includes("$('#saveSignature').onclick"), 'signature pad must expose a save action');
assert.ok(html.includes('db.settings.handwrittenSignature=data'), 'saved signature must persist inside the app database');
assert.ok(html.includes('AndroidBridge.saveSignatureImage(data)'), 'Android must export the saved PNG to device storage');
assert.ok(java.includes('saveSignatureImage(String dataUrl)'), 'native image export bridge must exist');
assert.ok(java.includes('MediaStore.Images.Media.RELATIVE_PATH'), 'modern Android must save the PNG in Pictures/Mushrifi');
assert.ok(java.includes('getExternalFilesDir(Environment.DIRECTORY_PICTURES)'), 'older Android must have an app-scoped fallback');
console.log('Signature pad integration guardrails passed.');
