const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const id='mushrifi-stage14-design-system';
const start=html.indexOf('<style id="'+id+'">');
const headEnd=html.indexOf('</head>');
assert.ok(start>=0&&headEnd>start,'Stage 14 design system loads in the head');
assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'design system is defined once');
const end=html.indexOf('</style>',start);
assert.ok(end>start,'design system style block closes');
const css=html.slice(start,end);
for(const token of ['--navy:#102a43','--blue:#286b91','--gold:#c9a85b','--bg:#f3f6f8','--ink:#1d3040','--muted:#687a87','--line:#dce5eb','--surface:#fff','--surface-soft:#f7fafc']){
 assert.ok(css.includes(token),'brand token exists: '+token);
}
assert.ok(css.includes('font-family:Tahoma,"Noto Sans Arabic",system-ui,Arial,sans-serif'),'Arabic font fallback is defined');
assert.ok(css.includes('body::before{opacity:.04'),'signature watermark is subdued');
assert.ok(css.includes('.panel,.stat{')&&css.includes('border-radius:var(--radius-lg)'),'cards share a common surface system');
assert.ok(css.includes('.btn{min-height:var(--control-height)'),'buttons use a shared touch target');
assert.ok(css.includes('select,textarea{min-height:var(--control-height)'),'form controls share a common height');
assert.ok(css.includes('button:focus-visible')&&css.includes('outline:3px solid'),'focus indication is visible');
assert.ok(css.includes('.attendance-workspace>.row{display:grid;'),'attendance forms use responsive grids');
assert.ok(css.includes('.attendance-log>summary{min-height:48px'),'attendance disclosures have stable touch size');
assert.ok(css.includes('@media(max-width:700px){')&&css.includes('.home-kpis{grid-template-columns:repeat(2,minmax(0,1fr))'),'dashboard cards adapt to mobile width');
assert.ok(css.includes('#nav{left:0!important;right:0!important;width:100%!important;max-width:none!important;transform:none!important}'),'mobile navigation remains full width');
assert.ok(css.includes('@media(prefers-reduced-motion:reduce)'),'reduced motion is respected');
assert.ok(css.includes('@media print{'),'print styling is considered');
for(const key of ['nav','home','students','attendance','documents','more','sStudents','dailyClass','dailyDate','dailyRoster','saveDailyAbsences','attForm','attRows','violForm','violRows','studentsRows','studentSearch','docForm','docsRows','voiceAssistant','startVoiceBtn','pageBackButton']){
 assert.equal((html.match(new RegExp('id="'+key+'"','g'))||[]).length,1,'existing workflow ID remains unique: '+key);
}
const n=html.indexOf('<nav class="no-print" id="nav"');
const ne=html.indexOf('</nav>',n);
assert.ok(n>=0&&ne>n,'primary navigation remains present');
const pages=[...html.slice(n,ne).matchAll(/data-page="([^"]+)"/g)].map(m=>m[1]);
assert.deepEqual(pages,['home','students','attendance','documents','more'],'primary navigation order is preserved');

const navStart=html.indexOf('<nav class="no-print" id="nav"');
const navEnd=html.indexOf('</nav>',navStart);
const navMarkup=navStart>=0&&navEnd>navStart?html.slice(navStart,navEnd+6):'';
assert.ok(navMarkup.includes('id="nav-author-engraving"'),'the author engraving is nested in the main navigation');
assert.ok(navMarkup.includes('ABDOUCHE HACENE'),'the author name is engraved in the navigation plaque');
assert.ok(navMarkup.includes('src="./signature-color.png"'),'the original signature is embedded in the navigation plaque');
assert.ok(navMarkup.includes('إمضاء Abdouche Hacene'),'the signature has an accessible description');
assert.ok(navMarkup.includes('تصميم وتطوير'),'the author caption remains visible');
assert.ok(html.includes('grid-template-rows:35px 53px'),'the navigation reserves a dedicated engraving row and a button row');
assert.ok(html.includes('background:\n  radial-gradient(ellipse at 50% 0%')||html.includes('radial-gradient(ellipse at 50% 0%'),'the navigation buttons share the graphite engraved plaque background');
assert.ok(html.includes('#nav>button.active')&&html.includes('rgba(222,205,167,.15)'),'active navigation buttons remain visible over the plaque');
const footerStart=html.indexOf('<footer class="app-footer">');
const footerEnd=html.indexOf('</footer>',footerStart);
const footer=footerStart>=0&&footerEnd>footerStart?html.slice(footerStart,footerEnd+9):'';
assert.ok(footer.includes('تُحفظ البيانات محلياً على هذا الهاتف'),'the original local-data notice is preserved');
assert.ok(!footer.includes('ABDOUCHE HACENE'),'the developer identity is not detached in a separate footer plaque');
assert.ok(!html.includes('app-author-engraving'),'the old standalone author bar is removed');
assert.ok(html.includes('color:#c9b385')&&html.includes('-webkit-text-stroke:.38px'),'the author name uses a recessed antique-bronze engraving effect');
assert.ok(html.includes('filter:grayscale(1) sepia(.78) saturate(1.08) brightness(.74) contrast(1.42)'),'the original signature is toned to match the charcoal plaque');
assert.ok(html.includes('grid-row:2!important'),'buttons occupy the lower row over the same integrated navigation plaque');
console.log('PASS: Stage 14 unified design tokens, mobile layout, accessible controls and workflow preservation.');
