const assert = require('node:assert/strict');
const {test} = require('node:test');

const {createTuiTheme} = require('../../src/config/theme-config');
const {renderTranscriptLines} = require('../../src/render/app-renderer');
const {displayWidth, safeRenderWidth, stripAnsi} = require('../../src/render/layout');
const {renderSubagentPendingLines, renderSubagentRunAppendBlock, renderSubagentRunBlock} = require('../../src/render/subagent-renderer');
const {renderToolCallPreviewLines, renderToolPairLines} = require('../../src/render/tool-message-renderer');

const BASE = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer-1', runId: 'run-1'};

function subagentRecord(text, event) {
  return {...BASE, text, event};
}

function createBashProcess(ok = true) {
  return [
    subagentRecord('inspect repository', {kind: 'start', task: 'inspect repository'}),
    subagentRecord('run_bash_command', {
      kind: 'tool_call',
      toolCallId: 'inner-bash',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({command: 'git status --short'})
    }),
    subagentRecord(ok ? 'clean' : 'fatal', {
      kind: 'tool_result',
      toolCallId: 'inner-bash',
      toolName: 'run_bash_command',
      ok,
      details: {kind: 'bash', exitCode: ok ? 0 : 2, durationMs: 15, timedOut: false, truncated: false}
    })
  ];
}

function assertSafe(lines, width) {
  for (const line of lines) {
    const plain = stripAnsi(line);
    assert.equal(plain.includes('\n'), false);
    assert.equal(plain.includes('\r'), false);
    assert.ok(displayWidth(line) <= safeRenderWidth(width), `${displayWidth(line)} > ${safeRenderWidth(width)}: ${plain}`);
  }
}

