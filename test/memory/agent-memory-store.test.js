const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  addAgentMemory,
  listAgentMemoryCatalogs,
  listEffectiveAgentMemoryCatalogs,
  readAgentMemoryCatalog,
  readEffectiveAgentMemoryCatalog,
  removeAgentMemoryCatalog,
  removeAgentMemoryItem,
  setAgentMemoryCatalogEnabled,
  setAgentMemoryItemEnabled,
  updateAgentMemoryCatalog,
  updateAgentMemoryItem
} = require('../../src/memory/agent-memory-store');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-memory-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  let id = 0;
  return {root, project, options: {storageRoot: path.join(root, 'store'), createId: () => `id-${++id}`, getNow: () => new Date('2026-07-12T00:00:00.000Z')}};
}

test('agent memory store creates catalog, appends items, updates and removes the empty catalog', () => {
  const {project, options} = fixture();
  let result = addAgentMemory(project, {catalog: 'Rendering', description: 'Terminal rendering knowledge', content: 'Use real cursors.'}, options);
  assert.equal(result.ok, true);
  assert.equal(result.catalogs.length, 1);
  assert.equal(result.catalog.enabled, true);
  assert.equal(result.memories[0].enabled, true);
  const firstId = result.memories[0].id;

  result = addAgentMemory(project, {catalog: 'rendering', content: 'Reserve the final column.'}, options);
  assert.equal(result.ok, true);
  assert.equal(result.catalogs.length, 1);
  assert.equal(result.memories.length, 2);

  result = updateAgentMemoryCatalog(project, 'rendering', {name: 'terminal', description: 'Terminal rules'}, undefined, options);
  assert.equal(result.ok, true);
  result = updateAgentMemoryItem(project, 'terminal', firstId, 'Use the real terminal cursor.', undefined, options);
  assert.equal(result.ok, true);
  assert.equal(result.memories[0].content, 'Use the real terminal cursor.');

  const secondId = result.memories[1].id;
  assert.equal(removeAgentMemoryItem(project, 'terminal', firstId, undefined, options).ok, true);
  result = removeAgentMemoryItem(project, 'terminal', secondId, undefined, options);
  assert.equal(result.ok, true);
  assert.equal(result.removedCatalog, true);
  assert.deepEqual(listAgentMemoryCatalogs(project, options), {ok: true, catalogs: []});
});

test('agent memory store filters project scope and lets project catalogs shadow global names', () => {
  const {root, project, options} = fixture();
  const other = path.join(root, 'other');
  fs.mkdirSync(path.join(other, '.git'), {recursive: true});
  assert.equal(addAgentMemory(project, {catalog: 'shared', description: 'global', content: 'global item', scope: 'global'}, options).ok, true);
  assert.equal(addAgentMemory(project, {catalog: 'shared', description: 'project', content: 'project item'}, options).ok, true);
  assert.equal(addAgentMemory(other, {catalog: 'other-only', description: 'other', content: 'other item'}, options).ok, true);

  const effective = listEffectiveAgentMemoryCatalogs(project, options);
  assert.equal(effective.ok, true);
  assert.deepEqual(effective.catalogs.map((catalog) => [catalog.name, catalog.description]), [['shared', 'project']]);
  assert.equal(readAgentMemoryCatalog(project, 'shared', undefined, options).memories[0].content, 'project item');
  assert.equal(readAgentMemoryCatalog(project, 'shared', 'global', options).memories[0].content, 'global item');
  assert.equal(readAgentMemoryCatalog(project, 'other-only', undefined, options).ok, false);
});

test('agent memory store toggles catalogs and falls back from disabled project to enabled global', () => {
  const {project, options} = fixture();
  assert.equal(addAgentMemory(project, {catalog: 'shared', description: 'global', content: 'global item', scope: 'global'}, options).ok, true);
  assert.equal(addAgentMemory(project, {catalog: 'shared', description: 'project', content: 'project item'}, options).ok, true);

  const disabled = setAgentMemoryCatalogEnabled(project, 'shared', false, 'project', options);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.catalog.enabled, false);
  assert.deepEqual(listAgentMemoryCatalogs(project, options).catalogs.map((catalog) => [catalog.scope.kind, catalog.enabled]), [['global', true], ['project', false]]);
  assert.deepEqual(listEffectiveAgentMemoryCatalogs(project, options).catalogs.map((catalog) => [catalog.scope.kind, catalog.name]), [['global', 'shared']]);

  const implicit = readEffectiveAgentMemoryCatalog(project, 'shared', undefined, options);
  assert.equal(implicit.ok, true);
  assert.equal(implicit.catalog.scope.kind, 'global');
  assert.equal(implicit.memories[0].content, 'global item');
  assert.equal(readEffectiveAgentMemoryCatalog(project, 'shared', 'project', options).ok, false);
  assert.equal(readAgentMemoryCatalog(project, 'shared', 'project', options).ok, true);
});

