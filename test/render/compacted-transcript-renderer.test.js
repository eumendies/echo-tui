const test = require('node:test');
const assert = require('node:assert/strict');
const {createAppRenderer} = require('../../src/render/app-renderer');
const {
  createSubagentAppendRenderState, trackParallelSubagentRecords, pruneSubagentAppendState,
  rebuildSubagentAppendState, renderTranscriptBlocks
} = require('../../src/render/transcript-renderer');
const {createComposer} = require('../../src/input/composer');
const {createTuiTheme} = require('../../src/config/theme-config');
const {DEFAULT_RENDER_PREFERENCES} = require('../../src/config/app-settings-config');
const {stripAnsi} = require('../../src/render/layout');
const ansi = require('../../src/terminal/ansi');

const compaction = {activeStartIndex: 800, summaryText: 'DO NOT EXPAND SUMMARY', createdAt: 'now'};
const baseRun = {role: 'subagent', agentName: 'explorer', parentToolCallId: 'outer', runId: 'run'};
const start = {...baseRun, text: 'inspect', event: {kind: 'start', task: 'inspect'}};
const call = {...baseRun, text: 'grep', event: {
  kind: 'tool_call', toolCallId: 'inner', toolName: 'grep', argumentsText: '{"pattern":"evicted-secret"}'
}};
const result = {...baseRun, text: 'found', event: {
  kind: 'tool_result', toolCallId: 'inner', toolName: 'grep', ok: true, details: {kind: 'generic'}
}};
const pending = {kind: 'subagent', agentName: 'explorer', runId: 'run', task: 'inspect', phase: 'thinking', elapsedMs: 10};

function harness(records = [{role: 'assistant', text: 'active answer'}]) {
  const output = {writes: [], write(chunk) { this.writes.push(String(chunk)); }};
  const renderer = createAppRenderer(output);
  const state = {
    composer: createComposer('composer draft'), commandSurface: null, pending: null, working: null,
    theme: createTuiTheme(), renderPreferences: DEFAULT_RENDER_PREFERENCES,
    streamingOwner: 'main', rows: 24, width: 100,
    statusLine: {projectName: 'project', model: {kind: 'default', label: 'test-model'}, mode: 'idle'},
    mainTranscript: {baseRecordIndex: 800, compaction}
  };
  const bannerContext = {cwd: '/tmp/project', nodeVersion: 'v20', terminalSize: {columns: 100, rows: 24}, mode: 'current terminal'};
  return {output, renderer, state, bannerContext, snapshot: {records, baseRecordIndex: 800, compaction}};
}

test('compacted resize, theme and recovery project one transient hint and resident records, preserving pending/footer/cursor', () => {
  const records = [
    {role: 'user', text: 'active question'},
    {role: 'compaction_notice', text: '已将较早的 400 条历史压缩为摘要'},
    {role: 'assistant', text: 'active answer'},
    {role: 'compaction_notice', text: '已将较早的 800 条历史压缩为摘要'},
    {role: 'compaction_notice', text: '当前无需压缩'}
  ];
  const original = JSON.stringify(records);
  const {output, renderer, state, bannerContext, snapshot} = harness(records);
  for (const width of [100, 80, 100]) {
    renderer.syncMainTranscript(snapshot, null);
    renderer.renderDestructive({
      ...state, width,
      theme: createTuiTheme({blocks: {colors: {notice: [11, 22, width]}}}),
      pending: {kind: 'streaming', text: 'stable pending\n\npending tail'},
      pendingMessage: {preview: 'queued request'},
      bannerContext,
      records
    });
    const frame = output.writes.at(-1);
    const plain = stripAnsi(frame);
    assert.match(plain, /较早的 800 条历史已压缩/u);
    assert.match(plain, /完整记录保存在会话文件中/u);
    assert.equal((plain.match(/历史已压缩/gu) || []).length, 1);
    assert.doesNotMatch(plain, /已将较早的|EVICTED ORIGINAL|DO NOT EXPAND SUMMARY/u);
    assert.match(plain, /当前无需压缩/u);
    for (const text of ['active question', 'active answer', 'stable pending', 'pending tail', 'composer draft', 'queued request', 'test-model']) {
      assert.ok(plain.includes(text), text);
    }
    assert.ok(frame.includes(ansi.showCursor()));
    assert.ok(frame.includes(`\x1b[38;2;11;22;${width}m`));
  }
  assert.equal(JSON.stringify(records), original);
});

test('compaction synchronization and incremental notice never clear screen or scrollback', () => {
  const {output, renderer, state, snapshot} = harness([]);
  const old = {...state, mainTranscript: {baseRecordIndex: 0, compaction: null}, pending};
  renderer.syncMainTranscript({...old.mainTranscript, records: [start, call]}, pending);
  renderer.renderRecords({...old, records: [start, call]});
  output.writes.length = 0;
  renderer.syncMainTranscript(snapshot, pending);
  assert.equal(output.writes.length, 0);
  renderer.renderRecords({...state, pending, records: [{role: 'compaction_notice', text: 'new notice'}]});
  renderer.renderRecords({...state, pending, records: [result]});
  const written = output.writes.join('');
  assert.equal(written.includes(ansi.clearVisibleScreen()), false);
  assert.equal(written.includes(ansi.clearScrollback()), false);
  assert.doesNotMatch(stripAnsi(written), /evicted-secret/u);
  assert.match(stripAnsi(written), /new notice/u);
});

test('ordinary footer ticks do not scan resident records again when the boundary is unchanged', () => {
  const {renderer, state, snapshot} = harness();
  renderer.syncMainTranscript(snapshot, null);
  const unscannable = new Proxy(snapshot.records, {
    get(target, key) {
      if (key === Symbol.iterator) throw new Error('ordinary tick scanned transcript');
      return Reflect.get(target, key);
    }
  });
  renderer.syncMainTranscript({...snapshot, records: unscannable}, null);
  renderer.render(state);
});

