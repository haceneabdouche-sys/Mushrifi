const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('android/app/src/main/assets/index.html','utf8');
const helperStart=html.indexOf("const PROFILE_FOLLOWUP_CATEGORIES=");
const helperEnd=html.indexOf('function buildStudentFollowupRecords(',helperStart);
assert.ok(helperStart>=0&&helperEnd>helperStart,'case workflow helpers are available in the existing follow-up module');
const validDate=value=>{
 const m=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return false;
 const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),date=new Date(Date.UTC(y,mo-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===mo-1&&date.getUTCDate()===d;
};
const sandbox={Date,String,Array,Number,Math,profileTimelineValidDate:validDate};
vm.createContext(sandbox);
vm.runInContext(html.slice(helperStart,helperEnd),sandbox);

const base={date:'2026-11-28',category:'المواظبة والحضور',status:'قيد المتابعة',observation:'تكرر الغياب خلال الأسبوع',actionTaken:'تم التحقق من سجل الحضور',result:'',nextDate:'2026-11-30'};
const legacy=sandbox.validateStudentFollowupInput(base);
assert.equal(legacy.valid,true,'legacy callers and old records remain valid without workflowStage');
assert.equal(legacy.value.workflowStage,'التحقق من المعطيات','legacy open follow-ups receive a conservative display stage without fabricated history');
assert.equal(legacy.value.status,'قيد المتابعة');
assert.equal(sandbox.profileStudentFollowupStage({status:'تمت المتابعة'}),'تقييم النتيجة');
assert.equal(sandbox.profileStudentFollowupStage({status:'أغلقت الحالة'}),'مغلقة');
assert.equal(sandbox.profileStudentFollowupStage({status:'قيد المتابعة'}),'التحقق من المعطيات');

const verifyToAction=sandbox.validateStudentFollowupInput({...base,workflowStage:'اتخاذ الإجراء',currentStage:'التحقق من المعطيات',transitionNote:'اكتمل التحقق من السجلات'});
assert.equal(verifyToAction.valid,true,'verification can proceed to an action with a reason');
assert.equal(verifyToAction.value.status,'قيد المتابعة','active stages preserve the legacy pending summary');
assert.equal(sandbox.validateStudentFollowupInput({...base,workflowStage:'اتخاذ الإجراء',currentStage:'التحقق من المعطيات'}).valid,false,
 'a stage change cannot be saved without an explicit transition note');
assert.equal(sandbox.validateStudentFollowupInput({...base,workflowStage:'مغلقة',currentStage:'التحقق من المعطيات',transitionNote:'تم اتخاذ القرار'}).valid,false,
 'the lifecycle rejects jumping directly from verification to closure');
assert.equal(sandbox.validateStudentFollowupInput({...base,workflowStage:'تقييم النتيجة',currentStage:'اتخاذ الإجراء',transitionNote:'تم تنفيذ الإجراء',result:''}).valid,false,
 'result assessment requires a documented outcome');
const assessment=sandbox.validateStudentFollowupInput({...base,workflowStage:'تقييم النتيجة',currentStage:'اتخاذ الإجراء',transitionNote:'تم تنفيذ الإجراء والمتابعة',result:'تحسن الحضور بعد التواصل مع الولي'});
assert.equal(assessment.valid,true);
assert.equal(assessment.value.status,'تمت المتابعة');
assert.equal(sandbox.validateStudentFollowupInput({...base,workflowStage:'مغلقة',currentStage:'تقييم النتيجة',transitionNote:'تمت المعالجة',result:'عولجت الحالة بالكامل',nextDate:'2026-11-30'}).valid,false,
 'a closed case cannot retain a future review reminder');
const closed=sandbox.validateStudentFollowupInput({...base,workflowStage:'مغلقة',currentStage:'تقييم النتيجة',transitionNote:'تمت مراجعة النتيجة وتأكيد استقرار الحالة',result:'عولجت الحالة وتأكد استقرار المواظبة',nextDate:''});
assert.equal(closed.valid,true);
assert.equal(closed.value.status,'أغلقت الحالة');
const reopened=sandbox.validateStudentFollowupInput({...base,workflowStage:'تقييم النتيجة',currentStage:'مغلقة',transitionNote:'ظهرت معطيات جديدة تستوجب إعادة التقييم',result:'بدأت مراجعة المعطيات الجديدة'});
assert.equal(reopened.valid,true,'a closed case can be reopened only through the explicit reassessment transition');
assert.equal(sandbox.validateStudentFollowupInput({...base,workflowStage:'مغلقة',currentStage:'مغلقة',transitionNote:'',result:''}).valid,true,
 'editing a legacy closed record without changing its stage remains backward-compatible');
assert.equal(sandbox.validateStudentFollowupInput({...base,workflowStage:'unknown-stage'}).valid,false);

const record={workflowHistory:[{at:'2026-11-20T08:00:00.000Z',from:'بداية الملف',to:'رصد الحالة',note:'إنشاء',owner:'مشرف'}]};
const original=JSON.stringify(record);
const history=sandbox.buildStudentFollowupWorkflowHistory(record,'التحقق من المعطيات','اتخاذ الإجراء','اكتملت المراجعة', '2026-11-28T09:00:00.000Z','ABDOUCHE HACENE',false);
assert.equal(history.length,2);
assert.equal(history[1].from,'التحقق من المعطيات');
assert.equal(history[1].to,'اتخاذ الإجراء');
assert.equal(history[1].note,'اكتملت المراجعة');
assert.equal(JSON.stringify(record),original,'transition history creation never mutates its source record');
const created=sandbox.buildStudentFollowupWorkflowHistory(null,'','رصد الحالة','', '2026-11-28T09:00:00.000Z','مشرف',true);
assert.equal(created.length,1);
assert.equal(created[0].from,'بداية الملف');
assert.equal(created[0].to,'رصد الحالة');
const longHistory=Array.from({length:80},(_,i)=>({at:'2026-11-01T00:00:00.000Z',from:'رصد الحالة',to:'التحقق من المعطيات',note:'م'.repeat(600),owner:'م'.repeat(120)}));
const bounded=sandbox.buildStudentFollowupWorkflowHistory({workflowHistory:longHistory},'التحقق من المعطيات','اتخاذ الإجراء','ملاحظة انتقال','2026-11-28T09:00:00Z','مالك',false);
assert.equal(bounded.length,60,'transition history is bounded to the latest sixty events');
assert.equal(bounded[0].note.length,400,'historical transition notes are size limited');
assert.equal(bounded[0].owner.length,100,'owner labels are size limited');

const viewStart=html.indexOf('function profileStudentFollowupView(records){');
const viewEnd=html.indexOf('function profilePrintableTable(',viewStart);
assert.ok(viewStart>=0&&viewEnd>viewStart,'follow-up cards can be tested independently');
const viewSandbox={Date,Array,String,esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),profileStudentFollowupStage:sandbox.profileStudentFollowupStage,licenseReadOnly:false};
vm.createContext(viewSandbox);vm.runInContext(html.slice(viewStart,viewEnd),viewSandbox);
const card=viewSandbox.profileStudentFollowupView([{id:'f1',category:'السلوك والانضباط',date:'2026-11-28',status:'قيد المتابعة',workflowStage:'متابعة الولي',owner:'المشرف',nextAction:'الاتصال بولي التلميذ',nextDate:'2026-11-30',workflowHistory:created}]);
assert.ok(card.html.includes('متابعة الولي')&&card.html.includes('الاتصال بولي التلميذ')&&card.html.includes('المشرف'));
assert.ok(card.html.includes('سجل انتقالات الحالة')&&card.html.includes('إنشاء ملف متابعة تربوية'));
const hostile=viewSandbox.profileStudentFollowupView([{id:'f2',status:'قيد المتابعة',workflowStage:'اتخاذ الإجراء',owner:'<img src=x>',nextAction:'<script>alert(1)</script>',workflowHistory:[{to:'اتخاذ الإجراء',note:'<svg onload=alert(1)>'}]}]);
assert.ok(!hostile.html.includes('<img src=x')&&!hostile.html.includes('<script>')&&!hostile.html.includes('<svg onload'));

