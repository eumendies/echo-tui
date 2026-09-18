const test = require('node:test');
const assert = require('node:assert/strict');

const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const { getCommittableStreamingText } = require('../../src/render/blocks/streaming-text');
const { renderPendingAssistantLines } = require('../../src/render/blocks/pending-preview-renderer');
test('renderPendingAssistantLines leaves thinking to the status line', () => {
  const lines = renderPendingAssistantLines({ kind: 'thinking', elapsedMs: 0 }, 80);

  assert.deepEqual(lines, []);
});

test('renderPendingAssistantLines groups multiple tools into compact ordered rows', () => {
  const pending = {
    kind: 'tool_calls',
    calls: [
      {callId: 'grep-1', toolName: 'grep', argumentsText: '{"pattern":"needle","paths":["src"]}'},
      {callId: 'glob-1', toolName: 'glob', argumentsText: '{"pattern":"**/*.ts","paths":["test"]}'},
      {callId: 'fetch-1', toolName: 'web_fetch', argumentsText: '{"url":"https://example.com/docs"}'}
    ]
  };
  const lines = renderPendingAssistantLines(pending, 80, 10).map(stripAnsi);

  assert.deepEqual(lines, [
    '◆ 3 tools · running',
    '  ├─ Grep · “needle” · in src',
    '  ├─ Glob · “**/*.ts” · in test',
    '  └─ Web fetch · example.com/docs'
  ]);
  assert.equal(lines.some((line) => /searching|fetching/u.test(line)), false);
});

test('renderPendingAssistantLines bounds compact tools by hidden call count and safe width', () => {
  const pending = {
    kind: 'tool_calls',
    calls: [
      {callId: 'grep-1', toolName: 'grep', argumentsText: JSON.stringify({pattern: 'needle'.repeat(20), paths: ['src']})},
      {callId: 'glob-1', toolName: 'glob', argumentsText: '{"pattern":"**/*.ts"}'},
      {callId: 'read-1', toolName: 'read_files', argumentsText: '{"files":[{"path":"src/a.ts"}]}'},
      {callId: 'search-1', toolName: 'web_search', argumentsText: '{"query":"Echo TUI"}'}
    ]
  };
  const constrained = renderPendingAssistantLines(pending, 32, 3).map(stripAnsi);
  const titleOnly = renderPendingAssistantLines(pending, 32, 1).map(stripAnsi);
  const extremelyNarrow = renderPendingAssistantLines(pending, 4, 3);

  assert.deepEqual(constrained.slice(0, 1), ['◆ 4 tools · running']);
  assert.ok(constrained[1].startsWith('  ├─ Grep · “needle'));
  assert.equal(constrained[2], '  └─ … +3 more');
  assert.deepEqual(titleOnly, ['◆ 4 tools · running']);
  assert.ok(constrained.every((line) => displayWidth(line) <= safeRenderWidth(32)));
  assert.ok(extremelyNarrow.every((line) => displayWidth(line) <= safeRenderWidth(4)));
});

test('renderPendingAssistantLines groups parallel subagents into compact ordered rows', () => {
  const pending = {
    kind: 'subagents',
    runs: [
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 14100, phase: 'tool', runId: 'r1', task: 'first investigation', toolName: 'grep'},
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 9800, phase: 'waiting_approval', runId: 'r2', task: 'second investigation'}
    ]
  };
  const lines = renderPendingAssistantLines(pending, 120, 10).map(stripAnsi);

  assert.deepEqual(lines, [
    '◆ 2 agents · 14.1s · ctrl+o 详情',
    '  ├─ explorer · first investigation · tool · grep · 14.1s',
    '  └─ explorer · second investigation · waiting approval · 9.8s'
  ]);
});

test('renderPendingAssistantLines bounds parallel subagent rows by budget and safe width', () => {
  const runs = Array.from({length: 5}, (_, index) => ({
    kind: 'subagent', agentName: 'explorer', elapsedMs: (index + 1) * 1000, phase: 'thinking', runId: `r${index}`, task: `task ${index}`
  }));
  const constrained = renderPendingAssistantLines({kind: 'subagents', runs}, 60, 3).map(stripAnsi);
  const titleOnly = renderPendingAssistantLines({kind: 'subagents', runs}, 60, 1).map(stripAnsi);

  assert.deepEqual(constrained.slice(0, 1), ['◆ 5 agents · 5.0s · ctrl+o 详情']);
  assert.equal(constrained[1], '  ├─ explorer · task 0 · thinking · 1.0s');
  assert.equal(constrained[2], '  └─ … +4 more');
  assert.deepEqual(titleOnly, ['◆ 5 agents · 5.0s · ctrl+o 详情']);
  assert.ok(constrained.every((line) => displayWidth(line) <= safeRenderWidth(60)));
});

test('renderPendingAssistantLines keeps streaming preview as plain text without thinking label', () => {
  const lines = renderPendingAssistantLines({ kind: 'streaming', text: 'draft output' }, 80).map((line) => stripAnsi(line));

  assert.deepEqual(lines, ['◇ draft output']);
});

test('renderPendingAssistantLines renders shell output as plain text without markdown', () => {
  const lines = renderPendingAssistantLines({
    kind: 'shell_output',
    commandLine: '$ printf markdown',
    output: '# title\n| a | b |\n```js\nconst x = 1;\n```\n'
  }, 80).map((line) => stripAnsi(line).trimEnd());

  assert.deepEqual(lines, [
    '# title',
    '| a | b |',
    '```js',
    'const x = 1;',
    '```'
  ]);
});

