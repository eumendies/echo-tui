const test = require('node:test');
const assert = require('node:assert/strict');

const {createTuiTheme} = require('../../src/config/theme-config');
const {stripAnsi} = require('../../src/render/layout');
const {renderHooksSurface} = require('../../src/render/footer/hooks-surface');

function createHooksSurface(overrides = {}) {
  return {
    kind: 'hooks',
    title: 'HOOKS',
    mode: 'events',
    diagnostics: [],
    events: [
      {event: 'assistant_turn_start', count: 0},
      {event: 'assistant_turn_end', count: 2},
      {event: 'assistant_turn_error', count: 0},
      {event: 'assistant_turn_cancelled', count: 0},
      {event: 'tool_call_start', count: 0},
      {event: 'tool_call_end', count: 0},
      {event: 'compaction_end', count: 0}
    ],
    selectedEvent: 'assistant_turn_end',
    eventIndex: 1,
    entries: [
      {command: 'echo done', enabled: true, timeoutMs: 1000},
      {command: 'echo disabled', enabled: false, timeoutMs: 2000}
    ],
    entryIndex: 0,
    dismissHint: 'hint',
    ...overrides
  };
}

test('renderHooksSurface renders events, diagnostics, and omits verbose labels', () => {
  const layout = renderHooksSurface(createHooksSurface({
    diagnostics: ['unknown_event: 未知 hook event，已忽略']
  }), 100);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.equal(layout.showCursor, false);
  assert.match(text, /HOOKS/);
  assert.doesNotMatch(text, /\.echo\/config\.json/);
  assert.match(text, /assistant_turn_start/);
  assert.match(text, /assistant_turn_end/);
  assert.match(text, /assistant_turn_start\s+0 hooks/);
  assert.match(text, /assistant_turn_end\s+2 hooks/);
  assert.doesNotMatch(text, /enabled ·/);
  assert.doesNotMatch(text, /disabled/);
  assert.match(text, /诊断/);
  assert.doesNotMatch(text, /配置：/);
  assert.doesNotMatch(text, /提示：/);
  assert.doesNotMatch(text, /"hooks"\s*:/);
  assert.doesNotMatch(text, /payload 字段文档[\s\S]*event/);
});

function isBlankBoxLine(line) {
  return /^│\s*│$/.test(line);
}

function visibleColumn(line, text) {
  const index = line.indexOf(text);
  assert.ok(index >= 0, `missing text: ${text}`);
  return index;
}

test('renderHooksSurface renders errors between form and dismiss hint', () => {
  const layout = renderHooksSurface(createHooksSurface({
    mode: 'entryDetail',
    error: 'command 不能为空。'
  }), 100);
  const lines = layout.lines.map((line) => stripAnsi(line));
  const text = lines.join('\n');
  const formEndIndex = lines.findIndex((line) => line.includes('Delete entry'));
  const hintIndex = lines.findIndex((line) => line.includes('hint'));
  const errorIndex = lines.findIndex((line) => line.includes('command 不能为空'));

  assert.ok(formEndIndex >= 0);
  assert.doesNotMatch(text, /Save hooks/);
  assert.doesNotMatch(text, /Back to entries/);
  assert.ok(hintIndex >= 0);
  assert.ok(errorIndex > formEndIndex);
  assert.ok(errorIndex < hintIndex);
  assert.equal(errorIndex, formEndIndex + 2);
  assert.equal(hintIndex, errorIndex + 2);
  assert.ok(isBlankBoxLine(lines[errorIndex - 1]));
  assert.ok(isBlankBoxLine(lines[errorIndex + 1]));
  assert.equal(visibleColumn(lines[errorIndex], 'command 不能为空。'), visibleColumn(lines[formEndIndex], 'Delete entry'));
  assert.equal(visibleColumn(lines[hintIndex], 'hint'), visibleColumn(lines[formEndIndex], 'Delete entry'));
  assert.equal(visibleColumn(lines[errorIndex], '▌'), visibleColumn(lines[formEndIndex], 'Delete entry') - 2);
});

test('renderHooksSurface renders empty and disabled entry states', () => {
  const empty = renderHooksSurface(createHooksSurface({
    mode: 'entries',
    selectedEvent: 'tool_call_start',
    eventIndex: 4,
    entries: [],
    entryIndex: 0
  }), 80);
  const disabled = renderHooksSurface(createHooksSurface({mode: 'entries', entryIndex: 1}), 100);

  assert.match(stripAnsi(empty.lines.join('\n')), /当前 event 没有 hook entry/);
  assert.doesNotMatch(stripAnsi(empty.lines.join('\n')), /按 a 添加/);
  assert.match(stripAnsi(disabled.lines.join('\n')), /○ off/);
  assert.match(stripAnsi(disabled.lines.join('\n')), /echo disabled/);
});

