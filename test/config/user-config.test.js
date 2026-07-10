const test = require('node:test');
const assert = require('node:assert/strict');

const { readOptionalUserConfig } = require('../../src/config/user-config');

test('readOptionalUserConfig reads a valid root config object', () => {
  const config = readOptionalUserConfig({
    configPath: '/tmp/config.json',
    readFile(filePath, encoding) {
      assert.equal(filePath, '/tmp/config.json');
      assert.equal(encoding, 'utf8');
      return JSON.stringify({ llm: { selectedModel: 'fast' }, tools: { bash: { timeoutMs: 1000 } } });
    }
  });

  assert.deepEqual(config, { llm: { selectedModel: 'fast' }, tools: { bash: { timeoutMs: 1000 } } });
});

test('readOptionalUserConfig returns an empty object for optional config failures', () => {
  assert.deepEqual(readOptionalUserConfig({ readFile() { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }), {});
  assert.deepEqual(readOptionalUserConfig({ readFile() { return '{not json'; } }), {});
  assert.deepEqual(readOptionalUserConfig({ readFile() { return '[]'; } }), {});
});
