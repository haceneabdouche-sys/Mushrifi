const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const workflow=fs.readFileSync('.github/workflows/build-apk.yml','utf8');
const gradle=fs.readFileSync('android/app/build.gradle','utf8');

const formStart=html.indexOf('<form id="studentForm">');
const formEnd=html.indexOf('</form>',formStart);
assert.ok(formStart>=0&&formEnd>formStart,'student editor form exists');
const form=html.slice(formStart,formEnd);
assert.match(form,/name="identityNumber"[^>]*maxlength="32"/,
 'official 16-digit identity number is editable on a student card');
assert.match(html,/studentCardFieldNames=\[[^\]]*'identityNumber'/,
 'identity number is included in student card reads and saves');
assert.match(html,/normalizeStudentIdentityNumber\(v\.identityNumber\)/,
 'identity number is normalized before storage');
assert.match(html,/identityDuplicate=values\.identityNumber&&db\.students\.find/,
 'duplicate identity numbers are rejected during manual editing');
assert.match(html,/رقم التعريف يجب أن يتكون من 16 رقمًا/,
 'manual card editing validates 16-digit identity numbers');

const panelStart=html.indexOf('id="guardianAddressImportDisclosure"');
const panelEnd=html.indexOf('</details>',panelStart);
assert.ok(panelStart>=0&&panelEnd>panelStart,'separate guardian address import panel exists');
const panel=html.slice(panelStart,panelEnd);
assert.match(panel,/id="guardianAddressImportFile"/);
assert.match(panel,/id="applyGuardianAddressImport"[^>]*disabled/,
 'the commit button starts disabled until a valid preview is prepared');
assert.match(panel,/downloadGuardianAddressTemplate/,
 'a blank CSV template can be downloaded');
assert.match(panel,/رقم التعريف.*عنوان الولي/,
 'the required source columns are clearly explained');

const helperStart=html.indexOf('function parseCSV(text, delimiter)');
const helperEnd=html.indexOf('function normName(v)',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'address import parser and planner functions exist after shared CSV parser');
const helpers=html.slice(helperStart,helperEnd);
assert.match(helpers,/function normalizeStudentIdentityNumber/);
assert.match(helpers,/function parseGuardianAddressImportSource/);
assert.match(helpers,/function buildGuardianAddressImportPlan/);
assert.match(helpers,/address\.length>300/,'overlong addresses are rejected, not truncated');
assert.doesNotMatch(helpers,/normalizeName|nameMatch|fallback/,
 'guardian address matching does not fall back to names or sections');

