const assert = require('node:assert/strict');
const {test} = require('node:test');

const {SubagentViewController} = require('../../src/app/subagent-view-controller');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {DEFAULT_TUI_THEME} = require('../../src/config/theme-config');
const {stripAnsi} = require('../../src/render/layout');

function subagentRecord(event, overrides = {}) {
  return {
    role: 'subagent',
    text: event.kind === 'start' ? event.task : '',
    agentName: 'explorer',
    parentToolCallId: 'outer-1',
    runId: 'run-1',
    event,
    ...overrides
  };
}

function createHarness({records = [], activity = null, activityFor = null} = {}) {
  const calls = {getRecords: 0, repaint: 0};
  const resolveActivity = (runId) => (activityFor ? activityFor(runId) : activity);
  const controller = new SubagentViewController({
    getRecords: () => {
      calls.getRecords += 1;
      return records;
    },
    getActivity: resolveActivity,
    hasActiveRuns: () => records.some((record) => record.role === 'subagent' && resolveActivity(record.runId) !== null),
    repaint: () => {
      calls.repaint += 1;
    }
  });
  return {
    controller,
    calls,
    appendRecords: (batch) => {
      records.push(...batch);
      return controller.appendRecords(batch);
    }
  };
}

function renderBase(width = 100) {
  return {
    composer: {}, commandSurface: null, pending: null, working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'main'}, mode: 'idle'},
    theme: DEFAULT_TUI_THEME,
    width
  };
}

test('SubagentViewController toggle opens on the latest run and closes on the second toggle', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'}),
    subagentRecord({kind: 'completed', durationMs: 5}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'second', parallelSize: 2}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const {controller, calls} = createHarness({records});

  controller.toggle();
  assert.equal(controller.isActive(), true);
  assert.equal(controller.getActiveRunId(), 'run-2');
  assert.equal(calls.repaint, 1);

  controller.toggle();
  assert.equal(controller.isActive(), false);
  assert.equal(calls.repaint, 2);
});

test('SubagentViewController toggle is a no-op without subagent records', () => {
  const {controller, calls} = createHarness({records: [{role: 'user', text: 'hi'}]});
  controller.toggle();
  assert.equal(controller.isActive(), false);
  assert.equal(calls.repaint, 0);
});

test('SubagentViewController cycles runs with wrap-around and repaints', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'second'}, {runId: 'run-2', parentToolCallId: 'outer-2'}),
    subagentRecord({kind: 'start', task: 'third'}, {runId: 'run-3', parentToolCallId: 'outer-3'})
  ];
  const {controller, calls} = createHarness({records});
  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-3');

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-2');
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-1');
  // 首个 run 再向上循环到最后一个
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-3');
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_DOWN}), true);
  assert.equal(controller.getActiveRunId(), 'run-1');
  assert.equal(calls.repaint, 5); // 打开 + 四次切换
});

test('SubagentViewController swallows read-only input, releases EXIT, and closes on Esc', () => {
  const records = [subagentRecord({kind: 'start', task: 'first'})];
  const {controller, calls} = createHarness({records});
  controller.toggle();

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.TEXT, value: 'x'}), true);
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.SUBMIT}), true);
  assert.equal(controller.isActive(), true);
  assert.equal(calls.repaint, 1);

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.EXIT}), false);

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.ESCAPE}), true);
  assert.equal(controller.isActive(), false);
  assert.equal(calls.repaint, 2);

  // 关闭后不再消费任何输入
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.ESCAPE}), false);
});

test('SubagentViewController closes the open window on Ctrl+O', () => {
  const records = [subagentRecord({kind: 'start', task: 'first'})];
  const {controller} = createHarness({records});
  controller.toggle();
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.OPEN_SUBAGENT_VIEW}), true);
  assert.equal(controller.isActive(), false);
});

