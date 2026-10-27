const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSubagentAppendRenderState,
  filterParallelSubagentRecords,
  filterPendingSubagentToolCallRecords,
  rebuildSubagentAppendState,
  renderBudgetedTranscriptLines,
  renderTranscriptBlocks,
  renderTranscriptLines,
  splitRenderedBlock
} = require('../../src/render/transcript-renderer');
const {DEFAULT_RENDER_PREFERENCES} = require('../../src/config/app-settings-config');
const {createTuiTheme} = require('../../src/config/theme-config');
const {stripAnsi} = require('../../src/render/layout');

function subagent(runId, text, event, agentName = 'explorer') {
  return {role: 'subagent', runId, parentToolCallId: `outer-${runId}`, agentName, text, event};
}

function outerPair(runId, text = `report-${runId}`, overrides = {}) {
  return [
    {role: 'tool_call', toolCallId: `outer-${runId}`, toolName: 'run_subagent', text: '',
      argumentsText: JSON.stringify({agent: 'explorer', task: `task-${runId}`})},
    {role: 'tool_result', toolCallId: `outer-${runId}`, toolName: 'run_subagent', text,
      ok: true, details: {kind: 'generic'}, ...overrides}
  ];
}

function completedRun(runId, event = {kind: 'completed', durationMs: 10}) {
  return [
    subagent(runId, `task-${runId}`, {kind: 'start', task: `task-${runId}`}),
    subagent(runId, `report-${runId}`, {kind: 'assistant'}),
    subagent(runId, event.kind === 'failed' ? 'provider failure' : '', event)
  ];
}

function bashPair(id) {
  return [
    {role: 'tool_call', text: '', toolCallId: id, toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}'},
    {role: 'tool_result', text: '/workspace', toolCallId: id, toolName: 'run_bash_command', ok: true, details: {kind: 'bash', exitCode: 0}}
  ];
}

function budget(records, limit, width = 80, preferences = DEFAULT_RENDER_PREFERENCES, theme, activeRunId) {
  return renderBudgetedTranscriptLines(records, width, theme, {...preferences, historyRenderLineLimit: limit}, activeRunId);
}

function plain(projection) {
  return projection.lines.map(stripAnsi).join('\n');
}

function inaccessibleText(record) {
  return Object.defineProperty(record, 'text', {enumerable: true, get() { throw new Error('unselected body accessed'); }});
}

test('budget projection uses render preferences as its only limit source and defaults to 1000 lines', () => {
  const records = [
    {role: 'assistant', text: 'earliest omitted'},
    {role: 'assistant', text: '```text\n' + 'middle row\n'.repeat(600) + '```'},
    {role: 'assistant', text: '```text\n' + 'latest row\n'.repeat(600) + '```'}
  ];
  assert.deepEqual(renderBudgetedTranscriptLines(records).lines, renderTranscriptLines(records.slice(1)));
  for (const [historyRenderLineLimit, firstRecord] of [[500, 2], [1000, 1], [2000, 0], [0, 0]]) {
    const preferences = {...DEFAULT_RENDER_PREFERENCES, historyRenderLineLimit};
    const projection = renderBudgetedTranscriptLines(records, 80, undefined, preferences);
    assert.deepEqual(projection.lines, renderTranscriptLines(records.slice(firstRecord)));
    assert.equal(projection.omittedVisibleHistory, firstRecord > 0);
  }
});