test('renderHooksSurface renders entry windowing and detail edit block cursor', () => {
  const entries = Array.from({length: 12}, (_value, index) => ({
    command: `echo ${index + 1}`,
    enabled: true,
    timeoutMs: 1000 + index
  }));
  const listLayout = renderHooksSurface(createHooksSurface({
    mode: 'entries',
    entries,
    entryIndex: 10
  }), 100);
  const detailLayout = renderHooksSurface(createHooksSurface({
    mode: 'entryDetail',
    entries,
    entryIndex: 10,
    detailIndex: 0,
    editTarget: 'command',
    editBuffer: 'echo edited'
  }), 100);
  const listText = stripAnsi(listLayout.lines.join('\n'));
  const detailText = stripAnsi(detailLayout.lines.join('\n'));

  assert.equal(detailLayout.showCursor, false);
  assert.match(listText, /↑/);
  assert.match(detailText, /Command/);
  assert.match(detailText, /Timeout/);
  assert.match(detailText, /echo edited█/);
  assert.match(detailText, /Enabled[\s\S]*─+[\s\S]*Run synthetic test[\s\S]*Delete entry/);
  assert.doesNotMatch(detailText, /Save hooks/);
  assert.doesNotMatch(detailText, /Back to entries/);
  assert.doesNotMatch(detailText, /重排/);
});

test('renderHooksSurface renders synthetic test status as a bottom message only', () => {
  const layout = renderHooksSurface(createHooksSurface({
    mode: 'entries',
    test: {
      command: 'echo done',
      entryIndex: 0,
      event: 'assistant_turn_end',
      status: 'completed',
      result: {
        ok: false,
        exitCode: 2,
        durationMs: 45,
        stdout: 'out\nline2',
        stdoutTruncated: true,
        stderr: 'bad',
        stderrTruncated: false
      }
    }
  }), 100);
  const lines = layout.lines.map((line) => stripAnsi(line));
  const text = lines.join('\n');
  const formEndIndex = lines.findIndex((line) => line.includes('echo disabled'));
  const testIndex = lines.findIndex((line) => line.includes('synthetic test: failed'));
  const hintIndex = lines.findIndex((line) => line.includes('hint'));

  assert.ok(formEndIndex >= 0);
  assert.ok(testIndex > formEndIndex);
  assert.ok(testIndex < hintIndex);
  assert.equal(testIndex, formEndIndex + 2);
  assert.equal(hintIndex, testIndex + 2);
  assert.ok(isBlankBoxLine(lines[testIndex - 1]));
  assert.ok(isBlankBoxLine(lines[testIndex + 1]));
  assert.equal(visibleColumn(lines[testIndex], 'synthetic test: failed'), visibleColumn(lines[formEndIndex], '#2'));
  assert.equal(visibleColumn(lines[hintIndex], 'hint'), visibleColumn(lines[formEndIndex], '#2'));
  assert.equal(visibleColumn(lines[testIndex], '▌'), visibleColumn(lines[formEndIndex], '#2') - 2);
  assert.doesNotMatch(text, /exit 2/);
  assert.doesNotMatch(text, /45ms/);
  assert.doesNotMatch(text, /stdout/);
  assert.doesNotMatch(text, /stderr/);
  assert.doesNotMatch(text, /真实 lifecycle hook/);
});

test('renderHooksSurface uses the same focus bar for selected rows and feedback rows', () => {
  const theme = createTuiTheme({footer: {focusBar: '┃'}}).footer;
  const layout = renderHooksSurface(createHooksSurface({
    mode: 'entries',
    entries: [{command: 'echo done', enabled: true, timeoutMs: 1000}],
    entryIndex: 0,
    test: {
      command: 'echo done',
      entryIndex: 0,
      event: 'assistant_turn_end',
      status: 'completed',
      result: {
        ok: true,
        exitCode: 0,
        durationMs: 12,
        stdout: '',
        stdoutTruncated: false,
        stderr: '',
        stderrTruncated: false
      }
    }
  }), 100, theme);
  const lines = layout.lines.map((line) => stripAnsi(line));
  const activeIndex = lines.findIndex((line) => line.includes('#1'));
  const testIndex = lines.findIndex((line) => line.includes('synthetic test: ok'));

  assert.ok(activeIndex >= 0);
  assert.ok(testIndex > activeIndex);
  assert.equal(visibleColumn(lines[activeIndex], '┃'), visibleColumn(lines[testIndex], '┃'));
  assert.equal(visibleColumn(lines[activeIndex], '#1'), visibleColumn(lines[testIndex], 'synthetic test: ok'));
  assert.doesNotMatch(lines[testIndex], /▌/);
});

test('renderHooksSurface renders timeout test status', () => {
  const layout = renderHooksSurface(createHooksSurface({
    mode: 'entries',
    test: {
      command: 'sleep',
      entryIndex: 0,
      event: 'assistant_turn_end',
      status: 'completed',
      result: {
        ok: false,
        timedOut: true,
        durationMs: 1000,
        stdout: '',
        stdoutTruncated: false,
        stderr: '',
        stderrTruncated: false
      }
    }
  }), 100);

  assert.match(stripAnsi(layout.lines.join('\n')), /timeout/);
});
