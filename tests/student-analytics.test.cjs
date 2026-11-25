const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function analyticsDateValid(value){');
const end=html.indexOf("$('#makeReport').onclick=()=>{",start);
assert.ok(start>=0&&end>start,'pure student analytics helpers must exist before the renderer');
const sandbox={};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const students=[
 {id:'s1',last:'أحمد',first:'الأول',schoolYear:'أولى',branch:'علوم',class:'1'},
 {id:'s2',last:'محمد',first:'الثاني',schoolYear:'أولى',branch:'علوم',class:'2'}
];
const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ar');
const groupKey=st=>[st.schoolYear,st.branch,st.class].map(norm).join('¦');
const resolveStudent=id=>students.find(st=>String(st.id)===String(id))||null;
const recordGroupKey=r=>[r.schoolYear||'',r.branch||'',r.class||''].map(norm).join('¦');
const parseHours=value=>{
 let s=String(value??'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫،]/g,'.').replace(/\s*(ساعة|ساعات|ساعتان|ساعتين)\s*/g,'').trim();
 if(s==='')return '';
 return /^\d+(?:\.\d+)?$/.test(s)?Number(s):NaN;
};
const attendance=[
 {id:'a1',student:'s1',date:'2026-11-04',type:'غياب',hours:'7 ساعات',justified:'مبرر'},
 {id:'a2',student:'s1',date:'2026-11-04',type:'غياب',hours:'2',justified:'غير مبرر'},
 {id:'a2',student:'s1',date:'2026-11-04',type:'غياب',hours:'2',justified:'غير مبرر'},
 {id:'l1',student:'s2',date:'2026-11-05',type:'تأخر',minutes:12,hours:0.2},
 {id:'l2',student:'s2',date:'2026-11-06',type:'تأخر',hours:'0.5'},
 {id:'l3',student:'s2',date:'2026-11-08',type:'تأخر',hours:'',minutes:''},
 {id:'a4',student:'s2',date:'2026-11-07',type:'غياب',hours:'',justified:''},
 {id:'a3',student:'deleted-student',date:'2026-11-07',type:'غياب',hours:'3',schoolYear:'أولى',branch:'علوم',class:'9'},
 {id:'bad-date',student:'s1',date:'2026-02-30',type:'غياب',hours:'5'}
];
const violations=[
 {id:'v1',student:'s1',date:'2026-11-04',type:'سلوك'},
 {id:'v2',student:'s1',date:'2026-11-06',type:'سلوك'},
 {id:'v2',student:'s1',date:'2026-11-06',type:'سلوك'},
 {id:'v3',student:'s2',date:'2026-11-04',type:'تأخر'},
 {id:'v4',student:'deleted-student',date:'2026-11-07',type:'غير معروف',schoolYear:'أولى',branch:'علوم',class:'9'},
 {id:'bad-v',student:'s1',date:'not-a-date',type:'سلوك'}
];
const result=sandbox.buildStudentAnalyticsSnapshot({
 attendance,violations,students,from:'2026-11-01',to:'2026-11-30',
 resolveStudent,groupKey,recordGroupKey,
 groupLabel:st=>'أولى — '+st.branch+' — '+st.class,
 studentLabel:st=>st.last+' '+st.first,
 parseHours
});
assert.equal(result.valid,true,'valid date range is accepted');
assert.equal(result.summary.absences,4,'valid absence rows are counted once per unique record ID');
assert.equal(result.summary.justifiedAbsences,1,'justified absences are separated');
assert.equal(result.summary.unjustifiedAbsences,1,'unjustified absences are separated');
assert.equal(result.summary.unknownAbsenceJustification,2,'missing justification status is not mislabeled as unjustified');
assert.equal(result.summary.unknownAbsenceHours,1,'blank absence duration is reported as unknown rather than counted as zero hours');
assert.equal(result.summary.absenceHours,12,'Arabic hour units are parsed as numeric hours');
assert.equal(result.summary.lateness,3,'late records are counted');
assert.equal(result.summary.unknownLatenessMinutes,1,'blank lateness duration is reported as unknown rather than counted as zero minutes');
assert.equal(result.summary.latenessMinutes,42,'explicit minutes win and legacy hours convert to minutes');
assert.equal(result.summary.violations,4,'valid violation records are counted once per unique ID');
assert.equal(result.summary.unclassifiedAttendance,1,'records with unknown group are not assigned to a live class');
assert.equal(result.summary.unclassifiedViolations,1,'unlinked violation is not assigned to a live class');
assert.equal(result.sections.length,2,'only known active sections appear in section rankings');
const section1=result.sections.find(x=>x.key===groupKey(students[0]));
const section2=result.sections.find(x=>x.key===groupKey(students[1]));
assert.equal(section1.absences,2,'known records are attributed to their verified active section');
assert.equal(section1.violations,2,'violations are attributed to the verified section');
assert.equal(section2.lateness,3,'late records are attributed to the verified section');
assert.equal(section2.absences,1,'a blank-duration absence remains counted as a record without inventing hours');
assert.equal(section2.violations,1,'second section violation count is correct');
assert.equal(result.sectionsByLateness[0].key,groupKey(students[1]),'late-section ranking sorts by lateness rather than absence count');
assert.deepEqual(JSON.parse(JSON.stringify(result.topViolators.map(x=>({id:x.id,count:x.count,distinctDays:x.distinctDays})))),[
 {id:'s1',count:2,distinctDays:2},
 {id:'s2',count:1,distinctDays:1}
],'repeat-offender ranking counts records and distinct dates without double counting');
assert.ok(result.weekly.length>0&&result.monthly.length>0,'weekly and monthly time series are produced');
assert.equal(result.monthly[0].absences,4,'month chart includes valid absence rows and unclassified rows exactly once');
assert.equal(result.weekly[0].label.startsWith('2026-11-01'),true,'first weekly bucket is calendar-week based for a Sunday start');

const invalid=sandbox.buildStudentAnalyticsSnapshot({attendance,violations,students,from:'2026-02-30',to:'2026-11-30'});
assert.equal(invalid.valid,false,'impossible calendar date invalidates the report');
const reversed=sandbox.buildStudentAnalyticsSnapshot({attendance,violations,students,from:'2026-11-30',to:'2026-11-01'});
assert.equal(reversed.valid,false,'reversed date range invalidates the report');
const wide=sandbox.buildStudentAnalyticsSnapshot({attendance,violations,students,from:'2000-01-01',to:'2026-11-30',resolveStudent,groupKey,recordGroupKey,groupLabel:st=>st.class,studentLabel:st=>st.last,parseHours});
assert.ok(wide.weekly.length<=12&&wide.monthly.length<=12,'long custom ranges cap rendered chart buckets at the latest 12 weeks and months');

assert.ok(html.includes('id="studentAnalyticsPanel"'),'analytics panel is present in the reports page');
assert.ok(html.includes('data-analytics-range="7"')&&html.includes('data-analytics-range="6months"'),'time range shortcuts are available');
assert.ok(html.includes('الترتيب حسب عدد الغيابات'),'section ranking clearly explains its sort criterion');
assert.ok(html.includes('التلاميذ الأكثر تكراراً للمخالفات'),'repeat violation ranking is rendered');
assert.ok(html.includes("if(activePage==='reports'){ensureStudentAnalyticsDates();renderStudentAnalytics();}"),'analytics refreshes when the reports page opens or saved data changes');
assert.ok(html.includes('unknownAbsenceHours')&&html.includes('unclassifiedViolations'),'incomplete data and unreadable durations remain visible');

console.log('PASS: student analytics date safety, duplicate-ID handling, Arabic duration parsing, justified status separation, exact minutes, section attribution, unlinked-record safeguards, repeat-violation ranking and weekly/monthly trends.');