test('uncompacted main recovery preserves all records and notices without adding a history hint', () => {
  const records = [{role: 'user', text: 'original history'}, {role: 'compaction_notice', text: 'original notice'}];
  const {output, renderer, state, bannerContext} = harness(records);
  renderer.syncMainTranscript({records, baseRecordIndex: 0, compaction: null}, null);
  renderer.renderDestructive({...state, bannerContext, records, mainTranscript: {baseRecordIndex: 0, compaction: null}});
  const plain = stripAnsi(output.writes.at(-1));
  assert.match(plain, /original history/u);
  assert.match(plain, /original notice/u);
  assert.doesNotMatch(plain, /完整记录保存在会话文件中/u);
});

test('pruning drops evicted raw calls and stale ids while keeping resident pairs and active parallel identity', () => {
  const state = createSubagentAppendRenderState();
  const parallelStart = {...start, event: {...start.event, parallelSize: 2}};
  const retiredStart = {...start, runId: 'retired', parentToolCallId: 'retired-outer'};
  trackParallelSubagentRecords(state, [parallelStart, retiredStart]);
  renderTranscriptBlocks([start, call, retiredStart], 80, undefined, undefined, false, state);
  state.terminalCallIds.add('retired-outer');
  pruneSubagentAppendState(state, [], ['run']);
  assert.equal(state.pendingToolCalls.size, 0);
  assert.deepEqual([...state.parallelRunIds], ['run']);
  assert.deepEqual([...state.parallelParentToolCallIds], ['outer']);
  assert.deepEqual([...state.parentToolCallIdsByRun], [['run', 'outer']]);
  assert.equal(state.runIds.has('retired'), false);
  assert.equal(state.terminalCallIds.size, 0);
  assert.equal(state.localParentToolCallIds.has('retired-outer'), false);

  renderTranscriptBlocks([call], 80, undefined, undefined, false, state);
  const residentCall = {...call, event: {...call.event, argumentsText: '{"pattern":"resident"}'}};
  pruneSubagentAppendState(state, [residentCall], ['run']);
  assert.equal([...state.pendingToolCalls.values()][0], residentCall);
  const completed = stripAnsi(renderTranscriptBlocks([result], 80, undefined, undefined, false, state).join(''));
  assert.match(completed, /resident/u);
  assert.doesNotMatch(completed, /evicted-secret/u);
  pruneSubagentAppendState(state, [], []);
  assert.equal(state.parentToolCallIdsByRun.size, 0);
  for (const ids of [state.parallelRunIds, state.runIds, state.parallelParentToolCallIds, state.localParentToolCallIds, state.terminalCallIds]) assert.equal(ids.size, 0);
});

test('snapshot rebuilding protects multiple active pending calls without retaining evicted prefixes', () => {
  const state = createSubagentAppendRenderState();
  const secondCall = {...call, runId: 'second-run', parentToolCallId: 'second-outer'};
  rebuildSubagentAppendState(state, [call, secondCall], ['run', 'second-run']);
  assert.equal(state.pendingToolCalls.size, 2);
  pruneSubagentAppendState(state, [secondCall], ['run', 'second-run']);
  assert.deepEqual([...state.pendingToolCalls.values()], [secondCall]);
});

test('returning from BTW or historical run preserves main active filtering and compacted projection', () => {
  const {output, renderer, state, bannerContext} = harness();
  const parallelStart = {...start, event: {...start.event, parallelSize: 2}};
  renderer.syncMainTranscript({records: [parallelStart], baseRecordIndex: 0, compaction: null}, null);
  renderer.renderRecords({...state, records: [parallelStart], mainTranscript: {baseRecordIndex: 0, compaction: null}});
  const parallelEvent = {...baseRun, text: 'hidden main process', event: {kind: 'assistant'}};
  const snapshot = {records: [parallelEvent], baseRecordIndex: 800, compaction};
  renderer.syncMainTranscript(snapshot, {kind: 'subagents', runs: [pending]});
  for (const owner of ['btw', 'view']) {
    renderer.renderDestructive({...state, mainTranscript: undefined, streamingOwner: owner, bannerContext,
      skipParallelSubagentFilter: owner === 'view', records: [{role: 'assistant', text: 'own projection'}]});
    const plain = stripAnsi(output.writes.at(-1));
    assert.match(plain, /own projection/u);
    assert.doesNotMatch(plain, /完整记录保存在会话文件中/u);
  }
  renderer.renderDestructive({...state, bannerContext, records: snapshot.records,
    pending: {kind: 'subagents', runs: [pending]}});
  const plain = stripAnsi(output.writes.at(-1));
  assert.match(plain, /完整记录保存在会话文件中/u);
  assert.doesNotMatch(plain, /hidden main process|own projection/u);
});

test('closing a historical view releases its buffered raw call instead of pairing it into a later side projection', () => {
  const {output, renderer, state, bannerContext, snapshot} = harness();
  renderer.renderDestructive({...state, mainTranscript: undefined, streamingOwner: 'view', bannerContext,
    skipParallelSubagentFilter: true, records: [start, call], pending});
  renderer.syncMainTranscript(snapshot, null);
  renderer.renderDestructive({...state, bannerContext, records: snapshot.records});
  output.writes.length = 0;
  renderer.renderRecords({...state, mainTranscript: undefined, streamingOwner: 'btw', records: [result]});
  assert.doesNotMatch(stripAnsi(output.writes.join('')), /evicted-secret/u);
});
