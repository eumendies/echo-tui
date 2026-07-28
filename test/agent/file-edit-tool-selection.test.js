const test = require('node:test');
const assert = require('node:assert/strict');

const {convertToolDefinitionsToAnthropicTools} = require('../../src/agent/anthropic/tool-converter');
const {convertTranscriptToAnthropicMessages} = require('../../src/agent/anthropic/transcript-converter');
const {convertToolDefinitionsToOpenAiChatTools} = require('../../src/agent/openai-chat/tool-converter');
const {convertTranscriptToOpenAiChatMessages} = require('../../src/agent/openai-chat/transcript-converter');
const {convertToolDefinitionsToOpenAiTools} = require('../../src/agent/openai-responses/tool-converter');
const {convertTranscriptToOpenAiInput} = require('../../src/agent/openai-responses/transcript-converter');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');

function createConfig(fileEditMode) {
  return {
    agentType: 'fake', apiKey: '', model: 'fake',
    tools: {bash: {timeoutMs: null, maxOutputBytes: 65_536}, fileEditMode}
  };
}

test('provider tool converters expose only the selected file edit schema', () => {
  for (const mode of ['apply_patch', 'edit_file']) {
    const definitions = createDefaultToolRegistry(createConfig(mode)).listDefinitions();
    const expected = mode;
    const omitted = mode === 'apply_patch' ? 'edit_file' : 'apply_patch';
    const converted = [
      convertToolDefinitionsToOpenAiTools(definitions),
      convertToolDefinitionsToOpenAiTools(definitions, {strict: undefined}),
      convertToolDefinitionsToOpenAiChatTools(definitions),
      convertToolDefinitionsToAnthropicTools(definitions)
    ];

    for (const tools of converted) {
      const names = tools.map((tool) => tool.name || tool.function?.name);
      assert.equal(names.includes(expected), true);
      assert.equal(names.includes(omitted), false);
    }
  }
});

test('provider transcript converters retain historical unselected file edit calls', () => {
  const records = [
    {role: 'user', text: 'continue'},
    {role: 'tool_call', text: '', toolCallId: 'old-patch', toolName: 'apply_patch', argumentsText: '{"patch":"old"}'},
    {role: 'tool_result', text: 'Applied patch.', toolCallId: 'old-patch', toolName: 'apply_patch', ok: true, details: {kind: 'apply_patch'}}
  ];

  assert.match(JSON.stringify(convertTranscriptToOpenAiInput(records)), /apply_patch/);
  assert.match(JSON.stringify(convertTranscriptToOpenAiChatMessages(records)), /apply_patch/);
  assert.match(JSON.stringify(convertTranscriptToAnthropicMessages(records)), /apply_patch/);
});
