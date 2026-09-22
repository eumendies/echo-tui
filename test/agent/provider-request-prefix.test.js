const test = require('node:test');
const assert = require('node:assert/strict');

const sandboxProviderModule = require('../../src/sandbox/provider');
const {resolveRuntimeMaterials} = require('../../src/agent/context/provider-request-prefix');

const RUN_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'echo-fake',
  contextWindow: 200000,
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 1024},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

/** 运行派生材料只读 registry 的 catalog 事实；这里给出最小投影。 */
function createSkillRegistry(catalog = []) {
  return {
    listSkillCatalog: () => catalog
  };
}

/** 沙箱可用性由运行平台决定；用桩替换 runtime note，断言调用口径而不是探测结果。 */
function withPatchedSandboxNote(note, callback) {
  const original = sandboxProviderModule.createSandboxRuntimeNote;
  const calls = [];
  sandboxProviderModule.createSandboxRuntimeNote = (config, executionMode, options) => {
    calls.push({config, executionMode, options});
    return note;
  };

  try {
    return callback(calls);
  } finally {
    sandboxProviderModule.createSandboxRuntimeNote = original;
  }
}

test('resolveRuntimeMaterials derives window, skill projection and sandbox note from run inputs', () => {
  const catalog = [{name: 'review', description: 'Review the current diff', sourceKind: 'builtin', sourcePath: '/tmp/skills/review'}];

  withPatchedSandboxNote('filesystem writes are limited to temp directories', (calls) => {
    const materials = resolveRuntimeMaterials({
      config: {...RUN_CONFIG, tools: {...RUN_CONFIG.tools, sandbox: {mode: 'workspace-write', network: true, extraWritablePaths: []}}},
      executionMode: {kind: 'interactive'},
      registry: createSkillRegistry(catalog),
      sandboxModeOverride: 'read-only',
      skillCatalogContextRatio: 0.02
    });

    assert.equal(materials.contextWindow, 200000);
    assert.deepEqual(materials.skillCatalog, catalog);
    assert.equal(materials.sandboxNote, 'filesystem writes are limited to temp directories');
    assert.equal(materials.skillCatalogProjection.budgetTokens, 4000);
    assert.equal(materials.skillCatalogProjection.mode, 'full');
    assert.ok(materials.skillCatalogTokens > 0);
    // 运行级收紧与执行模式必须逐字传给沙箱判定，口径与主运行一致。
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].options, {modeOverride: 'read-only'});
    assert.deepEqual(calls[0].executionMode, {kind: 'interactive'});
  });
});

test('resolveRuntimeMaterials omits the sandbox note when the sandbox is disabled', () => {
  const materials = resolveRuntimeMaterials({
    config: RUN_CONFIG,
    executionMode: {kind: 'interactive'},
    // 无 listSkillCatalog 的 registry 按空目录投影，不视为配置错误。
    registry: {},
    skillCatalogContextRatio: 0.02
  });

  assert.equal('sandboxNote' in materials, false);
  assert.deepEqual(materials.skillCatalog, []);
  assert.equal(materials.skillCatalogTokens, 0);
});

test('resolveRuntimeMaterials bounds the catalog projection by the run window budget', () => {
  const catalog = [
    {name: 'alpha', description: 'A'.repeat(400), sourceKind: 'builtin', sourcePath: '/tmp/skills/alpha'},
    {name: 'beta', description: 'B'.repeat(400), sourceKind: 'builtin', sourcePath: '/tmp/skills/beta'}
  ];
  const materials = resolveRuntimeMaterials({
    config: {...RUN_CONFIG, contextWindow: 100},
    executionMode: {kind: 'interactive'},
    registry: createSkillRegistry(catalog),
    skillCatalogContextRatio: 0.02
  });

  // 预算只有 2 token，完整与仅名称都放不下时退回 names_only；目录与预算事实同源。
  assert.equal(materials.skillCatalogProjection.budgetTokens, 2);
  assert.equal(materials.skillCatalogProjection.mode, 'names_only');
  assert.ok(materials.skillCatalog.every((entry) => entry.description === ''));
});
