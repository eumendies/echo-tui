const test = require('node:test');
const assert = require('node:assert/strict');

const {convertTranscriptToOpenAiInput} = require('../../src/agent/openai-responses/transcript-converter');
const {convertTranscriptToOpenAiChatMessages} = require('../../src/agent/openai-chat/transcript-converter');
const {convertTranscriptToAnthropicMessages} = require('../../src/agent/anthropic/transcript-converter');
const {createCodexRequest} = require('../../src/agent/codex/agent');
const {estimateRecordsTokens, generateCompactionSummary} = require('../../src/agent/context/context-compaction');

const CODEX_CONFIG = {
  agentType: 'codex',
  apiKey: '',
  baseURL: 'https://chatgpt.com/backend-api/codex',
  codexOAuth: {authFilePath: '/tmp/codex-auth.json'},
  model: 'test-model',
  tools: {bash: {timeoutMs: null, maxOutputBytes: 65536}}
};

function createRecords(resultText) {
  return [
    {role: 'tool_call', text: '$ printf output', toolCallId: 'call_1', toolName: 'run_bash_command', argumentsText: '{"command":"printf output"}'},
    {role: 'tool_result', text: resultText, toolCallId: 'call_1', toolName: 'run_bash_command', ok: true, details: {kind: 'bash', truncated: true}}
  ];
}

test('all provider continuations receive the same bounded offloading text', () => {
  const resultText = '[tool result truncated: /tmp/tool-result.txt]\n\ntail output';
  const records = createRecords(resultText);
  const openAi = convertTranscriptToOpenAiInput(records);
  const openAiChat = convertTranscriptToOpenAiChatMessages(records);
  const anthropic = convertTranscriptToAnthropicMessages(records);
  const codex = createCodexRequest(records, CODEX_CONFIG);

  assert.equal(openAi[1].output, resultText);
  assert.equal(openAiChat[1].content, resultText);
  assert.equal(anthropic.messages[1].content[0].content, resultText);
  assert.equal(codex.input[1].output, resultText);
});

test('token estimation and compaction consume only bounded transcript preview text', async () => {
  const resultText = '[tool result truncated: /tmp/tool-result.txt]\n\ntail output';
  const records = createRecords(resultText);
  const agent = {
    calls: [],
    async runTurn(summaryRecords) {
      this.calls.push(summaryRecords);
      return {draft: 'summary', toolCalls: []};
    }
  };

  assert.equal(estimateRecordsTokens(records) < 100, true);
  await generateCompactionSummary({agent, compactedRecords: records, previousSummary: ''});
  assert.match(agent.calls[0][1].text, /tool result truncated: \/tmp\/tool-result\.txt/);
  assert.match(agent.calls[0][1].text, /tail output/);
  assert.doesNotMatch(agent.calls[0][1].text, /FULL_ARTIFACT_ONLY/);
});
