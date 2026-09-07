const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {UserQuestionContext} = require('../../src/app/state/user-question-context');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {
  ASK_USER_QUESTIONS_TOOL_NAME,
  MAX_ASK_USER_CUSTOM_ANSWER_BYTES,
  MAX_ASK_USER_OPTION_DESCRIPTION_BYTES,
  MAX_ASK_USER_OPTION_LABEL_BYTES,
  MAX_ASK_USER_QUESTION_BYTES,
  createAskUserQuestionsCancelledResult,
  createAskUserQuestionsFailureResult,
  createAskUserQuestionsSuccessResult,
  parseAskUserQuestionsArgs
} = require('../../src/tools/ask-user-questions-tool-handler');
const {createApplyPatchToolHandler} = require('../../src/tools/apply-patch-tool-handler');
const {createEditFileToolHandler, EDIT_FILE_TOOL_NAME} = require('../../src/tools/edit-file-tool-handler');
const {
  COMPLETE_TODO_TOOL_NAME,
  CREATE_TODOS_TOOL_NAME,
  MAX_TODO_ITEM_TEXT_BYTES,
  executeTodoToolCall
} = require('../../src/tools/todo-tool-handler');
const {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES} = require('../../src/tools/tool-handler-utils');

function createWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-tui-structured-bounds-'));
}

function createCall(toolName, argumentsValue, callId = 'bounded-call') {
  return {callId, toolName, argumentsText: JSON.stringify(argumentsValue)};
}

function assertBoundedJson(result) {
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  assert.doesNotThrow(() => JSON.parse(result.text));
  assert.doesNotMatch(result.text, /\uFFFD/u);
}

function assertBoundedPlainText(result) {
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  assert.doesNotMatch(result.text, /\uFFFD/u);
}

test('todo tools reject oversized single and aggregate text without producing candidate state', () => {
  const currentState = {
    updatedAt: '2026-07-01T00:00:00.000Z',
    items: [{id: 'todo_1', text: 'keep me', status: 'open'}]
  };
  const snapshot = structuredClone(currentState);
  const oversizedSingle = executeTodoToolCall(createCall(CREATE_TODOS_TOOL_NAME, {
    items: ['🙂'.repeat(Math.floor(MAX_TODO_ITEM_TEXT_BYTES / 4) + 1)]
  }), currentState);
  const oversizedAggregate = executeTodoToolCall(createCall(CREATE_TODOS_TOOL_NAME, {
    items: ['a'.repeat(12_001), 'b'.repeat(12_001), 'c'.repeat(12_001), 'd'.repeat(12_001)]
  }), currentState);

  for (const rejected of [oversizedSingle, oversizedAggregate]) {
    assert.equal(rejected.ok, false);
    assert.equal(Object.hasOwn(rejected, 'todoState'), false);
    assertBoundedPlainText(rejected.result);
    assert.match(rejected.result.text, /must not exceed/u);
  }
  assert.deepEqual(currentState, snapshot);
});

test('todo create and complete results remain bounded JSON and reject oversized legacy state unchanged', () => {
  const created = executeTodoToolCall(createCall(CREATE_TODOS_TOOL_NAME, {items: ['检查🙂', '完成测试']}), undefined);
  assert.equal(created.ok, true);
  assertBoundedJson(created.result);
  assert.deepEqual(JSON.parse(created.result.text).items.map((item) => item.text), ['检查🙂', '完成测试']);

  const completed = executeTodoToolCall(createCall(COMPLETE_TODO_TOOL_NAME, {ids: ['todo_1']}), created.todoState);
  assert.equal(completed.ok, true);
  assertBoundedJson(completed.result);

  const legacyState = {
    updatedAt: 'old',
    items: [{id: 'todo_1', text: '\0'.repeat(20_000), status: 'open'}]
  };
  const snapshot = structuredClone(legacyState);
  const rejected = executeTodoToolCall(createCall(COMPLETE_TODO_TOOL_NAME, {ids: ['todo_1']}), legacyState);
  assert.equal(rejected.ok, false);
  assert.equal(Object.hasOwn(rejected, 'todoState'), false);
  assertBoundedPlainText(rejected.result);
  assert.match(rejected.result.text, /todo result exceeds the 65536-byte output limit/u);
  assert.deepEqual(legacyState, snapshot);
});

