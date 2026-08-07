const test = require('node:test');
const assert = require('node:assert/strict');

const { getProviderPreset, listProviderPresets } = require('../../src/config/provider-presets');

test('provider preset list hides fake agent from /config choices', () => {
  assert.equal(getProviderPreset('fake-agent').agentType, 'fake');
  assert.equal(listProviderPresets().some((preset) => preset.id === 'fake-agent'), false);
});

test('ollama preset targets the local OpenAI-compatible endpoint without api key', () => {
  const preset = getProviderPreset('ollama');

  assert.equal(preset.agentType, 'openai-chat');
  assert.equal(preset.apiKeyRequired, false);
  assert.equal(preset.defaultApiKey, 'ollama');
  assert.equal(preset.baseURLMode, 'fixed');
  assert.equal(preset.baseURL, 'http://localhost:11434/v1');
  assert.deepEqual(preset.suggestedModels, ['llama3.1:8b', 'qwen2.5-coder:7b', 'deepseek-r1:7b']);
});
