const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('function normalizeProfileStudentName(value){');
const end=html.indexOf('window.openStudentProfileAttendanceEdit',start);
assert.ok(start>=0&&end>start,'student profile helpers and timeline builder exist before profile actions');

const target={id:'student-1',last:'وائل',first:'عيسو',class:'1',schoolYear:'أولى',branch:'متوسط',phone:'0550000000'};
const otherSameName={id:'student-2',last:'وائل',first:'عيسو',class:'2',schoolYear:'أولى',branch:'متوسط'};
const otherStudent={id:'student-3',last:'تلميذ آخر',first:'آخر',class:'3',schoolYear:'أولى',branch:'متوسط'};
const parseHours=value=>{
 let text=String(value??'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
 text=text.replace(/\s*(ساعة|ساعات|ساعتان|ساعتين)\s*/g,'').trim();
 if(text==='')return '';
 return /^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
};
const sandbox={
 window:{},
 parseHours,
 attendanceGroupLabel:st=>[st.schoolYear||'',st.branch||'',st.class||''].filter(Boolean).join(' — '),
 studentAcademicParts:st=>({schoolYear:st.schoolYear,branch:st.branch,sectionNumber:st.class}),
 esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start,end),sandbox);

const database={
 students:[target,otherSameName,otherStudent],
 attendance:[
  {id:'a-1',student:'student-1',date:'2026-10-02',type:'غياب',hours:'7 ساعات',justified:'مبرر',notes:'شهادة طبية'},
  {id:'a-2',student:'student-1',date:'2026-10-02',type:'غياب',hours:'2',justified:'غير مبرر'},
  {id:'l-1',student:'student-1',date:'2026-10-06',type:'تأخر',minutes:'١٢',justified:'قيد التبرير'},
  {id:'other-a',student:'student-2',date:'2026-10-07',type:'غياب',hours:'9',justified:'غير مبرر'},
  {id:'legacy-a',student:'وائل عيسو1',studentName:'وائل عيسو1',class:'١',date:'2026-10-01',type:'غياب',hours:'1',justified:'مبرر',notes:'سجل قديم'},
  {id:'wrong-section',student:'وائل عيسو1',studentName:'وائل عيسو1',class:'2',date:'2026-10-09',type:'غياب',hours:'4'}
 ],
 violations:[
  {id:'v-1',student:'student-1',date:'2026-10-08',type:'سلوك',description:'إزعاج داخل القسم',action:'تنبيه',notes:'مراجعة لاحقة',photo:'private-photo-data'},
  {id:'other-v',student:'student-2',date:'2026-10-09',type:'سلوك',description:'لا يخص الملف'}
 ],
 documents:[
  {id:'d-1',student:'student-1',date:'2026-10-09',type:'استدعاء ولي',reason:'متابعة الغياب',appointment:'2026-10-12T09:00',reminderAt:'2026-10-11T18:00',deliveryDate:'2026-10-10',deliveryProof:'توقيع بالاستلام',notes:'الحضور مع الولي',photo:'private-document-photo'},
  {id:'d-2',student:'student-1',date:'',type:'إشعار غياب',reason:'غياب متواصل',appointment:'2026-10-10T08:30'},
  {id:'other-d',student:'student-2',date:'2026-10-11',type:'استدعاء ولي',reason:'لا يخص الملف'}
 ]
};
const data=sandbox.buildStudentReportData(target,database);
assert.equal(data.timeline.length,7,'timeline contains every verified record and no record from another active student');
assert.deepEqual(data.timeline.map(x=>x.recordId),['d-2','d-1','v-1','l-1','a-2','a-1','legacy-a'],'timeline sorts newest first and keeps distinct same-day records and safe legacy records');
assert.equal(data.timeline[0].source,'documents','latest dated document appears first');
assert.equal(data.timeline[0].date,'2026-10-10','a document without an issue date uses its valid appointment date as a chronology fallback');
assert.ok(data.timeline.some(x=>x.recordId==='a-1'&&x.detail.includes('7 ساعة')),'absence duration uses the known Arabic hours value');
assert.ok(data.timeline.some(x=>x.recordId==='l-1'&&x.detail.includes('12 دقيقة')),'lateness duration is shown in minutes');
assert.ok(!data.timeline.some(x=>x.recordId==='other-a'||x.recordId==='other-v'||x.recordId==='other-d'||x.recordId==='wrong-section'),'different IDs and mismatching sections are never pulled into this student timeline');
assert.ok(data.timeline.some(x=>x.recordId==='d-1'&&x.appointment==='2026-10-12T09:00'&&x.detail.includes('إثبات التبليغ')),'summons keep appointment and delivery evidence together');
assert.ok(!data.timeline.some(x=>String(x.detail).includes('private-photo')),'timeline does not copy or expose image payloads');

const allView=sandbox.profileTimelineView(data.timeline,'all',3);
assert.equal(allView.total,7,'timeline reports the full event count while limiting initial display');
assert.equal(allView.shown,3,'timeline initially displays only the requested page size');
assert.ok(allView.html.includes('فتح الوثيقة')&&allView.html.includes('عرض المخالفة'),'timeline provides source-specific record actions');
assert.ok(allView.html.includes('2026')||allView.html.includes('أكتوبر'),'timeline shows a readable event date');
const attendanceView=sandbox.profileTimelineView(data.timeline,'attendance',50);
assert.equal(attendanceView.total,4,'attendance filter includes all matching attendance records only');
const violationView=sandbox.profileTimelineView(data.timeline,'violations',50);
assert.equal(violationView.total,1,'violation filter excludes other event categories');
const documentView=sandbox.profileTimelineView(data.timeline,'documents',50);
assert.equal(documentView.total,2,'document filter includes summons and notices');
const capped=sandbox.profileTimelineView(data.timeline,'all',500);
assert.equal(capped.shown,7,'display cap never hides events when the requested count covers the history');

const ambiguous=sandbox.buildStudentTimeline(target,{students:[target,otherSameName],attendance:[{id:'ambiguous',student:'وائل عيسو1',date:'2026-10-13',type:'غياب'}]});
assert.equal(ambiguous.length,0,'a legacy same-name record without a section is not guessed when duplicate names exist');

const reportMarkup=sandbox.buildStudentPrintableReportMarkup(data);
assert.ok(reportMarkup.includes('الخط الزمني الشامل'),'printable student report includes the consolidated timeline');
assert.ok(reportMarkup.includes('متابعة الغياب')&&reportMarkup.includes('توقيع بالاستلام'),'printable timeline includes document reason and delivery evidence');
assert.ok(!reportMarkup.includes('0550000000')&&!reportMarkup.includes('private-document-photo'),'printable report continues to exclude unnecessary contact and image payloads');

assert.ok(html.includes('id="studentTimelineFilter"')&&html.includes('id="studentTimelineMore"'),'profile timeline has category filtering and progressive loading controls');
assert.ok(html.includes('window.openStudentProfileViolation=id=>'),'violation timeline action has a direct navigation handler');
assert.ok(html.includes('data-violation-id='),'violation records expose a stable row identity for safe navigation');
assert.ok(html.includes('window.openStudentProfileAttendanceEdit(id)')&&html.includes('window.openStudentProfileDocumentEdit(id)'),'timeline actions use the existing record editors');
assert.ok(fs.readFileSync('.github/workflows/build-apk.yml','utf8').includes('node tests/student-timeline.test.cjs'),'CI runs the new timeline regression suite');

console.log('PASS: unified student timeline chronology, safe ID and legacy matching, same-day distinct events, source actions, filters, progressive display and printable report.');
