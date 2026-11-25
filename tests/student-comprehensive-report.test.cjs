const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helperStart=html.indexOf('function normalizeProfileStudentName(value){');
const helperEnd=html.indexOf('window.openStudentProfileAttendanceEdit',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'student report data helpers must be defined before profile actions');
const parseHours=value=>{
 let text=String(value??'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٫،]/g,'.');
 text=text.replace(/\s*(ساعة|ساعات|ساعتان|ساعتين)\s*/g,'').trim();
 if(text==='')return '';
 return /^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
};
const target={id:'student-1',last:'سعيد',first:'الطالب',class:'1',sectionNumber:'1',schoolYear:'أولى',branch:'علوم وتكنولوجيا',attribute:'داخلي',guardian:'ولي سعيد',phone:'0550000000'};
const sandbox={
 window:{},
 parseHours,
 attendanceGroupLabel:st=>[st.schoolYear||'',st.branch||'',st.class||''].filter(Boolean).join(' — '),
 studentAcademicParts:st=>({schoolYear:st.schoolYear,branch:st.branch,sectionNumber:st.sectionNumber||st.class}),
 esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
};
vm.createContext(sandbox);
vm.runInContext(html.slice(helperStart,helperEnd),sandbox);

const database={
 students:[target,{id:'student-2',last:'طالب آخر',first:'آخر',class:'2',schoolYear:'أولى',branch:'علوم وتكنولوجيا'}],
 attendance:[
  {id:'a-1',student:'student-1',date:'2026-10-02',type:'غياب',hours:'7 ساعات',justified:'مبرر',notes:'تم إحضار شهادة طبية'},
  {id:'a-2',student:'student-1',date:'2026-10-03',type:'غياب',hours:'3',justified:'غير مبرر',notes:'اتصال بالولي'},
  {id:'a-3',student:'student-1',date:'2026-10-04',type:'غياب',hours:'',period:'الفترة الصباحية',notes:'طلب تبرير'},
  {id:'a-4',student:'student-1',date:'2026-10-05',type:'غياب',hours:'2',justified:'قيد التبرير'},
  {id:'l-1',student:'student-1',date:'2026-10-06',type:'تأخر',minutes:'١٢',justified:'مبرر',notes:'تأخر بسبب النقل'},
  {id:'l-2',student:'student-1',date:'2026-10-07',type:'تأخر',hours:'0.25',justified:'غير مبرر'},
  {id:'other-a',student:'student-2',date:'2026-10-07',type:'غياب',hours:'9',justified:'غير مبرر'},
  {id:'legacy-a',student:'سعيد الطالب',studentName:'سعيد الطالب',class:'١',date:'2026-10-01',type:'غياب',hours:'1',justified:'مبرر'}
 ],
 violations:[
  {id:'v-1',student:'student-1',date:'2026-10-08',type:'سلوك',description:'إزعاج داخل القسم',action:'تنبيه',notes:'متابعة بعد أسبوع'},
  {id:'other-v',student:'student-2',date:'2026-10-08',type:'سلوك',description:'لا تخص التلميذ'}
 ],
 documents:[
  {id:'d-1',student:'student-1',date:'2026-10-09',type:'استدعاء ولي',reason:'متابعة الغياب',appointment:'2026-10-12T09:00',reminderAt:'2026-10-11T18:00',deliveryDate:'2026-10-10',deliveryProof:'توقيع بالاستلام',notes:'الحضور مع الولي'},
  {id:'d-2',student:'student-1',date:'2026-10-10',type:'إشعار غياب - المرحلة الأولى',reason:'غياب متواصل',deliveryDate:'2026-10-10',deliveryProof:'وصل الاستلام'},
  {id:'d-3',student:'student-1',date:'2026-10-11',type:'تنبيه',reason:'متابعة عامة'},
  {id:'other-d',student:'student-2',date:'2026-10-11',type:'استدعاء ولي',reason:'لا يخص التلميذ'}
 ]
};
const data=sandbox.buildStudentReportData(target,database);
assert.equal(data.absences.length,5,'all and only matching student absences are included, including safe legacy recovery');
assert.equal(data.lateness.length,2,'only matching student lateness records are included');
assert.equal(data.violations.length,1,'only the selected student violations are included');
assert.equal(data.documents.length,3,'only the selected student documents are included');
assert.equal(data.summons.length,1,'guardian summons are separated');
assert.equal(data.absenceNotices.length,1,'absence notices are separated');
assert.equal(data.otherDocuments.length,1,'other notices are separated');
assert.equal(data.summary.absences,5,'absence total counts the included records');
assert.equal(data.summary.absenceStatus.justified,2,'justified absence count is correct including legacy record');
assert.equal(data.summary.absenceStatus.unjustified,1,'only explicit unjustified status is counted');
assert.equal(data.summary.absenceStatus.pending,1,'pending justification is counted separately');
assert.equal(data.summary.absenceStatus.unknown,1,'missing justification is unknown, not unjustified');
assert.equal(data.summary.absenceHours,13,'only known absence hours are added');
assert.equal(data.summary.unknownAbsenceHours,1,'missing or unreadable absence duration is shown separately');
assert.equal(data.summary.latenessMinutes,27,'Arabic explicit minutes and legacy decimal hours are handled separately');
assert.equal(data.summary.unknownLatenessMinutes,0,'both lateness durations are known');
assert.equal(data.summary.notes,6,'attendance, violation and document notes are included');
assert.equal(data.notes[0].date,'2026-10-09','notes are ordered newest first');
assert.equal(data.summary.summons,1,'summons count is correct');
assert.equal(data.summary.absenceNotices,1,'absence notice count is correct');
assert.ok(data.summons[0].deliveryProof.includes('الاستلام'),'delivery evidence stays with the summons');

const markup=sandbox.buildStudentPrintableReportMarkup(data);
for(const heading of ['التقرير الشامل للتلميذ','البيانات التعريفية','الحصيلة الإجمالية','تفصيل الغيابات','تفصيل التأخرات','سجل المخالفات','استدعاءات الأولياء','إشعارات الغياب','الوثائق والإشعارات الأخرى','الملاحظات المسجلة'])assert.ok(markup.includes(heading),'printable PDF includes section: '+heading);
for(const note of ['تم إحضار شهادة طبية','اتصال بالولي','متابعة بعد أسبوع','الحضور مع الولي'])assert.ok(markup.includes(note),'printable PDF preserves note: '+note);
assert.ok(markup.includes('توقيع بالاستلام'),'printable PDF retains delivery proof');
assert.ok(markup.includes('غير محدد'),'printable PDF explicitly labels unknown justification');
assert.ok(markup.includes('غير مسجلة'),'printable PDF marks unavailable duration');
assert.ok(!markup.includes('student-2')&&!markup.includes('لا يخص التلميذ'),'printable PDF never includes another student data');
assert.ok(!markup.includes('0550000000'),'PDF omits guardian phone number to limit unnecessary personal data exposure');
assert.ok(!markup.includes('<button'),'printable PDF contains no editing controls');

const profileStart=html.indexOf('window.studentHistory=id=>{');
const profileEnd=html.indexOf('\n};\nwindow.closeMushrifiPrintPreview',profileStart);
assert.ok(profileStart>=0&&profileEnd>profileStart,'student profile renderer exists');
const profile=html.slice(profileStart,profileEnd);
assert.ok(profile.includes("dataset.reportKind='student'")&&profile.includes('dataset.studentReportId=sid'),'individual profile marks its report for the dedicated export flow');
assert.ok(profile.includes('onclick="window.printReport()"'),'individual profile uses the branded PDF print preview');
assert.ok(profile.includes('غير محدد'),'on-screen student profile shows unknown justification state');
assert.ok(html.includes('buildStudentPrintableReportMarkup(data)'),'print action rebuilds the student report directly from saved records');
assert.ok(html.includes('window.closeMushrifiPrintPreview(false)'),'print preview has a safe return action');

console.log('PASS: comprehensive individual student report includes only verified student records, full categories, notes, summons and delivery evidence; unknown states/durations stay explicit; Arabic durations are correct; PDF markup is printable and excludes unrelated student data and unnecessary guardian phone details.');