test('ask_user_questions rejects oversized fields and aggregate definitions', () => {
  const fieldCases = [
    {question: '问'.repeat(Math.floor(MAX_ASK_USER_QUESTION_BYTES / 3) + 1), options: [{label: 'A'}]},
    {question: 'Q', options: [{label: '🙂'.repeat(Math.floor(MAX_ASK_USER_OPTION_LABEL_BYTES / 4) + 1)}]},
    {question: 'Q', options: [{label: 'A', description: '描'.repeat(Math.floor(MAX_ASK_USER_OPTION_DESCRIPTION_BYTES / 3) + 1)}]}
  ];

  for (const question of fieldCases) {
    assert.equal(parseAskUserQuestionsArgs({questions: [question]}).ok, false);
  }

  const aggregate = parseAskUserQuestionsArgs({
    questions: Array.from({length: 5}, (_, index) => ({
      question: `Q${index}`,
      options: [{label: 'A', description: String(index).repeat(7_000)}]
    }))
  });
  assert.equal(aggregate.ok, false);
  assert.match(aggregate.message, /definitions/u);
});

test('UserQuestionContext refuses oversized definitions before opening a surface', async () => {
  let updates = 0;
  const context = new UserQuestionContext(() => { updates += 1; });
  const call = createCall(ASK_USER_QUESTIONS_TOOL_NAME, {});
  const result = await context.request(call, {
    questions: [{question: 'Q'.repeat(MAX_ASK_USER_QUESTION_BYTES + 1), options: [{label: 'A'}]}]
  });

  assert.equal(context.hasActiveRequest(), false);
  assert.equal(context.getSurface(), null);
  assert.equal(updates, 0);
  assert.equal(result.ok, false);
  assertBoundedPlainText(result);
  assert.match(result.text, /must not exceed/u);
});

test('UserQuestionContext blocks custom answers beyond the UTF-8 limit and returns bounded JSON', async () => {
  const context = new UserQuestionContext(() => {});
  const call = createCall(ASK_USER_QUESTIONS_TOOL_NAME, {});
  const pending = context.request(call, {
    questions: [{question: '自定义？', options: [{label: '默认'}]}]
  });

  context.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  const answer = '🙂'.repeat(MAX_ASK_USER_CUSTOM_ANSWER_BYTES / 4);
  context.handleEvent({type: INPUT_EVENTS.TEXT, value: answer});
  context.handleEvent({type: INPUT_EVENTS.TEXT, value: 'x'});

  const surface = context.getSurface();
  assert.equal(surface.options.at(-1).inlineInput.text, answer);
  assert.match(surface.dismissHint, /最多/u);

  context.handleEvent({type: INPUT_EVENTS.SUBMIT});
  const result = await pending;
  assert.equal(result.ok, true);
  assertBoundedJson(result);
  assert.equal(JSON.parse(result.text).answers[0].customText, answer);
});

test('ask_user_questions success and cancellation are bounded JSON while failures are bounded plain text', () => {
  const call = createCall(ASK_USER_QUESTIONS_TOOL_NAME, {});
  const success = createAskUserQuestionsSuccessResult(call, [{question: 'Q', selectedOption: {label: '\0'.repeat(100_000)}}]);
  const cancelled = createAskUserQuestionsCancelledResult(call);
  const failure = createAskUserQuestionsFailureResult(call, '失败🙂\0'.repeat(30_000));

  // 答案 label 超过预算时成功构造器必须转失败，而不是返回超限 JSON。
  assert.equal(success.ok, false);
  assertBoundedPlainText(success);
  assert.match(success.text, /answer exceeds/u);

  assert.equal(cancelled.ok, false);
  assertBoundedJson(cancelled);
  assert.equal(JSON.parse(cancelled.text).cancelled, true);

  assert.equal(failure.ok, false);
  assertBoundedPlainText(failure);
  assert.ok(failure.text.startsWith('失败🙂'));
});

