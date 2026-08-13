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
