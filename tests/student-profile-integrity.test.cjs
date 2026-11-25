const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helperStart=html.indexOf('function normalizeProfileStudentName(value){');
const helperEnd=html.indexOf('window.openStudentProfileAttendanceEdit',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'profile identity and duration helpers must be defined before profile actions');
const helperSource=html.slice(helperStart,helperEnd);
const sandbox={
  attendanceGroupLabel:st=>[st.schoolYear||'',st.branch||'',st.class||''].filter(Boolean).join(' — '),
  parseHours:value=>{
    let text=String(value??'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    text=text.replace(/\s*(ساعة|ساعات|ساعتان|ساعتين)\s*/g,'').trim();
    if(text==='')return '';
    return /^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
  }
};
vm.createContext(sandbox);
vm.runInContext(helperSource,sandbox);

const student={id:'student-current',last:'وائل',first:'عيسو',class:'١',schoolYear:'أولى',branch:'متوسط'};
assert.equal(sandbox.normalizeProfileStudentName('وَائِل عيسو1'),'وائل عيسو','Latin trailing digits are removed after Arabic normalization');
assert.equal(sandbox.normalizeProfileStudentName('وَائِل عيسو ١'),'وائل عيسو','Arabic trailing digits are removed too');
assert.equal(sandbox.normalizeProfileStudentName('وائل عيسو 2'),'وائل عيسو','trailing suffix is removed with or without a separating space');
assert.equal(sandbox.normalizeProfileStudentName('عبد ٢ الرحمن'),'عبد ٢ الرحمن','digits inside a name are preserved');
assert.equal(sandbox.normalizeProfileStudentSection(' ١ '),'1','Arabic numerals and spaces normalize in section matching');

const legacyNameRecord={student:'وائل عيسو1',studentName:'وائل عيسو1',class:'1'};
assert.equal(sandbox.profileRecordBelongsToStudent(legacyNameRecord,student,[student]),true,'legacy name-based record with matching section is attached');
assert.equal(sandbox.profileRecordBelongsToStudent({student:'وائل عيسو1',class:'١'},student,[student]),true,'older records with the name in the student field remain supported');
assert.equal(sandbox.profileRecordBelongsToStudent({student:student.id,studentName:'اسم قديم',class:'قسم آخر'},student,[student]),true,'an exact internal ID always wins over stale display labels');

const other={...student,id:'student-other'};
assert.equal(sandbox.profileRecordBelongsToStudent({student:other.id,studentName:'وائل عيسو',class:'1'},student,[student,other]),false,'an active different student ID cannot be claimed by a name match');
assert.equal(sandbox.profileRecordBelongsToStudent({student:'old-uuid-123',studentName:'وائل عيسو1',class:'1'},student,[student]),true,'a legacy opaque ID can be safely recovered through its explicit name and matching section');
assert.equal(sandbox.profileRecordBelongsToStudent({student:'وائل عيسو1',class:'قسم آخر'},student,[student]),false,'a legacy record from another section is excluded');

const duplicate={id:'student-duplicate',last:'وائل',first:'عيسو',class:'٢',schoolYear:'أولى',branch:'متوسط'};
assert.equal(sandbox.profileRecordBelongsToStudent({student:'وائل عيسو1'},student,[student,duplicate]),false,'a legacy record without section is not guessed when the same name exists more than once');

assert.equal(sandbox.profileAbsenceHours({hours:'7 ساعات'}),7,'absence hour totals parse Arabic unit labels');
assert.equal(sandbox.profileAbsenceHours({hours:'',period:'٢٫٥'}),0,'invalid fallback values do not produce fabricated absence hours');
assert.equal(sandbox.profileLatenessMinutes({minutes:12,hours:0.2}),12,'explicit lateness minutes are authoritative');
assert.equal(sandbox.profileLatenessMinutes({hours:0.25}),15,'legacy lateness hours convert to minutes');
assert.equal(sandbox.profileLatenessMinutes({minutes:0,hours:1}),0,'an explicitly stored zero-minute value is preserved');

const profileStart=html.indexOf('window.studentHistory=id=>{');
const profileEnd=html.indexOf('window.closeMushrifiPrintPreview',profileStart);
assert.ok(profileStart>=0&&profileEnd>profileStart,'student profile renderer exists');
const profile=html.slice(profileStart,profileEnd);
assert.ok(profile.includes('profileRecordBelongsToStudent(s,db.students)'),'profile uses the tested conservative record matcher');
assert.ok(profile.includes('مجموع ساعات الغياب')&&profile.includes('مجموع دقائق التأخر'),'profile displays absence hours and lateness minutes as separate units');
assert.ok(!profile.includes('مجموع الساعات الكلي'),'profile does not add incompatible hours and minutes together');
assert.ok(profile.includes('profileLatenessMinutes(x)+\\' دقيقة\\''),'lateness rows display minutes');
assert.ok(profile.includes('profileAbsenceHours(x)+\\' ساعة\\''),'absence rows display hours');
assert.ok(profile.includes('openStudentProfileAttendanceEdit(this.dataset.id)'),'profile attendance records have a direct edit action');
assert.ok(profile.includes('openStudentProfileDocumentEdit(this.dataset.id)'),'profile documents have a direct edit action');
assert.match(html,/window\.openStudentProfileAttendanceEdit=id=>\{\s*go\('attendance'\);[\s\S]*window\.editAttendance\(String\(id\)\)/,'profile attendance edit opens the existing editor safely');
assert.match(html,/window\.openStudentProfileDocumentEdit=id=>\{\s*go\('documents'\);[\s\S]*window\.editDocument\(String\(id\)\)/,'profile document edit opens the existing editor safely');

console.log('PASS: profile history matching, duplicate-name safety, trailing-number normalization, section matching, duration units and direct editing.');
