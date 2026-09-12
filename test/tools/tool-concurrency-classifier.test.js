const test = require('node:test');
const assert = require('node:assert/strict');

const {classifyToolCallConcurrency} = require('../../src/tools/tool-concurrency-classifier');

function createCall(toolName, argumentsText = '{}') {
  return {callId: `call-${toolName}`, toolName, argumentsText};
}

test('classifyToolCallConcurrency only parallelizes explicit observation tools', () => {
  for (const toolName of ['glob', 'grep', 'read_files', 'web_fetch', 'web_search', 'use_skill']) {
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
  assert.equal(classifyToolCallConcurrency(call, new Set(['explorer'])), 'parallel_read');
  assert.equal(classifyToolCallConcurrency(call, new Set(['worker'])), 'exclusive');
});

test('classifyToolCallConcurrency keeps unparsable unknown or unpredicated subagent calls exclusive', () => {
  assert.equal(classifyToolCallConcurrency(createCall('run_subagent', 'not-json'), new Set(['explorer'])), 'exclusive');
  assert.equal(classifyToolCallConcurrency(createCall('run_subagent', '{"task":"missing agent"}'), new Set(['explorer'])), 'exclusive');
  assert.equal(classifyToolCallConcurrency(createCall('run_subagent', JSON.stringify({agent: 'explorer', task: 'x'}))), 'exclusive');
});