test('SubagentViewController projects a positioned status line with a live draft tail', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'first investigation'}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'second investigation', parallelSize: 2}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const activity = {
    kind: 'subagent',
    agentName: 'explorer',
    elapsedMs: 4200,
    phase: 'tool',
    runId: 'run-2',
    task: 'second investigation',
    model: 'live-child-model',
    reasoningEffort: 'high',
    toolName: 'grep',
    draft: 'partial grep output'
  };
  const {controller} = createHarness({records, activityFor: (runId) => (runId === 'run-2'
    ? activity
    : {kind: 'subagent', agentName: 'explorer', elapsedMs: 800, phase: 'thinking', runId, task: 'first investigation'})});
  controller.toggle();

  const state = controller.createRenderState({
    composer: {},
    commandSurface: null,
    pending: {kind: 'thinking', elapsedMs: 1},
    working: {elapsedMs: 9},
    statusLine: {projectName: 'echo', model: {kind: 'default', label: 'gpt'}, mode: 'streaming', detail: 'streaming'},
    width: 100
  });
  assert.equal(state.pending.kind, 'subagent');
  assert.equal(state.pending.runId, 'run-2');
  assert.equal(state.pending.draft, 'partial grep output');
  assert.equal(state.statusLine.mode, 'subagent_view');
  assert.deepEqual(state.statusLine.model, {kind: 'default', label: 'live-child-model', effort: 'high'});
  assert.equal(state.statusLine.detail, 'subagent 2/2 · explorer · second investigation · tool · grep · 4.2s');
  assert.equal(state.statusLine.keyHint, '↑/↓ 切换 · Ctrl+O/Esc 返回');
});

test('SubagentViewController marks ended runs and drops the draft tail', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'}),
    subagentRecord({kind: 'completed', durationMs: 5}, {runId: 'run-1'})
  ];
  const {controller} = createHarness({records, activityFor: () => null});
  controller.toggle();

  const state = controller.createRenderState({
    composer: {},
    commandSurface: null,
    pending: null,
    working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'},
    width: 100
  });
  assert.equal(state.pending, null);
  assert.match(state.statusLine.detail, /· 已结束$/u);
  assert.equal(controller.hasTimedActivity(), false);
});

test('SubagentViewController keeps modal surfaces visible by dropping the view status line', () => {
  const records = [subagentRecord({kind: 'start', task: 'first'})];
  const {controller} = createHarness({records});
  controller.toggle();

  const state = controller.createRenderState({
    composer: {},
    commandSurface: {kind: 'info', title: 'approval', lines: []},
    pending: null,
    working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'},
    width: 100
  });
  assert.equal(state.statusLine, undefined);
});

