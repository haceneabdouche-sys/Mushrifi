const assert = require('node:assert/strict');
const fs = require('node:fs');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

// First-run setup offers all three education stages and requires roster + assigned sections.
assert.ok(html.includes('id="firstRunSetup"'));
assert.match(html, /option value="primary">التعليم الابتدائي/);
assert.match(html, /option value="middle">التعليم المتوسط/);
assert.match(html, /option value="secondary">التعليم الثانوي/);
assert.ok(html.includes('id="setupRosterFile"'));
assert.ok(html.includes('id="setupAssignedList"'));
assert.ok(html.includes("if(!level||!school||!file||!setupSections.length)"), 'setup cannot finish without a roster and at least one assigned class');

// Existing installations with any historical data must not be forced through the wizard.
assert.ok(html.includes("if((db.students.length||db.attendance.length||db.documents.length||db.violations.length)&&db.settings.setupComplete!==true)"), 'legacy installations with records must be marked as configured');
assert.ok(html.includes("if(db.students.length&&db.settings.setupComplete!==true)"), 'legacy rosters retain their existing education profile');
assert.ok(html.includes("if(!complete){"), 'first-run gate is conditional');
assert.ok(html.includes("$('#firstRunSetup')?.classList.toggle('hidden',complete)"), 'completed setup hides the wizard');

// The user's assigned sections filter student visibility without deleting the master roster.
assert.ok(html.includes('function studentsForUser(){return db.students.filter(isStudentAssigned);}'));
assert.ok(html.includes('function isStudentAssigned(st)'));
assert.ok(html.includes("db.settings.assignedSections"));
assert.ok(html.includes("window.dispatchEvent(new CustomEvent('mushrifi-roster-import-finished'"), 'setup receives import completion');

// Importing or changing the education profile must not replace the user's data.
assert.ok(html.includes("db.settings.educationLevel=level"));
assert.ok(html.includes("لا تحذف أي تلميذ أو سجل"), 'education profile change is explicitly non-destructive');
console.log('Universal education setup guardrails passed.');
