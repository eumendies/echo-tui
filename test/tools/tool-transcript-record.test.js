const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createToolCallTranscriptRecord,
  createToolResultTranscriptRecord
} = require('../../src/tools/tool-transcript-record');

test('createToolCallTranscriptRecord formats bash commands and generic calls for transcript text', () => {
  assert.deepEqual(createToolCallTranscriptRecord({
    callId: 'call_bash',
    toolName: 'run_bash_command',
    argumentsText: JSON.stringify({command: 'git status --short'})
  }), {
    role: 'tool_call',
    text: '$ git status --short',
    toolCallId: 'call_bash',
    toolName: 'run_bash_command',
    argumentsText: '{"command":"git status --short"}'
  });

  assert.equal(createToolCallTranscriptRecord({
    callId: 'call_search',
    toolName: 'web_search',
    argumentsText: '{"query":"Echo TUI"}'
  }).text, 'web_search({"query":"Echo TUI"})');
});

test('createToolResultTranscriptRecord preserves attachments and web search metadata', () => {
  const attachments = [{
    kind: 'image',
    mediaType: 'image/png',
    dataBase64: 'aGVsbG8=',
    path: '/tmp/screenshot.png',
    sizeBytes: 5
  }];

  assert.deepEqual(createToolResultTranscriptRecord({
    callId: 'call_search',
    toolName: 'web_search',
    ok: true,
    text: 'search result',
    details: {kind: 'web_search', timedOut: false, truncated: true},
    attachments
  }), {
    role: 'tool_result',
    text: 'search result',
    toolCallId: 'call_search',
    toolName: 'web_search',
    ok: true,
    details: {kind: 'web_search', timedOut: false, truncated: true},
    attachments
  });
});

test('createToolResultTranscriptRecord preserves apply patch display metadata', () => {
  const display = {
    kind: 'apply_patch',
    files: [{path: 'a.txt', kind: 'added', lines: []}]
  };

  assert.deepEqual(createToolResultTranscriptRecord({
    callId: 'call_patch',
    toolName: 'apply_patch',
    ok: true,
    text: 'Done!',
    details: {kind: 'apply_patch', display}
  }), {
    role: 'tool_result',
    text: 'Done!',
    toolCallId: 'call_patch',
    toolName: 'apply_patch',
    ok: true,
    details: {kind: 'apply_patch', display}
  });
});

test('createToolResultTranscriptRecord preserves grep display metadata', () => {
  const display = {
    kind: 'grep',
    matches: [{path: 'src/a.ts', line: 3, column: 5, text: 'const needle = true;'}]
  };

  assert.deepEqual(createToolResultTranscriptRecord({
    callId: 'call_grep',
    toolName: 'grep',
    ok: true,
    text: 'src/a.ts:3:5: const needle = true;',
    details: {kind: 'grep', exitCode: 0, truncated: false, display}
  }), {
    role: 'tool_result',
    text: 'src/a.ts:3:5: const needle = true;',
    toolCallId: 'call_grep',
    toolName: 'grep',
    ok: true,
    details: {kind: 'grep', exitCode: 0, truncated: false, display}
  });
});

test('createToolResultTranscriptRecord preserves glob display metadata', () => {
  const display = {kind: 'glob', paths: ['src/a.ts', 'test/a.test.ts']};

  assert.deepEqual(createToolResultTranscriptRecord({
    callId: 'call_glob',
    toolName: 'glob',
    ok: true,
    text: 'src/a.ts\ntest/a.test.ts',
    details: {kind: 'glob', exitCode: 0, truncated: false, display}
  }), {
    role: 'tool_result',
    text: 'src/a.ts\ntest/a.test.ts',
    toolCallId: 'call_glob',
    toolName: 'glob',
    ok: true,
    details: {kind: 'glob', exitCode: 0, truncated: false, display}
  });
});
