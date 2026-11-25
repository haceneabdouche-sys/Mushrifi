const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

// Primary navigation must remain limited to five predictable destinations.
const navStart = html.indexOf('<nav class="no-print" id="nav"');
const navEnd = html.indexOf('</nav>', navStart);
assert.ok(navStart >= 0 && navEnd > navStart, 'primary navigation exists');
const navMarkup = html.slice(navStart, navEnd);
const navPages = [...navMarkup.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
assert.deepEqual(navPages, ['home', 'students', 'attendance', 'documents', 'more'],
  'the mobile primary navigation exposes exactly five sections');

// More is for secondary tools only; the main workflows must not be duplicated there.
const moreStart = html.indexOf('<section id="more" class="page hidden">');
const moreEnd = html.indexOf('<section id="agenda" class="page hidden">', moreStart);
assert.ok(moreStart >= 0 && moreEnd > moreStart, 'More page exists');
const more = html.slice(moreStart, moreEnd);
for (const duplicate of ['students', 'attendance', 'documents', 'violations']) {
  assert.ok(!more.includes('data-go="' + duplicate + '"'),
    'More must not duplicate the primary Follow-up or other main section: ' + duplicate);
}
for (const destination of ['agenda', 'reports', 'settings', 'audit']) {
  assert.ok(more.includes('data-go="' + destination + '"'),
    'More must expose the secondary destination: ' + destination);
}

// Violations is a real subview inside Follow-up, not a sixth navigation page.
const attendanceStart = html.indexOf('<section id="attendance" class="page hidden">');
const documentsStart = html.indexOf('<section id="documents" class="page hidden">');
const violationsStart = html.indexOf('<div id="violations" class="followup-view hidden"');
assert.ok(attendanceStart >= 0 && documentsStart > attendanceStart, 'Follow-up precedes documents');
assert.ok(violationsStart > attendanceStart && violationsStart < documentsStart,
  'violations panel is located inside the Follow-up page');
assert.ok(!html.includes('<section id="violations" class="page hidden">'),
  'violations no longer occupies a separate top-level page');
assert.match(html, /id="followupAttendanceTab"[^>]*data-followup-view="attendance"[^>]*aria-controls="attendanceView"/);
assert.match(html, /id="followupViolationsTab"[^>]*data-followup-view="violations"[^>]*aria-controls="violations"/);
assert.match(html, /<div id="attendanceView" class="followup-view" role="tabpanel"/);
assert.match(html, /<div id="violations" class="followup-view hidden" role="tabpanel"/);

// Stable forms, lists and primary controls retain their original unique IDs.
for (const id of [
  'pageBackButton', 'pageContextBar', 'pageContextTitle',
  'dailyClass', 'dailyDate', 'dailyRoster', 'attForm', 'attRows',
  'violForm', 'violRows', 'docForm', 'docsRows', 'studentsRows',
  'followupAttendanceTab', 'followupViolationsTab'
]) {
  assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
    'critical workflow ID remains unique: ' + id);
}

// Less-frequent summaries start collapsed; core daily work and speech access remain visible.
const smartDetailsStart = html.indexOf('<details class="panel attendance-log home-advanced-panel">');
assert.ok(smartDetailsStart >= 0, 'weekly analysis is in a disclosure');
assert.ok(!/<details[^>]*\sopen(?:\s|>)/.test(html.slice(smartDetailsStart, smartDetailsStart + 500)),
  'weekly analysis starts collapsed');
const shortcutsStart = html.indexOf('<summary><strong>اختصارات ومواعيد إضافية</strong>');
assert.ok(shortcutsStart > 0, 'secondary home shortcuts are grouped in one disclosure');
const homeVoice = html.indexOf('<section id="voiceAssistant"');
const homeAgenda = html.indexOf('<section class="panel agenda-home-panel"');
assert.ok(homeVoice > 0 && homeAgenda > homeVoice,
  'voice assistant remains on the home screen and appears before the secondary analysis');
assert.ok(html.includes('id="quickVoiceAccess"'), 'the optional quick voice shortcut is preserved');

