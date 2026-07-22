const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getDefaultGlobalSystemPromptPath,
  loadSystemPromptOverride
} = require('../../src/agent/context/system-prompt');

function createStats(kind) {
  return {
    isDirectory() {
      return kind === 'dir';
    },
    isFile() {
      return kind === 'file';
    }
  };
}

function createFakeFs(entries, readFailures = []) {
  const failures = new Set(readFailures);

  return {
    readFile(filePath) {
      const entry = entries[filePath];

      if (!entry || entry.kind !== 'file' || failures.has(filePath)) {
        throw new Error(`cannot read ${filePath}`);
      }

      return entry.content;
    },
    stat(filePath) {
      const entry = entries[filePath];

      if (!entry) {
        throw new Error(`missing ${filePath}`);
      }

      return createStats(entry.kind);
    }
  };
}

test('loadSystemPromptOverride prefers project SYSTEM.md over the user-level file', () => {
  const fs = createFakeFs({
    '/home/user/.echo/SYSTEM.md': {kind: 'file', content: 'global prompt'},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/SYSTEM.md': {kind: 'file', content: 'project prompt'}
  });

  const result = loadSystemPromptOverride({
    cwd: '/work/repo/src',
    homedir: '/home/user',
    readFile: fs.readFile,
    stat: fs.stat
  });

  assert.deepEqual(result, {
    content: 'project prompt',
    filePath: '/work/repo/SYSTEM.md',
    sourceKind: 'project'
  });
});

test('loadSystemPromptOverride falls back from invalid project files and normalizes the user-level file', () => {
  const entries = {
    '/home/user/.echo/SYSTEM.md': {kind: 'file', content: '  global\r\nprompt  '},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/SYSTEM.md': {kind: 'file', content: 'unreadable'}
  };
  const fs = createFakeFs(entries, ['/work/repo/SYSTEM.md']);

  const result = loadSystemPromptOverride({
    cwd: '/work/repo/src',
    homedir: '/home/user',
    readFile: fs.readFile,
    stat: fs.stat
  });

  assert.equal(getDefaultGlobalSystemPromptPath('/home/user'), '/home/user/.echo/SYSTEM.md');
  assert.deepEqual(result, {
    content: 'global\nprompt',
    filePath: '/home/user/.echo/SYSTEM.md',
    sourceKind: 'global'
  });
});

test('loadSystemPromptOverride uses cwd as project root without a marker and ignores empty candidates', () => {
  const emptyFs = createFakeFs({
    '/tmp/work/SYSTEM.md': {kind: 'file', content: ' \n '},
    '/home/user/.echo/SYSTEM.md': {kind: 'dir'}
  });
  const cwdFs = createFakeFs({
    '/tmp/work/SYSTEM.md': {kind: 'file', content: 'cwd prompt'}
  });

  assert.equal(loadSystemPromptOverride({
    cwd: '/tmp/work',
    homedir: '/home/user',
    readFile: emptyFs.readFile,
    stat: emptyFs.stat
  }), null);
  assert.deepEqual(loadSystemPromptOverride({
    cwd: '/tmp/work',
    homedir: '/home/user',
    readFile: cwdFs.readFile,
    stat: cwdFs.stat
  }), {
    content: 'cwd prompt',
    filePath: '/tmp/work/SYSTEM.md',
    sourceKind: 'project'
  });
});

test('loadSystemPromptOverride preserves SYSTEM.md content beyond the previous byte limit', () => {
  const content = '规则'.repeat(12_000);
  const fs = createFakeFs({
    '/tmp/work/SYSTEM.md': {kind: 'file', content}
  });

  const result = loadSystemPromptOverride({
    cwd: '/tmp/work',
    homedir: '/home/user',
    readFile: fs.readFile,
    stat: fs.stat
  });

  assert.equal(Buffer.byteLength(content, 'utf8') > 64 * 1024, true);
  assert.equal(result.content, content);
});