test('zero and sufficient budget equal the full projection across widths, themes, visibility and record kinds', () => {
  const records = [
    {role: 'system', text: 'hidden context'},
    {role: 'extension', text: 'hidden private reasoning', extension: {kind: 'unknown', name: 'private', payload: {}}},
    {role: 'user', text: 'raw user', displayText: 'visible user 中文', metadata: {interactionMode: 'plan'}},
    {role: 'assistant', text: '# Heading\n\n**Markdown** and `code`.\n\n| Key | Value |\n| --- | --- |\n| a | 中文 |\n\n```js\nconst x = 1;\n```'},
    ...bashPair('bash'),
    {role: 'reasoning_summary', text: 'stable reasoning'},
    {role: 'shell', text: 'shell output', command: 'pwd', output: '/workspace'},
    {role: 'error', text: 'local error'},
    {role: 'local_notice', text: 'interrupted'},
    {role: 'compaction_notice', text: 'notice'},
    ...completedRun('completed'),
    {role: 'assistant', text: 'between rail and outer'},
    ...outerPair('completed'),
    subagent('unfinished', 'task-unfinished', {kind: 'start', task: 'task-unfinished'}),
    subagent('unfinished', 'still working', {kind: 'assistant'})
  ];
  const original = structuredClone(records);
  const themes = [createTuiTheme(), createTuiTheme({blocks: {colors: {assistant: [20, 30, 40], subagentRail: [80, 90, 100]}}})];
  for (const width of [10, 40, 100]) {
    for (const showReasoningSummary of [false, true]) {
      for (const theme of themes) {
        const preferences = {...DEFAULT_RENDER_PREFERENCES, showReasoningSummary};
        const full = renderTranscriptLines(records, width, theme, preferences, true, 'unfinished');
        for (const limit of [0, full.length, full.length + 1]) {
          const projection = budget(records, limit, width, preferences, theme, 'unfinished');
          assert.deepEqual(projection.lines, full);
          assert.equal(projection.omittedVisibleHistory, false);
          assert.deepEqual([...projection.renderedSubagentRunIds].sort(), ['completed', 'unfinished']);
        }
      }
    }
  }
  assert.deepEqual(records, original);
});

test('finite budgets produce the exact complete-block suffix and count trailing blank lines', () => {
  const records = [
    {role: 'user', text: 'first user'},
    {role: 'assistant', text: 'answer one\n\nsecond paragraph'},
    ...bashPair('bash'),
    ...completedRun('rail'),
    {role: 'reasoning_summary', text: 'reasoning after the run'},
    {role: 'assistant', text: 'last answer'}
  ];
  for (const width of [15, 50, 100]) {
    const blocks = renderTranscriptBlocks(records, width, undefined, undefined, true).map(splitRenderedBlock);
    for (let limit = 1; limit <= blocks.flat().length + 1; limit += 1) {
      let first = blocks.length;
      let count = 0;
      while (first > 0 && count < limit) count += blocks[--first].length;
      const projection = budget(records, limit, width);
      assert.deepEqual(projection.lines, blocks.slice(first).flat());
      assert.equal(projection.omittedVisibleHistory, first > 0);
    }
  }
});

test('empty and entirely invisible histories neither spend budget nor report omissions', () => {
  const hidden = [
    inaccessibleText({role: 'system'}),
    inaccessibleText({role: 'extension', extension: {kind: 'unknown', name: 'private', payload: {}}}),
    inaccessibleText({role: 'reasoning_summary'})
  ];
  for (const records of [[], hidden]) {
    for (const limit of [0, 1, 500]) {
      assert.deepEqual(budget(records, limit, 80, {...DEFAULT_RENDER_PREFERENCES, showReasoningSummary: false}), {
        lines: [], omittedVisibleHistory: false, renderedSubagentRunIds: new Set()
      });
    }
  }
  const latest = {role: 'assistant', text: 'only visible history'};
  const projection = budget([...hidden, latest], 1, 80, {...DEFAULT_RENDER_PREFERENCES, showReasoningSummary: false});
  assert.deepEqual(projection.lines, renderTranscriptLines([latest]));
  assert.equal(projection.omittedVisibleHistory, false);
});

test('hidden records keep the original adjacency boundaries without becoming budget candidates', () => {
  const pair = bashPair('separated');
  const records = [pair[0], {role: 'system', text: 'separator'}, pair[1]];
  const expected = renderTranscriptLines([pair[1]]);
  const projection = budget(records, 1);
  assert.deepEqual(projection.lines, expected);
  assert.equal(projection.omittedVisibleHistory, true);
  assert.deepEqual(budget(records, 0).lines, renderTranscriptLines(records));
});

test('the complete crossing boundary and oversized newest block are retained', () => {
  const old = {role: 'assistant', text: 'earliest omitted'};
  const boundary = {role: 'assistant', text: '```text\n' + 'boundary row\n'.repeat(30) + '```'};
  const latest = {role: 'assistant', text: '```text\n' + 'latest row\n'.repeat(20) + '```'};
  const latestLines = renderTranscriptLines([latest]);
  const crossing = budget([old, boundary, latest], latestLines.length + 1);
  assert.deepEqual(crossing.lines, renderTranscriptLines([boundary, latest]));
  assert.ok(crossing.lines.length > latestLines.length + 1);
  assert.equal(crossing.omittedVisibleHistory, true);

  for (const records of [[latest], [old, latest]]) {
    const oversized = budget(records, 1);
    assert.deepEqual(oversized.lines, latestLines);
    assert.equal(oversized.omittedVisibleHistory, records.length > 1);
  }
});

