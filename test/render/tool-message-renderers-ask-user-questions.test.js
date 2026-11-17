const test = require('node:test');
const assert = require('node:assert/strict');

const {createTuiTheme} = require('../../src/config/theme-config');
const {stripAnsi} = require('../../src/render/layout');
const {
  renderAskUserQuestionsToolCallLines,
  renderAskUserQuestionsToolPairLines
} = require('../../src/render/tool-message-renderers/ask-user-questions');
const {renderToolPairLines} = require('../../src/render/tool-message-renderer');

const THEME = createTuiTheme();
const WIDTH = 80;

function callRecord(payload, toolCallId = 'ask-1') {
  return {
    role: 'tool_call',
    text: '',
    toolCallId,
    toolName: 'ask_user_questions',
    argumentsText: typeof payload === 'string' ? payload : JSON.stringify(payload)
  };
}

function resultRecord(payload, ok = true, toolCallId = 'ask-1') {
  return {
    role: 'tool_result',
    text: typeof payload === 'string' ? payload : JSON.stringify(payload),
    toolCallId,
    toolName: 'ask_user_questions',
    ok,
    details: {kind: 'generic'}
  };
}

const SINGLE_SELECT_ARGS = {
  questions: [{
    question: '选择部署目标',
    options: [
      {label: 'staging'},
      {label: 'production', description: '线上环境'}
    ]
  }]
};

test('pair renders single-select question with the selected label only', () => {
  const plain = stripAnsi(renderAskUserQuestionsToolPairLines(
    callRecord(SINGLE_SELECT_ARGS),
    resultRecord({answers: [{index: 0, selected: 'production'}]}),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /◆ Ask user questions · 1 question/u);
  assert.match(plain, /1\. 选择部署目标（单选）/u);
  assert.match(plain, /● production/u);
  assert.doesNotMatch(plain, /● staging/u);
});

test('option description is dropped from the receipt by design', () => {
  const plain = stripAnsi(renderAskUserQuestionsToolPairLines(
    callRecord(SINGLE_SELECT_ARGS),
    resultRecord({answers: [{index: 0, selected: 'production'}]}),
    WIDTH,
    THEME
  ).join('\n'));

  assert.equal(plain.includes('线上环境'), false);
});

test('pair renders multi-select labels and Other custom text', () => {
  const args = {
    questions: [{
      question: '选择要启用的检查',
      multiSelect: true,
      options: [{label: 'lint'}, {label: 'test'}, {label: 'Other'}]
    }]
  };

  const plain = stripAnsi(renderAskUserQuestionsToolPairLines(
    callRecord(args),
    resultRecord({answers: [{index: 0, multiSelect: true, selectedOptions: ['lint', 'Other'], customText: '手动审查'}]}),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /1\. 选择要启用的检查（多选）/u);
  assert.match(plain, /● lint/u);
  assert.match(plain, /● Other：手动审查/u);
  assert.doesNotMatch(plain, /● test/u);
});

test('pair renders the cancellation reason', () => {
  const plain = stripAnsi(renderAskUserQuestionsToolPairLines(
    callRecord(SINGLE_SELECT_ARGS),
    resultRecord({cancelled: true, reason: '用户中断'}),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /已取消：用户中断/u);
});

test('pair returns null for unparsable arguments', () => {
  assert.equal(
    renderAskUserQuestionsToolPairLines(
      callRecord('{oops'),
      resultRecord({answers: [{index: 0, selected: 'staging'}]}),
      WIDTH,
      THEME
    ),
    null
  );
});

test('pair returns null when the result does not match the questions', () => {
  assert.equal(
    renderAskUserQuestionsToolPairLines(
      callRecord(SINGLE_SELECT_ARGS),
      resultRecord({answers: [{index: 0, selected: 'not-an-option'}]}),
      WIDTH,
      THEME
    ),
    null
  );

  assert.equal(
    renderAskUserQuestionsToolPairLines(
      callRecord(SINGLE_SELECT_ARGS),
      resultRecord({answers: []}),
      WIDTH,
      THEME
    ),
    null
  );
});

test('call-only projection renders the question count', () => {
  const plain = stripAnsi(renderAskUserQuestionsToolCallLines(
    callRecord({
      questions: [
        {question: '第一个问题', options: [{label: 'a'}]},
        {question: '第二个问题', options: [{label: 'b'}]}
      ]
    }),
    true,
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /◆ Ask user questions · 2 questions/u);
});

test('call-only projection returns null for unparsable arguments', () => {
  assert.equal(renderAskUserQuestionsToolCallLines(callRecord('{oops'), undefined, WIDTH, THEME), null);
});

test('tool pair dispatch routes ask_user_questions to the dedicated renderer', () => {
  const plain = stripAnsi(renderToolPairLines(
    callRecord(SINGLE_SELECT_ARGS),
    resultRecord({answers: [{index: 0, selected: 'staging'}]}),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /● staging/u);
});
