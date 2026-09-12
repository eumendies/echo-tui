const assert = require('node:assert/strict');
const {test} = require('node:test');

const {SubagentRunContext} = require('../../src/app/state/subagent-run-context');
const {ToolApprovalContext} = require('../../src/app/state/tool-approval-context');
const {INPUT_EVENTS} = require('../../src/input/event-types');

function createRecord(event, overrides = {}) {
  return {
    role: 'subagent',
    text: event.kind === 'start' ? event.task : event.kind === 'completed' ? '' : event.kind,
    agentName: 'explorer',
    parentToolCallId: 'outer-1',
    runId: 'run-1',
    event,
    ...overrides
  };
}

test('SubagentRunContext tracks phases without accepting callbacks from another run', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([createRecord({kind: 'start', task: 'inspect files'})]), true);
  assert.equal(context.hasTimedActivity(), true);
  assert.equal(context.updateActivity({
    agentName: 'explorer',
    phase: 'tool',
    runId: 'run-1',
    task: 'inspect files',
    toolName: 'grep',
    argumentsText: '{"pattern":"needle"}'
  }), true);
  assert.deepEqual({...context.getPending(), elapsedMs: 0}, {
    kind: 'subagent',
    agentName: 'explorer',
    elapsedMs: 0,
    phase: 'tool',
    runId: 'run-1',
    task: 'inspect files',
    toolName: 'grep',
    argumentsText: '{"pattern":"needle"}'
  });

  assert.equal(context.updateActivity({agentName: 'explorer', phase: 'streaming', runId: 'late-run', task: 'late'}), false);
  assert.equal(context.getPending().runId, 'run-1');
  assert.equal(context.acceptRecords([createRecord({kind: 'completed', durationMs: 20})]), true);
  assert.equal(context.getPending(), null);
  assert.equal(context.hasTimedActivity(), false);
});

test('SubagentRunContext projects Worker waiting-question activity with the current run identity', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([createRecord({kind: 'start', task: 'implement feature'}, {agentName: 'worker'})]), true);
  assert.equal(context.updateActivity({
    agentName: 'worker', phase: 'waiting_question', runId: 'run-1', task: 'implement feature',
    toolName: 'ask_user_questions', argumentsText: '{"questions":[]}'
  }), true);
  assert.equal(context.getPending().agentName, 'worker');
  assert.equal(context.getPending().phase, 'waiting_question');
  assert.equal(context.isCurrentRun('run-1'), true);
});

test('SubagentRunContext keeps custom footer identity and replaces malformed names', () => {
  const context = new SubagentRunContext();
  context.acceptRecords([createRecord({kind: 'start', task: 'review'}, {agentName: 'security-reviewer'})]);
  assert.equal(context.getPending().agentName, 'security-reviewer');
  context.updateActivity({agentName: 'safe\u001b[31m\nINJECTED', phase: 'thinking', runId: 'run-1', task: 'review'});
  assert.equal(context.getPending().agentName, 'Subagent');
});

test('SubagentRunContext applies stable tool and message boundaries before footer rendering', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([createRecord({kind: 'start', task: 'inspect files'})]), true);
  assert.equal(context.acceptRecords([createRecord({
    kind: 'tool_call', toolCallId: 'inner-1', toolName: 'grep', argumentsText: '{"pattern":"needle"}'
  })]), true);
  assert.equal(context.getPending().phase, 'tool');
  assert.equal(context.getPending().toolName, 'grep');

  assert.equal(context.acceptRecords([createRecord({
    kind: 'tool_result', toolCallId: 'inner-1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}
  })]), true);
  assert.equal(context.getPending().phase, 'thinking');
  assert.equal(context.getPending().toolName, undefined);

  context.updateActivity({agentName: 'explorer', phase: 'streaming', runId: 'run-1', task: 'inspect files', draft: 'report'});
  assert.equal(context.acceptRecords([createRecord({kind: 'assistant'})]), true);
  assert.equal(context.getPending().phase, 'thinking');
  assert.equal(context.getPending().draft, undefined);
});

test('SubagentRunContext hides cancelled parent activity but accepts the matching terminal record once', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([createRecord({kind: 'start', task: 'inspect files'})]), true);

  context.markParentCancelled();
  assert.equal(context.getPending(), null);
  assert.equal(context.hasTimedActivity(), false);
  assert.equal(context.isCurrentRun('run-1'), false);
  assert.equal(context.updateActivity({agentName: 'explorer', phase: 'thinking', runId: 'run-1', task: 'inspect files'}), false);
  assert.equal(context.acceptRecords([createRecord({kind: 'cancelled', durationMs: 20})]), true);
  assert.equal(context.acceptRecords([createRecord({kind: 'cancelled', durationMs: 21})]), false);
});