test('apply_patch bounds success summaries, long paths, parser reasons, and filesystem errors', () => {
  const cwd = createWorkspace();
  const longStem = '目录-'.repeat(25);
  const patch = [
    '*** Begin Patch',
    ...Array.from({length: 12}, (_, index) => `*** Add File: ${longStem}${index}.txt\n+value ${index}`),
    '*** End Patch'
  ].join('\n');
  const smallHandler = createApplyPatchToolHandler({cwd, maxOutputBytes: 140});
  const success = smallHandler.execute({patch}, createCall('apply_patch', {patch}));
  assert.equal(success.ok, true);
  assert.ok(Buffer.byteLength(success.text, 'utf8') <= 140);
  assert.match(success.text, /omitted due to output limit/u);

  const longReasonPatch = `*** Begin Patch\n*** Unsupported: ${'🙂'.repeat(20_000)}\n*** End Patch`;
  const longReason = createApplyPatchToolHandler({cwd}).execute(
    {patch: longReasonPatch},
    createCall('apply_patch', {patch: longReasonPatch})
  );
  assert.equal(longReason.ok, false);
  assert.ok(Buffer.byteLength(longReason.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  assert.match(longReason.text, /^Patch failed\.\nReason:/u);
  assert.doesNotMatch(longReason.text, /\uFFFD/u);

  const originalMkdirSync = fs.mkdirSync;
  fs.mkdirSync = (...args) => {
    if (String(args[0]).includes('write-error')) throw new Error('文件异常🙂'.repeat(30_000));
    return originalMkdirSync(...args);
  };
  try {
    const errorPatch = '*** Begin Patch\n*** Add File: write-error/file.txt\n+value\n*** End Patch';
    const failed = createApplyPatchToolHandler({cwd}).execute(
      {patch: errorPatch},
      createCall('apply_patch', {patch: errorPatch})
    );
    assert.equal(failed.ok, false);
    assert.ok(Buffer.byteLength(failed.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
    assert.doesNotMatch(failed.text, /\uFFFD/u);
  } finally {
    fs.mkdirSync = originalMkdirSync;
  }
});

test('edit_file bounds UTF-8 success paths, hints, and filesystem exceptions while preserving edits', () => {
  const cwd = createWorkspace();
  const fileName = `${'你'.repeat(50)}.txt`;
  const target = path.join(cwd, fileName);
  fs.writeFileSync(target, 'before\n');
  const args = {path: fileName, old_string: 'before', new_string: 'after'};
  const success = createEditFileToolHandler({cwd, maxOutputBytes: 100}).execute(args, createCall(EDIT_FILE_TOOL_NAME, args));
  assert.equal(success.ok, true);
  assert.ok(Buffer.byteLength(success.text, 'utf8') <= 100);
  assert.doesNotMatch(success.text, /\uFFFD/u);
  assert.equal(fs.readFileSync(target, 'utf8'), 'after\n');

  const ambiguousTarget = path.join(cwd, 'ambiguous.txt');
  fs.writeFileSync(ambiguousTarget, 'same same');
  const ambiguousArgs = {path: 'ambiguous.txt', old_string: 'same', new_string: 'new'};
  const hinted = createEditFileToolHandler({cwd, maxOutputBytes: 96}).execute(ambiguousArgs, createCall(EDIT_FILE_TOOL_NAME, ambiguousArgs));
  assert.equal(hinted.ok, false);
  assert.ok(Buffer.byteLength(hinted.text, 'utf8') <= 96);
  assert.match(hinted.text, /^Edit failed\.\nReason:/u);

  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (...values) => {
    if (values[0] === target) throw new Error('写入异常🙂'.repeat(30_000));
    return originalWriteFileSync(...values);
  };
  try {
    const failingArgs = {path: fileName, old_string: 'after', new_string: 'again'};
    const failed = createEditFileToolHandler({cwd}).execute(failingArgs, createCall(EDIT_FILE_TOOL_NAME, failingArgs));
    assert.equal(failed.ok, false);
    assert.ok(Buffer.byteLength(failed.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
    assert.doesNotMatch(failed.text, /\uFFFD/u);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
});