// Mobile navigation is pinned at the bottom and respects Android safe-area insets.
assert.match(html, /#nav\{position:fixed;left:0;right:0;bottom:0;top:auto[\s\S]*?grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
assert.match(html, /env\(safe-area-inset-bottom\)/);
assert.match(html, /header \.credit-signature-wrap\{width:58px;height:58px/);
assert.match(html, /header \.credit-signature\{width:58px;height:58px/);
assert.match(html, /\.page-context-bar/);
assert.match(html, /\.followup-tabs/);

// License state controls visibility of the banner, while read-only mode permits safe navigation.
assert.match(html, /const advisory=\$\('#licenseAdvisory'\);if\(advisory\)advisory\.classList\.toggle\('hidden',!licenseReadOnly\)/);
assert.match(html, /pageBackButton/);
assert.match(html, /\[data-followup-view\]/);

// Execute the actual route/navigation functions with a small DOM model. This checks that
// legacy go('violations') calls still open the correct tab, preserve More state and back history.
function classList(initial = []) {
  const values = new Set(initial);
  return {
    contains: value => values.has(value),
    add: value => values.add(value),
    remove: value => values.delete(value),
    toggle(value, force) {
      const next = force === undefined ? !values.has(value) : !!force;
      if (next) values.add(value); else values.delete(value);
      return next;
    }
  };
}
function element(id, classes = []) {
  return { id, classList: classList(classes), attributes: {}, dataset: {},
    setAttribute(key, value) { this.attributes[key] = value; } };
}
const pageIds = ['home', 'more', 'students', 'attendance', 'documents', 'agenda', 'audit', 'reports', 'settings'];
const pages = pageIds.map(id => element(id, id === 'home' ? ['page'] : ['page', 'hidden']));
const pageMap = Object.fromEntries(pages.map(page => [page.id, page]));
const attendanceView = element('attendanceView');
const violationsView = element('violations', ['hidden']);
const backBar = element('pageContextBar', ['hidden']);
const title = element('pageContextTitle');
const subtitle = element('pageContextSubtitle');
const ids = { '#attendanceView': attendanceView, '#violations': violationsView,
  '#pageContextBar': backBar, '#pageContextTitle': title, '#pageContextSubtitle': subtitle };
const tabs = [
  element('followupAttendanceTab'), element('followupViolationsTab')
];
tabs[0].dataset.followupView = 'attendance';
tabs[1].dataset.followupView = 'violations';
const navButtons = ['home', 'students', 'attendance', 'documents', 'more'].map(page => {
  const button = element('nav-' + page);
  button.dataset.page = page;
  return button;
});
const listeners = {};
const documentStub = {
  getElementById: id => pageMap[id] || (id === 'attendanceView' ? attendanceView : id === 'violations' ? violationsView : null),
  querySelector(selector) {
    if (selector === '.page:not(.hidden)') return pages.find(page => !page.classList.contains('hidden')) || null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.page') return pages;
    if (selector === 'nav button') return navButtons;
    if (selector === '[data-followup-view]') return tabs;
    return [];
  }
};
let renderCount = 0;
const historyCalls = [];
const context = {
  document: documentStub,
  window: { addEventListener: (name, callback) => { listeners[name] = callback; } },
  history: {
    replaceState: (...args) => historyCalls.push(['replace', ...args]),
    pushState: (...args) => historyCalls.push(['push', ...args])
  },
  $: selector => ids[selector] || null,
  $$: selector => selector === '[data-followup-view]' ? tabs : [],
  render: () => { renderCount += 1; },
  console
};
vm.createContext(context);
const navSourceStart = html.indexOf("let previousAppPage='home';");
const navSourceEnd = html.indexOf('function setSettingsTab(tab){', navSourceStart);
assert.ok(navSourceStart >= 0 && navSourceEnd > navSourceStart, 'navigation source can be isolated');
vm.runInContext(html.slice(navSourceStart, navSourceEnd), context);

context.go('violations');
assert.equal(context.currentAppRoute(), 'violations', 'legacy violations route remains addressable');
assert.equal(pageMap.attendance.classList.contains('hidden'), false, 'violations route opens the parent Follow-up page');
assert.equal(attendanceView.classList.contains('hidden'), true, 'attendance tab is hidden while violations is selected');
assert.equal(violationsView.classList.contains('hidden'), false, 'violations tab is visible');
assert.equal(tabs[1].classList.contains('active'), true, 'violations tab is active');
assert.equal(navButtons.find(button => button.dataset.page === 'attendance').classList.contains('active'), true,
  'the Follow-up primary navigation stays selected');
assert.equal(navButtons.find(button => button.dataset.page === 'more').classList.contains('active'), false,
  'violations no longer incorrectly activates More');
assert.equal(title.textContent, 'المتابعة · المخالفات والسلوك', 'context bar shows the subview title');

context.go('agenda');
assert.equal(navButtons.find(button => button.dataset.page === 'more').classList.contains('active'), true,
  'secondary destinations activate More');
assert.equal(context.goPreviousPage(), true, 'common Back action returns to the previous logical route');
assert.equal(context.currentAppRoute(), 'violations', 'Back returns to the exact Follow-up subview');
assert.equal(violationsView.classList.contains('hidden'), false, 'Back restores the violations tab');
context.go('attendance');
assert.equal(context.currentAppRoute(), 'attendance', 'the attendance tab remains separately addressable');
assert.equal(attendanceView.classList.contains('hidden'), false, 'attendance tab becomes visible');
assert.equal(violationsView.classList.contains('hidden'), true, 'violations tab is hidden after returning to attendance');
assert.ok(renderCount >= 4, 'navigation refreshes the displayed page after each transition');
assert.ok(historyCalls.some(call => call[0] === 'push'), 'logical subpage changes are reflected in browser history');

console.log('PASS: Stage 13 information architecture, unique workflow IDs, compact mobile navigation, and logical route/back behavior.');