test('terminal width recomputes actual line counts and therefore the selected suffix', () => {
  const records = [
    {role: 'assistant', text: 'earliest'},
    {role: 'user', text: 'middle visible'},
    {role: 'assistant', text: 'latest-word '.repeat(20)}
  ];
  const wideLatest = renderTranscriptLines(records.slice(-1), 120).length;
  assert.ok(renderTranscriptLines(records.slice(-1), 20).length > wideLatest + 1);
  const wide = budget(records, wideLatest + 1, 120);
  const narrow = budget(records, wideLatest + 1, 20);
  assert.deepEqual(wide.lines, renderTranscriptLines(records.slice(-2), 120));
  assert.deepEqual(narrow.lines, renderTranscriptLines(records.slice(-1), 20));
});

test('reasoning visibility is applied before counting, including hidden reasoning after a visible tail', () => {
  const messages = [{role: 'user', text: 'earlier'}, {role: 'assistant', text: 'latest visible'}];
  const summary = {role: 'reasoning_summary', text: 'reasoning '.repeat(80)};
  const limit = renderTranscriptLines(messages.slice(-1)).length + 1;
  const hidden = budget([...messages, summary], limit, 80, {...DEFAULT_RENDER_PREFERENCES, showReasoningSummary: false});
  const shown = budget([...messages, summary], limit, 80, {...DEFAULT_RENDER_PREFERENCES, showReasoningSummary: true});
  assert.deepEqual(hidden.lines, renderTranscriptLines(messages));
  assert.equal(hidden.omittedVisibleHistory, false);
  assert.deepEqual(shown.lines, renderTranscriptLines([summary]));
  assert.equal(shown.omittedVisibleHistory, true);
});

test('unselected old bodies and tool arguments never enter sanitization, Markdown or wrapping', () => {
  const old = Array.from({length: 300}, () => inaccessibleText({role: 'assistant'}));
  const oldTool = bashPair('old-tool').map(inaccessibleText);
  Object.defineProperty(oldTool[0], 'argumentsText', {get() { throw new Error('unselected arguments accessed'); }});
  const oldRail = completedRun('old-rail').map(inaccessibleText);
  const latest = {role: 'assistant', text: 'visible tail'};
  const projection = budget([...old, ...oldTool, ...oldRail, latest], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines([latest]));
  assert.equal(projection.omittedVisibleHistory, true);
  assert.equal(projection.renderedSubagentRunIds.size, 0);
  assert.throws(() => renderTranscriptLines(old.slice(0, 1)), /unselected body accessed/u);
});

test('the latest ordinary tool call/result pair remains one indivisible selection unit', () => {
  const pair = bashPair('latest');
  const projection = budget([{role: 'assistant', text: 'earlier'}, ...pair], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines(pair));
  assert.match(plain(projection), /pwd/u);
  assert.match(plain(projection), /workspace/u);
});

