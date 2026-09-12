const test = require('node:test');
const assert = require('node:assert/strict');

const {createTuiTheme} = require('../../src/config/theme-config');
const {displayWidth, safeRenderWidth, stripAnsi} = require('../../src/render/layout');
const {
  renderRunSubagentCompactPairLines,
  renderRunSubagentToolPairLines
} = require('../../src/render/tool-message-renderers/run-subagent');
const {renderToolPairBlock} = require('../../src/render/tool-message-renderer');

const THEME = createTuiTheme();
const WIDTH = 80;

function callRecord(argumentsText, toolCallId = 'outer-1') {
  return {
    role: 'tool_call',
    text: '',
    toolCallId,
    toolName: 'run_subagent',
    argumentsText
  };
}

function resultRecord(text, ok = true, toolCallId = 'outer-1') {
  return {
    role: 'tool_result',
    text,
    toolCallId,
    toolName: 'run_subagent',
    ok,
    details: {kind: 'generic'}
  };
}

test('expanded run_subagent pair renders agent identity, task summary and report body', () => {
  const lines = renderRunSubagentToolPairLines(
    callRecord(JSON.stringify({agent: 'explorer', task: '调查 src/commands 斜杠命令层'})),
    resultRecord('# 1. Handler 组织、注册与分派\n- 契约定义于 src/types/command.ts:867-888'),
    WIDTH,
    THEME
  ).map(stripAnsi);

  assert.match(lines[0], /◆ ▌ explorer · 调查 src\/commands 斜杠命令层/u);
  assert.match(lines.join('\n'), /▌ # 1\. Handler 组织、注册与分派/u);
  assert.equal(lines.every((line) => line.includes('▌')), true);
  assert.equal(lines.some((line) => line.includes('{"agent"')), false);
  assert.match(lines.at(-1), /▌ completed/u);
});

test('expanded pair keeps the delegated task fully visible without display truncation', () => {
  const task = Array.from({length: 16}, (_, index) => `delegated task line ${index + 1}`).join('\n');
  const plain = stripAnsi(renderRunSubagentToolPairLines(
    callRecord(JSON.stringify({agent: 'worker', task})),
    resultRecord('done'),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /delegated task line 16/u);
});

test('expanded pair bounds the report body with the shared tool output budget', () => {
  const report = Array.from({length: 30}, (_, index) => `report line ${index + 1}`).join('\n');
  const plain = stripAnsi(renderRunSubagentToolPairLines(
    callRecord(JSON.stringify({agent: 'explorer', task: 'inspect'})),
    resultRecord(report),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /report line 11/u);
  assert.doesNotMatch(plain, /report line 12/u);
  assert.match(plain, /\[tool output truncated for display\]/u);
});

test('expanded pair renders failure status and failure text body', () => {
  const lines = renderRunSubagentToolPairLines(
    callRecord(JSON.stringify({agent: 'worker', task: 'implement task'})),
    resultRecord('Subagent failed: provider error', false),
    WIDTH,
    THEME
  ).map(stripAnsi);

  assert.match(lines[0], /◆ ▌ worker · implement task/u);
  assert.match(lines.join('\n'), /▌ Subagent failed: provider error/u);
  assert.match(lines.at(-1), /▌ failed/u);
});

test('expanded pair falls back to null when arguments cannot be trusted', () => {
  assert.equal(renderRunSubagentToolPairLines(callRecord('not json'), resultRecord('report'), WIDTH, THEME), null);
  assert.equal(renderRunSubagentToolPairLines(callRecord('{}'), resultRecord('report'), WIDTH, THEME), null);
  assert.equal(renderRunSubagentToolPairLines(callRecord('{"agent":"explorer"}'), resultRecord('report'), WIDTH, THEME), null);
  assert.equal(renderRunSubagentToolPairLines(callRecord('{"agent":"explorer","task":"   "}'), resultRecord('report'), WIDTH, THEME), null);
  assert.equal(renderRunSubagentToolPairLines(callRecord('{"agent":42,"task":"inspect"}'), resultRecord('report'), WIDTH, THEME), null);
});

test('expanded pair sanitizes invalid agent names through the safe formatter', () => {
  const invalidName = 'safe\u001b[31m\nINJECTED';
  const plain = stripAnsi(renderRunSubagentToolPairLines(
    callRecord(JSON.stringify({agent: invalidName, task: 'inspect'})),
    resultRecord('report'),
    WIDTH,
    THEME
  ).join('\n'));

  assert.match(plain, /◆ ▌ Subagent · inspect/u);
  assert.doesNotMatch(plain, /INJECTED|\[31m/u);
});

test('expanded pair keeps every visible line within the safe width', () => {
  const lines = renderRunSubagentToolPairLines(
    callRecord(JSON.stringify({agent: 'explorer', task: '调查任务 '.repeat(40)})),
    resultRecord('report'),
    48,
    THEME
  );
  const plain = lines.map(stripAnsi);

  assert.equal(plain.every((line) => displayWidth(line) <= safeRenderWidth(48)), true);
});

test('compact pair keeps the single-line terminal identity', () => {
  const lines = renderRunSubagentCompactPairLines(
    callRecord(JSON.stringify({agent: 'explorer', task: 'inspect repository'})),
    resultRecord('Final evidence report.'),
    WIDTH,
    THEME
  ).map(stripAnsi);

  assert.deepEqual(lines, ['◆ Explorer · returned report']);
});

test('renderToolPairBlock routes non-compact run_subagent pairs to the expanded renderer', () => {
  const block = stripAnsi(renderToolPairBlock(
    callRecord(JSON.stringify({agent: 'explorer', task: 'first investigation'})),
    resultRecord('First report.'),
    WIDTH
  ));

  assert.match(block, /◆ ▌ explorer · first investigation/u);
  assert.match(block, /▌ First report\./u);
  assert.doesNotMatch(block, /\{"agent"/u);
});
