const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const markup=html.slice(html.indexOf('id="csvImport"'),html.indexOf('</div>',html.indexOf('id="csvImport"')));
assert.ok(markup.includes('id="csvImportPreview"'),'CSV import preview container must exist');
assert.ok(markup.includes('id="csvImportStatus"'),'CSV import status must explain that selecting a file does not alter data');

const handlerStart=html.indexOf("$('#csvImport').onchange=async e=>{");
const handlerEnd=html.indexOf('\n\n\nlet pendingGuardianAddressImport=null;',handlerStart);
assert.ok(handlerStart>=0&&handlerEnd>handlerStart,'CSV import handler must exist and be delimited');
const handler=html.slice(handlerStart,handlerEnd);
assert.ok(handler.includes('const plannedDb=JSON.parse(JSON.stringify(db))'),'import must stage its result in a separate planned database');
assert.ok(handler.includes('db=originalDb;'),'live database must be restored before displaying the preview');
assert.ok(handler.includes('pendingStudentCsvImport={database:plannedDb'),'preview must retain the staged result without persisting it');
assert.ok(!/\bsave\s*\(/.test(handler),'CSV parsing and preview must not save or commit the import');
assert.ok(handler.includes('sourceSections[sectionLabel]'),'preview must count incoming students by section');
assert.ok(handler.includes('duplicates++')&&handler.includes('conflicts++')&&handler.includes('invalid++'),'preview must classify duplicates, ambiguous matches and incomplete records');

const commitStart=html.indexOf('function applyStudentCsvImport(){');
const commitEnd=html.indexOf("\n$('#csvImport').onchange=",commitStart);
assert.ok(commitStart>=0&&commitEnd>commitStart,'a separate explicit commit action must exist');
const commit=html.slice(commitStart,commitEnd);
const backupAt=commit.indexOf("saveUndoSnapshot('قبل استيراد قائمة التلاميذ')");
const swapAt=commit.indexOf('db=pending.database');
const saveAt=commit.indexOf('if(!save())');
assert.ok(backupAt>=0&&swapAt>backupAt&&saveAt>swapAt,'a local undo snapshot must be confirmed before the staged database can be saved');
assert.ok(commit.includes('db=previousDb;'),'a failed save must restore the previous in-memory database');
assert.ok(commit.includes('clearStoredRecoverySnapshot()'),'a failed commit must clear the unused undo snapshot');
assert.ok(commit.includes('preserveUndoOnNextSave=false'),'a failed commit must reset the undo-preservation flag');

assert.match(html,/function isCompatibleImportIdentity\(existingValue,incomingValue\)/,'student identity safety guard must remain');
assert.match(html,/return identityCompatible&&nameMatch&&sectionMatch&&yearMatch&&branchMatch/,'safe fallback matching by name, section, year and branch must remain intact');

console.log('PASS: CSV import now previews all counts and section distribution, keeps data unchanged until confirmation, and saves an undo snapshot before commit.');
