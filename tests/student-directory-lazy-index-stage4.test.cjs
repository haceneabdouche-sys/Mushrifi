const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const start=html.indexOf('const normalizeStudentKey=');
const end=html.indexOf('\nlet previousAppPage=',start);
assert.ok(start>=0&&end>start,'student identity and directory index helpers form an isolated block');

let normalizeCalls=0,sortCalls=0;
const students=[
 {id:'s1',last:'عيسو',first:'وائل',class:'1',schoolYear:'أولى',branch:'علوم'},
 {id:'s2',last:'أحمد',first:'أمين',class:'2',schoolYear:'أولى',branch:'علوم'},
 {id:'s3',last:'أحمد',first:'أمين',class:'3',schoolYear:'أولى',branch:'آداب'}
];
const sandbox={
 db:{students,attendance:[{student:'deleted-id',studentName:'تلميذ سابق'}],documents:[],violations:[]},
 normalizeDirectorySearch:value=>{normalizeCalls++;return String(value??'').toLocaleLowerCase('ar').replace(/\s+/g,' ').trim();},
 sectionLabel:value=>String(value??''),
 Intl:{Collator:function(locale,options){return{compare(a,b){sortCalls++;return String(a).localeCompare(String(b),locale,options);}};}},
 $:()=>null,
 $$:()=>[]
};
vm.createContext(sandbox);
const evaluate=source=>vm.runInContext(source,sandbox);
vm.runInContext(html.slice(start,end),sandbox);

// The dashboard can resolve a current student's ID without preparing the
// expensive Arabic aliases, normalized search text, or full sorted directory.
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'directory indexes start unbuilt');
assert.equal(vm.runInContext('studentNameIndexReady',sandbox),false,'name aliases start unbuilt');
sandbox.refreshActiveStudentSelectors('home');
assert.equal(vm.runInContext('studentIdentityIndexReady',sandbox),false,'Home does not initialize student indexes through hidden selectors');
assert.equal(evaluate("student('s1').id"),'s1','exact ID lookup remains available');
assert.equal(vm.runInContext('studentIdentityIndexReady',sandbox),true,'exact ID lookup builds only the lightweight identity map');
assert.equal(vm.runInContext('studentNameIndexReady',sandbox),false,'exact ID lookup does not build all Arabic aliases');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'exact ID lookup does not sort the student directory');
assert.equal(normalizeCalls,0,'exact ID lookup performs no per-student search normalization');
assert.equal(sortCalls,0,'exact ID lookup performs no directory sorting');
assert.equal(vm.runInContext('studentDirectorySorted.length',sandbox),0,'no sorted directory rows are allocated for the dashboard');

// Name-based voice matching remains exact for unique aliases and safely
// rejects duplicate full names rather than guessing between students.
assert.equal(evaluate("student('وائل عيسو').id"),'s1','unique reversed Arabic full name resolves');
assert.equal(evaluate("student('أمين أحمد')"),null,'ambiguous full names still return null');
assert.equal(vm.runInContext('studentNameIndexReady',sandbox),true,'name aliases are prepared only when name matching is requested');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'name matching alone does not sort or normalize the full search directory');
assert.equal(evaluate("name('deleted-id')"),'تلميذ سابق','legacy records retain their saved student-name fallback');
assert.equal(vm.runInContext('recordNameIndexReady',sandbox),true,'historical name fallback is indexed only when required');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'historical name resolution does not build the directory');

// Search text and sorting are deferred until a directory/select page asks for them.
sandbox.ensureStudentDirectoryIndexes();
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),true,'the directory index is built on explicit demand');
assert.equal(vm.runInContext('studentDirectorySorted.length',sandbox),3,'all students remain available in the sorted directory');
assert.ok(sortCalls>0,'sorting occurs when the directory is actually requested');
assert.equal(normalizeCalls,3,'each student search string is normalized once when the directory is prepared');
const normalizedAfterBuild=normalizeCalls;
assert.ok(evaluate('studentSearchText(db.students[0])').includes('وائل'),'cached search text remains available');
assert.equal(normalizeCalls,normalizedAfterBuild,'reading an existing search cache does not normalize the same student again');

// A same-length in-place student edit is still made visible after a successful
// save invalidates the derived indexes; the directory stays lazy afterwards.
students[0].last='عيسو الجديد';
sandbox.rebuildStudentIndexes();
assert.equal(vm.runInContext('studentIdentityIndexReady',sandbox),true,'save-time invalidation rebuilds the lightweight ID map');
assert.equal(vm.runInContext('studentNameIndexReady',sandbox),false,'save-time invalidation discards stale aliases');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'save-time invalidation discards stale directory sort and search cache');
assert.equal(vm.runInContext('recordNameIndexReady',sandbox),false,'student changes invalidate historical-name fallback too');
assert.equal(evaluate("student('s1').last"),'عيسو الجديد','ID lookup sees the edited student object immediately');
assert.equal(evaluate("student('وائل عيسو')"),null,'stale old name aliases are not retained after an edit');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'name re-indexing still does not force directory sorting');
assert.equal(evaluate("student('وائل عيسو الجديد').id"),'s1','new unique alias resolves after lazy index rebuild');

// Source replacement/length change resets the indexes before the next use.
sandbox.db.students=sandbox.db.students.concat([{id:'s4',last:'تلميذ',first:'رابع',class:'4'}]);
assert.equal(evaluate("student('s4').id"),'s4','a new student is found after the source list grows');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),false,'a changed list does not sort until a directory consumer requests it');
sandbox.refreshActiveStudentSelectors('attendance');
assert.equal(vm.runInContext('studentDirectoryIndexReady',sandbox),true,'attendance selector preparation builds the shared directory index');
assert.equal(vm.runInContext('studentDirectorySorted.length',sandbox),4,'attendance selector sees every student after a list change');

const directoryStart=html.indexOf('function renderStudentDirectory(){');
const directoryEnd=html.indexOf('\n}\n',directoryStart);
assert.ok(directoryStart>=0&&directoryEnd>directoryStart,'student directory renderer exists');
assert.ok(html.slice(directoryStart,directoryEnd).includes('ensureStudentDirectoryIndexes();'),'student directory explicitly prepares its indexes');
const selectorStart=html.indexOf('function refreshActiveStudentSelectors(activePage){');
const selectorEnd=html.indexOf('\n}',selectorStart);
assert.ok(selectorStart>=0&&selectorEnd>selectorStart&&html.slice(selectorStart,selectorEnd).includes('ensureStudentDirectoryIndexes();'),'active student selectors prepare the shared directory index');
const guardianStart=html.indexOf('function refreshGuardianReceptionStudentOptions(){');
const guardianEnd=html.indexOf('\n}',guardianStart);
assert.ok(guardianStart>=0&&guardianEnd>guardianStart&&html.slice(guardianStart,guardianEnd).includes('ensureStudentDirectoryIndexes();'),'guardian reception selector prepares the same index only on its page');

console.log('PASS: Stage 4 defers Arabic aliases, normalized directory search and full sorting until needed while preserving IDs, unique/ambiguous name matching, legacy fallbacks and save-time invalidation.');
