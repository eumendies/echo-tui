const test = require('node:test');
const assert = require('node:assert/strict');
const {createAppRenderer} = require('../../src/render/app-renderer');
const transcript = require('../../src/render/transcript-renderer');
const {DEFAULT_RENDER_PREFERENCES} = require('../../src/config/app-settings-config');
const {DEFAULT_TUI_THEME} = require('../../src/config/theme-config');
const {createComposer} = require('../../src/input/composer');
const {stripAnsi} = require('../../src/render/layout');
const {renderFooterLayout} = require('../../src/render/footer');
const {getCommittableReasoningText, getCommittableStreamingText} = require('../../src/render/blocks/streaming-text');
const ansi = require('../../src/terminal/ansi');

function longMessage(marker, lines = 600) {
  return {role: 'assistant', text: `${marker}_BEGIN\n\n\`\`\`text\n${Array.from({length: lines}, (_, index) => `${marker} row ${index}`).join('\n')}\n\`\`\`\n\n${marker}_END`};
}

function createHarness(overrides = {}) {
  const writes = [];
  const renderer = createAppRenderer({write(chunk) { writes.push(String(chunk)); return true; }});
  const state = {
    composer: createComposer('draft'), commandSurface: null, pending: null, working: null,
    theme: DEFAULT_TUI_THEME, renderPreferences: {...DEFAULT_RENDER_PREFERENCES, historyRenderLineLimit: 500},
    streamingOwner: 'main', mainTranscript: {baseRecordIndex: 0, compaction: null},
    statusLine: {projectName: 'budget-test', model: {kind: 'default', label: 'fake'}, mode: 'idle'},
    width: 100, rows: 30, ...overrides
  };
  function recover(records, next = {}) {
    const options = {...state, ...next};
    return renderer.renderDestructive({
      ...options, records,
      bannerContext: {cwd: '/tmp/budget-test', nodeVersion: 'v20', terminalSize: {columns: options.width, rows: options.rows}, mode: 'current terminal'}
    });
  }
  return {writes, renderer, state, recover, latest: () => stripAnsi(writes.at(-1))};
}

function occurrences(text, marker) { return text.split(marker).length - 1; }
function runRecord(text, event) {
  return {role: 'subagent', runId: 'budget-run', agentName: 'explorer', parentToolCallId: 'outer-budget', text, event};
}

