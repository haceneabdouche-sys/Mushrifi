const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helper=html.split('\n').find(line=>line.startsWith('function isCompatibleImportIdentity('));
assert.ok(helper,'CSV import identity compatibility guard must exist');

const context={};
vm.createContext(context);
vm.runInContext(helper,context);
const compatible=(existing,incoming)=>vm.runInContext(
  'isCompatibleImportIdentity('+JSON.stringify(existing)+','+JSON.stringify(incoming)+')',
  context
);

assert.equal(compatible('', '123456789'),true,
  'legacy student cards without a national identity number may still be matched by name and section');
assert.equal(compatible('12 345-6789', '123456789'),true,
  'formatting differences in the same identity number must not block a safe legacy match');
assert.equal(compatible('١٢٣٤٥٦٧٨٩', '123456789'),true,
  'Arabic-Indic digits must normalize to the same identity number');
assert.equal(compatible('123456789', '987654321'),false,
  'a student with another identity number must never be reused as a name-and-section fallback');
assert.equal(compatible('123456789', ''),false,
  'a missing incoming identity number cannot match a numbered student');

const importStart=html.indexOf("$('#csvImport').onchange=");
assert.ok(importStart>=0,'CSV import handler must exist');
const fallbackStart=html.indexOf('let fallback=db.students.filter(st=>',importStart);
assert.ok(fallbackStart>importStart,'name-and-section fallback must exist');
const fallbackEnd=html.indexOf('});',fallbackStart);
assert.ok(fallbackEnd>fallbackStart,'fallback filter must be bounded');
const fallback=html.slice(fallbackStart,fallbackEnd);
assert.match(fallback,/isCompatibleImportIdentity\(st\.identityNumber,data\.identityNumber\)/,
  'fallback matching must reject a different existing identity number');
assert.match(fallback,/return identityCompatible&&nameMatch&&sectionMatch&&yearMatch&&branchMatch/,
  'identity compatibility must be enforced together with name, section, year and branch matching');
assert.match(html,/if\(!existingById\.has\(incomingId\)\)existingById\.set\(incomingId,\[\]\);\s*existingById\.get\(incomingId\)\.push\(record\)/,
  'the in-memory identity index must use the normalized incoming identity key');

console.log('PASS: CSV import cannot merge same-name, same-section students with different identity numbers.');
