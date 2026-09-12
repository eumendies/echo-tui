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
  const calls = {repaint: 0};
  const resolveActivity = (runId) => (activityFor ? activityFor(runId) : activity);
  const controller = new SubagentViewController({
    getRecords: () => records,
    getActivity: resolveActivity,
    hasActiveRuns: () => records.some((record) => record.role === 'subagent' && resolveActivity(record.runId) !== null),
    repaint: () => {
      calls.repaint += 1;
    }
  });
  return {controller, calls};
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

test('SubagentViewController getViewRecords and containsRunRecords filter by the active run', () => {
  const records = [
    {role: 'user', text: 'delegate'},
    subagentRecord({kind: 'start', task: 'first'}, {runId: 'run-1'}),
    subagentRecord({kind: 'assistant'}, {runId: 'run-1'}),
    subagentRecord({kind: 'start', task: 'second'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ];
  const {controller} = createHarness({records});
  controller.toggle();
  assert.equal(controller.getActiveRunId(), 'run-2');
  assert.deepEqual(controller.getViewRecords().map((record) => record.event.kind), ['start']);
  assert.equal(controller.containsRunRecords([
    subagentRecord({kind: 'assistant'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ]), true);
  assert.equal(controller.containsRunRecords([{role: 'user', text: 'x'}]), false);
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
