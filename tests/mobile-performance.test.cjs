const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const scriptStart = html.indexOf('<script');
const scriptOpenEnd = html.indexOf('>', scriptStart);
const scriptEnd = html.indexOf('</script>', scriptOpenEnd);
assert.ok(scriptStart >= 0 && scriptOpenEnd > scriptStart && scriptEnd > scriptOpenEnd, 'Mushrifi has an inline application script');
const js = html.slice(scriptOpenEnd + 1, scriptEnd);

assert.ok(html.includes('header .credit-wrap{animation:none!important'), 'phone header 3D animation is disabled');
assert.ok(html.includes('header .credit-name-glint,header .credit-signature-glint{display:none!important}'), 'decorative SVG glints are omitted on phones while the signature artwork remains');
assert.ok(html.includes('header .credit-signature-glint .signature-glint-point{filter:none!important}'), 'sparkle points avoid expensive filter passes');
assert.ok(!html.includes('<animateMotion'), 'the header and signature no longer run continuous SVG path animations');
assert.ok(!html.includes('mushrifi-credit-spin 10s linear infinite'), 'the header has no permanent 3D spin animation');
assert.ok(html.includes('backdrop-filter:none;'), 'fixed mobile navigation avoids live backdrop blur composition');
assert.ok(html.includes('const STUDENT_DIRECTORY_PAGE_SIZE=30;'), 'large student directories are paginated instead of adding every row to the DOM');
assert.ok(html.includes('const ATTENDANCE_LOG_PAGE_SIZE=40,VIOLATION_LOG_PAGE_SIZE=18,DOCUMENT_LOG_PAGE_SIZE=15;'), 'large record histories are paginated to avoid thousands of DOM nodes');
assert.ok(!html.includes('mix-blend-mode:multiply}'), 'the full-screen signature background does not trigger blend-mode composition');
assert.ok(html.includes('const student=id=>{\n ensureStudentIdentityIndexes();')&&html.includes('ensureStudentNameIndexes();const matches=studentByName.get(key);'), 'student ID lookup uses a lightweight index and unique-name aliases are prepared only when needed');
assert.ok(html.includes('function refreshActiveStudentSelectors(activePage)'), 'student select options are cached and only replaced when their source changes');
assert.ok(js.includes('renderSmartDashboard(overview.date,overview.monthly);')&&!js.includes('renderDailyFollowupDashboard(today,Date.now());'), 'cached monthly metrics render without recalculating hidden daily task analytics');
assert.ok(js.includes('const overview=getHomeOverviewSnapshot(dateISO());'), 'the home view reuses its cached summary when navigating back to the dashboard');
assert.ok(!js.includes('renderAgendaHome(today);'), 'upcoming agenda data is not built for the hidden home panel');
assert.ok(js.includes('const keepRecent=')&&js.includes('if(position<6){recent.splice'), 'recent activity keeps a bounded six-item list instead of sorting every record');
assert.ok(html.includes('header .credit-signature,header p.credit{filter:none!important;transform:none!important}'), 'phone header avoids expensive filters and transforms');
assert.ok(html.includes('class="credit-signature"'), 'static signature image remains in the interface');

assert.ok(js.includes("const activePage=document.querySelector('.page:not(.hidden)')?.id||'home';"), 'rendering detects the active page');
assert.ok(js.includes("if(activePage==='students')renderStudentDirectory();"), 'student directory is refreshed only on its page');
assert.ok(js.includes("if(activePage==='attendance'&&activeFollowupView==='attendance'){"), 'attendance history is refreshed only while its tab is active');
assert.ok(js.includes("if(activePage==='documents'){"), 'documents are refreshed only on their page');
assert.ok(js.includes("if(activePage==='attendance'&&activeFollowupView==='violations'){"), 'violations are refreshed only while their tab is active');
assert.ok(js.includes("if(activePage==='home'){"), 'dashboard-only content is isolated from data pages');
assert.ok(js.includes("$$('.studentSelect').filter(sel=>sel.closest('.page')?.id===activePage)"), 'student selectors are populated only for the active page');
assert.ok(js.includes("if((activePage==='attendance'&&activeFollowupView==='attendance')||activePage==='settings'){refreshAttendanceClassOptions();renderAttendanceWorkspace();}"), 'attendance and settings summaries update only when needed');
assert.ok(js.includes("if(typeof render==='function')render();"), 'navigation refreshes the newly opened page');
assert.ok(js.includes('AndroidBridge.saveDatabase(json)'), 'native database save path remains intact');
assert.ok(js.includes('preserveUndoOnNextSave'), 'delete recovery snapshot handling remains intact');

console.log('PASS: mobile rendering preserves lightweight sparkle while avoiding continuous 3D animation, filter passes, and inactive-page rebuilds.');