test('SubagentRunContext switches to the plural compact form while a parallel run is active', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([
    createRecord({kind: 'start', task: 'first', parallelSize: 2}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    createRecord({kind: 'start', task: 'second', parallelSize: 2}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ]), true);

  const pending = context.getPending();
  assert.equal(pending.kind, 'subagents');
  assert.deepEqual(pending.runs.map((run) => [run.runId, run.task, run.phase]), [
    ['run-1', 'first', 'thinking'],
    ['run-2', 'second', 'thinking']
  ]);

  // 并行 run 单独活跃时仍保持 plural 形态，过程记录不回主 rail
  assert.equal(context.acceptRecords([createRecord({kind: 'completed', durationMs: 5}, {runId: 'run-1'})]), true);
  assert.equal(context.getPending().kind, 'subagents');
  assert.equal(context.getPending().runs.length, 1);

  // 单委派保持 singular
  const single = new SubagentRunContext();
  single.acceptRecords([createRecord({kind: 'start', task: 'solo'}, {runId: 'run-9'})]);
  assert.equal(single.getPending().kind, 'subagent');
});

test('SubagentRunContext tracks concurrent runs independently and keeps late runs isolated', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([
    createRecord({kind: 'start', task: 'first'}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    createRecord({kind: 'start', task: 'second'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ]), true);
  assert.equal(context.isCurrentRun('run-1'), true);
  assert.equal(context.isCurrentRun('run-2'), true);
  assert.equal(context.hasTimedActivity(), true);

  assert.equal(context.acceptRecords([
    createRecord({kind: 'tool_call', toolCallId: 'inner-1', toolName: 'grep', argumentsText: '{}'}, {runId: 'run-1'})
  ]), true);
  assert.equal(context.acceptRecords([
    createRecord({kind: 'tool_result', toolCallId: 'inner-1', toolName: 'grep', ok: true, details: {kind: 'grep', truncated: false}}, {runId: 'run-1'})
  ]), true);

  // run-1 终态只删除自己的条目，不影响 run-2
  assert.equal(context.acceptRecords([createRecord({kind: 'completed', durationMs: 10}, {runId: 'run-1'})]), true);
  assert.equal(context.isCurrentRun('run-1'), false);
  assert.equal(context.isCurrentRun('run-2'), true);
  assert.equal(context.hasTimedActivity(), true);
  assert.equal(context.getPending().runId, 'run-2');

  // 迟到 runId 的活动与记录仍整体拒绝
  assert.equal(context.updateActivity({agentName: 'explorer', phase: 'thinking', runId: 'run-1', task: 'late'}), false);
  assert.equal(context.acceptRecords([createRecord({kind: 'assistant'}, {runId: 'run-1'})]), false);
});

test('SubagentRunContext accepts one cancelled terminal per parent-cancelled run', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([
    createRecord({kind: 'start', task: 'first'}, {runId: 'run-1', parentToolCallId: 'outer-1'}),
    createRecord({kind: 'start', task: 'second'}, {runId: 'run-2', parentToolCallId: 'outer-2'})
  ]), true);

  context.markParentCancelled();
  assert.equal(context.getPending(), null);
  assert.equal(context.hasTimedActivity(), false);
  assert.equal(context.acceptRecords([createRecord({kind: 'cancelled', durationMs: 5}, {runId: 'run-1'})]), true);
  assert.equal(context.acceptRecords([createRecord({kind: 'cancelled', durationMs: 6}, {runId: 'run-2'})]), true);
  assert.equal(context.acceptRecords([createRecord({kind: 'cancelled', durationMs: 7}, {runId: 'run-2'})]), false);
});

test('explorer permission reuses allow-all session grants without opening a surface', () => {
  const context = new ToolApprovalContext(() => {});
  context.allowAllForSession = true;
  const call = {
    callId: 'inner-bash',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({command: 'node inspect.js'})
  };
  const decision = context.request(call, {
    preview: 'node inspect.js',
    previewTitle: 'explorer bash',
    origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-1'}
  });

  assert.deepEqual(decision, {kind: 'allow_all_for_session'});
  assert.equal(context.getSurface(), null);
  assert.equal(context.allowAllForSession, true);
});

test('explorer permission can cache and reuse the same Bash command grant as primary approval', async () => {
  const context = new ToolApprovalContext(() => {});
  const call = {
    callId: 'inner-bash-feedback',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({command: 'node inspect.js'})
  };
  const decision = context.request(call, {
    preview: 'node inspect.js',
    origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-1'}
  });
  const surface = context.getSurface();

  assert.equal(surface.title, 'PERMISSION · EXPLORER');
  assert.deepEqual(surface.options.map((option) => option.label), [
    'Allow once',
    'Allow this command for this session',
    'Allow all tools for this session',
    'Deny',
    'Tell model what to do'
  ]);
  context.handleEvent({type: INPUT_EVENTS.MOVE_DOWN});
  context.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.equal(context.hasActiveRequest(), false);

  assert.deepEqual(await decision, {
    kind: 'allow_command_for_session',
    toolName: 'run_bash_command',
    command: 'node inspect.js'
  });
  assert.deepEqual(context.request({...call, callId: 'primary-bash-later'}), {
    kind: 'allow_command_for_session',
    toolName: 'run_bash_command',
    command: 'node inspect.js'
  });
  assert.equal(context.getSurface(), null);
});

