const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'android/app/src/main/assets/index.html'), 'utf8');
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');

const policyStart = html.indexOf('function absenceWorkflowGroupKey(record){');
const policyEnd = html.indexOf('function absenceStageLabel(', policyStart);
assert.ok(policyStart >= 0 && policyEnd > policyStart, 'Stage 28 and 29 absence workflow policy must be present.');

const context = {
  window: {},
  db: { documents: [], attendance: [], settings: { schoolHolidays: [] } },
  dateISO: () => '2026-11-27',
  isValidISODate: value => {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
  },
  calendarDaysBetween: (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000),
  crypto: { randomUUID: () => 'stage29-test-id' }
};
vm.createContext(context);
vm.runInContext(html.slice(policyStart, policyEnd), context, { timeout: 1000 });

function resultOf(expression) {
  return JSON.parse(vm.runInContext('JSON.stringify(' + expression + ')', context));
}
function stageDoc(id, stage, overrides = {}) {
  return {
    id, student: 'student-29', absenceStart: '2026-11-01',
    absenceStage: stage, date: '2026-11-01',
    deliveryDate: '', deliveryProof: '',
    guardianResponseStatus: 'غير مسجل',
    absenceWorkflowStatus: 'مفتوح',
    ...overrides
  };
}
function streak(days = 11) {
  return { student: { id: 'student-29' }, start: '2026-11-01', days };
}

{
  const record = stageDoc('first', 4);
  context.db.documents = [record];
  context.record = record;
  context.input = {
    deliveryDate: '2026-11-05',
    deliveryMethod: 'البريد المضمون',
    deliveryRecipient: 'ولي التلميذ',
    deliveryProof: 'رقم إرسال 123',
    confirmed: false
  };
  const blocked = resultOf("applyAbsenceWorkflowDelivery(record,input,'2026-11-27')");
  assert.equal(blocked.ok, false, 'A delivery cannot be asserted without explicit confirmation.');
  assert.equal(record.deliveryDate, '', 'A rejected attempt must not mutate the record.');

  context.input.confirmed = true;
  const saved = resultOf("applyAbsenceWorkflowDelivery(record,input,'2026-11-27')");
  assert.equal(saved.ok, true);
  assert.equal(saved.changed, true);
  assert.equal(record.deliveryDate, '2026-11-05');
  assert.equal(record.deliveryMethod, 'البريد المضمون');
  assert.equal(record.deliveryRecipient, 'ولي التلميذ');
  assert.equal(record.deliveryProof, 'رقم إرسال 123');
  assert.equal(record.absenceWorkflowHistory.length, 1);
}

{
  const record = stageDoc('future', 4);
  context.db.documents = [record];
  context.record = record;
  context.input = {
    deliveryDate: '2026-11-28',
    deliveryMethod: 'البريد المضمون',
    deliveryRecipient: 'ولي التلميذ',
    deliveryProof: 'رقم إرسال مستقبلي',
    confirmed: true
  };
  const future = resultOf("applyAbsenceWorkflowDelivery(record,input,'2026-11-27')");
  assert.equal(future.ok, false, 'Future delivery dates must be rejected.');
  assert.equal(record.deliveryProof, '');
}

{
  const record = stageDoc('reply', 4, { deliveryDate: '2026-11-05', deliveryProof: 'وصل 4' });
  context.db.documents = [record];
  context.record = record;
  context.input = { guardianResponseStatus: 'لم يرد الولي', guardianResponseDate: '', guardianResponseNotes: '' };
  const noDate = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(noDate.ok, false, 'A response/review outcome must carry its recording date.');
  context.input.guardianResponseDate = '2026-11-04';
  const beforeDelivery = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(beforeDelivery.ok, false, 'A reply review date cannot precede verified delivery.');
  context.input.guardianResponseDate = '2026-11-10';
  const earlyNoReply = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(earlyNoReply.ok, false, 'A no-response decision cannot be recorded before seven full days have elapsed.');
  context.input.guardianResponseDate = '2026-11-12';
  const saved = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(saved.ok, true);
  assert.equal(record.guardianResponseStatus, 'لم يرد الولي');
  assert.equal(record.guardianResponseDate, '2026-11-12');
  assert.equal(record.absenceWorkflowHistory.length, 1);
}

{
  const record = stageDoc('warning-response', 18, { deliveryDate: '2026-11-01', deliveryProof: 'وصل الإعذار' });
  context.db.documents = [record];
  context.record = record;
  context.input = { guardianResponseStatus: 'لم يرد الولي', guardianResponseDate: '2026-11-14', guardianResponseNotes: '' };
  const earlyWarningNoReply = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(earlyWarningNoReply.ok, false, 'The registered warning response period requires fourteen complete days.');
  context.input.guardianResponseDate = '2026-11-15';
  const validWarningNoReply = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(validWarningNoReply.ok, true);
}