class FakeDOMParser{
 parseFromString(source){
  const tables=[...source.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(table=>{
   const rows=[...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>{
    const cells=[...row[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(cell=>{
     const text=cell[1].replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
     return {textContent:text};
    });
    return {querySelectorAll:()=>cells};
   });
   return {querySelectorAll:()=>rows};
  });
  return {querySelectorAll:()=>tables};
 }
}
const context={DOMParser:FakeDOMParser};
vm.createContext(context);
vm.runInContext(helpers,context);

const idA='1234567890123456';
const idB='2234567890123456';
const idC='3234567890123456';
const idD='4234567890123456';
const idE='5234567890123456';
const idF='6234567890123456';

const csv='رقم التعريف,عنوان الولي\r\n"'+idA+'","حي النصر، شارع 1، بناية 4"\r\n';
const parsedCsv=JSON.parse(JSON.stringify(context.parseGuardianAddressImportSource(csv)));
assert.equal(parsedCsv.length,1);
assert.equal(parsedCsv[0].identityNumber,idA);
assert.equal(parsedCsv[0].guardianAddress,'حي النصر، شارع 1، بناية 4');

const semicolon='رقم التعريف;عنوان الولي\r\n'+idA+';"الحي؛ الشارع 2"\r\n';
const parsedSemicolon=JSON.parse(JSON.stringify(context.parseGuardianAddressImportSource(semicolon)));
assert.equal(parsedSemicolon[0].guardianAddress,'الحي؛ الشارع 2');

const htmlSource='<html><body><table><tr><th>رقم التعريف</th><th>عنوان الولي</th></tr><tr><td>'+idA+'</td><td>حي الورود، منزل 5</td></tr></table></body></html>';
const parsedHtml=JSON.parse(JSON.stringify(context.parseGuardianAddressImportSource(htmlSource)));
assert.equal(parsedHtml[0].identityNumber,idA);
assert.equal(parsedHtml[0].guardianAddress,'حي الورود، منزل 5');

assert.throws(()=>context.parseGuardianAddressImportSource('رقم التعريف,اللقب,الاسم\r\n'+idA+',لقب,اسم\r\n'),/عنوان الولي/,
 'a roster-only file without guardian address must be rejected before any change');
assert.throws(()=>context.parseGuardianAddressImportSource('\u0000\u0001binary-xls'),/Excel ثنائية/,
 'binary Excel files must be rejected with an explicit conversion instruction');
assert.equal(context.normalizeStudentIdentityNumber('١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦'),idA,
 'Arabic-Indic digits normalize to the exact canonical 16-digit string');
assert.equal(/^\d{16}$/.test(context.normalizeStudentIdentityNumber('1.234567890123456e+15')),false,
 'scientific notation is not silently expanded into a guessed identity number');

const students=[
 {id:'a',identityNumber:idA,guardianAddress:'',last:'أ',first:'أ'},
 {id:'b',identityNumber:idB,guardianAddress:'حي النصر',last:'ب',first:'ب'},
 {id:'c',identityNumber:idC,guardianAddress:'عنوان محفوظ مختلف',last:'ج',first:'ج'},
 {id:'d1',identityNumber:idD,guardianAddress:'',last:'د',first:'د'},
 {id:'d2',identityNumber:idD,guardianAddress:'',last:'د2',first:'د2'}
];
const rows=[
 {identityNumber:idA,guardianAddress:'عنوان جديد'},
 {identityNumber:idB,guardianAddress:'  حي   النصر  '},
 {identityNumber:idC,guardianAddress:'عنوان آخر'},
 {identityNumber:'7234567890123456',guardianAddress:'عنوان لشخص غير مسجل',last:'أ',first:'أ'},
 {identityNumber:idE,guardianAddress:'عنوان مكرر 1'},
 {identityNumber:idE,guardianAddress:'عنوان مكرر 2'},
 {identityNumber:'123456789012345',guardianAddress:'عنوان برقم ناقص'},
 {identityNumber:idD,guardianAddress:'عنوان رقم تعريف غير فريد'},
 {identityNumber:idB,guardianAddress:''},
 {identityNumber:idF,guardianAddress:'ع'.repeat(301)}
];
const plan=JSON.parse(JSON.stringify(context.buildGuardianAddressImportPlan(students,rows)));
assert.equal(plan.counts.ready,1);
assert.equal(plan.counts.same,1);
assert.equal(plan.counts.conflict,2);
assert.equal(plan.counts.unmatched,1,
 'an unknown identity remains unmatched even when a name resembles a known student');
assert.equal(plan.counts.duplicate,2);
assert.equal(plan.counts.invalid,2);
assert.equal(plan.counts.empty,1);
assert.equal(plan.counts.total,rows.length);
assert.equal(plan.updates.length,1);
assert.equal(plan.updates[0].studentId,'a');
assert.equal(plan.updates[0].guardianAddress,'عنوان جديد');

// Clean unique identity can fill only a blank address.
const cleanPlan=JSON.parse(JSON.stringify(context.buildGuardianAddressImportPlan(
 [{id:'only',identityNumber:idA,guardianAddress:'',last:'اسم',first:'لقب'}],
 [{identityNumber:idA,guardianAddress:'عنوان دقيق'}]
)));
assert.equal(cleanPlan.updates.length,1);
assert.equal(cleanPlan.updates[0].studentId,'only');

// Existing addresses and duplicated database identities are never overwritten.
const protectedPlan=JSON.parse(JSON.stringify(context.buildGuardianAddressImportPlan(
 [
  {id:'one',identityNumber:idA,guardianAddress:'عنوان موجود'},
  {id:'two',identityNumber:idB,guardianAddress:''},
  {id:'three',identityNumber:idB,guardianAddress:''}
 ],
 [
  {identityNumber:idA,guardianAddress:'عنوان مختلف'},
  {identityNumber:idB,guardianAddress:'عنوان وارد'}
 ]
)));
assert.equal(protectedPlan.counts.conflict,2);
assert.equal(protectedPlan.updates.length,0);

const commitStart=html.indexOf("$('#applyGuardianAddressImport')?.addEventListener('click'");
const commitEnd=html.indexOf("refreshGuardianAddressImportControls();",commitStart);
assert.ok(commitStart>=0&&commitEnd>commitStart,'manual commit handler exists');
const commit=html.slice(commitStart,commitEnd+80);
assert.match(commit,/if\(licenseReadOnly\)/,'commit respects license read-only state');
assert.match(commit,/normalizeStudentIdentityNumber\(target\.identityNumber\)!==update\.identityNumber/,
 'the exact identity is checked again immediately before commit');
assert.match(commit,/normalizeGuardianAddressText\(target\.guardianAddress\)/,
 'the current address is rechecked before commit to prevent overwrite races');
assert.match(commit,/item\.student\.guardianAddress=item\.address/,
 'the commit changes only the guardian address field');
assert.doesNotMatch(commit,/db\.students\.push/,
 'the address importer never creates a new student record');
assert.match(commit,/if\(!save\(\)\)\{db=originalDatabase;render\(\);throw new Error/,
 'save failure restores the complete original in-memory database');

assert.match(html,/const allowed=new Set\(\[[^\]]*downloadGuardianAddressTemplate/,
 'template export is allowed but remains subject to the existing read-only controls');
assert.match(html,/guardianAddressFile=\$\('#guardianAddressImportFile'\);if\(guardianAddressFile\)setLicenseControlDisabled\(guardianAddressFile,true\)/,
 'file selection is disabled in license read-only mode');
assert.match(workflow,/Run Stage 22 safe guardian address import tests[\s\S]*?node tests\/guardian-address-import-stage22\.test\.cjs/,
 'CI runs the Stage 22 import regression suite');
const versionCode=Number((gradle.match(/versionCode\s+(\d+)/)||[])[1]||0);
assert.ok(versionCode>=26&&/versionName '2\.6'/.test(gradle),
 'internal build code advances while the visible version remains 2.6');

console.log('PASS: Stage 22 exact-ID guardian-address import, preview-only parsing, duplicate/conflict rejection, no-overwrite policy, transactional save, and identity editing.');
