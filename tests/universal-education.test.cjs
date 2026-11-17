const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('const DEFAULT_ACADEMIC_STRUCTURE=');
const end=html.indexOf('function renderAssignedSections()',start);
assert.notEqual(start,-1,'generic academic configuration must exist');
assert.notEqual(end,-1,'assigned-section filtering must be defined before UI handlers');
const context={
 db:{settings:{educationLevel:'primary',assignedSections:[{schoolYear:'السنة الأولى',branch:'عام',sectionNumber:'1'}]},students:[
  {id:'p1',first:'أحمد',last:'ابتدائي',schoolYear:'السنة الأولى',class:'1'},
  {id:'p2',first:'سارة',last:'ابتدائي',schoolYear:'السنة الثانية',class:'1'},
  {id:'m1',first:'علي',last:'متوسط',schoolYear:'الأولى متوسط',class:'1'},
  {id:'s1',first:'ليلى',last:'ثانوي',schoolYear:'أولى',branch:'جذع مشترك علوم وتكنولوجيا',class:'1'}
 ]}
};
vm.createContext(context);
vm.runInContext(html.slice(start,end),context);
assert.equal(context.studentsForUser().length,1,'primary profile should show only the assigned primary class');
assert.equal(context.studentsForUser()[0].id,'p1');
assert.equal(context.assignedSectionKey({schoolYear:'أولى',branch:'جدع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),context.assignedSectionKey({schoolYear:'أولى',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),'assigned-section matching should normalize legacy branch spelling');
assert.equal(context.assignedSectionKey({schoolYear:'أولى',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),context.assignedSectionKey({schoolYear:'الأولى ثانوي',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),'secondary year labels with the ثانوي suffix should match the roster year');
assert.equal(context.assignedSectionKey({schoolYear:'أولى',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),context.assignedSectionKey({schoolYear:'السنة الأولى ثانوي',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),'full secondary year labels should match the short roster year');
assert.equal(context.assignedSectionKey({schoolYear:'ثانية',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),context.assignedSectionKey({schoolYear:'الثانية ثانوي',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}),'second-year labels should normalize consistently');
assert.equal(context.studentAcademicParts(context.db.students[0]).branch,'عام','primary classes should use the general branch');
context.db.settings.educationLevel='middle';
context.db.settings.assignedSections=[{schoolYear:'الأولى متوسط',branch:'عام',sectionNumber:'1'}];
assert.deepEqual(Array.from(context.studentsForUser(),s=>s.id),['m1'],'middle profile should filter by its assigned class');
context.db.settings.educationLevel='secondary';
context.db.settings.assignedSections=[{schoolYear:'أولى',branch:'جذع مشترك علوم وتكنولوجيا',sectionNumber:'1'}];
assert.deepEqual(Array.from(context.studentsForUser(),s=>s.id),['s1'],'secondary profile should filter by year, branch and section');
assert.ok(context.academicStructure().some(x=>x.schoolYear==='أولى'&&x.branch==='جذع مشترك علوم وتكنولوجيا'),'secondary structure should retain branch definitions');
context.db.settings.educationLevel='primary';
context.db.settings.assignedSections=[{schoolYear:'السنة الأولى',branch:'عام',sectionNumber:'1'}];
context.academicStructure();
assert.equal(context.db.students.length,4,'changing education profile must not delete student records');
assert.equal(context.db.students.find(s=>s.id==='s1').first,'ليلى','unassigned student records remain preserved');
assert.ok(html.includes('id="setupRosterFile" type="file" accept=".csv,.xls,.html'),'first-run setup should accept legacy Excel roster files');
assert.ok(html.includes("const required=['last','first','class']"),'national identity number should be optional in roster imports');
assert.ok(html.includes('if(data.branch)data.branch=canonicalBranch(data.branch)'),'roster branch aliases should be canonicalized before updating student cards');
assert.ok(html.includes('mushrifi-roster-import-finished'),'setup should wait for roster import completion');
assert.ok(html.includes("if(backupFile&&window.AndroidBridge){if(typeof AndroidBridge.clearSummonsReminders==='function')AndroidBridge.clearSummonsReminders();if(typeof AndroidBridge.scheduleSummonsReminder==='function')db.documents.filter(d=>d.type==='استدعاء ولي'&&d.appointment).forEach(scheduleSummonsReminder);}"),'first-run JSON restore should rebuild guardian appointment reminders');
assert.ok(html.includes("البطاقات المطابقة والمحدّثة: '+updated")&&html.includes("إجمالي بطاقات التلاميذ في القاعدة: '+db.students.length"),'import summary should report matched students and final total');
assert.ok(html.includes("إجمالي التلاميذ في الأقسام المسندة إليك: '+studentsForUser().length"),'import summary should distinguish the supervisor assigned-student total from the full imported roster');
assert.ok(html.includes('let importSnapshot=null,importCommitted=false;'),'roster import should track a transaction snapshot');
assert.ok(html.includes('if(importSnapshot&&!importCommitted)'),'roster import should roll back partial changes after a failed import');
assert.ok(html.includes('importCommitted=true;'),'roster import should commit only after a successful database save');
const attrStart=html.indexOf('function rosterAttributeFields(data)');
const attrEnd=html.indexOf("\n$('#clearStudents').onclick=",attrStart);
assert.notEqual(attrStart,-1,'roster schooling-system mapping must exist');
assert.notEqual(attrEnd,-1,'roster schooling-system mapping must be isolated');
vm.runInContext(html.slice(attrStart,attrEnd),context);
assert.deepEqual(JSON.parse(JSON.stringify(context.rosterAttributeFields({schoolingSystem:'نصف داخلي'}))),{attribute:'نصف داخلي',status:'نصف داخلي'},'new imported students should retain their school system as the visible attribute');
assert.deepEqual(JSON.parse(JSON.stringify(context.rosterAttributeFields({schoolingSystem:''}))),{attribute:'',status:''},'blank roster systems should not invent an attribute');
assert.ok(html.includes('const schooling=rosterAttributeFields(data)'), 'matched student records should fill missing attribute fields from the roster');
assert.ok(html.includes('target.attribute=schooling.attribute;target.status=schooling.status;'),'matched student cards should keep their schooling attribute synchronized with the master roster');
assert.ok(html.includes('const legacyKey=value=>'),'assigned activity should recognize legacy student-name links');
assert.ok(html.includes("let matches=db.students.filter(st=>[st.last+' '+st.first"),'legacy-name activity matching should check the whole institution before assigning records');
assert.ok(html.includes('return matches.length===1&&assignedIds.has(String(matches[0].id))'),'legacy-name activity matching should reject ambiguous or unassigned students');
const nameNormStart=html.indexOf('const normalizeStudentIdentity=');
const nameNormEnd=html.indexOf('\nconst findStudentForRecord',nameNormStart);
assert.notEqual(nameNormStart,-1,'legacy student identity normalizer must exist');
assert.notEqual(nameNormEnd,-1,'legacy student identity normalizer must be isolated');
const normalizeStudentIdentity=vm.runInContext(html.slice(nameNormStart,nameNormEnd)+'\nnormalizeStudentIdentity',context);
assert.equal(normalizeStudentIdentity('وائل عيسو1'),normalizeStudentIdentity('وائل عيسو'),'legacy student history should resolve names ending in digits');
assert.ok(html.includes('const requested=String(id),assignedStudents=studentsForUser();let s=assignedStudents.find'),'student history should resolve legacy name references only within assigned sections');

assert.ok(html.includes(String.raw`replace(/\s*\d+$/,'')`),'legacy student-name matching should ignore trailing digits without deleting the record');
assert.ok(html.includes('...rosterAttributeFields(data)'), 'new student records should store attribute and status');
assert.ok(html.includes('studentsForUser().filter(s=>attendanceGroupKey(s)===cls)'),'daily attendance roster should be limited to assigned classes');
assert.ok(html.includes('st=studentsForUser().find(x=>String(x.id)===check.dataset.id)'),'daily attendance saving should use only assigned students');
assert.ok(html.includes('roster=studentsForUser().filter(s=>attendanceGroupKey(s)===group.key)'),'monthly attendance reports should only count assigned students');
assert.ok(html.includes('const choices=studentsForUser().map'),'attendance record editing should only offer assigned students');
assert.ok(html.includes('const students=studentsForUser().map'),'document editing should only offer assigned students');
assert.ok(html.includes('const requested=String(id),assignedStudents=studentsForUser();let s=assignedStudents.find'),'individual student history should resolve only within assigned students');
assert.ok(html.includes('id="assignedYear"')&&html.includes('id="assignedBranch"')&&html.includes('id="assignedSection"'),'settings should allow adding assigned sections after first-run setup');
assert.ok(html.includes("$('#addAssignedSection')?.addEventListener"),'assigned-section addition should be interactive');
assert.ok(html.includes("level==='secondary'?canonicalBranch($('#assignedBranch').value.trim()):'عام'"),'primary and middle assigned sections should use the general branch');
assert.ok(html.includes('db.settings.assignedSections.push(item)'),'new assigned sections should be persisted in settings');
assert.ok(html.includes('assignedSectionKey(x)===assignedSectionKey(item)'),'duplicate assigned sections should be rejected');
assert.ok(html.includes("if(typeof updateAssignedBranchVisibility==='function')updateAssignedBranchVisibility();"),'saved education level should control the assigned-section branch field on every render');

assert.ok(html.includes('const st=studentsForUser().find(x=>String(x.id)===String(f.get(\'student\')))'),'individual attendance submission should validate the selected student against assigned classes');

assert.ok(html.includes('const EMPTY_DB=\'{"students":[],"attendance":[],"documents":[],"violations":[],"settings":{}}\';'),'a genuinely new installation should start with empty student and follow-up collections');
assert.ok(html.includes('لا توجد بطاقات تلاميذ أو سجلات غياب أو تأخر أو مخالفات أو استدعاءات'),'first-run instructions should clearly explain that a clean installation has no previous records');
assert.ok(html.includes('تبدأ سجلات المتابعة بالظهور عندما تنشئها أنت'),'first-run instructions should explain that follow-up records are created only by the user');
console.log('Universal education profiles: primary, middle, secondary filtering and data retention passed.');
