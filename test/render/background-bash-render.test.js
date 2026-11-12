const test = require('node:test');
const assert = require('node:assert/strict');

const { renderToolPairBlock } = require('../../src/render/tool-message-renderer');
const { stripAnsi } = require('../../src/render/layout');

function createBackgroundReference(overrides = {}) {
  return {
    taskId: 'bash-2',
    sessionId: 'session-a',
    ownerInstanceId: 'instance-1',
    outputPath: '/Users/someone/.echo/echo_tui/projects/2f29/background-tasks/session-a/instance-1/bash-2/output.log',
    statusPath: '/Users/someone/.echo/echo_tui/projects/2f29/background-tasks/session-a/instance-1/bash-2/status.json',
    ...overrides
  };
}

function createPair(resultOverrides = {}) {
  const reference = createBackgroundReference();
  return [
    {
      role: 'tool_call',
      text: '$ npm run dev',
      toolCallId: 'call-bg',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({ background: true, command: 'npm run dev' })
    },
    {
      role: 'tool_result',
      text: 'task_id: bash-2\nstate: running',
      toolCallId: 'call-bg',
      toolName: 'run_bash_command',
      ok: true,
      details: { kind: 'bash', background: { ...reference, state: 'running', command: 'npm run dev' } },
      ...resultOverrides
    }
  ];
}

test('background start renders a compact projection that never claims completion', () => {
  const [call, result] = createPair();
  const block = stripAnsi(renderToolPairBlock(call, result, 100));

  assert.match(block, /Bash · background/u);
  assert.equal(block.includes('bash-2'), false);
  assert.match(block, /npm run dev/u);
  assert.match(block, /log: output\.log · status: status\.json/u);

  // 启动成功不得渲染成前台结论,也不得出现 stdout/stderr 分段标记。
  assert.equal(block.includes('complete'), false);
  assert.equal(block.includes('exit 0'), false);
  assert.equal(block.includes('stdout:'), false);
  assert.equal(block.includes('stderr:'), false);

  // 项目分区完整路径只留在模型可见文本与 /tasks 详情里。
  assert.equal(block.includes('/background-tasks/'), false);
});

test('background projection keeps the same shape for historical replay', () => {
  const [, result] = createPair();
  // 回放时状态可能已是 exited,投影仍只陈述启动事实。
  const replayed = { ...result, details: { kind: 'bash', background: { ...result.details.background, state: 'exited' } } };
  const block = stripAnsi(renderToolPairBlock(createPair()[0], replayed, 100));

  assert.match(block, /Bash · background/u);
  assert.equal(block.includes('bash-2'), false);
  assert.equal(block.includes('exited'), false);
});

test('foreground bash results keep the existing complete/exit projection', () => {
  const call = {
    role: 'tool_call',
    text: '$ printf hello',
    toolCallId: 'call-fg',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({ command: 'printf hello' })
  };
  const result = {
    role: 'tool_result',
    text: 'hello',
    toolCallId: 'call-fg',
    toolName: 'run_bash_command',
    ok: true,
    details: { kind: 'bash', exitCode: 0, timedOut: false, truncated: false, durationMs: 12 }
  };
  const block = stripAnsi(renderToolPairBlock(call, result, 100));

  assert.match(block, /Bash · complete · exit 0/u);
  assert.match(block, /hello/u);
});

test('legacy bash results without task fields keep rendering as foreground output', () => {
  const call = {
    role: 'tool_call',
    text: '$ npm test',
    toolCallId: 'call-legacy',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({ command: 'npm test' })
  };
  const result = {
    role: 'tool_result',
    text: 'stdout:\nall good',
    toolCallId: 'call-legacy',
    toolName: 'run_bash_command',
    ok: true,
    details: { kind: 'bash', exitCode: 0 }
  };
  const block = stripAnsi(renderToolPairBlock(call, result, 100));

  assert.match(block, /Bash · complete/u);
  assert.match(block, /all good/u);
});
