const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const {
  readAgentMemoryCatalog,
  setAgentMemoryCatalogEnabled,
  setAgentMemoryItemEnabled,
  updateAgentMemoryItem
} = require('../../src/memory/agent-memory-store');
const {createSkillRegistry} = require('../../src/skills/skill-registry');

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-memory-skill-'));
  const home = path.join(root, 'home');
  const cwdPath = path.join(root, 'project');
  fs.mkdirSync(path.join(cwdPath, '.git'), {recursive: true});
  fs.mkdirSync(home, {recursive: true});
  const cwd = fs.realpathSync(cwdPath);
  return {
    cwd,
    home,
    storageRoot: path.join(home, '.echo', 'agent-memory'),
    run(args) {
      return spawnSync(process.execPath, [require.resolve('../../src/skills/builtin/agent-memory/scripts/memory'), ...args], {
        cwd,
        encoding: 'utf8',
        env: {...process.env, HOME: home}
      });
    }
  };
}

function output(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('packaged agent-memory skill exposes its complete protocol and script resource', () => {
  const registry = createSkillRegistry({
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-memory-registry-')),
    projectSkillsDir: '/missing-project-skills',
    userSkillsDir: '/missing-user-skills'
  });
  const result = registry.loadSkill('agent-memory');

  assert.equal(result.ok, true);
  assert.equal(result.skill.sourceKind, 'builtin');
  assert.match(result.skill.content, /Never directly read, edit, patch, or delete/);
  assert.match(result.skill.content, /update-catalog/);
  assert.match(result.skill.content, /Successful commands print JSON/);
  assert.deepEqual(result.skill.resources, ['scripts/memory.js']);
  assert.ok(require('../../../package.json').files.includes('dist/src'));
});

test('agent-memory script resolves its store from a relocated package tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-memory-install-'));
  const installedSrc = path.join(root, 'node_modules', '@eumendies', 'echo-tui', 'dist', 'src');
  fs.cpSync(path.resolve(__dirname, '../../src'), installedSrc, {recursive: true});
  const scriptPath = path.join(installedSrc, 'skills', 'builtin', 'agent-memory', 'scripts', 'memory.js');
  const cwd = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
  fs.mkdirSync(home, {recursive: true});

  const result = spawnSync(process.execPath, [scriptPath, 'validate'], {
    cwd,
    encoding: 'utf8',
    env: {...process.env, HOME: home}
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {valid: true, catalogCount: 0, itemCount: 0});
});

test('agent-memory script shares store semantics across read, mutation, scope and validation', () => {
  const harness = createHarness();
  const userMemoryPath = path.join(harness.home, '.echo', 'memories.json');
  fs.mkdirSync(path.dirname(userMemoryPath), {recursive: true});
  fs.writeFileSync(userMemoryPath, '{"sentinel":true}\n', 'utf8');

  const added = output(harness.run(['add', '--catalog', 'rendering', '--description', 'Terminal rules', '--content', 'Use real cursors']));
  assert.equal(added.catalog.scope, 'project');
  const itemId = added.memory.id;
  const projectRead = output(harness.run(['read', '--catalog', 'rendering']));
  assert.equal(projectRead.catalog.scope, 'project');
  assert.deepEqual(projectRead.memories, [{id: itemId, content: 'Use real cursors'}]);

  assert.equal(updateAgentMemoryItem(harness.cwd, 'rendering', itemId, 'Use terminal cursors', 'project', {storageRoot: harness.storageRoot}).ok, true);
  assert.equal(output(harness.run(['read', '--catalog', 'rendering'])).memories[0].content, 'Use terminal cursors');

  assert.equal(setAgentMemoryItemEnabled(harness.cwd, 'rendering', itemId, false, 'project', {storageRoot: harness.storageRoot}).ok, true);
  assert.deepEqual(output(harness.run(['read', '--catalog', 'rendering'])).memories, []);
  assert.equal(setAgentMemoryItemEnabled(harness.cwd, 'rendering', itemId, true, 'project', {storageRoot: harness.storageRoot}).ok, true);

  output(harness.run(['update-item', '--catalog', 'rendering', '--item-id', itemId, '--content', 'Use stable cursors', '--scope', 'project']));
  output(harness.run(['update-catalog', '--catalog', 'rendering', '--name', 'terminal', '--description', 'Stable terminal rules', '--scope', 'project']));
  assert.equal(readAgentMemoryCatalog(harness.cwd, 'terminal', 'project', {storageRoot: harness.storageRoot}).ok, true);

  output(harness.run(['add', '--catalog', 'preferences', '--description', 'Global preferences', '--content', 'Use concise Chinese', '--scope', 'global']));
  assert.equal(readAgentMemoryCatalog(harness.cwd, 'preferences', 'global', {storageRoot: harness.storageRoot}).ok, true);
  assert.equal(output(harness.run(['read', '--catalog', 'preferences'])).catalog.scope, 'global');
  assert.deepEqual(output(harness.run(['validate'])), {valid: true, catalogCount: 2, itemCount: 2});

  output(harness.run(['remove-item', '--catalog', 'terminal', '--item-id', itemId, '--scope', 'project']));
  assert.equal(readAgentMemoryCatalog(harness.cwd, 'terminal', 'project', {storageRoot: harness.storageRoot}).ok, false);
  output(harness.run(['remove-catalog', '--catalog', 'preferences', '--scope', 'global']));
  assert.equal(fs.readFileSync(userMemoryPath, 'utf8'), '{"sentinel":true}\n');
});

test('agent-memory script rejects invalid arguments and invalid storage without overwriting it', () => {
  const harness = createHarness();
  const invalidArgs = harness.run(['add', '--catalog', 'rules']);
  assert.notEqual(invalidArgs.status, 0);
  assert.match(invalidArgs.stderr, /--content is required/);

  fs.mkdirSync(harness.storageRoot, {recursive: true});
  const indexPath = path.join(harness.storageRoot, 'catalogs.json');
  fs.writeFileSync(indexPath, '{not-json', 'utf8');
  const invalidStorage = harness.run(['validate']);
  assert.notEqual(invalidStorage.status, 0);
  assert.match(invalidStorage.stderr, /JSON|Unexpected|position|property/i);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), '{not-json');
});

test('agent-memory mutations require exact scope and reject disabled catalogs', () => {
  const harness = createHarness();
  output(harness.run(['add', '--catalog', 'preferences', '--description', 'Global preferences', '--content', 'Use concise Chinese', '--scope', 'global']));

  const missingScope = harness.run(['update-catalog', '--catalog', 'preferences', '--description', 'Changed']);
  assert.notEqual(missingScope.status, 0);
  assert.match(missingScope.stderr, /--scope is required/);

  output(harness.run(['add', '--catalog', 'rules', '--description', 'Project rules', '--content', 'Keep tests focused']));
  assert.equal(setAgentMemoryCatalogEnabled(harness.cwd, 'rules', false, 'project', {storageRoot: harness.storageRoot}).ok, true);
  const disabledUpdate = harness.run(['update-catalog', '--catalog', 'rules', '--description', 'Changed', '--scope', 'project']);
  const disabledRemove = harness.run(['remove-catalog', '--catalog', 'rules', '--scope', 'project']);
  const disabledAdd = harness.run(['add', '--catalog', 'rules', '--content', 'Another fact']);

  for (const result of [disabledUpdate, disabledRemove, disabledAdd]) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /已停用/);
  }
  assert.equal(readAgentMemoryCatalog(harness.cwd, 'rules', 'project', {storageRoot: harness.storageRoot}).ok, true);
});
