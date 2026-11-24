const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const scriptMatch = html.match(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/i);
assert.ok(scriptMatch, 'Mushrifi has an inline application script');
const js = scriptMatch[1];

assert.ok(html.includes('header .credit-wrap{animation:none!important'), 'phone header animation is disabled');
assert.ok(html.includes('header .credit-name-glint,header .credit-signature-glint{display:none!important'), 'expensive animated SVG glints are hidden on phones');
assert.ok(html.includes('header .credit-signature,header p.credit{filter:none!important;transform:none!important}'), 'phone header avoids expensive filters and transforms');
assert.ok(html.includes('class="credit-signature"'), 'static signature image remains in the interface');

assert.ok(js.includes("const activePage=document.querySelector('.page:not(.hidden)')?.id||'home';"), 'rendering detects the active page');
assert.ok(js.includes("if(activePage==='students')renderStudentDirectory();"), 'student directory is refreshed only on its page');
assert.ok(js.includes("if(activePage==='attendance'){"), 'attendance history is refreshed only on its page');
assert.ok(js.includes("if(activePage==='documents'){"), 'documents are refreshed only on their page');
assert.ok(js.includes("if(activePage==='violations'){"), 'violations are refreshed only on their page');
assert.ok(js.includes("if(activePage==='home'){"), 'dashboard-only content is isolated from data pages');
assert.ok(js.includes("$$('.studentSelect').filter(sel=>sel.closest('.page')?.id===activePage)"), 'student selectors are populated only for the active page');
assert.ok(js.includes("if(activePage==='attendance'||activePage==='settings'){refreshAttendanceClassOptions();renderAttendanceWorkspace();}"), 'attendance and settings summaries update only when needed');
assert.ok(js.includes("if(typeof render==='function')render();"), 'navigation refreshes the newly opened page');
assert.ok(js.includes('AndroidBridge.saveDatabase(json)'), 'native database save path remains intact');
assert.ok(js.includes('preserveUndoOnNextSave'), 'delete recovery snapshot handling remains intact');

console.log('PASS: mobile rendering avoids continuous decorative animation and rebuilds only the active page without changing database persistence.');