test('renderPendingAssistantLines only projects the uncommitted shell output tail', () => {
  const committed = 'done 1\ndone 2\n';
  const pending = {
    kind: 'shell_output',
    commandLine: '$ npm test',
    output: `${committed}partial`,
    historyRawLength: committed.length
  };
  const lines = renderPendingAssistantLines(pending, 80).map((line) => stripAnsi(line).trimEnd());

  assert.deepEqual(lines, ['partial']);
});

test('renderPendingAssistantLines removes committed projection without repeating the role prefix', () => {
  const text = 'alpha\n\nbeta';
  const historyText = getCommittableStreamingText(text);
  const lines = renderPendingAssistantLines({kind: 'streaming', text, historyText}, 80).map((line) => stripAnsi(line));
  assert.ok(lines.some((line) => line.includes('beta')));
  assert.equal(lines.some((line) => line.startsWith('◇ ')), false);
});

test('renderPendingAssistantLines renders streaming markdown before applying tail collapse', () => {
  const text = ['# Plan', '- first', '- second', '```', 'code', '```'].join('\n');
  const lines = renderPendingAssistantLines({ kind: 'streaming', text }, 80, 3).map((line) => stripAnsi(line));

  assert.equal(lines.length, 3);
  assert.equal(lines[0], '◇ …已生成 4 行，显示最新 2 行');
  assert.ok(lines.includes('  code'));
});

test('renderPendingAssistantLines renders streaming tables and tolerates partial tables', () => {
  const table = ['| Name | Count |', '| --- | ---: |', '| alpha | 12 |'].join('\n');
  const tableLines = renderPendingAssistantLines({ kind: 'streaming', text: table }, 80).map((line) => stripAnsi(line));
  const partialLines = renderPendingAssistantLines({ kind: 'streaming', text: '| Name | Count |' }, 80).map((line) => stripAnsi(line));

  assert.ok(tableLines.some((line) => line.includes('│')));
  assert.equal(tableLines[0].startsWith('◇ Name'), true);
  assert.deepEqual(partialLines, ['◇ | Name | Count |']);
});

test('renderPendingAssistantLines renders streaming code with cross-line syntax highlight', () => {
  const text = ['```js', 'const text = "first', 'second";', '```'].join('\n');
  const lines = renderPendingAssistantLines({ kind: 'streaming', text }, 80);
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.deepEqual(plainLines, ['◇ const text = "first', '  second";']);
  assert.ok(lines[0].includes('\x1b[38;2;170;0;170mconst'));
  assert.ok(lines[0].includes('\x1b[38;2;0;170;0m"first\x1b[39m'));
  assert.ok(lines[1].includes('\x1b[38;2;0;170;0msecond"\x1b[39m'));
});

test('renderPendingAssistantLines collapses long streaming preview to a bounded tail', () => {
  const text = Array.from({ length: 14 }, (_value, index) => `line ${index + 1}`).join('\n');
  const lines = renderPendingAssistantLines({ kind: 'streaming', text }, 80, 9).map((line) => stripAnsi(line));

  assert.equal(lines.length, 9);
  assert.equal(lines[0], '◇ …已生成 14 行，显示最新 8 行');
  assert.ok(!lines.includes('◇ line 1'));
  assert.ok(!lines.includes('  line 1'));
  assert.ok(lines.some((line) => line.includes('line 7')));
  assert.ok(lines.some((line) => line.includes('line 14')));
});

test('renderPendingAssistantLines renders reasoning streaming preview', () => {
  const lines = renderPendingAssistantLines({ kind: 'reasoning_streaming', text: 'thinking\nmore' }, 80).map((line) => stripAnsi(line).trimEnd());

  assert.deepEqual(lines, ['◇ thinking', '  more']);
});

test('renderPendingAssistantLines bounds reasoning streaming preview', () => {
  const reasoningText = Array.from({ length: 6 }, (_value, index) => `thought ${index + 1}`).join('\n');
  const lines = renderPendingAssistantLines({ kind: 'reasoning_streaming', text: reasoningText }, 80, 5).map((line) => stripAnsi(line).trimEnd());

  assert.equal(lines.length, 5);
  assert.equal(lines[0], '◇ …已生成 6 行 reasoning，显示最新 4 行');
  assert.ok(lines.some((line) => line.includes('thought 6')));
  assert.ok(!lines.some((line) => line.includes('thought 1')));
});

test('renderPendingAssistantLines collapses a long uncommitted shell tail to a bounded preview', () => {
  const output = Array.from({ length: 14 }, (_value, index) => `line ${index + 1}`).join('\n');
  const lines = renderPendingAssistantLines({ kind: 'shell_output', commandLine: '$ long', output }, 80, 5).map((line) => stripAnsi(line).trimEnd());

  assert.equal(lines.length, 5);
  assert.equal(lines[0], '…已生成 14 行，显示最新 4 行');
  assert.ok(!lines.includes('$ long'));
  assert.ok(!lines.includes('line 1'));
  assert.ok(lines.includes('line 11'));
  assert.ok(lines.includes('line 14'));
});

test('renderPendingAssistantLines collapses multi-line subagent tasks into physical single rows', () => {
  const pending = {
    kind: 'subagents',
    runs: [
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 1200, phase: 'thinking', runId: 'r1', task: '第一行任务\n请回答：echo-tui.ts 与 compaction'},
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 2400, phase: 'tool', runId: 'r2', task: '第二个\n任务', toolName: 'grep'}
    ]
  };
  const lines = renderPendingAssistantLines(pending, 80, 10);

  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => !line.includes('\n')));
  assert.ok(lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
  assert.match(stripAnsi(lines[1]), /第一行任务 请回答：echo-tui\.ts 与 compaction · thinking/u);
});
