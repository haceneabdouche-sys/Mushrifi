const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');

// $() returns one Element; collection methods must be called on $$() results.
const invalidCollectionCalls = [...html.matchAll(/(?<!\$)\$\(['"][^'"]+['"]\)\.(?:forEach|map|filter)\(/g)]
  .map(match => match[0]);
assert.deepEqual(invalidCollectionCalls, [],
  'Never call collection methods on $() (querySelector); use $$() (querySelectorAll).');

for (const [pattern, description] of [
  [/\$\$\('\[data-settings-tab\]'\)\.forEach\(/, 'Settings tabs must all receive click handlers.'],
  [/\$\$\('nav button'\)\.forEach\(/, 'Main navigation buttons must all receive click handlers.'],
  [/\$\$\('\[data-go\]'\)\.forEach\(/, 'Dashboard shortcut tiles must all receive click handlers.'],
  [/\$\$\('#dailyRoster \.daily-student'\)\.forEach\(/, 'Daily roster search must iterate every student card.']
]) assert.match(html, pattern, description);

console.log('PASS: DOM collection selectors use querySelectorAll for navigation, settings, shortcuts, and roster search.');
