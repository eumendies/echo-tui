const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {DEFAULT_APP_SETTINGS} = require('../../src/config/app-settings-config');
const {createSystemPromptCommandPort} = require('../../src/app/command/system-prompt-command-port');

// 模型配置固定不可读：用来验证动态段摘要的段级降级，而不是依赖真实 provider 配置。
function createPort(cwd) {
  const calls = {clears: 0};
  const port = createSystemPromptCommandPort({
    appContext: {
      clearContextUsage() {
        calls.clears += 1;
      },
      getCurrentCwd() {
        return cwd;
      }
    },
    userConfigContext: {
      capture() {
        return {
          getAppSettings() {
            return DEFAULT_APP_SETTINGS;
          },
          resolveLlmConfig() {
            throw new Error('配置不可读');
          }
        };
      }
    }
  });

  return {calls, port};
}

test('readSystemPrompt skips dynamic sections unless explicitly requested', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-system-prompt-port-'));
  const {port} = createPort(cwd);

  try {
    const factsOnly = port.readSystemPrompt();
    assert.equal(factsOnly.ok, true);
    assert.equal(factsOnly.dynamicSections, undefined);

    const withSections = port.readSystemPrompt({includeDynamicSections: true});
    assert.equal(withSections.ok, true);
    assert.deepEqual(withSections.dynamicSections.map((section) => section.label), [
      'Runtime environment',
      'AGENTS.md instructions',
      'Available Skills',
      'Memory'
    ]);
    // 模型配置不可读时只有 skills 段降级，其余段照常展示。
    assert.equal(withSections.dynamicSections[2].detail, '模型配置不可读');
    assert.equal(withSections.dynamicSections[1].detail, '未发现');
  } finally {
    fs.rmSync(cwd, {force: true, recursive: true});
  }
});

test('deleteSystemPrompt only invalidates context usage when a file was removed', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-system-prompt-port-'));
  const {calls, port} = createPort(cwd);

  try {
    fs.writeFileSync(path.join(cwd, 'SYSTEM.md'), 'project prompt', 'utf8');

    assert.deepEqual(port.deleteSystemPrompt('project'), {ok: true, filePath: path.join(cwd, 'SYSTEM.md')});
    assert.equal(calls.clears, 1);

    // 第二次删除命中 ENOENT：仍返回成功，但不应再次失效缓存。
    assert.equal(port.deleteSystemPrompt('project').ok, true);
    assert.equal(calls.clears, 1);
  } finally {
    fs.rmSync(cwd, {force: true, recursive: true});
  }
});

test('saveSystemPrompt skips cache invalidation when content is unchanged', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-system-prompt-port-'));
  const {calls, port} = createPort(cwd);

  try {
    const first = port.saveSystemPrompt('project', 'project prompt');
    assert.deepEqual(first, {
      ok: true,
      filePath: path.join(cwd, 'SYSTEM.md'),
      overwritten: false,
      unchanged: false
    });
    assert.equal(calls.clears, 1);

    const second = port.saveSystemPrompt('project', 'project prompt\r\n');
    assert.equal(second.ok, true);
    assert.equal(second.unchanged, true);
    assert.equal(calls.clears, 1);
    assert.equal(fs.readFileSync(path.join(cwd, 'SYSTEM.md'), 'utf8'), 'project prompt');
  } finally {
    fs.rmSync(cwd, {force: true, recursive: true});
  }
});
