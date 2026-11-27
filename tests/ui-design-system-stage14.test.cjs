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

const homeMarkStart=html.indexOf('<div id="home-author-engraving"');
const homeMarkEnd=html.indexOf('<section id="more"',homeMarkStart);
const homeMark=homeMarkStart>=0&&homeMarkEnd>homeMarkStart?html.slice(homeMarkStart,homeMarkEnd):'';
assert.ok(homeMark.includes('ABDOUCHE HACENE'),'the developer name is placed inside the home red engraving strip');
assert.ok(homeMark.includes('src="./signature-color.png"'),'the approved original signature is used in the red strip');
assert.ok(homeMark.includes('إمضاء Abdouche Hacene'),'the signature has an accessible description');
assert.ok(homeMark.includes('تصميم وتطوير'),'the author caption remains in the engraved strip');
assert.ok(homeMark.includes('home-author-copy'),'name and caption are grouped for responsive horizontal layout');
const homeStart=html.indexOf('<section id="home"');
assert.ok(homeStart>=0&&homeMarkEnd>homeMarkStart,'the engraving belongs to the home dashboard');
const footerStart=html.indexOf('<footer class="app-footer">');
const footerEnd=html.indexOf('</footer>',footerStart);
const footer=footerStart>=0&&footerEnd>footerStart?html.slice(footerStart,footerEnd+9):'';
assert.ok(footer.includes('تُحفظ البيانات محلياً على هذا الهاتف'),'the existing local-data notice is preserved');
assert.ok(!footer.includes('ABDOUCHE HACENE'),'the developer identity is not duplicated below the storage note');
assert.ok(html.includes('.home-author-engraving')&&html.includes('.home-author-signature'),'the home engraving has a dedicated style');
assert.ok(html.includes('linear-gradient(132deg,#a52b37 0%,#821722 52%,#9c2631 100%)'),'the name and signature sit inside the requested dark-red strip');
assert.ok(html.includes('color:#26070c')&&html.includes('-webkit-text-stroke:.55px'),'the name uses a dark recessed engraved-graffiti finish');
assert.ok(html.includes('filter:grayscale(1) sepia(1) saturate(2.2) brightness(.32) contrast(1.55)'),'the original signature is rendered as burnt dark ink');
assert.ok(html.includes('@media(max-width:360px)'),'the engraved strip has a narrow-phone layout');
console.log('PASS: Stage 14 unified design tokens, mobile layout, accessible controls and workflow preservation.');