test('main recovery orders transient compaction and budget hints before complete history and the footer without mutating facts', () => {
  const compaction = {activeStartIndex: 20, summaryText: 'summary', createdAt: 'now'};
  const h = createHarness({mainTranscript: {baseRecordIndex: 20, compaction}});
  const records = [
    {role: 'compaction_notice', text: '已将较早的 20 条历史压缩为摘要'},
    {role: 'assistant', text: 'old omitted answer'}, longMessage('LATEST')
  ];
  const original = structuredClone(records);
  for (const width of [100, 60, 80]) {
    h.recover(records, {width});
    const plain = h.latest();
    assert.equal(occurrences(plain, '完整记录保存在会话文件中'), 1);
    assert.equal(occurrences(plain, '较早的部分历史未展开'), 1);
    assert.ok(plain.indexOf('node v20') < plain.indexOf('完整记录保存在会话文件中'));
    assert.ok(plain.indexOf('完整记录保存在会话文件中') < plain.indexOf('较早的部分历史未展开'));
    assert.ok(plain.indexOf('较早的部分历史未展开') < plain.indexOf('LATEST_BEGIN'));
    assert.ok(plain.indexOf('LATEST_END') < plain.indexOf('draft'));
    assert.doesNotMatch(plain, /old omitted answer|已将较早的/u);
    assert.match(plain, /不影响模型上下文/u);
    assert.equal(occurrences(h.writes.at(-1), ansi.clearScrollback()), 1);
    assert.doesNotMatch(h.writes.at(-1), /\x1b\[\?(?:1049|1047|47)h/u);
    assert.deepEqual(records, original);
  }
});

test('no budget hint is added for a single oversized block or invisible-only prefixes', () => {
  const h = createHarness({renderPreferences: {...DEFAULT_RENDER_PREFERENCES, showReasoningSummary: false, historyRenderLineLimit: 500}});
  const visible = longMessage('ONLY');
  h.recover([{role: 'system', text: 'hidden'}, {role: 'reasoning_summary', text: 'hidden reasoning'}, visible]);
  assert.match(h.latest(), /ONLY_BEGIN/u);
  assert.match(h.latest(), /ONLY_END/u);
  assert.doesNotMatch(h.latest(), /未展开|hidden|已压缩/u);
});

test('a run omitted by the budget gets its first visible title on the next event, then uses continuation', () => {
  const h = createHarness();
  const start = runRecord('', {kind: 'start', task: 'old task'});
  h.recover([start, longMessage('LATEST')]);
  assert.doesNotMatch(h.latest(), /explorer|old task/u);
  h.renderer.renderRecords({...h.state, records: [runRecord('new event after recovery', {kind: 'assistant'})]});
  assert.match(h.latest(), /explorer/u);
  assert.match(h.latest(), /new event after recovery/u);
  h.renderer.renderRecords({...h.state, records: [runRecord('continuing event', {kind: 'assistant'})]});
  assert.doesNotMatch(h.latest(), /explorer/u);
  assert.match(h.latest(), /continuing event/u);

  h.recover([longMessage('OLDER'), start]);
  h.renderer.renderRecords({...h.state, records: [runRecord('already titled event', {kind: 'assistant'})]});
  assert.doesNotMatch(h.latest(), /explorer/u);
  assert.match(h.latest(), /already titled event/u);
});

test('a folded outer result cannot survive recovery without its resident report and intervening blocks', () => {
  const h = createHarness();
  h.recover([
    {role: 'assistant', text: 'older excluded'},
    runRecord('', {kind: 'start', task: 'dependency task'}),
    runRecord('essential report body', {kind: 'assistant'}),
    runRecord('', {kind: 'completed', durationMs: 12}),
    longMessage('DEPENDENCY'),
    {role: 'tool_call', text: '', toolCallId: 'outer-budget', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"dependency task"}'},
    {role: 'tool_result', text: 'outer duplicate report', toolCallId: 'outer-budget', toolName: 'run_subagent', ok: true, details: {kind: 'generic'}}
  ]);
  assert.match(h.latest(), /essential report body/u);
  assert.match(h.latest(), /DEPENDENCY_BEGIN/u);
  assert.match(h.latest(), /DEPENDENCY_END/u);
  assert.equal(occurrences(h.latest(), 'essential report body'), 1);
  assert.doesNotMatch(h.latest(), /older excluded|outer duplicate report/u);
  assert.equal(occurrences(h.latest(), '较早的部分历史未展开'), 1);
});

test('ordinary append and footer ticks neither enforce the budget nor re-scan the stable history', (t) => {
  const h = createHarness();
  const records = [{role: 'assistant', text: 'old omitted'}, longMessage('LATEST')];
  h.renderer.syncMainTranscript({records, baseRecordIndex: 0, compaction: null}, null);
  h.recover(records);
  const project = t.mock.method(transcript, 'renderBudgetedTranscriptLines');
  const rebuild = t.mock.method(transcript, 'rebuildSubagentAppendState');
  const guardedRecords = new Proxy(records, {get(target, key, receiver) {
    if (key === Symbol.iterator) throw new Error('footer tick scanned history');
    return Reflect.get(target, key, receiver);
  }});
  const writeStart = h.writes.length;
  for (let tick = 0; tick < 5; tick += 1) {
    h.renderer.syncMainTranscript({records: guardedRecords, baseRecordIndex: 0, compaction: null}, null);
    h.renderer.render({...h.state, composer: createComposer(`draft ${tick}`)});
  }
  h.renderer.renderRecords({...h.state, records: [longMessage('APPEND', 700)]});
  const appended = stripAnsi(h.writes.slice(writeStart).join(''));
  assert.match(appended, /APPEND_BEGIN/u);
  assert.match(appended, /APPEND_END/u);
  assert.doesNotMatch(h.writes.slice(writeStart).join(''), /\x1b\[(?:2|3)J/u);
  assert.equal(project.mock.callCount(), 0);
  assert.equal(rebuild.mock.callCount(), 0);
});

for (const kind of ['streaming', 'reasoning_streaming', 'shell_output']) {
  test(`budget recovery preserves ${kind} source and pending boundaries, cursor, and command surfaces`, () => {
    const text = kind === 'streaming' ? 'LIVE_PREFIX\n\nLIVE_TAIL' : 'LIVE_PREFIX\nLIVE_TAIL';
    const pending = kind === 'shell_output'
      ? {kind, commandLine: '$ synthetic-command', output: text}
      : {kind, text};
    const h = createHarness({pending, working: {elapsedMs: 10}});
    h.renderer.render(h.state);
    const records = [{role: 'assistant', text: 'old omitted'}, longMessage('LATEST')];
    const next = {...h.state, width: 60};
    const pointer = h.recover(records, next);
    const frame = h.latest();
    assert.doesNotMatch(frame, /old omitted/u);
    assert.match(frame, /LATEST_END/u);
    assert.equal(occurrences(frame, 'LIVE_PREFIX'), 1);
    assert.equal(occurrences(frame, 'LIVE_TAIL'), 1);
    assert.ok(frame.indexOf('LATEST_END') < frame.indexOf('LIVE_PREFIX'));
    const preparedPending = kind === 'shell_output'
      ? {...pending, historyRawLength: text.indexOf('\n') + 1}
      : {...pending, historyText: kind === 'streaming' ? getCommittableStreamingText(text) : getCommittableReasoningText(text, 60)};
    const footer = renderFooterLayout({...next, pending: preparedPending});
    assert.equal(pointer.cursorRow, footer.cursorRow);
    assert.equal(pointer.cursorColumn, footer.cursorColumn);
    assert.ok(h.writes.at(-1).endsWith(ansi.cursorUp(footer.lines.length - 1 - footer.cursorRow)
      + ansi.carriageReturn() + ansi.cursorForward(footer.cursorColumn) + (footer.showCursor ? ansi.showCursor() : '')));

    const commandSurface = {kind: 'info', title: 'Active command', lines: ['SURFACE_STAYS_OPEN'], dismissHint: 'Esc close'};
    h.recover(records, {...next, commandSurface});
    assert.match(h.latest(), /SURFACE_STAYS_OPEN/u);
    const beforeFinal = h.writes.length;
    if (kind === 'shell_output') {
      h.renderer.renderRecords({...next, pending: null, records: [{role: 'shell', text: `${pending.commandLine}\n\n${text}`, command: 'synthetic-command', output: text}]});
    } else {
      h.renderer.render({...next, pending: null}, {role: kind === 'streaming' ? 'assistant' : 'reasoning_summary', text});
    }
    const final = stripAnsi(h.writes.slice(beforeFinal).join(''));
    assert.doesNotMatch(final, /LIVE_PREFIX/u);
    assert.equal(occurrences(final, 'LIVE_TAIL'), 1);
  });
}

test('budgeted main recovery still keeps an active internal call only in the footer and restores its tool pair later', () => {
  const pending = {kind: 'subagent', runId: 'budget-run', agentName: 'explorer', task: 'inspect', elapsedMs: 10,
    phase: 'tool', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}'};
  const h = createHarness({pending});
  h.recover([
    longMessage('OLDER'), runRecord('', {kind: 'start', task: 'inspect'}),
    runRecord('', {kind: 'tool_call', toolCallId: 'inner', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}'})
  ]);
  assert.equal(occurrences(h.latest(), 'Bash · running'), 1);
  h.renderer.renderRecords({...h.state, pending: {...pending, phase: 'thinking', toolName: undefined, argumentsText: undefined},
    records: [runRecord('/workspace', {kind: 'tool_result', toolCallId: 'inner', toolName: 'run_bash_command', ok: true, details: {kind: 'bash'}})]});
  assert.equal(occurrences(h.latest(), 'Bash · complete'), 1);
});
