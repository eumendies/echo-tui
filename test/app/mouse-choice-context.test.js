const assert = require('node:assert/strict');
const test = require('node:test');

const {UserQuestionContext} = require('../../src/app/state/user-question-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');

const call = {callId: 'call-1', toolName: 'apply_patch', argumentsText: '{}'};

test('UserQuestionContext mouse option handling confirms single choice and only toggles multi choice', async () => {
  const single = new UserQuestionContext(() => {});
  const singleResult = single.request(call, {
    questions: [{question: '选择', multiSelect: false, options: [{label: 'A'}, {label: 'B'}]}]
  });

  assert.equal(single.handlePointerOption(1, false), true);
  assert.equal(single.getSurface().focusedIndex, 1);
  single.handlePointerOption(1, true);
  assert.match((await singleResult).text, /"selected":"B"/);

  const multi = new UserQuestionContext(() => {});
  const multiResult = multi.request(call, {
    questions: [{question: '选择', multiSelect: true, options: [{label: 'A'}, {label: 'B'}]}]
  });
  multi.handlePointerOption(1, true);
  const multiSurface = multi.getSurface();
  assert.equal(multiSurface.options[1].checked, true);
  assert.equal(multi.hasActiveRequest(), true);
  multi.cancelActiveRequest();
  await multiResult;
});

test('UserQuestionContext and ToolApprovalContext keep inline input clicks as focus-only actions', async () => {
  const question = new UserQuestionContext(() => {});
  const questionResult = question.request(call, {
    questions: [{question: '填写', multiSelect: false, options: [{label: 'A'}]}]
  });
  question.handlePointerOption(1, true);
  assert.equal(question.hasActiveRequest(), true);
  assert.equal(question.getSurface().focusedIndex, 1);
  question.cancelActiveRequest();
  await questionResult;

  const approval = new ToolApprovalContext(() => {});
  const approvalResult = approval.request(call);
  const feedbackIndex = approval.getSurface().options.findIndex((option) => option.inlineInput);
  approval.handlePointerOption(feedbackIndex, true);
  assert.equal(approval.hasActiveRequest(), true);
  assert.equal(approval.getSurface().focusedIndex, feedbackIndex);
  approval.handlePointerOption(0, true);
  assert.deepEqual(await approvalResult, {kind: 'allow_once'});
});
