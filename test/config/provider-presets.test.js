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

test('opencode go presets pin zen endpoints and declare the session affinity header', () => {
  const chat = getProviderPreset('opencode-go');
  const responses = getProviderPreset('opencode-go-responses');
  const anthropic = getProviderPreset('opencode-go-anthropic');

  assert.equal(chat.agentType, 'openai-chat');
  assert.equal(chat.baseURL, 'https://opencode.ai/zen/go/v1');
  assert.equal(chat.sessionHeader, 'x-opencode-session');
  assert.deepEqual(chat.headers, {'User-Agent': 'echo-tui/1.0'});
  assert.deepEqual(chat.suggestedModels, ['glm-5.2', 'kimi-k3', 'deepseek-v4-pro', 'mimo-v2.5', 'omen-alpha']);

  assert.equal(responses.agentType, 'openai');
  assert.equal(responses.baseURL, 'https://opencode.ai/zen/go/v1');
  assert.equal(responses.sessionHeader, 'x-opencode-session');
  assert.deepEqual(responses.suggestedModels, ['gpt-5.6-luna', 'grok-4.6']);

  assert.equal(anthropic.agentType, 'anthropic');
  assert.equal(anthropic.baseURL, 'https://opencode.ai/zen/go');
  assert.equal(anthropic.sessionHeader, 'x-opencode-session');
  assert.deepEqual(anthropic.suggestedModels, ['minimax-m3', 'qwen3.8-max', 'qwen3.7-plus']);
});
