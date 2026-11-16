const test = require('node:test');
const assert = require('node:assert/strict');

const {classifyToolCallConcurrency} = require('../../src/tools/tool-concurrency-classifier');

function createCall(toolName, argumentsText = '{}') {
  return {callId: `call-${toolName}`, toolName, argumentsText};
}

test('classifyToolCallConcurrency only parallelizes explicit observation tools', () => {
  for (const toolName of ['glob', 'grep', 'read_files', 'web_fetch', 'web_search', 'use_skill', 'list_mcp_resources', 'read_mcp_resource']) {
    assert.equal(classifyToolCallConcurrency(createCall(toolName)), 'parallel_read');
  }

  for (const toolName of ['apply_patch', 'edit_file', 'create_todos', 'complete_todo', 'ask_user_questions', 'run_subagent', 'mcp__docs__search', 'unknown']) {
    assert.equal(classifyToolCallConcurrency(createCall(toolName)), 'exclusive');
  }
});

test('classifyToolCallConcurrency uses the strict readonly Bash policy', () => {
  assert.equal(classifyToolCallConcurrency(createCall('run_bash_command', JSON.stringify({command: 'git status --short && rg TODO src'}))), 'parallel_read');
  assert.equal(classifyToolCallConcurrency(createCall('run_bash_command', JSON.stringify({command: 'npm test'}))), 'exclusive');
  assert.equal(classifyToolCallConcurrency(createCall('run_bash_command', JSON.stringify({command: 'git status > status.txt'}))), 'exclusive');
  assert.equal(classifyToolCallConcurrency(createCall('run_bash_command', 'not-json')), 'exclusive');
});

test('classifyToolCallConcurrency parallelizes readonly subagent delegation through the injected name set', () => {
  const call = createCall('run_subagent', JSON.stringify({agent: 'explorer', task: 'inspect'}));
  assert.equal(classifyToolCallConcurrency(call, {readonlySubagentNames: new Set(['explorer'])}), 'parallel_read');
  assert.equal(classifyToolCallConcurrency(call, {readonlySubagentNames: new Set(['worker'])}), 'exclusive');
});

test('classifyToolCallConcurrency keeps unparsable unknown or unpredicated subagent calls exclusive', () => {
  assert.equal(classifyToolCallConcurrency(createCall('run_subagent', 'not-json'), {readonlySubagentNames: new Set(['explorer'])}), 'exclusive');
  assert.equal(classifyToolCallConcurrency(createCall('run_subagent', '{"task":"missing agent"}'), {readonlySubagentNames: new Set(['explorer'])}), 'exclusive');
  assert.equal(classifyToolCallConcurrency(createCall('run_subagent', JSON.stringify({agent: 'explorer', task: 'x'}))), 'exclusive');
});

test('classifyToolCallConcurrency grants parallel_worker only from a frozen managed-worktree snapshot', () => {
  const workerCall = createCall('run_subagent', JSON.stringify({agent: 'worker', task: 'implement'}));

  // 没有已完成预检快照时不得提前授予资格。
  assert.equal(classifyToolCallConcurrency(workerCall), 'exclusive');
  assert.equal(classifyToolCallConcurrency(workerCall, {readonlySubagentNames: new Set(['explorer'])}), 'exclusive');

  assert.equal(
    classifyToolCallConcurrency(workerCall, {workerWorkspace: {mode: 'managed_worktree', workerAgentName: 'worker'}}),
    'parallel_worker'
  );
  // 非 Git 共享目录保持独占，不因为具备 Worker 名称就并发。
  assert.equal(
    classifyToolCallConcurrency(workerCall, {workerWorkspace: {mode: 'shared_cwd', workerAgentName: 'worker'}}),
    'exclusive'
  );
  // 自定义 general Agent 与其它名称不获得资格。
  assert.equal(
    classifyToolCallConcurrency(createCall('run_subagent', JSON.stringify({agent: 'custom', task: 'x'})), {workerWorkspace: {mode: 'managed_worktree', workerAgentName: 'worker'}}),
    'exclusive'
  );
  // 只读集合优先：Worker 资格不得被 readonly 语义覆盖成 parallel_read。
  assert.equal(
    classifyToolCallConcurrency(workerCall, {readonlySubagentNames: new Set(['worker']), workerWorkspace: {mode: 'managed_worktree', workerAgentName: 'worker'}}),
    'parallel_read'
  );
});