test('the latest continuous subagent run retains its title, nested tool pair and terminal', () => {
  const records = [
    subagent('tools', 'task-tools', {kind: 'start', task: 'task-tools'}),
    subagent('tools', '', {kind: 'tool_call', toolCallId: 'inner', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}'}),
    subagent('tools', '/workspace', {kind: 'tool_result', toolCallId: 'inner', toolName: 'run_bash_command', ok: true, details: {kind: 'bash'}}),
    subagent('tools', '', {kind: 'completed', durationMs: 10})
  ];
  const projection = budget([{role: 'assistant', text: 'earlier'}, ...records], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines(records));
  assert.deepEqual([...projection.renderedSubagentRunIds], ['tools']);
  assert.match(plain(projection), /explorer · task-tools/u);
  assert.match(plain(projection), /completed · 10ms/u);
});

test('a compact single-delegate result keeps the earlier report and every intervening block', () => {
  for (const terminal of [{kind: 'completed', durationMs: 10}, {kind: 'failed', durationMs: 20}, {kind: 'cancelled', durationMs: 30}]) {
    const run = completedRun('dependency', terminal);
    const interval = [...run, {role: 'assistant', text: 'intervening message'}, ...outerPair('dependency', 'duplicate report', {ok: terminal.kind === 'completed'})];
    const projection = budget([{role: 'user', text: 'earlier omitted'}, ...interval], 1);
    assert.deepEqual(projection.lines, renderTranscriptLines(interval));
    assert.equal(projection.omittedVisibleHistory, true);
    assert.equal((plain(projection).match(/report-dependency/gu) || []).length, 1);
    assert.match(plain(projection), /intervening message/u);
    assert.doesNotMatch(plain(projection), /duplicate report/u);
    assert.deepEqual([...projection.renderedSubagentRunIds], ['dependency']);
    assert.equal(budget(interval, 1).omittedVisibleHistory, false);
  }
});

test('dependency spans start at the first resident rail even when report and terminal form later blocks', () => {
  const [start, report, terminal] = completedRun('split');
  const interval = [start, {role: 'assistant', text: 'split one'}, report, {role: 'assistant', text: 'split two'}, terminal, ...outerPair('split')];
  const projection = budget([{role: 'user', text: 'earlier omitted'}, ...interval], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines(interval));
  assert.match(plain(projection), /report-split/u);
  assert.equal(projection.omittedVisibleHistory, true);
});

test('overlapping report dependency intervals merge without pulling unrelated older history', () => {
  const interval = [
    ...completedRun('a'),
    {role: 'assistant', text: 'gap one'},
    ...completedRun('b'),
    ...outerPair('a'),
    {role: 'assistant', text: 'gap two'},
    ...outerPair('b')
  ];
  const projection = budget([{role: 'user', text: 'outside'}, ...interval], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines(interval));
  assert.deepEqual([...projection.renderedSubagentRunIds].sort(), ['a', 'b']);
  assert.equal(projection.omittedVisibleHistory, true);
});

test('unrelated later history can omit an entire dependency interval without rendering its old bodies', () => {
  const interval = [...completedRun('old').map(inaccessibleText), ...outerPair('old').map(inaccessibleText)];
  Object.defineProperty(interval.at(-2), 'argumentsText', {get() { throw new Error('unselected arguments accessed'); }});
  const latest = {role: 'assistant', text: 'unrelated new answer'};
  const projection = budget([...interval, latest], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines([latest]));
  assert.equal(projection.omittedVisibleHistory, true);
});

test('a synthesized interruption stays with the rail it continues in either physical record order', () => {
  const start = subagent('cancelled', 'task-cancelled', {kind: 'start', task: 'task-cancelled'});
  const pair = outerPair('cancelled', 'Tool execution was interrupted by the user before it returned a result.', {ok: false, details: {kind: 'generic', interrupted: true}});
  for (const interval of [[start, {role: 'assistant', text: 'intervening'}, ...pair], [...pair, start]]) {
    const projection = budget([{role: 'assistant', text: 'earlier'}, ...interval], 1);
    assert.deepEqual(projection.lines, renderTranscriptLines(interval));
    assert.match(plain(projection), /explorer · task-cancelled/u);
    assert.equal((plain(projection).match(/cancelled/gu) || []).length, 2);
    assert.doesNotMatch(plain(projection), /interrupted before completion|Tool execution was interrupted/u);
  }
});

test('only resident dependencies are used; a standalone outer result remains fully visible', () => {
  const pair = outerPair('not-resident', 'resident report without a rail');
  const projection = budget([{role: 'assistant', text: 'earlier'}, ...pair], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines(pair));
  assert.match(plain(projection), /resident report without a rail/u);
  assert.equal(projection.renderedSubagentRunIds.size, 0);
});

test('main-window parallel and pending filters remain before budget selection and spend no lines', () => {
  const parallel = completedRun('parallel');
  parallel[0] = {...parallel[0], event: {...parallel[0].event, parallelSize: 2}};
  const pending = subagent('active', '', {kind: 'tool_call', toolCallId: 'inner', toolName: 'run_bash_command', argumentsText: '{"command":"pwd"}'});
  const records = [
    {role: 'user', text: 'earlier'}, ...parallel,
    ...outerPair('parallel', 'parallel outer report'),
    {role: 'assistant', text: 'visible latest'}, pending
  ];
  const state = createSubagentAppendRenderState();
  rebuildSubagentAppendState(state, records, ['active']);
  const filtered = filterPendingSubagentToolCallRecords(filterParallelSubagentRecords(records, state.parallelRunIds), state);
  const projection = budget(filtered, 1, 80, DEFAULT_RENDER_PREFERENCES, undefined, 'active');
  assert.deepEqual(projection.lines, renderTranscriptLines([{role: 'assistant', text: 'visible latest'}]));
  assert.equal(projection.renderedSubagentRunIds.size, 0);
  assert.doesNotMatch(plain(projection), /task-parallel|pwd/u);

  const parallelPair = budget(filtered.slice(0, -1), 1);
  assert.match(plain(parallelPair), /parallel outer report/u);
  assert.doesNotMatch(plain(parallelPair), /report-parallel/u);
  assert.equal(parallelPair.renderedSubagentRunIds.size, 0);
});

test('unfiltered parallel identities preserve the existing noncompact outer report without creating a dependency', () => {
  const run = completedRun('parallel');
  run[0].event.parallelSize = 2;
  const pair = outerPair('parallel', 'parallel outer report');
  const projection = budget([...run, {role: 'assistant', text: 'gap'}, ...pair], 1);
  assert.deepEqual(projection.lines, renderTranscriptLines(pair));
  assert.match(plain(projection), /parallel outer report/u);
  assert.equal(projection.renderedSubagentRunIds.size, 0);
});

test('unfinished and active run interruption semantics match the full renderer', () => {
  const records = [subagent('active', 'task-active', {kind: 'start', task: 'task-active'})];
  const stopped = budget(records, 1);
  const active = budget(records, 1, 80, DEFAULT_RENDER_PREFERENCES, undefined, 'active');
  assert.deepEqual(stopped.lines, renderTranscriptLines(records));
  assert.deepEqual(active.lines, renderTranscriptLines(records, 80, undefined, undefined, true, 'active'));
  assert.match(plain(stopped), /interrupted before completion/u);
  assert.doesNotMatch(plain(active), /interrupted before completion/u);
});

test('rebuilding retains all run metadata but restores only titles that were actually projected', () => {
  const records = [
    ...completedRun('omitted'),
    subagent('pending', 'task-pending', {kind: 'start', task: 'task-pending'}),
    subagent('pending', '', {kind: 'tool_call', toolCallId: 'inner', toolName: 'grep', argumentsText: '{"pattern":"pending"}'}),
    {role: 'assistant', text: 'between'},
    ...completedRun('selected')
  ];
  const state = createSubagentAppendRenderState();
  const projection = budget(records, 1);
  rebuildSubagentAppendState(state, records, ['pending']);
  state.runIds = projection.renderedSubagentRunIds;
  assert.deepEqual([...state.runIds], ['selected']);
  assert.deepEqual([...state.parentToolCallIdsByRun.keys()], ['omitted', 'pending', 'selected']);
  assert.equal(state.localParentToolCallIds.has('outer-omitted'), true);
  assert.equal(state.terminalCallIds.has('outer-omitted'), true);
  assert.equal(state.pendingToolCalls.size, 1);

  const late = subagent('omitted', 'new visible event', {kind: 'assistant'});
  const first = stripAnsi(renderTranscriptBlocks([late], 80, undefined, undefined, false, state).join(''));
  assert.match(first, /explorer/u);
  assert.match(first, /new visible event/u);
  const continuation = stripAnsi(renderTranscriptBlocks([{...late, text: 'another visible event'}], 80, undefined, undefined, false, state).join(''));
  assert.doesNotMatch(continuation, /explorer/u);
  assert.match(continuation, /another visible event/u);
});

test('an explicitly empty title set clears stale emitted titles without discarding preserved run identity', () => {
  const state = createSubagentAppendRenderState();
  const records = completedRun('known');
  rebuildSubagentAppendState(state, records);
  assert.equal(state.runIds.has('known'), true);
  rebuildSubagentAppendState(state, records, [], true);
  state.runIds = budget([...records, {role: 'assistant', text: 'newest'}], 1).renderedSubagentRunIds;
  assert.equal(state.runIds.size, 0);
  assert.equal(state.parentToolCallIdsByRun.get('known'), 'outer-known');
  assert.equal(state.terminalCallIds.has('outer-known'), true);
  const append = stripAnsi(renderTranscriptBlocks([subagent('known', 'visible again', {kind: 'assistant'})], 80, undefined, undefined, false, state).join(''));
  assert.match(append, /explorer/u);
});
