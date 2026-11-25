const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const marker='function normalizeDirectorySearch(value){';
const start=html.indexOf(marker);
const end=html.indexOf('\nconst normalizeStudentKey=',start);
assert.ok(start>=0&&end>start,'a standalone Arabic-aware directory search normalizer must exist before student matching');
const normalizeSource=html.slice(start,end).trim();
const normalize=vm.runInNewContext('('+normalizeSource+')');

assert.equal(normalize('  أَحْمَد   ١٢  '),'احمد 12','diacritics, alef variants, whitespace and Arabic digits are normalized');
assert.equal(normalize('إِبْرَاهِيم'),'ابراهيم','initial alef hamza variants are searchable consistently');
assert.equal(normalize('هُدَى'),'هدي','ya maqsurah is normalized to ya');
assert.equal(normalize('مُشْرِفِي'),'مشرفي','Arabic diacritics are ignored');
assert.equal(normalize('مدرسة'),'مدرسة','taa marbuta is preserved to avoid over-broad matching');
assert.equal(normalize('٠١۲۳٤٥'),'012345','Arabic-Indic and Eastern Arabic-Indic digits normalize to Latin digits');
assert.equal(normalize('عبد\u0640الرحمن'),'عبدالرحمن','Arabic tatweel is ignored');

const student={last:'أحمد',first:'عيسى',class:'١ ثانوي',attribute:'داخلي',guardian:'إبراهيم',phone:'٠٥٥٠١٢٣٤٥٦',identityNumber:'۱۲۳۴'};
const searchable=normalize([student.first,student.last,student.class,student.attribute,student.guardian,student.phone,student.identityNumber].join(' '));
for(const query of ['احمد','عيسي','1 ثانوي','داخلي','ابراهيم','0550123456','1234']){
  assert.ok(searchable.includes(normalize(query)),'student directory must match normalized query: '+query);
}

const input=html.match(/<input id="studentSearch"[^>]*>/)?.[0]||'';
assert.match(input,/type="search"/,'the directory search uses a search-optimized mobile input');
assert.match(input,/aria-label="بحث في ملفات التلاميذ"/,'the search field has an accessible label');
assert.match(html,/<span id="studentCount"[^>]*role="status"[^>]*aria-live="polite"/,'result count is announced accessibly');
assert.match(html,/let q=normalizeDirectorySearch\(\$\('#studentSearch'\)\?\.value\|\|''\);/,'directory query uses the shared normalizer');
assert.match(html,/const searchable=s=>normalizeDirectorySearch\(/,'all student fields use the same normalizer');
assert.match(html,/نتائج البحث: '\+matches\.length\+' من '\+db\.students\.length/,'filtered result count shows matches against total students');
assert.match(html,/لا توجد نتائج مطابقة للبحث/,'empty search has a clear message instead of implying the directory is empty');
assert.match(html,/normalizeDirectorySearch\(\$\('#attStudentSearch'\)\?\.value\|\|''\)/,'individual attendance student selector uses the same normalizer');
assert.match(html,/normalizeDirectorySearch\(\$\('#reportStudentSearch'\)\?\.value\|\|''\)/,'report student selector uses the same normalizer');

console.log('PASS: Arabic-aware student search handles diacritics, alef and ya variants, tatweel, Arabic digits, accessibility and truthful result counts.');
