const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');

// The attendance group list and timetable fallback are stable between renders.
const groupStart=html.indexOf('const classKey=');
const groupEnd=html.indexOf('function refreshAttendanceClassOptions',groupStart);
assert.ok(groupStart>=0&&groupEnd>groupStart,'attendance group cache helpers exist as one block');
const groupSandbox={
 db:{students:[
  {id:'s1',schoolYear:'أولى',branch:'علوم',class:'1'},
  {id:'s2',schoolYear:'أولى',branch:'علوم',class:'2'}
 ],settings:{timetables:{}}},
 sectionDisplay:value=>String(value),
 student:id=>null
};
vm.createContext(groupSandbox);
vm.runInContext(html.slice(groupStart,groupEnd),groupSandbox);
const firstGroups=vm.runInContext('attendanceGroups()',groupSandbox);
const secondGroups=vm.runInContext('attendanceGroups()',groupSandbox);
assert.equal(secondGroups,firstGroups,'reopening attendance does not rebuild/sort the section list');
assert.equal(vm.runInContext('attendanceGroupForStudent(db.students[0]).key',groupSandbox),firstGroups[0].key,'student section lookup uses the cached key index');
groupSandbox.selectedGroup=firstGroups.find(group=>group.class==='1');
assert.equal(vm.runInContext('timetableForGroup(selectedGroup)',groupSandbox),null,'missing section timetable stays missing');
const fallbackTimetable={sun:3,mon:3};
groupSandbox.db.settings.timetables['1']=fallbackTimetable;
vm.runInContext('invalidateAttendanceGroupCaches()',groupSandbox);
assert.equal(vm.runInContext('timetableForGroup(selectedGroup)',groupSandbox),fallbackTimetable,'saved timetable edits invalidate fallback caches immediately');

// Extract the real absence-analysis helpers so cache behavior is exercised against production logic.
const analysisStart=html.indexOf('let absenceAnalysisRevision=0;');
const streakEnd=html.indexOf('function absenceWorkflowGroupKey',analysisStart);
const monthlyStart=html.indexOf('function getMonthlyUnjustifiedOccurrences(month){');
const monthlyEnd=html.indexOf('function monthlyAbsenceWarningExists',monthlyStart);
assert.ok(analysisStart>=0&&streakEnd>analysisStart&&monthlyStart>0&&monthlyEnd>monthlyStart,'absence analysis and monthly cache helpers are present');

let today='2026-11-18',studentCalls=0;
const student={id:'s1',last:'عيسو',first:'وائل'};
const context={
 db:{
  students:[student],
  settings:{schoolHolidays:[],timetables:{}},
  documents:[],
  attendance:[
   {student:'s1',date:'2026-11-16',type:'غياب',justified:'غير مبرر',hours:6},
   {student:'s1',date:'2026-11-17',type:'غياب',justified:'غير مبرر',hours:6},
   {student:'s1',date:'2026-11-18',type:'غياب',justified:'غير مبرر',hours:6}
  ]
 },
 dateISO:()=>today,
 student:id=>{studentCalls++;return id==='s1'?student:null;},
 parseHours:value=>Number(value)||0,
 scheduledHoursForStudentDate:()=>6,
 dateFromISO:value=>new Date(value+'T12:00:00'),
 calendarDaysBetween:(a,b)=>Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/86400000)
};
vm.createContext(context);
const analysisCode=html.slice(analysisStart,streakEnd)+'\n'+html.slice(monthlyStart,monthlyEnd);
vm.runInContext(analysisCode,context);

const firstStreaks=context.getUnjustifiedStreaks();
assert.equal(firstStreaks.length,1,'the full-day consecutive absence rule remains unchanged');
assert.equal(firstStreaks[0].days,3,'calendar-day duration remains unchanged');
const callsAfterStreaks=studentCalls;
const secondStreaks=context.getUnjustifiedStreaks();
assert.equal(secondStreaks,firstStreaks,'a repeated page render reuses the same streak snapshot');
assert.equal(studentCalls,callsAfterStreaks,'a repeated page render does not re-resolve every attendance row');

