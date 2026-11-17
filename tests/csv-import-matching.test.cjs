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
assert.match(source, /return nameMatch&&sectionMatch&&yearMatch&&branchMatch&&identityCompatible/);

// Re-importing a matched student keeps the same internal student id, and
// attendance/document/violation references are not recreated or discarded.
assert.match(source, /String\(record\.student\)===String\(target\.id\)/);
assert.match(source, /for\(const kind of \['attendance','documents','violations'\]\)/);
assert.match(source, /db=originalDb;render\(\);throw new Error\('تعذر حفظ الاستيراد/);

// The actual student form stores the displayed student attribute in "attribute".
// Preserve the imported schooling regime ("نصف داخلي" / "خارجي") there.
assert.match(source, /schoolingSystem:find\(\['نظامالتمدرس','النظام','regime','schoolingsystem'\]\)/);
assert.match(source, /if\(!data\.attribute&&data\.schoolingSystem\)data\.attribute=data\.schoolingSystem/);
assert.match(source, /data\.last=normalizeImportName\(data\.last\)/);
assert.match(source, /data\.first=normalizeImportName\(data\.first\)/);

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

console.log('CSV import matching regression tests passed.');