test('custom and malformed subagent permission titles use safe directory identities', () => {
  const call = {callId: 'custom-approval', toolName: 'apply_patch', argumentsText: '{}'};
  const custom = new ToolApprovalContext(() => {});
  custom.request(call, {origin: {kind: 'subagent', agentName: 'security-reviewer', runId: 'custom-run'}});
  assert.equal(custom.getSurface().title, 'PERMISSION · security-reviewer');

  const malformed = new ToolApprovalContext(() => {});
  malformed.request(call, {origin: {kind: 'subagent', agentName: 'safe\u001b[31m\nINJECTED', runId: 'bad-run'}});
  assert.equal(malformed.getSurface().title, 'PERMISSION · Subagent');
});

test('tool approval queues concurrent subagent requests and promotes them in FIFO order', async () => {
  const context = new ToolApprovalContext(() => {});
  const callA = {callId: 'bash-a', toolName: 'run_bash_command', argumentsText: JSON.stringify({command: 'node a.js'})};
  const callB = {callId: 'bash-b', toolName: 'run_bash_command', argumentsText: JSON.stringify({command: 'node b.js'})};
  const decisionA = context.request(callA, {preview: 'node a.js', origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-1'}});
  const decisionB = context.request(callB, {preview: 'node b.js', origin: {kind: 'subagent', agentName: 'explorer', runId: 'run-2'}});

  // 第一个请求打开 surface，第二个排队等待而不抢占
  assert.equal(context.getSurface().message, 'node a.js');
  context.handleEvent({type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(await decisionA, {kind: 'allow_once'});

  // 第一个决议后第二个自动提升
  assert.equal(context.hasActiveRequest(), true);
  assert.equal(context.getSurface().message, 'node b.js');
  context.handleEvent({type: INPUT_EVENTS.ESCAPE});
  assert.deepEqual(await decisionB, {kind: 'deny'});
  assert.equal(context.hasActiveRequest(), false);
  assert.equal(context.getSurface(), null);
});

test('tool approval resolves all active and queued requests on cancellation', async () => {
  const context = new ToolApprovalContext(() => {});
  const decisionA = context.request({callId: 'a', toolName: 'apply_patch', argumentsText: '{}'}, {preview: 'patch a'});
  const decisionB = context.request({callId: 'b', toolName: 'apply_patch', argumentsText: '{}'}, {preview: 'patch b'});

  context.cancelAllPending();

  assert.deepEqual(await decisionA, {kind: 'deny', message: 'Tool execution was interrupted.'});
  assert.deepEqual(await decisionB, {kind: 'deny', message: 'Tool execution was interrupted.'});
  assert.equal(context.hasActiveRequest(), false);
  assert.equal(context.getSurface(), null);

  // 无待处理请求时清算为无操作
  context.cancelAllPending();
  assert.equal(context.hasActiveRequest(), false);
});

test('SubagentRunContext getActivity exposes per-run snapshots and clears on terminal', () => {
  const context = new SubagentRunContext();
  assert.equal(context.getActivity('run-1'), null);
  assert.equal(context.acceptRecords([createRecord({kind: 'start', task: 'investigate', parallelSize: 2}, {runId: 'run-1', agentName: 'explorer'})]), true);
  const activity = context.getActivity('run-1');
  assert.equal(activity.kind, 'subagent');
  assert.equal(activity.task, 'investigate');
  assert.equal(activity.agentName, 'explorer');
  assert.equal(context.acceptRecords([createRecord({kind: 'completed', durationMs: 5}, {runId: 'run-1'})]), true);
  assert.equal(context.getActivity('run-1'), null);
});

test('SubagentRunContext exposes start record model facts through activity snapshots', () => {
  const context = new SubagentRunContext();
  assert.equal(context.acceptRecords([createRecord({kind: 'start', task: 'inspect', model: 'qwen-max', reasoningEffort: 'high'})]), true);
  assert.deepEqual({...context.getActivity('run-1'), elapsedMs: 0}, {
    kind: 'subagent',
    agentName: 'explorer',
    elapsedMs: 0,
    phase: 'thinking',
    runId: 'run-1',
    task: 'inspect',
    model: 'qwen-max',
    reasoningEffort: 'high'
  });

  // 后续瞬时活动更新不覆盖 start record 携带的模型事实
  assert.equal(context.updateActivity({agentName: 'explorer', phase: 'tool', runId: 'run-1', task: 'inspect', toolName: 'grep'}), true);
  assert.equal(context.getPending().model, 'qwen-max');
  assert.equal(context.getPending().reasoningEffort, 'high');
});
