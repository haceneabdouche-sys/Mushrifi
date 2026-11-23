const fs = require('fs');
const html = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
const checks = [
  ['quick voice action is present on the home screen', /id="quickVoiceAccess"[^>]*>🎙️<b>التحدث إلى مُشرِفي<\/b>/],
  ['quick voice action launches the Arabic speech button', /\$\('#quickVoiceAccess'\)\?\.addEventListener\('click',[\s\S]*?\$\('#startVoiceBtn'\)\?\.click\(\)/],
  ['report print uses a dedicated preview instead of printing the whole app', /window\.printReport\s*=\s*\(\)=>[\s\S]*?id='mushrifiPrintPreview'[\s\S]*?window\.print\(\)/],
  ['report has summary cards for justified and unjustified absences', /غيابات مبررة[\s\S]*?غيابات غير مبررة/],
  ['report totals absence hours and lateness minutes', /ساعات الغياب[\s\S]*?دقائق التأخر/],
  ['report validates date range before filtering', /if\(from&&to&&from>to\)/],
  ['voice flow requires explicit confirmation before saving attendance', /id="confirmVoiceAttendance">تأكيد الحفظ[\s\S]*?id="cancelVoiceAttendance">إلغاء/],
  ['voice quick access remains on the home screen', /<section id="home" class="page">[\s\S]*?id="voiceAssistant"/]
];
let failed = 0;
for (const [label, pattern] of checks) {
  const ok = pattern.test(html);
  process.stdout.write((ok ? 'PASS ' : 'FAIL ') + label + '\n');
  if (!ok) failed++;
}
if (failed) process.exit(1);