{
  const first = stageDoc('first', 4, {
    deliveryDate: '2026-11-05', deliveryProof: 'وصل 1',
    guardianResponseStatus: 'غير مسجل'
  });
  context.db.documents = [first];
  context.streak = streak(11);
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'No response decision means no escalation.');
  first.guardianResponseStatus = 'قيد الدراسة';
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'Pending excuse review must block escalation.');
  first.guardianResponseStatus = 'تبرير مقبول';
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'An accepted excuse must block escalation.');
  first.guardianResponseStatus = 'لم يرد الولي';
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [11], 'The next step becomes eligible only after verified delivery, elapsed time and recorded outcome.');
}

{
  const first = stageDoc('first', 4, { deliveryDate: '2026-11-05', deliveryProof: 'وصل 1' });
  const second = stageDoc('second', 11, { deliveryDate: '2026-11-14', deliveryProof: 'وصل 2' });
  const unrelated = stageDoc('another-cycle', 4, { absenceStart: '2026-11-20' });
  context.db.documents = [first, second, unrelated];
  context.record = second;
  context.input = {
    reason: 'التحق بالمؤسسة',
    settlementDate: '2026-11-22',
    notes: 'تم التحقق من العودة في سجل الحضور.',
    confirmed: false
  };
  const notConfirmed = resultOf("applyAbsenceWorkflowSettlement(db.documents,record,input,'2026-11-27')");
  assert.equal(notConfirmed.ok, false);
  assert.equal(first.absenceWorkflowStatus, 'مفتوح');

  context.input.confirmed = true;
  const settled = resultOf("applyAbsenceWorkflowSettlement(db.documents,record,input,'2026-11-27')");
  assert.equal(settled.ok, true);
  assert.equal(settled.count, 2);
  assert.equal(first.absenceWorkflowStatus, 'مسوى');
  assert.equal(second.absenceWorkflowStatus, 'مسوى');
  assert.equal(first.absenceReturnDate, '2026-11-22');
  assert.equal(unrelated.absenceWorkflowStatus, 'مفتوح');
  assert.equal(first.absenceWorkflowHistory.length, 1);
  assert.equal(second.absenceWorkflowHistory.length, 1);
  assert.equal(resultOf("absenceWorkflowCycleIsClosed('student-29','2026-11-01')"), true);
  context.streak = streak(40);
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'A settled cycle can never advance automatically.');
}

{
  const record = stageDoc('invalid-settlement', 4);
  context.db.documents = [record];
  context.record = record;
  context.input = { reason: 'تبرير مقبول', settlementDate: '2026-10-31', notes: '', confirmed: true };
  const invalid = resultOf("applyAbsenceWorkflowSettlement(db.documents,record,input,'2026-11-27')");
  assert.equal(invalid.ok, false, 'Settlement cannot predate the start of the absence cycle.');
  assert.equal(record.absenceWorkflowStatus, 'مفتوح');
}


{
  const record = stageDoc('monthly-closed', 17, { absenceStart: '', absenceWorkflowStatus: 'مسوى' });
  context.db.documents = [record];
  context.record = record;
  context.input = {
    deliveryDate: '2026-11-05', deliveryMethod: 'البريد المضمون',
    deliveryRecipient: 'ولي التلميذ', deliveryProof: 'وصل شهري', confirmed: true
  };
  const blockedDelivery = resultOf("applyAbsenceWorkflowDelivery(record,input,'2026-11-27')");
  assert.equal(blockedDelivery.ok, false, 'A settled monthly warning must reject delivery-record edits.');
  context.input = { guardianResponseStatus: 'رد غير كافٍ', guardianResponseDate: '2026-11-12', guardianResponseNotes: '' };
  const blockedResponse = resultOf("applyAbsenceWorkflowResponse(record,input,'2026-11-27')");
  assert.equal(blockedResponse.ok, false, 'A settled monthly warning must reject response edits.');
}


{
  const record = stageDoc('cycle-evidence', 4);
  context.db.attendance = [
    { id: 'before-cycle', student: 'student-29', date: '2026-10-31', type: 'حضور' },
    { id: 'after-cycle', student: 'student-29', date: '2026-11-12', type: 'حضور' },
    { id: 'unrelated-student', student: 'other', date: '2026-11-13', type: 'حضور' }
  ];
  context.record = record;
  const evidence = resultOf("findAbsenceWorkflowReturnEvidence(record,db.attendance)");
  assert.equal(evidence.date, '2026-11-12');
  assert.equal(evidence.type, 'حضور');
  context.db.attendance = [{ student: 'student-29', date: '2026-11-12', type: 'غياب', justified: 'مبرر' }];
  const justifiedEvidence = resultOf("findAbsenceWorkflowReturnEvidence(record,db.attendance)");
  assert.equal(justifiedEvidence.type, 'غياب', 'A justified absence after the cycle start interrupts the streak and must be reviewed.');
  context.db.attendance = [{ student: 'student-29', date: '2026-11-12', type: 'غياب', justified: 'غير مبرر' }];
  assert.equal(resultOf("findAbsenceWorkflowReturnEvidence(record,db.attendance)"), null, 'Another unjustified absence is not return evidence.');
}


