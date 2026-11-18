const assert = require('node:assert/strict');
const fs = require('node:fs');

for (const path of ['index.html', 'android/app/src/main/assets/index.html']) {
  const html = fs.readFileSync(path, 'utf8');
  const root = html.match(/:root\\s*\\{([^}]+)\\}/);
  assert.ok(root, path + ': theme tokens must be declared');
  assert.match(root[1], /--primary\\s*:\\s*var\\(--blue\\)/,
    path + ': primary action color must resolve to the shared blue theme token');
  assert.match(html, /\\.student-name\\{[^}]*color:var\\(--primary\\)/,
    path + ': student links must use the defined primary token');
}
console.log('Shared Mushrifi primary theme token checks passed.');
