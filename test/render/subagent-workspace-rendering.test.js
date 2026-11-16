const assert = require('node:assert/strict');
const {test} = require('node:test');

const {createTuiTheme} = require('../../src/config/theme-config');
const {stripAnsi} = require('../../src/render/layout');
const {renderSubagentRunBlock} = require('../../src/render/subagent-renderer');
const {renderRunSubagentCompactPairLines} = require('../../src/render/tool-message-renderers/run-subagent');

const BASE = {role: 'subagent', agentName: 'worker', parentToolCallId: 'outer-1', runId: 'run-1'};

function subagentRecord(text, event) {
  return {...BASE, text, event};
}

function renderText(records, width = 100) {
  return stripAnsi(renderSubagentRunBlock(records, width, createTuiTheme('default')));
}

test('a managed worker rail shows the frozen baseline and workspace path', () => {
  const text = renderText([
    subagentRecord('implement the change', {
      kind: 'start',
      task: 'implement the change',
      workspace: {
        baseCommit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        execCwd: '/managed/ws-1/worktree/packages/app',
        mode: 'managed_worktree',
        owner: {projectCwd: '/repo', sessionId: 'session-1'},
        workspaceRoot: '/managed/ws-1/worktree'
      }
    }),
    subagentRecord('', {kind: 'completed', durationMs: 1200})
  ]);

  assert.match(text, /managed worktree · base a1b2c3d4e5f6/u);
  assert.match(text, /\/managed\/ws-1\/worktree/u);
  assert.match(text, /completed/u);
});

test('a shared-directory worker states that it writes the parent workspace directly', () => {
  const text = renderText([
    subagentRecord('implement the change', {
      kind: 'start',
      task: 'implement the change',
      workspace: {mode: 'shared_cwd', owner: {projectCwd: '/repo'}}
    }),
    subagentRecord('', {kind: 'completed', durationMs: 10})
  ]);

  assert.match(text, /shared directory · changes go directly to the parent workspace/u);
  assert.doesNotMatch(text, /managed worktree/u);
});

test('the terminal rail keeps the workspace location and never claims integration', () => {
  const text = renderText([
    subagentRecord('implement the change', {
      kind: 'start',
      task: 'implement the change',
      workspace: {
        baseCommit: 'a'.repeat(40),
        execCwd: '/managed/ws-1/worktree',
        mode: 'managed_worktree',
        owner: {projectCwd: '/repo'},
        workspaceRoot: '/managed/ws-1/worktree'
      }
    }),
    subagentRecord('', {
      kind: 'completed',
      durationMs: 900,
      workspace: {retained: true, workspaceRoot: '/managed/ws-1/worktree'}
    })
  ]);

  assert.match(text, /workspace retained · not integrated/u);
  assert.match(text, /\/managed\/ws-1\/worktree/u);
});

test('a failed run still points at the retained workspace', () => {
  const text = renderText([
    subagentRecord('x', {kind: 'start', task: 'x', workspace: {mode: 'managed_worktree', owner: {projectCwd: '/repo'}}}),
    subagentRecord('', {
      kind: 'failed',
      durationMs: 5,
      workspace: {retained: true, workspaceRoot: '/managed/ws-1/worktree'}
    })
  ]);

  assert.match(text, /workspace retained · not integrated/u);
  assert.match(text, /\/managed\/ws-1\/worktree/u);
});

test('legacy records without workspace facts keep their original projection', () => {
  const text = renderText([
    subagentRecord('legacy task', {kind: 'start', task: 'legacy task'}),
    subagentRecord('', {kind: 'completed', durationMs: 10})
  ]);

  // 不凭空推断历史运行曾使用 worktree。
  assert.doesNotMatch(text, /managed worktree|shared directory|workspace retained/u);
  assert.match(text, /legacy task/u);
});

test('an incomplete managed run reports unconfirmed state instead of a confirmed interruption', () => {
  const text = renderText([
    subagentRecord('implement the change', {
      kind: 'start',
      task: 'implement the change',
      workspace: {
        baseCommit: 'b'.repeat(40),
        mode: 'managed_worktree',
        owner: {projectCwd: '/repo', sessionId: 'session-1'},
        workspaceRoot: '/managed/ws-9/worktree'
      }
    })
  ]);

  const interrupted = stripAnsi(renderSubagentRunBlock([
    subagentRecord('implement the change', {kind: 'start', task: 'implement the change', workspace: {
      baseCommit: 'b'.repeat(40),
      mode: 'managed_worktree',
      owner: {projectCwd: '/repo', sessionId: 'session-1'},
      workspaceRoot: '/managed/ws-9/worktree'
    }})
  ], 100, createTuiTheme('default'), true));

  // 有工作区事实时不能只凭缺终态判定已中断。
  assert.match(interrupted, /state unconfirmed/u);
  assert.match(interrupted, /may still be active/u);
  assert.doesNotMatch(interrupted, /interrupted before completion/u);
  assert.doesNotMatch(text, /state unconfirmed/u);
});

test('an incomplete legacy run keeps the confirmed-interruption wording', () => {
  const text = stripAnsi(renderSubagentRunBlock([
    subagentRecord('legacy task', {kind: 'start', task: 'legacy task'})
  ], 100, createTuiTheme('default'), true));

  assert.match(text, /interrupted before completion/u);
});

test('the compact run_subagent projection keeps the only workspace entry', () => {
  const call = {
    role: 'tool_call',
    text: 'run_subagent',
    toolCallId: 'outer-1',
    toolName: 'run_subagent',
    argumentsText: JSON.stringify({agent: 'worker', task: 'implement'})
  };
  const result = {
    role: 'tool_result',
    text: '## Worker Workspace Handoff',
    toolCallId: 'outer-1',
    toolName: 'run_subagent',
    ok: true,
    details: {kind: 'generic', workspace: {retained: true, workspaceRoot: '/managed/ws-1/worktree'}}
  };

  const lines = renderRunSubagentCompactPairLines(call, result, 100, createTuiTheme('default')).map(stripAnsi);
  const text = lines.join('\n');
  // rail 与 compact 共用同一份措辞。
  assert.match(text, /workspace retained · not integrated/u);
  assert.match(text, /\/managed\/ws-1\/worktree/u);
});

test('the compact projection stays a single line when no workspace facts exist', () => {
  const call = {
    role: 'tool_call',
    text: 'run_subagent',
    toolCallId: 'outer-1',
    toolName: 'run_subagent',
    argumentsText: JSON.stringify({agent: 'explorer', task: 'inspect'})
  };
  const result = {
    role: 'tool_result',
    text: 'report',
    toolCallId: 'outer-1',
    toolName: 'run_subagent',
    ok: true,
    details: {kind: 'generic'}
  };

  const lines = renderRunSubagentCompactPairLines(call, result, 100, createTuiTheme('default'));
  assert.equal(lines.length, 1);
});
