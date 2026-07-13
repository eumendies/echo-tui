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
  removeAgentMemoryCatalog,
  removeAgentMemoryItem,
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
      {id: 'catalog-1', name: 'Rendering', description: 'First', scope: {kind: 'global'}},
      {id: 'catalog-2', name: 'rendering', description: 'Second', scope: {kind: 'global'}}
    ]
  };
  fs.writeFileSync(indexPath, JSON.stringify(index), 'utf8');

  const result = listAgentMemoryCatalogs(project, options);
  assert.equal(result.ok, false);
  assert.match(result.error, /同一 scope 包含同名 catalog/);
  assert.equal(fs.readFileSync(indexPath, 'utf8'), JSON.stringify(index));
});

test('removing an agent catalog removes it from the index', () => {
  const {project, options} = fixture();
  assert.equal(addAgentMemory(project, {catalog: 'x', description: 'desc', content: 'item'}, options).ok, true);
  const removed = removeAgentMemoryCatalog(project, 'x', undefined, options);
  assert.equal(removed.ok, true);
  assert.equal(removed.removedCatalog, true);
  assert.deepEqual(removed.catalogs, []);
});
