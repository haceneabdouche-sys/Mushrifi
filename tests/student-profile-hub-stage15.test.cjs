const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const profileStart=html.indexOf("$('#reportOutput').innerHTML=`<section class=\"student-profile-hub panel\"");
const profileEnd=html.indexOf("const timelineFilter=$('#studentTimelineFilter')",profileStart);
assert.ok(profileStart>=0&&profileEnd>profileStart,'student profile hub is rendered inside the existing student history route');
const profile=html.slice(profileStart,profileEnd);

for(const id of [
 'studentProfileOverview','studentProfileFollowups','studentProfileTimeline',
 'studentProfileSummary','studentProfileAbsences','studentProfileLateness',
 'studentProfileViolations','studentProfileDocuments','studentProfileNav',
 'studentProfileActions','studentProfileActionStatus'
]){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,
  'student profile hub identifier is unique: '+id);
}

assert.ok(profile.includes('مركز ملف التلميذ'),'profile opens with a unified student identity heading');
assert.ok(profile.includes('student-profile-identity-grid'),'identity details are grouped into a compact information card');
assert.ok(profile.includes('student-profile-kpis'),'absence, lateness, violations, documents and pending follow-ups have a summary view');
assert.ok(profile.includes('absHours.toLocaleString')&&profile.includes('lateMinutes.toLocaleString'),
 'known duration totals are labelled in hours and minutes without deriving unknown values');

for(const action of ['absence','late','violation','summons','edit','whatsapp','print']){
 assert.ok(profile.includes('data-profile-action="'+action+'"'),
  'profile provides the quick action: '+action);
}
assert.ok(profile.includes("data-profile-action=\"absence\"\u0024{licenseReadOnly?' disabled aria-disabled=\"true\"':''}"),
 'data-changing actions are visibly disabled in read-only license mode');
assert.ok(profile.includes('id="studentProfileActionStatus"')&&profile.includes('aria-live="polite"'),
 'quick action failures can be announced accessibly');

const navPages=[...profile.matchAll(/data-profile-target="([^"]+)"/g)].map(match=>match[1]);
assert.deepEqual(navPages,[
 'studentProfileFollowups','studentProfileTimeline','studentProfileSummary',
 'studentProfileAbsences','studentProfileLateness','studentProfileViolations','studentProfileDocuments'
],'internal profile navigation exposes each record category exactly once');
for(const id of navPages){
 const re=new RegExp('<details id="'+id+'"[^>]*>');
 if(['studentProfileSummary','studentProfileAbsences','studentProfileLateness','studentProfileViolations','studentProfileDocuments'].includes(id)){
  assert.ok(re.test(profile),'detailed historical sections are progressive disclosure panels: '+id);
  assert.doesNotMatch(profile.match(re)[0],/\sopen(?:\s|>)/,'historical panel starts collapsed: '+id);
 }
}
assert.equal((profile.match(/<details\b/g)||[]).length,6,'the five long historical panels and optional follow-up workflow details are collapsed by default');
assert.equal((profile.match(/<\/details>/g)||[]).length,6,'every historical and follow-up details panel closes correctly');

const navHandlerStart=html.indexOf("const profileNav=$('#studentProfileNav');");
const navHandlerEnd=html.indexOf("const followupForm=$('#studentFollowupForm')",navHandlerStart);
assert.ok(navHandlerStart>=0&&navHandlerEnd>navHandlerStart,'profile navigation and quick-action handlers are installed');
const handlers=html.slice(navHandlerStart,navHandlerEnd);
assert.ok(handlers.includes("if(target.tagName==='DETAILS')target.open=true"),
 'choosing a historical category opens its details panel before scrolling');
assert.ok(handlers.includes("target.scrollIntoView?.({behavior:'smooth',block:'start'})"),
 'profile navigation moves to the requested category');
assert.ok(handlers.includes('window.studentAction(action,sid)'),
 'record creation reuses the existing student-aware action dispatcher');
assert.ok(handlers.includes("window.editStudent(sid)"),
 'editing reuses the existing student editor and identity');
assert.ok(profile.includes("openGuardianWhatsApp('${s.id}')"),
 'guardian messaging uses the selected student ID through the established direct handler');
assert.ok(handlers.includes('window.printReport()'),
 'printing reuses the existing workflow');
assert.ok(handlers.includes('if(!button||button.disabled)return'),
 'disabled actions cannot be triggered by the profile event handler');

assert.ok(html.includes('function profileRecordBelongsToStudent(record,target,students)'),
 'profile records continue to use stable student identity and safe legacy matching');
assert.ok(html.includes('function buildStudentTimeline(target,database,profileRecords)'),
 'the established verified timeline remains the source of the event history');
assert.ok(html.includes('bodyMarkup=buildStudentPrintableReportMarkup(data)'),
 'the printable report remains a separately assembled report, not a print of the interactive controls');
assert.ok(html.includes('window.openStudentProfileAttendanceEdit')&&html.includes('window.openStudentProfileDocumentEdit'),
 'existing record-specific edit workflows remain available');
assert.ok(!handlers.includes('db.attendance.push')&&!handlers.includes('db.violations.push')&&!handlers.includes('db.documents.push'),
 'the hub does not create records on its own; existing forms remain responsible for confirmed saves');

console.log('PASS: Stage 15 unified student profile, identity preservation, direct actions, internal navigation, collapsed historical sections and print separation.');
