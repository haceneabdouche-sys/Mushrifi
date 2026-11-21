const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const activity = fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java', 'utf8');

for (const id of ['setupEducationLevel', 'setupYear', 'setupBranch', 'setupSection', 'setupRosterFile']) {
  assert.ok(html.includes('id="' + id + '"'), 'First-run setup control is missing: ' + id);
}
assert.match(html, /const setupForm=\$\('#firstRunSetupForm'\);/,
  'First-run form must be referenced for license-state unlock.');
assert.match(activity, /Intent\.ACTION_OPEN_DOCUMENT[\s\S]*?intent\.setType\("\*\/\*"\)[\s\S]*?startActivityForResult\(intent, PICK_FILE\)/,
  'Android must invoke the Storage Access Framework for the WebView file input.');
assert.match(activity, /requestCode == PICK_FILE[\s\S]*?FileChooserParams\.parseResult[\s\S]*?data\.getData\(\)[\s\S]*?new Uri\[\]\{data\.getData\(\)\}/,
  'Picker result must fall back to the direct ACTION_OPEN_DOCUMENT URI if WebView parsing returns empty.');
assert.match(activity, /ValueCallback<Uri\[]> callback = fileCallback;\s*fileCallback = null;\s*if \(callback != null\) callback\.onReceiveValue\(result\);/,
  'The chooser callback must be delivered and cleared exactly once.');
console.log('First-run setup field unlock and Android document picker regression checks passed.');
