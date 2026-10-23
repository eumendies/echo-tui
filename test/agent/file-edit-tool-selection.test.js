const test = require('node:test');
const assert = require('node:assert/strict');

const {convertToolDefinitionsToAnthropicTools} = require('../../src/agent/anthropic/tool-converter');
const {convertTranscriptToAnthropicMessages} = require('../../src/agent/anthropic/transcript-converter');
const {convertToolDefinitionsToOpenAiChatTools} = require('../../src/agent/openai-chat/tool-converter');
const {convertTranscriptToOpenAiChatMessages} = require('../../src/agent/openai-chat/transcript-converter');
const {convertToolDefinitionsToOpenAiTools} = require('../../src/agent/openai-responses/tool-converter');
const {convertTranscriptToOpenAiInput} = require('../../src/agent/openai-responses/transcript-converter');
const {prepareAgent} = require('../../src/agent/agent-setup');
const {createRequest} = require('../../src/agent/openai-responses/agent');
const {createChatRequest} = require('../../src/agent/openai-chat/agent');
const {createAnthropicRequest} = require('../../src/agent/anthropic/agent');
const {createCodexRequest} = require('../../src/agent/codex/agent');

function createConfig() {
  return {
    agentType: 'fake', apiKey: '', model: 'fake',
    tools: {bash: {timeoutMs: null, maxOutputBytes: 65_536}, sandbox: {mode: 'off', network: false, extraWritablePaths: []}}
  };
}

test('provider tool converters respect every explicit main editor disable combination', () => {
  for (const disabledTools of [[], ['apply_patch'], ['edit_file'], ['apply_patch', 'edit_file']]) {
    const {registry} = prepareAgent({config: createConfig(), mainAgentTools: {disabledTools}});
    const definitions = registry.listDefinitions();
    const converted = [
      convertToolDefinitionsToOpenAiTools(definitions),
      convertToolDefinitionsToOpenAiTools(definitions, {strict: undefined}),
      convertToolDefinitionsToOpenAiChatTools(definitions),
      convertToolDefinitionsToAnthropicTools(definitions)
    ];

    for (const tools of converted) {
      const names = tools.map((tool) => tool.name || tool.function?.name);
      for (const name of ['apply_patch', 'edit_file']) {
        assert.equal(names.includes(name), !disabledTools.includes(name));
      }
      if (!disabledTools.includes('apply_patch')) {
        const patchSchema = JSON.stringify(tools.find((tool) => (tool.name || tool.function?.name) === 'apply_patch'));
        assert.match(patchSchema, /\*\*\* Begin Patch/);
        assert.doesNotMatch(patchSchema, /unified diff/i);
      }
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

test('all four provider requests consume zero, one or two main editor schemas without rewriting history', () => {
  const config = createConfig();
  const records = [
    {role: 'system', text: 'system'},
    {role: 'user', text: 'continue'},
    ...['apply_patch', 'edit_file'].flatMap((toolName) => [
      {role: 'tool_call', text: '', toolCallId: `old-${toolName}`, toolName, argumentsText: '{}'},
      {role: 'tool_result', text: `old ${toolName} result`, toolCallId: `old-${toolName}`, toolName, ok: true, details: {kind: toolName}}
    ])
  ];
  const history = structuredClone(records);
  for (const disabledTools of [[], ['apply_patch'], ['edit_file'], ['apply_patch', 'edit_file']]) {
    const {registry} = prepareAgent({config, mainAgentTools: {disabledTools}});
    for (const buildRequest of [createRequest, createChatRequest, createAnthropicRequest, createCodexRequest]) {
      const request = buildRequest(records, config, registry);
      const names = request.tools.map((tool) => tool.name || tool.function?.name);
      assert.equal(names.includes('run_bash_command'), true);
      for (const name of ['apply_patch', 'edit_file']) {
        assert.equal(names.includes(name), !disabledTools.includes(name), buildRequest.name + name);
      }
      const serializedHistory = JSON.stringify(request.input || request.messages);
      assert.match(serializedHistory, /old apply_patch result/);
      assert.match(serializedHistory, /old edit_file result/);
    }
  }
  assert.deepEqual(records, history);
});
