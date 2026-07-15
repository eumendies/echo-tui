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
    timedOut: false,
    truncated: true,
    attachments
  }), {
    role: 'tool_result',
    text: 'search result',
    toolCallId: 'call_search',
    toolName: 'web_search',
    ok: true,
    timedOut: false,
    truncated: true,
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
    display
  }), {
    role: 'tool_result',
    text: 'Done!',
    toolCallId: 'call_patch',
    toolName: 'apply_patch',
    ok: true,
    display
  });
});
