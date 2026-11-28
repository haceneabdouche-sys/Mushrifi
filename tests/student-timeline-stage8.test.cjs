const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const start = html.indexOf('function profileTimelineValidDate(value){');
const end = html.indexOf('const PROFILE_FOLLOWUP_CATEGORIES=', start);
assert.ok(start >= 0 && end > start, 'timeline date, search and paging helpers exist as a pure block');
const sandbox = {
  Date,
  String,
  Intl,
  esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch])
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end), sandbox);

const events = [
  { source: 'attendance', sourceLabel: 'غياب وتأخر وحضور', recordId: 'a-1', date: '2026-11-02', title: 'تأخر 12 دقيقة', detail: 'حالة التبرير: قيد التبرير', notes: 'تأخر صباحي' },
  { source: 'documents', sourceLabel: 'وثيقة أو استدعاء', recordId: 'd-1', date: '2026-11-04', title: 'استدعاء ولي', detail: 'الموضوع: شهادة طبية', appointment: '2026-11-06T09:00', notes: 'إثبات التبليغ' },
  { source: 'violations', sourceLabel: 'مخالفة', recordId: 'v-1', date: '2026-11-07', title: 'مخالفة مسجلة · سلوك', detail: 'الوصف: إزعاج داخل القسم' },
  { source: 'followups', sourceLabel: 'متابعة تربوية', recordId: 'f-1', date: '2026-11-08', title: 'متابعة تربوية · المواظبة والحضور', detail: 'الإجراء المتخذ: لقاء مع الولي', appointment: '2026-11-12' },
  { source: 'documents', sourceLabel: 'وثيقة أو استدعاء', recordId: 'd-nodate', date: '', title: 'وثيقة قديمة دون تاريخ', detail: 'لا يجوز اختراع تاريخ لها' }
];

const all = sandbox.profileTimelineView(events, 'all', 30);
assert.equal(all.total, 5, 'all event sources are preserved');
assert.equal(all.shown, 5);
assert.equal(all.start, 1);
assert.equal(all.end, 5);
assert.equal(all.hasPrevious, false);
assert.equal(all.hasNext, false);

const searchArabic = sandbox.profileTimelineView(events, 'all', 30, 0, 'شَهَادَة طبية');
assert.equal(searchArabic.total, 1, 'Arabic diacritics and hamza variants are normalized for local search');
assert.equal(searchArabic.html.includes('d-1'), true);
const searchDigits = sandbox.profileTimelineView(events, 'attendance', 30, 0, '١٢ دقيقة');
assert.equal(searchDigits.total, 1, 'Arabic-Indic digits match Western digits');
const searchNotes = sandbox.profileTimelineView(events, 'all', 30, 0, 'إثبات التبليغ');
assert.equal(searchNotes.total, 1, 'search includes notes and delivery evidence');
const dateRange = sandbox.profileTimelineView(events, 'all', 30, 0, '', '2026-11-04', '2026-11-07');
assert.equal(dateRange.total, 2, 'inclusive date bounds return only events within the exact range');
assert.ok(dateRange.html.includes('استدعاء ولي') && dateRange.html.includes('مخالفة مسجلة'));
const dateOnlyExcludesUnknown = sandbox.profileTimelineView(events, 'all', 30, 0, '', '2026-11-01', '2026-11-30');
assert.equal(dateOnlyExcludesUnknown.total, 4, 'events without a trustworthy date are excluded only when date filtering is active');
const reversed = sandbox.profileTimelineView(events, 'all', 30, 0, '', '2026-11-10', '2026-11-01');
assert.equal(reversed.invalidRange, true, 'reversed date bounds are explicitly rejected');
assert.equal(reversed.total, 0);
assert.ok(reversed.html.includes('تاريخ البداية'));

const many = Array.from({ length: 257 }, (_, i) => ({
  source: ['attendance', 'violations', 'documents', 'followups'][i % 4],
  sourceLabel: 'حدث', recordId: 'record-' + i,
  date: '2026-11-' + String(1 + (i % 28)).padStart(2, '0'),
  title: 'حدث رقم ' + i, detail: 'تفصيل ' + i
}));
const seen = new Set();
for (let offset = 0; offset < many.length; offset += 30) {
  const page = sandbox.profileTimelineView(many, 'all', 30, offset);
  const ids = [...page.html.matchAll(/data-timeline-record-id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, Math.min(30, many.length - offset), 'page returns only its bounded slice');
  ids.forEach(id => {
    assert.ok(!seen.has(id), 'pagination does not duplicate an event: ' + id);
    seen.add(id);
  });
  assert.equal(page.hasPrevious, offset > 0, 'previous-page state follows the current offset');
  assert.equal(page.hasNext, offset + ids.length < many.length, 'next-page state follows remaining results');
}
assert.equal(seen.size, 257, 'pagination reaches every event, including histories beyond the former 200-event ceiling');
const lastPage = sandbox.profileTimelineView(many, 'all', 30, 999);
assert.equal(lastPage.offset, 240, 'out-of-range offsets clamp to the final valid page');
assert.equal(lastPage.shown, 17);
assert.equal(lastPage.hasNext, false);
assert.equal(lastPage.hasPrevious, true);

const hostile = sandbox.profileTimelineView([
  { source: 'violations', sourceLabel: 'مخالفة', recordId: '<script>', date: '2026-11-01', title: '<img src=x onerror=alert(1)>', detail: '<b>نص</b>' }
], 'all', 30);
assert.ok(!hostile.html.includes('<img src=x'));
assert.ok(hostile.html.includes('&lt;img src=x'));
assert.ok(hostile.html.includes('data-timeline-record-id="&lt;script&gt;"'));

for (const id of [
  'studentTimelineStats', 'studentTimelineStatAll', 'studentTimelineStatAttendance',
  'studentTimelineStatViolations', 'studentTimelineStatDocuments', 'studentTimelineStatFollowups',
  'studentTimelineSearch', 'studentTimelineFilter', 'studentTimelineFrom', 'studentTimelineTo',
  'studentTimelineClear', 'studentTimelineRange', 'studentTimelinePrevious', 'studentTimelineMore'
]) {
  assert.equal((html.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1,
    'timeline control ID is unique: ' + id);
}
assert.match(html, /timelinePageSize=30/);
assert.match(html, /timelineOffset\+=timelinePageSize/);
assert.match(html, /timelineOffset=Math\.max\(0,timelineOffset-timelinePageSize\)/);
assert.match(html, /profileTimelineView\(timeline,timelineMode,timelinePageSize,timelineOffset,query,from,to\)/);
assert.doesNotMatch(html, /timelineLimit=Math\.min\(200/,
  'the old hard stop at 200 events must not remain');
assert.match(html, /timelineSearch\.addEventListener\('input',resetTimelinePage\)/);
assert.match(html, /studentTimelineClear/);
assert.match(html, /data-timeline-stat-filter/);
assert.ok(fs.readFileSync('.github/workflows/build-apk.yml', 'utf8')
  .includes('node tests/student-timeline-stage8.test.cjs'), 'CI executes the Stage 8 timeline regression test');

console.log('PASS: Stage 8 timeline search, Arabic normalization, inclusive dates, safe text rendering, category summaries and unbounded-by-200 paged history.');
