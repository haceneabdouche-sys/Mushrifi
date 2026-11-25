const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const studentsStart=html.indexOf('<section id="students"');
const attendanceStart=html.indexOf('<section id="attendance"');
const documentsStart=html.indexOf('<section id="documents"');
assert.ok(studentsStart>=0&&attendanceStart>studentsStart&&documentsStart>attendanceStart,
  'main workflows must remain in their expected navigation order');

const students=html.slice(studentsStart,attendanceStart);
const sectionSetupStart=students.indexOf('<details class="panel attendance-log section-setup">');
const sectionSetupEnd=students.indexOf('</details>',sectionSetupStart);
assert.ok(sectionSetupStart>=0&&sectionSetupEnd>sectionSetupStart,
  'rarely used academic list setup must be in a native disclosure panel');
const sectionSetup=students.slice(sectionSetupStart,sectionSetupEnd);
assert.match(sectionSetup,/<summary>[\s\S]*إعداد المستويات والشعب والأقسام[\s\S]*<\/summary>/,
  'the collapsed section setup must have a clear accessible summary');
assert.ok(sectionSetup.includes('id="sectionForm"')&&sectionSetup.includes('id="sectionList"'),
  'existing academic setup controls and IDs must remain available');
assert.ok(!/<details[^>]*\sopen(?:\s|>)/.test(students.slice(sectionSetupStart,sectionSetupEnd+10)),
  'the rarely used setup panel must start collapsed');

const attendance=html.slice(attendanceStart,documentsStart);
const dailyStart=attendance.indexOf('id="dailyClass"');
const individualStart=attendance.indexOf('<details class="panel attendance-log individual-attendance">');
const individualEnd=attendance.indexOf('</details>',individualStart);
assert.ok(dailyStart>=0&&individualStart>dailyStart,
  'the daily whole-class workflow must stay first and visible');
assert.ok(individualEnd>individualStart,
  'individual attendance entry must be in a disclosure panel');
const individual=attendance.slice(individualStart,individualEnd);
assert.ok(individual.includes('id="attForm"')&&individual.includes('id="attStudentSearch"'),
  'all individual attendance controls must remain intact');
assert.ok(!/<details[^>]*\sopen(?:\s|>)/.test(individual),
  'individual attendance entry must start collapsed');

const logStart=attendance.indexOf('<details class="panel attendance-log">',individualEnd);
const logEnd=attendance.indexOf('</details>',logStart);
assert.ok(logStart>individualEnd&&logEnd>logStart,
  'attendance history must remain accessible in a separate disclosure panel');
const log=attendance.slice(logStart,logEnd);
assert.ok(log.includes('id="attRows"')&&log.includes('id="attLogCount"'),
  'attendance history table and count must retain their existing IDs');
assert.ok(!/<details[^>]*\sopen(?:\s|>)/.test(log),
  'the lengthy attendance log must start collapsed to reduce screen clutter');

for(const id of ['dailyClass','dailyDate','dailyRoster','loadDailyRoster','saveDailyAbsences','attForm','attRows','sectionForm','sectionList']){
  const count=(html.match(new RegExp('id="'+id+'"','g'))||[]).length;
  assert.equal(count,1,'control ID must remain unique: '+id);
}
assert.match(html,/\.section-setup>summary:focus-visible/,
  'disclosure summaries must expose a visible keyboard focus state');
assert.match(html,/\.individual-attendance>summary:focus-visible/,
  'individual form disclosure must expose a visible keyboard focus state');

console.log('PASS: everyday workflow stays visible; advanced and long-form sections are organized as accessible, collapsed panels without changing control IDs.');
