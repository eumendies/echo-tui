const test = require('node:test');
const assert = require('node:assert/strict');

const { getProviderPreset, listProviderPresets } = require('../../src/config/provider-presets');

test('provider preset list hides fake agent from /config choices', () => {
  assert.equal(getProviderPreset('fake-agent').agentType, 'fake');
  assert.equal(listProviderPresets().some((preset) => preset.id === 'fake-agent'), false);
});
