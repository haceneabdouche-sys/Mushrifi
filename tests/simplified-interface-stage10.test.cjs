const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');

const navStart=html.indexOf('<nav class="no-print" id="nav"');
const navEnd=html.indexOf('</nav>',navStart);
assert.ok(navStart>=0&&navEnd>navStart,'primary navigation remains present');
const nav=[...html.slice(navStart,navEnd).matchAll(/data-page="([^"]+)"/g)].map(x=>x[1]);
assert.deepEqual(nav,['home','students','attendance','documents','more'],'the five primary navigation destinations are unchanged');

const pages=['home','more','agenda','supervisionLog','guardianReceptions','audit','students','attendance','documents','reports','settings'];
for(const page of pages){
 assert.equal((html.match(new RegExp('<section id="'+page+'" class="page(?: hidden)?"','g'))||[]).length,1,
  'existing page remains present exactly once: '+page);
}
for(const id of [
 'sStudents','todayAbs','todayLate','todaySummons','homeLeadershipPulse','homePulseOpenTasks',
 'dailyTasksDetails','absenceStageDashboard','absenceStageDashboardHeading','absenceStageAlertCount',
 'homeMonthlyDetails','smartDashboardHeading','smartMonthPeriod','smartMonthAbsences',
 'smartMonthLateness','smartMonthViolations','upcomingAgenda','studentFollowupForm',
 'studentFollowupDate','studentFollowupCategory','studentFollowupStage','studentFollowupStatus',
 'studentFollowupStatusDisplay','studentFollowupOwner','studentFollowupNextAction',
 'studentFollowupNextDate','studentFollowupResult','studentFollowupTransitionNote'
]){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'important workflow ID remains unique: '+id);
}

const homeStart=html.indexOf('<section id="home" class="page">');
const moreStart=html.indexOf('<section id="more" class="page hidden">');
assert.ok(homeStart>=0&&moreStart>homeStart,'home precedes More in the page document');
const home=html.slice(homeStart,moreStart);
const quickStart=home.indexOf('<div class="panel quick-panel home-quick-actions"');
const quickEnd=home.indexOf('</div>\n</div>',quickStart);
assert.ok(quickStart>0&&quickEnd>quickStart,'four common actions are visible in the Home workspace');
const quick=home.slice(quickStart,quickEnd);
for(const [label,route] of [['ملف تلميذ','students'],['تسجيل الغياب','attendance'],['وثيقة جديدة','documents'],['إضافة موعد','agenda']]){
 assert.ok(quick.includes(label)&&quick.includes('data-go="'+route+'"'),'quick action is preserved and routed: '+label);
}
assert.ok(home.indexOf('home-quick-actions')<home.indexOf('home-leadership-pulse'),'quick actions appear before secondary analysis panels');
assert.ok(home.indexOf('id="absenceStageDetails"')>0&&home.indexOf('id="absenceStageDashboard"')>home.indexOf('id="absenceStageDetails"'),
 'official absence notices remain available inside a collapsed disclosure');
assert.ok(home.indexOf('id="homeMonthlyDetails"')>0&&home.indexOf('class="panel home-monthly-summary"')>home.indexOf('id="homeMonthlyDetails"'),
 'monthly analytics remain available inside a collapsed disclosure');
assert.ok(home.includes('<details class="panel daily-tasks-panel" id="dailyTasksDetails"'),
 'daily task analytics remain available as an expandable section');
assert.ok(home.includes('<section class="panel agenda-home-panel"'),
 'upcoming appointments remain visible as a concise home preview');
assert.ok(home.includes('<details class="panel attendance-log home-advanced-panel"'),
 'secondary home shortcuts are retained behind the existing expandable section');
assert.ok(home.includes('<details class="panel attendance-log home-stat-details"'),
 'full statistics remain available without occupying the initial view');
assert.ok(home.includes('<details class="panel attendance-log recent-log"'),
 'recent operation history remains available without occupying the initial view');

