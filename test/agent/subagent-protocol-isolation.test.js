const assert = require('node:assert/strict');
const {test} = require('node:test');

const {estimateRecordsTokens, generateCompactionSummary} = require('../../src/agent/context/context-compaction');
const {
  renderConversationReferenceMaterial,
  renderConversationReferenceSegments
} = require('../../src/agent/context/conversation-reference');
const {convertTranscriptToAnthropicMessages} = require('../../src/agent/anthropic/transcript-converter');
const {convertTranscriptToOpenAiChatMessages} = require('../../src/agent/openai-chat/transcript-converter');
const {convertTranscriptToOpenAiInput} = require('../../src/agent/openai-responses/transcript-converter');
const {shouldIncludeRecordInProviderContext} = require('../../src/agent/transcript-converter-common');

function createSubagentRecord() {
  return {
    role: 'subagent',
    text: 'PRIVATE-SUBAGENT-PROCESS',
    agentName: 'security-reviewer',
    parentToolCallId: 'outer-1',
    runId: 'run-1',
    event: {kind: 'tool_call', toolCallId: 'PRIVATE-INNER-ID', toolName: 'grep', argumentsText: '{}'}
  };
}

test('all provider converters defensively omit subagent process records', () => {
  const subagent = createSubagentRecord();
  const records = [{role: 'user', text: 'question'}, subagent, {role: 'assistant', text: 'answer'}];

  assert.equal(shouldIncludeRecordInProviderContext(subagent), false);
  for (const projection of [
    convertTranscriptToOpenAiInput(records),
    convertTranscriptToOpenAiChatMessages(records),
    convertTranscriptToAnthropicMessages(records)
  ]) {
    const serialized = JSON.stringify(projection);
    assert.doesNotMatch(serialized, /PRIVATE-SUBAGENT-PROCESS/);
    assert.doesNotMatch(serialized, /PRIVATE-INNER-ID/);
    assert.match(serialized, /question/);
    assert.match(serialized, /answer/);
  }
});

test('subagent process is excluded from token estimates, conversation references, and compaction summaries', async () => {
  const subagent = createSubagentRecord();
  const records = [{role: 'user', text: 'visible user'}, subagent, {role: 'assistant', text: 'visible answer'}];
  assert.equal(estimateRecordsTokens(records), estimateRecordsTokens([records[0], records[2]]));
  assert.doesNotMatch(
    renderConversationReferenceMaterial(renderConversationReferenceSegments({records})),
    /PRIVATE-SUBAGENT-PROCESS|PRIVATE-INNER-ID/
  );

  let summaryInput = [];
  const summary = await generateCompactionSummary({
    agent: {
      async runTurn(input) {
        summaryInput = input;
        return {draft: 'summary', toolCalls: []};
      }
    },
    prefixRecords: [],
    compactedRecords: records,
    previousSummary: ''
  });
  const summaryText = summaryInput.map((record) => record.text).join('\n');

  assert.equal(summary.summaryText, 'summary');
  assert.match(summaryText, /visible user/);
  assert.match(summaryText, /visible answer/);
  assert.doesNotMatch(summaryText, /PRIVATE-SUBAGENT-PROCESS|PRIVATE-INNER-ID/);
});
