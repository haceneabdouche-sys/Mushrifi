const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

// The original .xls export is an HTML table with missing explicit </tr> tags.
// The Android WebView HTML parser repairs those row boundaries.
assert.match(source, /new DOMParser\(\)\.parseFromString\(raw,'text\/html'\)/);
assert.match(source, /parsedHtml\.querySelector\('table'\)/);
assert.match(source, /table\.querySelectorAll\('tr'\)/);

// Student identity number is optional, while name and class remain required.
assert.match(source, /if\(!data\.last\|\|!data\.first\|\|!data\.class\)/);
assert.doesNotMatch(source, /const required=\['identityNumber','last','first','class'\]/);

// Matching uses the full academic context and never merges two known,
// different identity numbers just because their names and classes match.
assert.match(source, /const incomingYear=normalizeClass\(data\.schoolYear\)/);
assert.match(source, /const incomingBranch=normalizeClass\(data\.branch\)/);
assert.match(source, /const identityCompatible=!incomingId\|\|!existingId\|\|existingId===incomingId/);
// Matching is indexed once by normalized name + section, then narrowed by year,
// branch and official identity. The index is maintained when cards are updated.
assert.match(source, /const fallbackIndex=new Map\(\)/);
assert.match(source, /const fallbackKeysByStudent=new Map\(\)/);
assert.match(source, /const bucket=fallbackIndex\.get\(fallbackKey\(n,incomingSection\)\)/);
assert.match(source, /return yearMatch&&branchMatch&&identityCompatible/);
assert.match(source, /removeFallbackStudent\(target\)/);
assert.match(source, /indexFallbackStudent\(target\)/);

// Linked records and academic combinations are indexed/collected once per import,
// avoiding repeated full-array scans inside the student loop.
assert.match(source, /const recordsByStudentId=new Map\(\)/);
assert.match(source, /const linkedRecords=recordsByStudentId\.get\(String\(target\.id\)\)\|\|\[\]/);
assert.match(source, /for\(const record of linkedRecords\)record\.studentName=currentDisplayName/);
assert.match(source, /const pendingAcademic=new Map\(\)/);
assert.match(source, /if\(pendingAcademic\.size\)/);

// Static guardrails plus a small reference-model scenario. This is not a substitute
// for running the import UI against the real 557-row file.
assert.ok(source.includes("const originalDb=JSON.parse(JSON.stringify(db));importSnapshot=originalDb;"), 'import must snapshot the entire database before mutating it');
assert.ok(source.includes("if(!save())throw new Error('تعذر حفظ الاستيراد"), 'a failed database save must enter the rollback path');
assert.ok(source.includes('if(importSnapshot&&!importCommitted){db=importSnapshot;try{render();}'), 'a failed import must restore the full database snapshot before refreshing the UI');
assert.ok(source.includes('importCommitted=true;'), 'the snapshot must be released from rollback only after a successful save');
assert.ok(source.includes('let importSnapshot=null,importCommitted=false;'), 'import must keep a transaction snapshot');
assert.ok(source.includes('if(importSnapshot&&!importCommitted){db=importSnapshot;'), 'any exception before commit must restore the entire original database');
assert.ok(source.includes("if(data.branch)data.branch=canonicalBranch(data.branch);"), 'official roster branch spelling must be canonicalized before matching');

// The actual student form stores the displayed student attribute in "attribute".
// Preserve the imported schooling regime ("نصف داخلي" / "خارجي") there.
assert.ok(source.includes("schoolingSystem:find(['نظامالتمدرس','النظام','regime','schoolingsystem'])"));
assert.ok(source.includes("if(!data.attribute&&data.schoolingSystem)data.attribute=data.schoolingSystem"));
assert.ok(source.includes("data.last=normalizeImportName(data.last)"));
assert.ok(source.includes("data.first=normalizeImportName(data.first)"));

// Name suffix cleanup handles Arabic and Western digits.
assert.match(source, /normalizeImportName=v=>normalizeKey\(v\)/);
assert.match(source, /replace\(\/\(\[\^\\s\]\+\?\)\[0-9٠-٩۰-۹\]\+/);

function importRows(db, rows) {
  let added = 0, updated = 0, skipped = 0;
  const seen = new Set();
  for (const row of rows) {
    const id = row.id || '';
    const key = id ? 'id:' + id : 'name:' + row.name + '|academic:' + row.academic;
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    let target = id ? db.students.find(s => s.identityNumber === id) : null;
    if (!target) {
      const matches = db.students.filter(s =>
        s.name === row.name && s.academic === row.academic &&
        (!id || !s.identityNumber || s.identityNumber === id)
      );
      if (matches.length === 1) target = matches[0];
      else if (matches.length > 1) { skipped++; continue; }
    }
    if (target) {
      target.name = row.name;
      updated++;
    } else {
      db.students.push({ id: 'student-' + (db.students.length + 1), identityNumber: id, name: row.name, academic: row.academic });
      added++;
    }
  }
  return { added, updated, skipped };
}

const rows = [
  { id: 'ID-1', name: 'صيدون فرح', academic: 'ثانية|لغات أجنبية|1' },
  // Same name and class, but a different official identity: keep separately.
  { id: 'ID-2', name: 'صيدون فرح', academic: 'ثانية|لغات أجنبية|1' },
  { id: 'ID-3', name: 'تلميذ تجريبي', academic: 'أولى|علوم|1' },
  // Exact duplicate row with the same identity: skip.
  { id: 'ID-3', name: 'تلميذ تجريبي', academic: 'أولى|علوم|1' }
];
const db = { students: [], attendance: [{ student: 'student-1', hours: 3 }] };
assert.deepEqual(importRows(db, rows), { added: 3, updated: 0, skipped: 1 });
assert.equal(db.students.length, 3);
const savedAttendance = structuredClone(db.attendance);
assert.deepEqual(importRows(db, rows), { added: 0, updated: 3, skipped: 1 });
assert.equal(db.students.length, 3);
assert.deepEqual(db.attendance, savedAttendance);

assert.ok(source.includes("AndroidBridge.notifyAbsenceStage(String(x.student.id),studentName,stage,x.start)"), 'eligible absence stages must send a one-time native reminder');
console.log('CSV import static guardrails and reference-model checks passed.');
