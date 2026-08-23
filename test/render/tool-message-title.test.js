const test = require('node:test');
const assert = require('node:assert/strict');

const {createToolCallTitle, formatToolDisplayName} = require('../../src/render/tool-message-renderers/shared');

test('formatToolDisplayName uses stable built-in sentence case names', () => {
  assert.equal(formatToolDisplayName('ask_user_questions'), 'Ask user questions');
  assert.equal(formatToolDisplayName('read_files'), 'Read files');
  assert.equal(formatToolDisplayName('run_bash_command'), 'Bash');
  assert.equal(formatToolDisplayName('run_subagent'), 'Run subagent');
});

test('formatToolDisplayName normalizes snake, camel, Pascal and acronym identifiers', () => {
  assert.equal(formatToolDisplayName('generic_tool'), 'Generic tool');
  assert.equal(formatToolDisplayName('readMemory'), 'Read memory');
  assert.equal(formatToolDisplayName('AskUserQuestions'), 'Ask user questions');
  assert.equal(formatToolDisplayName('URLFetcher'), 'URL fetcher');
});

test('formatToolDisplayName preserves standard MCP source boundaries', () => {
  assert.equal(formatToolDisplayName('mcp__github_server__createIssue'), 'MCP · github server · create issue');
  assert.equal(formatToolDisplayName('mcp__broken'), 'Mcp broken');
});

test('createToolCallTitle joins non-empty trusted summary segments', () => {
  assert.equal(createToolCallTitle('edit_file', [' src/app.ts ', null, 'replace all']), 'Edit file · src/app.ts · replace all');
  assert.equal(createToolCallTitle('create_todos', ['', undefined]), 'Create todos');
});
