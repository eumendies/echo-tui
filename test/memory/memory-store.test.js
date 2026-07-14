const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createUserMemory,
  deleteUserMemory,
  readUserMemories,
  updateUserMemory
} = require('../../src/memory/memory-store');

function withTemporaryMemoryStore(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-memory-'));
  const storagePath = path.join(dir, '.echo', 'memories.json');

  try {
    return callback({dir, storagePath});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}

test('memory store treats a missing file as an empty collection and writes versioned entries atomically', () => {
  withTemporaryMemoryStore(({storagePath}) => {
    assert.deepEqual(readUserMemories({storagePath}), {ok: true, memories: []});
    const created = createUserMemory('使用 TypeScript\r\n注释使用中文', {
      storagePath,
      createId: () => 'memory-1',
      getNow: () => new Date('2026-07-12T07:00:00.000Z')
    });

    assert.deepEqual(created, {
      ok: true,
      memories: [{
        id: 'memory-1',
        content: '使用 TypeScript\n注释使用中文',
        enabled: true,
        createdAt: '2026-07-12T07:00:00.000Z',
        updatedAt: '2026-07-12T07:00:00.000Z'
      }]
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(storagePath, 'utf8')), {version: 1, memories: created.memories});
  });
});

test('memory store updates and deletes saved entries', () => {
  withTemporaryMemoryStore(({storagePath}) => {
    const created = createUserMemory('旧内容', {storagePath, createId: () => 'memory-1', getNow: () => new Date('2026-07-12T07:00:00.000Z')});
    const updated = updateUserMemory('memory-1', '新内容', {storagePath, getNow: () => new Date('2026-07-13T07:00:00.000Z')});

    assert.equal(updated.ok, true);
    assert.deepEqual(updated.memories[0], {...created.memories[0], content: '新内容', updatedAt: '2026-07-13T07:00:00.000Z'});
    assert.deepEqual(deleteUserMemory('memory-1', {storagePath}), {ok: true, memories: []});
  });
});

test('memory store reads legacy entries as enabled and persists enabled state changes', () => {
  withTemporaryMemoryStore(({storagePath}) => {
    fs.mkdirSync(path.dirname(storagePath), {recursive: true});
    fs.writeFileSync(storagePath, JSON.stringify({version: 1, memories: [{
      id: 'memory-1',
      content: '旧 memory',
      createdAt: '2026-07-12T07:00:00.000Z',
      updatedAt: '2026-07-12T07:00:00.000Z'
    }]}), 'utf8');
    const {setUserMemoryEnabled} = require('../../src/memory/memory-store');
    const updated = setUserMemoryEnabled('memory-1', false, {storagePath, getNow: () => new Date('2026-07-13T07:00:00.000Z')});

    assert.equal(updated.ok, true);
    assert.equal(updated.memories[0].enabled, false);
    assert.equal(readUserMemories({storagePath}).memories[0].enabled, false);
  });
});

test('memory store preserves invalid files and reports write failures', () => {
  withTemporaryMemoryStore(({storagePath}) => {
    fs.mkdirSync(path.dirname(storagePath), {recursive: true});
    fs.writeFileSync(storagePath, '{not-json', 'utf8');
    const invalid = createUserMemory('不会覆盖', {storagePath});

    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /JSON|property name/i);
    assert.equal(fs.readFileSync(storagePath, 'utf8'), '{not-json');

    const failed = createUserMemory('无法写入', {
      storagePath: path.join(path.dirname(storagePath), 'other.json'),
      writeFile() {
        throw new Error('disk full');
      }
    });
    assert.deepEqual(failed, {ok: false, error: '无法保存 memory 文件：disk full'});
  });
});
