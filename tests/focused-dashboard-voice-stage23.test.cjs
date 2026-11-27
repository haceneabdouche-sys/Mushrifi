const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const java=fs.readFileSync('android/app/src/main/java/dz/mushrifi/app/MainActivity.java','utf8');
const gradle=fs.readFileSync('android/app/build.gradle','utf8');

const home=html.indexOf('<section id="home" class="page">');
const heading=html.indexOf('<div class="home-heading panel">',home);
const voice=html.indexOf('<section id="voiceAssistant"',heading);
const kpis=html.indexOf('<div class="home-kpis grid">',heading);
assert.ok(home>=0&&heading>home&&voice>heading&&kpis>voice,'microphone sits in the upper dashboard heading before KPIs');
const buttonStart=html.indexOf('<button',voice),buttonEnd=html.indexOf('</button>',buttonStart);
assert.ok(buttonStart>=0&&buttonEnd>buttonStart);
assert.equal(html.slice(html.indexOf('>',buttonStart)+1,buttonEnd),'🎙️','the microphone button displays only the icon');
assert.equal((html.match(/id="startVoiceBtn"/g)||[]).length,1,'only one microphone button exists');
assert.ok(!html.includes('id="quickVoiceAccess"'),'duplicate lower microphone tile is removed');
assert.ok(html.includes('id="voiceStatus" class="muted voice-status hidden"'),'voice status is hidden until interaction');
assert.ok(html.includes('id="voiceTranscript" class="voice-transcript panel hidden"'),'transcript starts hidden');
assert.ok(html.includes('id="voiceConfirm" class="voice-confirm panel hidden"'),'suggested actions start hidden');
assert.ok(html.includes('#home .daily-tasks-panel,#home .agenda-home-panel,#home .home-advanced-panel{display:none!important}'),'busy daily and upcoming panels are visually removed only from home');
assert.ok(html.includes('<section id="agenda" class="page hidden">'),'the original agenda page remains in the app');

const start=html.indexOf('function showVoiceSuggestedActions(st){');
const end=html.indexOf('\nfunction handleVoiceOpenStudent(raw){',start);
assert.ok(start>=0&&end>start,'suggested-action handler exists');
const handler=html.slice(start,end);
const keys=['absence','late','report','violation','summons'];
const buttons=keys.map(action=>({dataset:{action},disabled:false,listener:null,addEventListener(type,fn){assert.equal(type,'click');this.listener=fn;}}));
const status={textContent:'',classList:{remove(){},add(){}}};
const confirm={innerHTML:'',visible:false,classList:{remove(){confirm.visible=true;},add(){confirm.visible=false;}}};
const profileButton={onclick:null};
const calls=[];
const context={
 window:{
  studentAction(action,id){calls.push({action,id});return true;},
  studentHistory(id){calls.push({action:'history',id});}
 },
 $:selector=>({'#voiceStatus':status,'#voiceConfirm':confirm,'#voiceOpenStudentRecord':profileButton})[selector]||null,
 $$:selector=>selector==='.voiceSuggestedAction'?buttons:[],
 esc:value=>String(value)
};
vm.createContext(context);
vm.runInContext(handler,context);
context.showVoiceSuggestedActions({id:'student-1',last:'عيسو',first:'وائل',class:'1'});
assert.ok(confirm.visible,'suggested actions display after recognizing a student');
for(const button of buttons){assert.equal(typeof button.listener,'function','click listener is attached for '+button.dataset.action);button.listener();}
assert.deepEqual(calls.map(x=>x.action),keys,'all five actions reach the shared student-action handler');
assert.ok(calls.every(x=>x.id==='student-1'),'all actions use the selected student ID');
assert.equal(confirm.visible,false,'action panel closes after successful navigation');
assert.match(status.textContent,/تم فتح الإجراء المطلوب/,'successful navigation gives user feedback');
assert.equal(typeof profileButton.onclick,'function','opening the full profile remains wired');
assert.ok(handler.includes("$$('.voiceSuggestedAction').forEach"),'the handler uses the all-elements query helper');
assert.ok(!handler.includes("\n $('.voiceSuggestedAction').forEach"),'the prior querySelector/forEach bug cannot return');

assert.ok(html.includes('window.onArabicSpeechError=message=>'),'page receives native speech errors');
assert.ok(html.includes('window.onArabicSpeechCancelled=()=>'),'page receives native speech cancellation');
assert.ok(html.includes("if(!String(raw||'').trim())"),'empty recognition result is safely rejected');
assert.ok(java.includes('window.onArabicSpeechError && window.onArabicSpeechError'),'Android returns recognition failures to the page');
assert.ok(java.includes('window.onArabicSpeechCancelled && window.onArabicSpeechCancelled'),'Android returns cancellation to the page');
assert.ok(java.includes('RecognizerIntent.EXTRA_LANGUAGE, "ar-DZ"'),'speech recognition continues to use Algerian Arabic');
assert.ok(!java.includes('if (speechPending) return;'),'a repeated recognition request no longer silently locks the button');

assert.ok(html.includes('<small class="student-followup-author">المشرف التربوي: ABDOUCHE HACENE</small>'),'saved observation shows the supervisor name below the note');
assert.ok(html.includes('<small class="student-followup-author-note">المشرف التربوي: ABDOUCHE HACENE</small>'),'the observation editor shows the supervisor name');
assert.ok(html.includes('<small class="student-report-observation-author">المشرف التربوي: ABDOUCHE HACENE</small>'),'printed observation carries the same attribution');

assert.ok(html.includes('id="smartMonthAbsences"')&&html.includes('id="smartMonthLateness"')&&html.includes('id="smartMonthViolations"'),'monthly summary outputs exist');
assert.ok(!html.includes('id="smartWeekAbsences"'),'weekly summary output IDs are removed');
assert.ok(gradle.includes('versionCode 27')&&gradle.includes("versionName '2.6'"),'Android package version is advanced to 2.7');
console.log('PASS: Stage 23 compact dashboard, monthly summary, microphone interaction, native voice feedback and supervisor attribution.');