test('Explorer title and outer rail use subagentRail while nested Bash work uses toolOutput', () => {
  const theme = createTuiTheme({
    blocks: {colors: {
      toolOutput: [1, 2, 3],
      toolSuccess: [4, 5, 6],
      toolError: [7, 8, 9],
      tool: [10, 11, 12],
      subagentRail: [16, 17, 18],
      text: [13, 14, 15]
    }}
  });
  const nested = renderSubagentRunBlock([
    ...createBashProcess(false),
    subagentRecord('failed report', {kind: 'failed', durationMs: 40})
  ], 80, theme);
  const nestedLines = nested.trimEnd().split('\n');
  const nestedPlain = nestedLines.map(stripAnsi);

  assert.ok(nestedPlain.some((line) => line.includes('▌ ◆ ▌ Bash · failed · exit 2 · 15ms')));
  assert.ok(nestedPlain.some((line) => line.includes('fatal')));
  assert.ok(nestedPlain.some((line) => line.includes('failed · 40ms · failed report')));
  assert.match(nested, /\x1b\[38;2;1;2;3m/);
  assert.match(nested, /\x1b\[38;2;16;17;18m/);
  assert.doesNotMatch(nested, /\x1b\[38;2;4;5;6m|\x1b\[38;2;7;8;9m|\x1b\[38;2;10;11;12m|\x1b\[38;2;13;14;15m/);

  const topLevel = renderToolPairLines({
    role: 'tool_call', text: '', toolCallId: 'top', toolName: 'run_bash_command', argumentsText: JSON.stringify({command: 'git status'})
  }, {
    role: 'tool_result', text: 'clean', toolCallId: 'top', toolName: 'run_bash_command', ok: true,
    details: {kind: 'bash', exitCode: 0, durationMs: 1, timedOut: false, truncated: false}
  }, 80, theme).join('\n');
  assert.match(topLevel, /\x1b\[38;2;4;5;6m/);
});

test('nested non-Bash tool titles and status markers are also mapped to toolOutput', () => {
  const theme = createTuiTheme({
    blocks: {colors: {
      toolOutput: [21, 22, 23],
      toolSuccess: [24, 25, 26],
      toolError: [27, 28, 29],
      tool: [30, 31, 32],
      subagentRail: [36, 37, 38],
      text: [33, 34, 35]
    }}
  });
  const rendered = renderSubagentRunBlock([
    subagentRecord('find TypeScript files', {kind: 'start', task: 'find TypeScript files'}),
    subagentRecord('glob', {
      kind: 'tool_call', toolCallId: 'inner-glob', toolName: 'glob',
      argumentsText: JSON.stringify({pattern: '**/*.ts', paths: ['src']})
    }),
    subagentRecord('src/main.ts', {
      kind: 'tool_result', toolCallId: 'inner-glob', toolName: 'glob', ok: true,
      details: {kind: 'glob', truncated: false, display: {kind: 'glob', paths: ['src/main.ts']}}
    }),
    subagentRecord('', {kind: 'completed', durationMs: 5})
  ], 80, theme);

  assert.match(rendered, /\x1b\[38;2;21;22;23m/u);
  assert.match(rendered, /\x1b\[38;2;36;37;38m/u);
  assert.doesNotMatch(rendered, /\x1b\[38;2;24;25;26m|\x1b\[38;2;27;28;29m|\x1b\[38;2;30;31;32m|\x1b\[38;2;33;34;35m/u);
});

test('stable and pending subagent rails share one column and pending does not repeat the header', () => {
  const stable = renderSubagentRunAppendBlock([
    subagentRecord('inspect alignment', {kind: 'start', task: 'inspect alignment'})
  ], 80);
  const pending = renderSubagentPendingLines({
    kind: 'subagent', agentName: 'explorer', elapsedMs: 1200, phase: 'streaming',
    runId: 'run-1', task: 'inspect alignment', draft: 'collecting evidence'
  }, 80, 10);
  const lines = stripAnsi(stable).trimEnd().split('\n').concat(pending.map(stripAnsi));

  assert.equal(lines[0].indexOf('▌'), 2);
  assert.equal(lines[1].indexOf('▌'), 2);
  assert.equal(lines[2].indexOf('▌'), 2);
  assert.equal(lines[1], '  ▌ ');
  assert.equal(lines.slice(1).some((line) => line.includes('explorer · inspect alignment')), false);
});

test('run_subagent task text is never display-truncated in the outer call or subagent header', () => {
  const task = Array.from({length: 16}, (_, index) => `delegated task line ${index + 1}`).join('\n');
  const preview = renderToolCallPreviewLines('run_subagent', JSON.stringify({agent: 'worker', task}, null, 2), 48).map(stripAnsi).join('\n');
  const rail = stripAnsi(renderSubagentRunBlock([
    subagentRecord(task, {kind: 'start', task}),
    subagentRecord('', {kind: 'completed', durationMs: 5})
  ], 48));

  assert.match(preview, /delegated task line 16/u);
  assert.match(rail, /delegated task line 16/u);
  assert.doesNotMatch(preview, /\[tool output truncated for display\]/u);
  assert.doesNotMatch(rail, /\[tool output truncated for display\]/u);
});

test('subagent reasoning and tools are separated by continuous outer rail spacer rows', () => {
  const records = [
    subagentRecord('inspect tools', {kind: 'start', task: 'inspect tools'}),
    subagentRecord('choose glob', {kind: 'reasoning_summary'}),
    subagentRecord('glob', {kind: 'tool_call', toolCallId: 'glob-1', toolName: 'glob', argumentsText: '{"pattern":"src/**"}'}),
    subagentRecord('src/main.ts', {kind: 'tool_result', toolCallId: 'glob-1', toolName: 'glob', ok: true, details: {kind: 'glob', truncated: false, display: {kind: 'glob', paths: ['src/main.ts']}}}),
    subagentRecord('inspect glob result', {kind: 'reasoning_summary'}),
    subagentRecord('', {kind: 'completed', durationMs: 10})
  ];
  const lines = stripAnsi(renderSubagentRunBlock(records, 80)).trimEnd().split('\n');
  const firstReasoningIndex = lines.findIndex((line) => line.includes('Reasoning: choose glob'));
  const toolIndex = lines.findIndex((line) => line.includes('◆ Glob'));
  const secondReasoningIndex = lines.findIndex((line) => line.includes('Reasoning: inspect glob result'));

  assert.equal(lines[firstReasoningIndex - 1], '  ▌ ');
  assert.equal(lines[toolIndex - 1], '  ▌ ');
  assert.equal(lines[secondReasoningIndex - 1], '  ▌ ');
});

test('completed subagent rail shows its report once and compacts the outer run_subagent result', () => {
  const records = [
    ...createBashProcess(true),
    subagentRecord('Final evidence report.', {kind: 'assistant'}),
    subagentRecord('', {kind: 'completed', durationMs: 1234}),
    {
      role: 'tool_call', text: '', toolCallId: 'outer-1', toolName: 'run_subagent',
      argumentsText: JSON.stringify({agent: 'explorer', task: 'inspect repository'})
    },
    {
      role: 'tool_result', text: 'Final evidence report.', toolCallId: 'outer-1', toolName: 'run_subagent', ok: true,
      details: {kind: 'generic'}
    }
  ];
  const lines = renderTranscriptLines(records, 80);
  const plain = lines.map(stripAnsi).join('\n');

  assert.equal(plain.match(/Final evidence report\./g)?.length, 1);
  assert.match(plain, /completed · 1\.2s/);
  assert.match(plain, /Explorer · returned report/);
  assert.doesNotMatch(plain, /\{"task":"inspect repository"\}/);
});

test('Worker rail and compact outer result preserve Worker identity', () => {
  const workerBase = {...BASE, agentName: 'worker', runId: 'worker-run', parentToolCallId: 'worker-outer'};
  const records = [
    {...workerBase, text: 'implement task', event: {kind: 'start', task: 'implement task'}},
    {...workerBase, text: 'done', event: {kind: 'assistant'}},
    {...workerBase, text: '', event: {kind: 'completed', durationMs: 25}},
    {role: 'tool_call', text: '', toolCallId: 'worker-outer', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"implement task"}'},
    {role: 'tool_result', text: 'done', toolCallId: 'worker-outer', toolName: 'run_subagent', ok: true, details: {kind: 'generic'}}
  ];
  const plain = renderTranscriptLines(records, 80).map(stripAnsi).join('\n');
  assert.match(plain, /worker · implement task/u);
  assert.match(plain, /Worker · completed task/u);
  assert.doesNotMatch(plain, /Explorer · returned report/u);

  const pending = renderSubagentPendingLines({
    kind: 'subagent', agentName: 'worker', elapsedMs: 500, phase: 'waiting_question',
    runId: 'worker-run', task: 'implement task', toolName: 'ask_user_questions'
  }, 80, 4).map(stripAnsi).join('\n');
  assert.match(pending, /waiting question · 0\.5s/u);
});

test('custom subagent rail and compact results preserve safe custom identity for all visible phases', () => {
  const customBase = {...BASE, agentName: 'security-reviewer', runId: 'custom-run', parentToolCallId: 'custom-outer'};
  const records = [
    {...customBase, text: 'review auth', event: {kind: 'start', task: 'review auth'}},
    {...customBase, text: '', event: {kind: 'completed', durationMs: 15}},
    {role: 'tool_call', text: '', toolCallId: 'custom-outer', toolName: 'run_subagent', argumentsText: '{"agent":"security-reviewer","task":"review auth"}'},
    {role: 'tool_result', text: 'done', toolCallId: 'custom-outer', toolName: 'run_subagent', ok: true, details: {kind: 'generic'}}
  ];
  const completed = renderTranscriptLines(records, 40).map(stripAnsi);
  const failed = renderTranscriptLines([
    {...customBase, parentToolCallId: 'failed-outer', runId: 'failed-run', text: 'review auth', event: {kind: 'start', task: 'review auth'}},
    {...customBase, parentToolCallId: 'failed-outer', runId: 'failed-run', text: 'provider failed', event: {kind: 'failed', durationMs: 20}},
    {role: 'tool_call', text: '', toolCallId: 'failed-outer', toolName: 'run_subagent', argumentsText: '{"agent":"security-reviewer","task":"review auth"}'},
    {role: 'tool_result', text: 'failed', toolCallId: 'failed-outer', toolName: 'run_subagent', ok: false, details: {kind: 'generic'}}
  ], 40).map(stripAnsi);
  const pending = renderSubagentPendingLines({
    kind: 'subagent', agentName: 'security-reviewer', elapsedMs: 250, phase: 'streaming',
    runId: 'custom-run', task: 'review auth', draft: 'checking'
  }, 12, 4).map(stripAnsi);

  assert.match(completed.join('\n'), /security-reviewer · review auth/u);
  assert.match(completed.join('\n'), /Security reviewer · completed/u);
  assert.match(failed.join('\n'), /Security reviewer · failed/u);
  assert.match(pending.join('\n'), /streaming/u);
  assert.match(pending.join('\n'), /0\.3s/u);
  assertSafe(completed, 40);
  assertSafe(failed, 40);
  assertSafe(pending, 12);
});

test('failed subagent compact result hides the provider-facing handoff body while rail keeps concise failure', () => {
  const handoff = 'Subagent failure: Explorer failed：termination error\n\nStable output:\n    preserved finding\n'.repeat(20);
  const plain = renderTranscriptLines([
    subagentRecord('inspect failure rendering', {kind: 'start', task: 'inspect failure rendering'}),
    subagentRecord('preserved finding', {kind: 'assistant'}),
    subagentRecord('Explorer failed：termination error', {kind: 'failed', durationMs: 25}),
    {role: 'tool_call', text: '', toolCallId: 'outer-1', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"inspect failure rendering"}'},
    {role: 'tool_result', text: handoff, toolCallId: 'outer-1', toolName: 'run_subagent', ok: false, details: {kind: 'generic'}}
  ], 60).map(stripAnsi);
  const output = plain.join('\n');

  assert.match(output, /preserved finding/u);
  assert.match(output, /failed · 25ms · Explorer failed：termination error/u);
  assert.match(output, /Explorer · failed/u);
  assert.doesNotMatch(output, /Subagent failure:|Stable output:/u);
  assertSafe(plain, 60);
});

test('invalid subagent names never reach rail or compact result output', () => {
  const invalidName = 'safe\u001b[31m\nINJECTED';
  const invalidBase = {...BASE, agentName: invalidName, runId: 'invalid-run', parentToolCallId: 'invalid-outer'};
  const plain = renderTranscriptLines([
    {...invalidBase, text: 'inspect', event: {kind: 'start', task: 'inspect'}},
    {...invalidBase, text: '', event: {kind: 'failed', durationMs: 2}},
    {role: 'tool_call', text: '', toolCallId: 'invalid-outer', toolName: 'run_subagent', argumentsText: JSON.stringify({agent: invalidName, task: 'inspect'})},
    {role: 'tool_result', text: 'failed', toolCallId: 'invalid-outer', toolName: 'run_subagent', ok: false, details: {kind: 'generic'}}
  ], 20).map(stripAnsi);

  assert.match(plain.join('\n'), /Subagent/u);
  assert.doesNotMatch(plain.join('\n'), /INJECTED|\[31m/u);
  assertSafe(plain, 20);
});

test('resume projection marks an unfinished run as interrupted without mutating records', () => {
  const records = createBashProcess(true);
  const before = structuredClone(records);
  const plain = renderTranscriptLines(records, 50).map(stripAnsi).join('\n');

  assert.match(plain, /interrupted before completion/);
  assert.deepEqual(records, before);
});

test('destructive projection does not mark the currently active subagent run as interrupted', () => {
  const records = createBashProcess(true);
  const active = renderTranscriptLines(records, 50, undefined, undefined, true, 'run-1').map(stripAnsi).join('\n');

  assert.doesNotMatch(active, /interrupted before completion/u);
});

test('incremental subagent projection keeps one outer header across callbacks', () => {
  const start = subagentRecord('inspect incremental output', {kind: 'start', task: 'inspect incremental output'});
  const reasoning = subagentRecord('Found the relevant module.', {kind: 'reasoning_summary'});
  const completed = subagentRecord('', {kind: 'completed', durationMs: 40});
  const output = [
    renderSubagentRunAppendBlock([start], 80, undefined, false),
    renderSubagentRunAppendBlock([reasoning], 80, undefined, true),
    renderSubagentRunAppendBlock([completed], 80, undefined, true)
  ].join('');
  const plain = stripAnsi(output);

  assert.equal((plain.match(/explorer · inspect incremental output/gu) || []).length, 1);
  assert.match(plain, /Reasoning: Found the relevant module\./u);
  assert.match(plain, /completed · 40ms/u);
  assert.doesNotMatch(plain, /interrupted before completion/u);
});

test('subagent rail safely degrades and reflows Chinese content at narrow widths', () => {
  const records = [
    subagentRecord('调查很长的中文路径与证据'.repeat(4), {kind: 'start', task: '调查很长的中文路径与证据'.repeat(4)}),
    subagentRecord('结论包含宽字符与非常长的内容'.repeat(5), {kind: 'assistant'}),
    subagentRecord('', {kind: 'completed', durationMs: 5})
  ];
  const before = structuredClone(records);
  const narrow = renderTranscriptLines(records, 10);
  const wider = renderTranscriptLines(records, 24);

  assertSafe(narrow, 10);
  assertSafe(wider, 24);
  assert.ok(narrow.some((line) => stripAnsi(line).startsWith('› ')));
  assert.deepEqual(records, before);
});
