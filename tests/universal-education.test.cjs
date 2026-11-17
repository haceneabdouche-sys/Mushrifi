const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('const DEFAULT_ACADEMIC_STRUCTURE=');
const end=html.indexOf('function updateStudentClassValue()',start);
assert.notEqual(start,-1,'generic academic configuration must exist');
assert.notEqual(end,-1,'assigned-section filtering must be defined before form handlers');
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
assert.ok(html.includes('...rosterAttributeFields(data)'), 'new student records should store attribute and status');
console.log('Universal education profiles: primary, middle, secondary filtering and data retention passed.');