{
  const record = stageDoc('quick-delivery', 4);
  context.db.documents = [record];
  context.record = record;
  context.input = { deliveryConfirmed: true, deliveryDate: '2026-11-05', guardianResponseStatus: 'غير مسجل', guardianResponseDate: '' };
  const saved = resultOf("applyAbsenceWorkflowQuickUpdate(record,input,'2026-11-27')");
  assert.equal(saved.ok, true, 'A brief delivery confirmation and date should be sufficient.');
  assert.equal(record.deliveryConfirmed, true);
  assert.equal(record.deliveryDate, '2026-11-05');
  assert.equal(record.deliveryProof, '', 'The app must not invent a receipt or proof reference.');
  context.db.documents = [record];
  context.streak = streak(11);
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'No guardian outcome means no escalation yet.');
}

{
  const record = stageDoc('quick-no-show', 4, { deliveryConfirmed: true, deliveryDate: '2026-11-05' });
  context.db.documents = [record];
  context.record = record;
  context.input = { deliveryConfirmed: true, deliveryDate: '2026-11-05', guardianResponseStatus: 'لم يحضر', guardianResponseDate: '2026-11-11' };
  const early = resultOf("applyAbsenceWorkflowQuickUpdate(record,input,'2026-11-27')");
  assert.equal(early.ok, false, 'The no-show outcome must respect the seven-day period.');
  context.input.guardianResponseDate = '2026-11-12';
  const saved = resultOf("applyAbsenceWorkflowQuickUpdate(record,input,'2026-11-27')");
  assert.equal(saved.ok, true);
  assert.equal(record.guardianResponseStatus, 'لم يحضر');
  assert.equal(record.guardianResponseDate, '2026-11-12');
  context.streak = streak(11);
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [11], 'A recorded no-show can unlock the next eligible stage after the time gate.');
}

{
  const record = stageDoc('quick-attended', 4, { deliveryConfirmed: true, deliveryDate: '2026-11-05' });
  context.db.documents = [record];
  context.record = record;
  context.input = { deliveryConfirmed: true, deliveryDate: '2026-11-05', guardianResponseStatus: 'حضر الولي', guardianResponseDate: '2026-11-06' };
  assert.equal(resultOf("applyAbsenceWorkflowQuickUpdate(record,input,'2026-11-27')").ok, true);
  context.streak = streak(11);
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'A guardian who attended must not be treated as a no-show.');
}

{
  const record = stageDoc('quick-excuse', 4, { deliveryConfirmed: true, deliveryDate: '2026-11-05' });
  context.db.documents = [record];
  context.record = record;
  context.input = { deliveryConfirmed: true, deliveryDate: '2026-11-05', guardianResponseStatus: 'قدّم تبريراً', guardianResponseDate: '2026-11-06' };
  assert.equal(resultOf("applyAbsenceWorkflowQuickUpdate(record,input,'2026-11-27')").ok, true);
  context.streak = streak(11);
  assert.deepEqual(resultOf('getEligibleAbsenceStages(streak)'), [], 'A submitted excuse must be reviewed instead of escalating automatically.');
}

assert.ok(html.includes('id="absenceWorkflowBoard"'), 'The document page must expose the workflow management panel.');
assert.ok(html.includes('data-absence-action="quick-save"'), 'The panel must provide one compact save action.');
assert.ok(html.includes('data-field="deliveryConfirmed"'), 'The simple flow must distinguish an actual delivery from a draft.');
assert.ok(html.includes('حضر الولي') && html.includes('لم يحضر') && html.includes('قدّم تبريراً'), 'The simplified guardian outcomes must be available.');
assert.ok(!html.includes('إدارة بيانات التبليغ ونتيجة رد الولي'), 'The former multi-step editor must be removed from the primary panel.');
assert.ok(!html.includes('تسجيل عودة التلميذ أو تسوية الملف'), 'The old settlement form must be removed from the primary board.');
assert.ok(html.includes('توجد حركة حضور/تبرير بعد بداية هذه الدورة بتاريخ '), 'The board must flag potential attendance evidence after the absence cycle start.');
assert.ok(html.includes('guardianResponseNotes'), 'The workflow history must preserve dated response details for review.');
assert.ok(html.includes('function applyAbsenceWorkflowSettlement('), 'The legacy settlement helper remains available for already-saved records.');
assert.match(html, /absenceWorkflowHistory/);
assert.match(html, /absenceWorkflowCycleIsClosed\(streak\.student\.id,streak\.start\)/);
assert.match(html, /absenceWorkflowHistory:'تاريخ إجراءات دورة الغياب'/, 'Workflow history must be redacted in audit records.');
assert.match(gradle, /versionCode 46/);
assert.match(gradle, /versionName '2\.6'/);

console.log('PASS Stage 29 absence workflow delivery, guardian response, settlement, audit privacy and closure tests');
