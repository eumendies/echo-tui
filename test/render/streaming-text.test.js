const test = require('node:test');
const assert = require('node:assert/strict');

const { renderAssistantMessageLines, renderReasoningSummaryLines } = require('../../src/render/blocks/message-renderer');
const { getCommittableReasoningText, getCommittableStreamingText, renderStreamingCommitLines } = require('../../src/render/blocks/streaming-text');
const { renderPendingAssistantLines } = require('../../src/render/blocks/pending-preview-renderer');
test('renderStreamingCommitLines equals the stable prefix of the final assistant projection', () => {
  const first = getCommittableStreamingText('alpha\n\nbeta');
  const second = getCommittableStreamingText('alpha\n\nbeta\n\ngamma');
  const firstLines = renderStreamingCommitLines('assistant', first, '', 30);
  const secondLines = renderStreamingCommitLines('assistant', second, first, 30);
  assert.deepEqual([...firstLines, ...secondLines], renderAssistantMessageLines(second, 30));
});

test('getCommittableReasoningText commits complete visual lines before provider done', () => {
  const text = `${'a'.repeat(90)} tail`;
  const committed = getCommittableReasoningText(text, 40);

  assert.ok(committed.length > 0);
  assert.ok(committed.length < text.length);
  const lines = renderPendingAssistantLines({kind: 'reasoning_streaming', text, historyText: committed}, 40);
  assert.ok(lines.length >= 1);
  assert.ok(lines.length < renderReasoningSummaryLines(text, 40).length);
});