for(const id of ['studentFollowupStage','studentFollowupOwner','studentFollowupNextAction','studentFollowupTransitionNote','studentFollowupResult']){
 assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,'case workflow control exists once: '+id);
}
assert.match(html,/followupForm\.elements\.workflowStage\.addEventListener\('change',\(\)=>syncStudentFollowupFormStatus\(followupForm\)\)/);
assert.match(html,/function syncStudentFollowupFormStatus\(form\)/);
assert.ok(html.includes('id="studentFollowupAdvanced"')&&html.includes('<summary><strong>تفاصيل إضافية لمسار الحالة</strong>'));
assert.ok(html.includes('id="studentFollowupStatusDisplay"')&&html.includes('type="hidden" id="studentFollowupStatus"'),
 'simple follow-up status stays visible while the canonical workflow stage remains available in advanced details');
assert.match(html,/buildStudentFollowupWorkflowHistory\(current,currentStage,checked\.value\.workflowStage,checked\.transitionNote/);
assert.match(html,/buildStudentFollowupWorkflowHistory\(null,'',checked\.value\.workflowStage/);
assert.match(html,/transitionNote:'ملاحظة انتقال الحالة',workflowHistory:'سجل تفاصيل انتقالات المتابعة'/);
assert.match(html,/sourceLabel:'تطور ملف المتابعة'/);
assert.ok(!html.includes('db.followups.forEach(record=>record.workflowHistory'),'legacy records are not bulk-migrated and no fabricated old transition history is created');
console.log('PASS: Stage 9 case lifecycle transitions, result-required closure, documented reopening, bounded immutable transition history, legacy compatibility and privacy-safe rendering.');
