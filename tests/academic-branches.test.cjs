const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('const academicNorm=');
const end=html.indexOf('function studentAcademicParts(',start);
assert.notEqual(start,-1,'academic normalization code must exist');
assert.notEqual(end,-1,'student academic parser must follow branch aliases');
const source=html.slice(start,end);
const context={};
vm.createContext(context);
vm.runInContext(source,context);
const cases=[
 ['جذع مشترك علوم وتكنولوجيا','ج م ع ت'],
 ['جذع مشترك آداب','ج م أ'],
 ['آداب وفلسفة','أ ف'],
 ['تسيير واقتصاد','ت إ'],
 ['رياضيات','ريا'],
 ['تقني رياضي','ت ر'],
 ['علوم تجريبية','ع ت'],
 ['لغات أجنبية','ل ا']
];
for(const [full,short] of cases){
 assert.equal(context.shortBranch(full),short,'display alias for '+full);
 assert.equal(context.canonicalBranch(short),full,'accept alias '+short);
 assert.equal(context.canonicalBranch(full),full,'keep canonical branch '+full);
}
assert.equal(context.canonicalBranch('  ج   م   ع   ت  '),'جذع مشترك علوم وتكنولوجيا','normalize extra spaces in alias');
assert.equal(context.shortBranch('شعبة غير معروفة'),'شعبة غير معروفة','preserve unknown branch names');
console.log('Academic branch aliases: '+cases.length+' mappings passed.');