const moreEnd=html.indexOf('<section id="agenda" class="page hidden">',moreStart);
const more=html.slice(moreStart,moreEnd);
for(const group of ['دفاتر العمل','المواعيد والتقارير','إدارة التطبيق وحماية البيانات'])assert.ok(more.includes(group),'More section remains grouped: '+group);
for(const route of ['supervisionLog','guardianReceptions','agenda','reports','settings','audit'])assert.ok(more.includes('data-go="'+route+'"'),'secondary route remains reachable: '+route);
assert.ok(!more.includes('data-go="students"')&&!more.includes('data-go="attendance"')&&!more.includes('data-go="documents"'),
 'More remains reserved for secondary tools and does not duplicate primary navigation');

const formStart=html.indexOf('<form id="studentFollowupForm"');
const formEnd=html.indexOf('</form>',formStart);
assert.ok(formStart>=0&&formEnd>formStart,'existing follow-up form remains present');
const form=html.slice(formStart,formEnd);
const advancedStart=form.indexOf('<details class="student-followup-advanced no-print" id="studentFollowupAdvanced">');
const advancedEnd=form.indexOf('</details>',advancedStart);
assert.ok(advancedStart>0&&advancedEnd>advancedStart,'detailed case lifecycle controls are grouped in one collapsed panel');
const advanced=form.slice(advancedStart,advancedEnd);
assert.ok(advanced.includes('studentFollowupStage')&&advanced.includes('studentFollowupOwner')&&advanced.includes('studentFollowupNextAction')&&advanced.includes('studentFollowupTransitionNote'),
 'all stage, owner, next-action and transition-reason controls remain in the advanced panel');
assert.ok(!/\sopen(?:\s|>)/.test(advanced.slice(0,150)),'advanced case details are collapsed by default');
const basicMarkup=form.slice(0,advancedStart)+form.slice(advancedEnd+'</details>'.length);
assert.ok(basicMarkup.includes('studentFollowupDate')&&basicMarkup.includes('studentFollowupCategory')&&basicMarkup.includes('studentFollowupObservation')&&basicMarkup.includes('studentFollowupAction'),
 'the ordinary follow-up form keeps date, category, observation and action outside the collapsed advanced panel');
assert.ok(form.includes('studentFollowupNextDate')&&form.includes('studentFollowupResult'),'review date and outcome remain available');
assert.ok(form.includes('type="hidden" id="studentFollowupStatus"')&&form.includes('studentFollowupStatusDisplay'),
 'the simple status summary is visible while canonical status remains wired to the same form payload');
assert.match(html,/function syncStudentFollowupFormStatus\(form\)/);
assert.match(html,/followupForm\.elements\.workflowStage\.addEventListener\('change',\(\)=>syncStudentFollowupFormStatus\(followupForm\)\)/);

assert.ok(html.includes('function profileFollowupCanTransition(from,to)')&&html.includes('function buildStudentFollowupWorkflowHistory'),
 'the complete case lifecycle and transition-history engine is preserved');
assert.ok(html.includes('function parseMushrifiDatabase(raw){')&&html.includes('function buildAuditEvents('),
 'database parsing and audit mechanisms remain in the application');
assert.ok(html.includes('saveUndoSnapshot(')&&html.includes('function parseRecoverySnapshot(raw){'),
 'recovery and undo guarantees remain present');
assert.ok(html.includes('const PROFILE_FOLLOWUP_STAGES=')&&html.includes('const PROFILE_FOLLOWUP_TRANSITIONS='),
 'the existing controlled state machine constants are preserved');
assert.ok(html.includes('id="licenseAdvisory"')&&html.includes('id="settings"'),
 'licensing and app settings are not removed');
assert.match(html,/\.home-quick-actions \.home-quick-tiles\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,
 'quick actions use four columns on wide screens');
assert.match(html,/@media\(max-width:520px\)\{\.home-quick-actions \.home-quick-tiles\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
 'quick actions collapse to two columns on mobile screens');
console.log('PASS: simplified Home, progressive disclosure, five stable routes, all secondary tools, and unchanged data/lifecycle/recovery/license foundations.');