const firstMonthly=context.getMonthlyUnjustifiedOccurrences('2026-11');
assert.equal(firstMonthly.length,1,'three distinct unjustified days still produce one monthly case');
assert.deepEqual(Array.from(firstMonthly[0].dates),['2026-11-16','2026-11-17','2026-11-18']);
const callsAfterMonthly=studentCalls;
const secondMonthly=context.getMonthlyUnjustifiedOccurrences('2026-11');
assert.equal(secondMonthly,firstMonthly,'monthly dashboard reuses its computed result on navigation');
assert.equal(studentCalls,callsAfterMonthly,'monthly repeat rows are not rescanned on every page render');

// Data saves explicitly invalidate the cache, including in-place edits that preserve array length.
context.db.attendance[2].hours=0;
context.invalidateAbsenceAnalysisCache();
const afterEdit=context.getUnjustifiedStreaks();
assert.equal(afterEdit.length,0,'a committed attendance edit forces a fresh streak calculation');
assert.ok(studentCalls>callsAfterMonthly,'cache invalidation causes the changed records to be inspected again');

// The current date is part of the cache key and advances without a data save.
today='2026-11-15';
assert.equal(context.getUnjustifiedStreaks().length,0,'a new day gets a fresh view even without a data edit');

// A changed holiday range is picked up after the same explicit settings invalidation used by save().
context.db.settings.schoolHolidays.push({start:'2026-11-16',end:'2026-11-18'});
context.invalidateAbsenceAnalysisCache();
assert.equal(context.isSchoolHolidayDate('2026-11-17'),true,'holiday ranges are validated once and refreshed after settings change');

// The automation runner checks the date/data key before doing any expensive streak or month scan.
const automationStart=html.indexOf('let absenceAutomationRunning=false,absenceAutomationLastKey=');
const automationEnd=html.indexOf('window.createAbsenceStageNotice=',automationStart);
assert.ok(automationStart>=0&&automationEnd>automationStart,'absence automation has a revision-aware run guard');
let streakScans=0,monthlyScans=0,automationDate='2026-11-18';
const automationContext={
 dateISO:()=>automationDate,
 absenceAutomationRevision:0,
 licenseReadOnly:false,
 licenseStateKnown:true,
 db:{attendance:[],documents:[]},
 getUnjustifiedStreaks:()=>{streakScans++;return[];},
 getEligibleAbsenceStages:()=>[],
 getMonthlyUnjustifiedOccurrences:()=>{monthlyScans++;return[];},
 createMonthlyRepetitionWarning:()=>false,
 createAbsenceStageNoticeRecord:()=>false,
 save:()=>true,
 student:()=>null,
 window:{AndroidBridge:null},
 console
};
vm.createContext(automationContext);
vm.runInContext(html.slice(automationStart,automationEnd),automationContext);
automationContext.runAbsenceStageAutomation();
automationContext.runAbsenceStageAutomation();
assert.equal(streakScans,1,'unchanged navigation does not rerun the full absence workflow scan');
assert.equal(monthlyScans,1,'unchanged navigation does not rerun the monthly warning scan');
automationContext.absenceAutomationRevision++;
automationContext.runAbsenceStageAutomation();
assert.equal(streakScans,2,'a committed data change permits a new automation pass');
automationDate='2026-11-19';
automationContext.runAbsenceStageAutomation();
assert.equal(streakScans,3,'the daily automation becomes eligible again on the next date');

// The attendance student selector now waits briefly and uses the shared normalized/cached option builder.
assert.ok(html.includes('let attendanceStudentSearchTimer=0;'),'attendance student search has a debounce timer');
assert.ok(html.includes("refreshActiveStudentSelectors('attendance');"),'attendance search reuses cached normalized selector options');
assert.ok(!html.includes("db.students.filter(s=>!q||[s.last,s.first,s.class,s.schoolYear,s.branch].join(' ').toLocaleLowerCase('ar').includes(q))"),'the old full-list rebuild on each keypress is removed');
assert.ok(html.includes('setTimeout(()=>{')&&html.includes('},100);'),'search rendering is deferred briefly while the user is typing');

console.log('PASS: cached school groups, absence streaks, monthly warning analysis, holiday ranges, automation throttling and debounced attendance search.');