test('agent memory store keeps disabled items manageable but filters them from effective reads', () => {
  const {project, options} = fixture();
  let result = addAgentMemory(project, {catalog: 'rendering', description: 'rules', content: 'first'}, options);
  const firstId = result.memories[0].id;
  result = addAgentMemory(project, {catalog: 'rendering', content: 'second'}, options);
  const secondId = result.memories[1].id;

  result = setAgentMemoryItemEnabled(project, 'rendering', firstId, false, undefined, options);
  assert.equal(result.ok, true);
  assert.equal(result.memories.find((item) => item.id === firstId).enabled, false);
  assert.equal(result.memories.find((item) => item.id === secondId).enabled, true);
  assert.deepEqual(readAgentMemoryCatalog(project, 'rendering', undefined, options).memories.map((item) => item.content), ['first', 'second']);
  assert.deepEqual(readEffectiveAgentMemoryCatalog(project, 'rendering', undefined, options).memories.map((item) => item.content), ['second']);
});

test('agent memory store preserves invalid index and reports failed writes', () => {
  const {project, options} = fixture();
  fs.mkdirSync(options.storageRoot, {recursive: true});
  const indexPath = path.join(options.storageRoot, 'catalogs.json');
  fs.writeFileSync(indexPath, '{bad', 'utf8');
  assert.equal(addAgentMemory(project, {catalog: 'x', description: 'x', content: 'x'}, options).ok, false);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), '{bad');

  fs.rmSync(options.storageRoot, {recursive: true, force: true});
  const failed = addAgentMemory(project, {catalog: 'x', description: 'x', content: 'x'}, {...options, writeFile() { throw new Error('disk full'); }});
  assert.equal(failed.ok, false);
  assert.match(failed.error, /disk full/);
});

test('agent memory store rejects duplicate catalog names within one scope', () => {
  const {project, options} = fixture();
  fs.mkdirSync(options.storageRoot, {recursive: true});
  const indexPath = path.join(options.storageRoot, 'catalogs.json');
  const index = {
    version: 1,
    catalogs: [
      {id: 'catalog-1', name: 'Rendering', description: 'First', enabled: true, scope: {kind: 'global'}},
      {id: 'catalog-2', name: 'rendering', description: 'Second', enabled: true, scope: {kind: 'global'}}
    ]
  };
  fs.writeFileSync(indexPath, JSON.stringify(index), 'utf8');

  const result = listAgentMemoryCatalogs(project, options);
  assert.equal(result.ok, false);
  assert.match(result.error, /同一 scope 包含同名 catalog/);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), JSON.stringify(index));
});

test('agent memory store rejects version 1 files without enabled fields', () => {
  const {project, options} = fixture();
  fs.mkdirSync(options.storageRoot, {recursive: true});
  const indexPath = path.join(options.storageRoot, 'catalogs.json');
  fs.writeFileSync(indexPath, JSON.stringify({version: 1, catalogs: [
    {id: 'catalog-1', name: 'rendering', description: 'rules', scope: {kind: 'global'}}
  ]}), 'utf8');
  assert.equal(listAgentMemoryCatalogs(project, options).ok, false);

  fs.writeFileSync(indexPath, JSON.stringify({version: 1, catalogs: [
    {id: 'catalog-1', name: 'rendering', description: 'rules', enabled: true, scope: {kind: 'global'}}
  ]}), 'utf8');
  fs.mkdirSync(path.join(options.storageRoot, 'catalogs'), {recursive: true});
  fs.writeFileSync(path.join(options.storageRoot, 'catalogs', 'catalog-1.json'), JSON.stringify({version: 1, catalogId: 'catalog-1', memories: [
    {id: 'item-1', content: 'rule', createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z'}
  ]}), 'utf8');
  assert.equal(readAgentMemoryCatalog(project, 'rendering', 'global', options).ok, false);
});

test('removing an agent catalog removes it from the index', () => {
  const {project, options} = fixture();
  assert.equal(addAgentMemory(project, {catalog: 'x', description: 'desc', content: 'item'}, options).ok, true);
  const removed = removeAgentMemoryCatalog(project, 'x', undefined, options);
  assert.equal(removed.ok, true);
  assert.equal(removed.removedCatalog, true);
  assert.deepEqual(removed.catalogs, []);
});
