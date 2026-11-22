const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('const EDUCATION_LEVELS=');
const end=html.indexOf('function updateStudentClassValue()',start);
assert.notEqual(start,-1,'all educational stages must be declared');
assert.notEqual(end,-1,'academic helper functions must be isolated');
const context={db:{settings:{academicStructure:[]},students:[
 {id:'p1',schoolYear:'السنة الأولى ابتدائي',class:'1'},
 {id:'m4',schoolYear:'السنة الرابعة متوسط',class:'2'},
 {id:'s2',schoolYear:'السنة الثانية ثانوي',branch:'علوم تجريبية',class:'3'},
 {id:'legacy',schoolYear:'أولى',branch:'جذع مشترك علوم وتكنولوجيا',class:'1'}
]}};
vm.createContext(context);
vm.runInContext(html.slice(start,end)+'\nglobalThis.__test={EDUCATION_LEVELS,DEFAULT_ACADEMIC_STRUCTURE};',context);
assert.equal(context.__test.EDUCATION_LEVELS.find(x=>x.key==='primary').years.length,5,'primary must have five years');
assert.equal(context.__test.EDUCATION_LEVELS.find(x=>x.key==='middle').years.length,4,'middle must have four years');
assert.equal(context.__test.EDUCATION_LEVELS.find(x=>x.key==='secondary').years.length,3,'secondary must have three years');
assert.equal(context.__test.DEFAULT_ACADEMIC_STRUCTURE.filter(x=>x.educationLevel==='primary').length,5,'all primary years need a default general class');
assert.equal(context.__test.DEFAULT_ACADEMIC_STRUCTURE.filter(x=>x.educationLevel==='middle').length,4,'all middle years need a default general class');
assert.equal(context.__test.DEFAULT_ACADEMIC_STRUCTURE.filter(x=>x.educationLevel==='secondary').length,14,'secondary years need first-year trunks and upper-year branches');
assert.equal(context.studentAcademicParts(context.db.students[0]).educationLevel,'primary');
assert.equal(context.shortAcademicYear('السنة الأولى ابتدائي'),'سنة أولى','primary year labels should be short');
assert.equal(context.shortAcademicYear('السنة الأولى متوسط'),'سنة أولى','middle year labels should be short');
assert.equal(context.shortAcademicYear('السنة الرابعة متوسط'),'سنة رابعة','middle year labels should be short');
assert.equal(context.studentAcademicParts(context.db.students[1]).educationLevel,'middle');
assert.equal(context.studentAcademicParts(context.db.students[2]).educationLevel,'secondary');
assert.equal(context.studentAcademicParts(context.db.students[0]).branch,'عام','primary students use a general branch');
assert.equal(context.studentAcademicParts(context.db.students[1]).branch,'عام','middle students use a general branch');
assert.equal(context.studentAcademicParts(context.db.students[3]).educationLevel,'secondary','legacy short year names remain secondary');
const structure=context.academicStructure();
assert.ok(structure.some(x=>x.educationLevel==='primary'&&x.schoolYear==='السنة الخامسة ابتدائي'));
assert.ok(structure.some(x=>x.educationLevel==='middle'&&x.schoolYear==='السنة الرابعة متوسط'));
assert.ok(structure.some(x=>x.educationLevel==='secondary'&&x.schoolYear==='السنة الثالثة ثانوي'&&x.branch==='لغات أجنبية'));
assert.equal(context.db.students.length,4,'building the new academic structure must not delete student records');
assert.equal(context.db.students.find(x=>x.id==='legacy').schoolYear,'أولى','legacy year labels must remain intact');
assert.equal(context.db.students.find(x=>x.id==='legacy').educationLevel,'secondary','legacy student records should be classified without losing their old year value');
assert.ok(html.includes('id="studentEducationLevel"'),'student form must allow choosing the education stage');
assert.ok(html.includes('function studentAcademicLabel(st){const p=studentAcademicParts(st);return [educationStageLabel(p.educationLevel),shortAcademicYear(p.schoolYear),...(p.educationLevel==="secondary"?[shortBranch(p.branch)]:[]),"القسم "+p.sectionNumber].filter(Boolean).join(" - ")||"—";}'),'primary and middle display labels must omit the general branch');
assert.ok(html.includes("v.educationLevel=educationStageForYear(v.schoolYear,v.educationLevel)"),'new student cards must persist their education stage');
assert.ok(html.includes("if(v.educationLevel!=='secondary')v.branch='عام'"),'primary and middle cards must not require a secondary stream');
console.log('All educational stages: 5 primary, 4 middle, 3 secondary years and data preservation passed.');