test('SubagentViewController getViewRecords and appendRecords filter by the active run', () => {
  const records = [
    {role: 'user', text: 'delegate'},
    subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'}),
    subagentRecord({kind: 'assistant'}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'second'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const {controller, appendRecords} = createHarness({records});
  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-2');
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start']);
  assert.equal(appendRecords([
    subagentRecord({kind: 'assistant'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ]), true);
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start', 'assistant']);
  assert.equal(appendRecords([{role: 'user', text: 'x'}]), false);
});

test('SubagentViewController hasTimedActivity tracks any active run while the window is open', () => {
  const records = [subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'})];
  let activity = {kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'thinking', runId: 'run-1', task: 'first'};
  const {controller} = createHarness({records, activityFor: () => activity});

  // 窗口未打开时计时钩子保持安静
  assert.equal(controller.hasTimedActivity(), false);
  controller.toggle();
  assert.equal(controller.hasTimedActivity(), true);
  activity = null;
  assert.equal(controller.hasTimedActivity(), false);
});

test('SubagentViewController hasTimedActivity keeps triggering for unwatched active runs', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'old'}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    subagentRecord({kind: 'completed', durationMs: 5}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    subagentRecord({kind: 'start', task: 'live'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const activities = {
    'run-1': {kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'thinking', runId: 'run-1', task: 'old'}
  };
  const {controller} = createHarness({records, activityFor: (runId) => activities[runId] ?? null});
  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-1');
  assert.equal(controller.hasTimedActivity(), true);

  // 观看中的 run 结束，但未观看的 run-2 仍在活动 → 索引行计时仍需 timer 驱动
  delete activities['run-1'];
  activities['run-2'] = {kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'thinking', runId: 'run-2', task: 'live'};
  assert.equal(controller.hasTimedActivity(), true);

  // 全部 run 结束后钩子静止
  delete activities['run-2'];
  assert.equal(controller.hasTimedActivity(), false);
});

test('SubagentViewController flattens multi-line tasks in the view status line', () => {
  const records = [subagentRecord({kind: 'start', task: '第一行\n请回答：x'}, {runId: 'run-1'})];
  const {controller} = createHarness({records, activityFor: () => null});
  controller.toggle();

  const state = controller.createRenderState({
    composer: {},
    commandSurface: null,
    pending: null,
    working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'},
    width: 100
  });

  assert.ok(!state.statusLine.detail.includes('\n'));
  assert.match(state.statusLine.detail, /第一行 请回答：x · 已结束/u);
});

test('SubagentViewController opens on the most recent active run, not a later finished one', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'live one'}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'finished early'}, {runId: 'run-2', parentToolCallId: 'outer-2'}),
    subagentRecord({kind: 'completed', durationMs: 5}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const {controller} = createHarness({
    records,
    activityFor: (runId) => (runId === 'run-1' ? {kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'thinking', runId, task: 'live one'} : null)
  });

  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-1');
});

test('SubagentViewController cycles all runs including finished ones while watching', () => {
  const records = [
    subagentRecord({kind: 'start', task: 'old'}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    subagentRecord({kind: 'completed', durationMs: 5}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    subagentRecord({kind: 'start', task: 'live one'}, {runId: 'run-2', parentToolCallId: 'outer-2'}),
    subagentRecord({kind: 'start', task: 'live two'}, {runId: 'run-3', parentToolCallId: 'outer-3'})
  ];
  const live = new Set(['run-2', 'run-3']);
  const {controller} = createHarness({
    records,
    activityFor: (runId) => (live.has(runId) ? {kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'thinking', runId, task: ''} : null)
  });

  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-3');

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-2');
  const state = controller.createRenderState({
    composer: {}, commandSurface: null, pending: null, working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'}, width: 100
  });
  assert.match(state.statusLine.detail, /^subagent 2\/3 · /u);

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-1'); // 活跃 run 仍存在时也可落入已结束的 run-1
  const finishedState = controller.createRenderState({
    composer: {}, commandSurface: null, pending: null, working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'}, width: 100
  });
  assert.match(finishedState.statusLine.detail, /^subagent 1\/3 · /u);
  assert.match(finishedState.statusLine.detail, /已结束/u);

  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-3');
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), true);
  assert.equal(controller.getActiveRunId(), 'run-2');
});

test('SubagentViewController exposes the run index below the composer in createRenderState', () => {
  const records = [
    subagentRecord({kind: 'start', task: '旧任务'}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    subagentRecord({kind: 'completed', durationMs: 4000}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    subagentRecord({kind: 'start', task: '新任务'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const {controller} = createHarness({
    records,
    activityFor: (runId) => (runId === 'run-2' ? {kind: 'subagent', agentName: 'explorer', elapsedMs: 1500, phase: 'tool', runId, task: '新任务', toolName: 'grep'} : null)
  });
  controller.toggle();

  const base = {
    composer: {}, commandSurface: null, pending: null, working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'}, width: 100
  };

  const lines = (controller.createRenderState(base).viewIndexLines ?? []).map(stripAnsi);

  assert.equal(lines.length, 4); // 索引标题 + 2 行清单 + 尾部空行
  assert.match(lines[0], /◆ subagent 会话 · 运行中 1 · 共 2 个 · ↑\/↓ 切换/u);
  assert.match(lines[1], /1\. explorer · 旧任务 · 已结束 · 4\.0s/u);
  assert.match(lines[2], /▸ 2\. explorer · 新任务 · tool · grep · 1\.5s/u);

  // 命令 surface 浮层激活时，索引与状态行一起隐藏
  const suppressed = controller.createRenderState({...base, commandSurface: {kind: 'info', title: 't', lines: [], dismissHint: 'esc'}});
  assert.equal(suppressed.viewIndexLines, undefined);
});

test('SubagentViewController falls back to the main session model when the run has no model facts', () => {
  const records = [
    subagentRecord({kind: 'start', task: '新任务'}, {runId: 'run-1', parentToolCallId: 'outer-1'})
  ];
  const {controller} = createHarness({
    records,
    activityFor: (runId) => (runId === 'run-1' ? {kind: 'subagent', agentName: 'explorer', elapsedMs: 10, phase: 'thinking', runId, task: '新任务'} : null)
  });
  controller.toggle();

  const base = {
    composer: {}, commandSurface: null, pending: null, working: null,
    statusLine: {projectName: 'p', model: {kind: 'default', label: 'm'}, mode: 'idle'}, width: 100
  };

  // activity 与 start record 均无模型事实 → 状态行回退主会话模型且不显示 effort 段
  assert.deepEqual(controller.createRenderState(base).statusLine.model, {kind: 'default', label: 'm'});
});

test('SubagentViewController reads full history only once across footer, timer, destructive and resize projections', () => {
  const records = [
    {role: 'user', text: 'main history'},
    subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'second'}, {runId: 'run-2'})
  ];
  const activity = {agentName: 'explorer', elapsedMs: 10, phase: 'thinking', task: 'live'};
  const {controller, calls, appendRecords} = createHarness({records, activity});
  assert.equal(controller.appendRecords(records), false);
  assert.equal(calls.getRecords, 0);
  controller.toggle();
  assert.equal(calls.getRecords, 1);

  for (let index = 0; index < 10; index += 1) {
    activity.elapsedMs += 100;
    assert.equal(controller.hasTimedActivity(), true);
    controller.createRenderState(renderBase(index % 2 === 0 ? 80 : 120));
    assert.equal(controller.getViewRecords().length, 1);
    controller.handleEvent({type: INPUT_EVENTS.MOVE_UP});
    controller.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  }
  assert.equal(appendRecords([{role: 'assistant', text: 'main only'}]), false);
  assert.equal(calls.getRecords, 1);
  assert.equal(controller.getActiveRunId(), 'run-2');
});

test('SubagentViewController ingests new runs and unwatched body and terminal events without replaying history', () => {
  const records = [subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'})];
  const activities = {'run-1': {agentName: 'explorer', elapsedMs: 10, phase: 'thinking', task: 'first'}};
  const {controller, calls, appendRecords} = createHarness({records, activityFor: (runId) => activities[runId] ?? null});
  controller.toggle();

  assert.equal(appendRecords([
    {role: 'assistant', text: 'main only'},
    subagentRecord({kind: 'start', task: 'second', model: 'child-model', reasoningEffort: 'high'}, {runId: 'run-2'}),
    subagentRecord({kind: 'assistant'}, {runId: 'run-2', text: 'unwatched body'}),
    subagentRecord({kind: 'failed', durationMs: 2000}, {runId: 'run-2'}),
    subagentRecord({kind: 'start', task: 'third'}, {runId: 'run-3'}),
    subagentRecord({kind: 'cancelled', durationMs: 3000}, {runId: 'run-3'})
  ]), false);
  assert.equal(controller.getActiveRunId(), 'run-1');
  assert.deepEqual(controller.getViewRecords(), [records[0]]);
  const index = controller.createRenderState(renderBase()).viewIndexLines.map(stripAnsi).join('\n');
  assert.match(index, /共 3 个/u);
  assert.match(index, /second · 失败 · 2\.0s/u);
  assert.match(index, /third · 已取消 · 3\.0s/u);

  delete activities['run-1'];
  assert.equal(appendRecords([
    subagentRecord({kind: 'assistant'}, {text: 'current body'}),
    subagentRecord({kind: 'completed', durationMs: 4000})
  ]), true);
  const ended = controller.createRenderState(renderBase());
  assert.equal(ended.pending, null);
  assert.match(ended.statusLine.detail, /已结束/u);
  assert.match(ended.viewIndexLines.map(stripAnsi).join('\n'), /first · 已结束 · 4\.0s/u);
  assert.equal(controller.hasTimedActivity(), false);
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start', 'assistant', 'completed']);

  controller.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(controller.getActiveRunId(), 'run-2');
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start', 'assistant', 'failed']);
  assert.equal(controller.getViewRecords()[1].text, 'unwatched body');
  assert.deepEqual(controller.createRenderState(renderBase()).statusLine.model, {kind: 'default', label: 'child-model', effort: 'high'});
  controller.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  assert.equal(controller.getActiveRunId(), 'run-3');
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start', 'cancelled']);
  assert.equal(calls.getRecords, 1);
});

test('SubagentViewController drops its cache on every close path and reads the latest journal when reopened', () => {
  for (const close of [
    (controller) => controller.close(),
    (controller) => controller.toggle(),
    (controller) => controller.handleEvent({type: INPUT_EVENTS.ESCAPE}),
    (controller) => controller.handleEvent({type: INPUT_EVENTS.OPEN_SUBAGENT_VIEW})
  ]) {
    const records = [
      subagentRecord({kind: 'start', task: 'old', model: 'old-model', reasoningEffort: 'low'}),
      subagentRecord({kind: 'completed', durationMs: 1000})
    ];
    const {controller, calls, appendRecords} = createHarness({records});
    controller.toggle();
    assert.equal(controller.getViewRecords().length, 2);
    close(controller);
    assert.equal(controller.isActive(), false);
    assert.deepEqual(controller.getViewRecords(), []);
    assert.equal(controller.createRenderState(renderBase()).viewIndexLines, undefined);
    assert.equal(appendRecords([
      subagentRecord({kind: 'start', task: 'new'}, {runId: 'run-2'}),
      subagentRecord({kind: 'failed', durationMs: 2000}, {runId: 'run-2'})
    ]), false);
    controller.toggle();
    assert.equal(controller.getActiveRunId(), 'run-2');
    assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start', 'failed']);
    controller.handleEvent({type: INPUT_EVENTS.MOVE_UP});
    assert.equal(controller.getActiveRunId(), 'run-1');
    assert.equal(controller.getViewRecords().length, 2);
    const state = controller.createRenderState(renderBase());
    assert.deepEqual(state.statusLine.model, {kind: 'default', label: 'old-model', effort: 'low'});
    assert.match(state.viewIndexLines.map(stripAnsi).join('\n'), /old · 已结束 · 1\.0s/u);
    assert.equal(calls.getRecords, 2);

    // 模拟清空或切换会话后重新打开，旧 run 不应留在窗口缓存中。
    controller.close();
    records.splice(0, records.length, subagentRecord({kind: 'start', task: 'replacement'}, {runId: 'run-3'}));
    controller.toggle();
    assert.equal(controller.getActiveRunId(), 'run-3');
    assert.match(controller.createRenderState(renderBase()).statusLine.detail, /^subagent 1\/1 /u);
    assert.equal(calls.getRecords, 3);
  }
});

test('SubagentViewController leaves an empty view uncached and ignores batches until explicitly opened', () => {
  const records = [{role: 'user', text: 'not a subagent'}];
  const {controller, calls, appendRecords} = createHarness({records});
  controller.toggle();
  assert.equal(controller.isActive(), false);
  assert.deepEqual(controller.getViewRecords(), []);
  assert.equal(controller.createRenderState(renderBase()).statusLine.mode, 'idle');
  assert.equal(calls.repaint, 0);
  assert.equal(calls.getRecords, 1);
  assert.equal(appendRecords([subagentRecord({kind: 'start', task: 'while closed'})]), false);
  assert.deepEqual(controller.getViewRecords(), []);

  // 新记录被 journal 移除后，空视图不能通过之前忽略的批次发现旧 run。
  records.splice(0, records.length);
  controller.toggle();
  assert.equal(controller.isActive(), false);
  assert.equal(calls.getRecords, 2);
  assert.equal(appendRecords([subagentRecord({kind: 'start', task: 'latest'}, {runId: 'run-2'})]), false);
  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-2');
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start']);
  assert.equal(calls.getRecords, 3);
});

test('SubagentViewController stays closed and unrendered when complete history is unavailable', () => {
  const calls = {repaint: 0};
  const controller = new SubagentViewController({
    getRecords: () => null,
    getActivity: () => null,
    hasActiveRuns: () => false,
    repaint: () => { calls.repaint += 1; }
  });

  controller.toggle();
  assert.equal(controller.isActive(), false);
  assert.equal(controller.getActiveRunId(), null);
  assert.deepEqual(controller.getViewRecords(), []);
  assert.equal(calls.repaint, 0);
  // 窗口未打开时输入仍交还上层路由。
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.MOVE_UP}), false);
});
