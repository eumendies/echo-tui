const test = require('node:test');
const assert = require('node:assert/strict');

const {applySandboxConfigDraft, createSandboxConfigDraft, SandboxConfigEditorError} = require('../../src/config/sandbox-config-editor');

test('createSandboxConfigDraft falls back to parse-layer defaults for missing or invalid fields', () => {
  assert.deepEqual(createSandboxConfigDraft({}), {mode: 'workspace-write', network: true, extraWritablePaths: []});

  assert.deepEqual(
    createSandboxConfigDraft({tools: {sandbox: {mode: 'read-only', network: false, extraWritablePaths: ['/tmp/one']}}}),
    {mode: 'read-only', network: false, extraWritablePaths: ['/tmp/one']}
  );

  // 非法档位/非布尔网络/非数组路径按缺省值回退；保存校验负责把文件修正为合法值。
  assert.deepEqual(
    createSandboxConfigDraft({tools: {sandbox: {mode: 'bogus', network: 'yes', extraWritablePaths: 'oops'}}}),
    {mode: 'workspace-write', network: true, extraWritablePaths: []}
  );
});

test('applySandboxConfigDraft writes tools.sandbox and preserves unrelated keys', () => {
  const root = {tools: {bash: {timeoutMs: 1000}, sandbox: {mode: 'off', extraPath: 'keep-me'}}};

  applySandboxConfigDraft(root, {mode: 'workspace-write', network: false, extraWritablePaths: ['/tmp/a', '/tmp/b']});

  assert.deepEqual(root.tools.sandbox, {mode: 'workspace-write', network: false, extraWritablePaths: ['/tmp/a', '/tmp/b'], extraPath: 'keep-me'});
  assert.deepEqual(root.tools.bash, {timeoutMs: 1000});
});

test('applySandboxConfigDraft rejects invalid drafts with field-scoped errors', () => {
  const root = {};
  const invalid = (error) => error instanceof SandboxConfigEditorError;

  assert.throws(
    () => applySandboxConfigDraft(root, {mode: 'bogus', network: true, extraWritablePaths: []}),
    (error) => invalid(error) && error.message.includes('tools.sandbox.mode')
  );

  assert.throws(
    () => applySandboxConfigDraft(root, {mode: 'off', network: 'yes', extraWritablePaths: []}),
    (error) => invalid(error) && error.message.includes('network')
  );

  assert.throws(
    () => applySandboxConfigDraft(root, {mode: 'off', network: true, extraWritablePaths: ['./build']}),
    (error) => invalid(error) && error.message.includes('extraWritablePaths[0]')
  );

  assert.throws(
    () => applySandboxConfigDraft(root, {mode: 'off', network: true, extraWritablePaths: ['/tmp/a', '/tmp/a']}),
    (error) => invalid(error) && error.message.includes('重复')
  );

  assert.equal(root.tools, undefined);
});
