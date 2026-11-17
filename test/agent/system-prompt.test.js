const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deleteSystemPromptOverride,
  getDefaultGlobalSystemPromptPath,
  loadSystemPromptOverride,
  resolveSystemPromptSnapshot,
  writeSystemPromptOverride
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

// 可写假 fs：记录写入、rename、mkdir 与 unlink，供原子替换和删除语义校验。
function createWritableFs(entries, readFailures = []) {
  const failures = new Set(readFailures);
  const writes = [];
  const renames = [];
  const mkdirs = [];
  const unlinks = [];

  return {
    entries,
    writes,
    renames,
    mkdirs,
    unlinks,
    io: {
      createTempPath: (targetPath) => `${targetPath}.tmp`,
      mkdir(dirPath, options) {
        mkdirs.push([dirPath, options]);
      },
      readFile(filePath) {
        const entry = entries[filePath];

        if (!entry || entry.kind !== 'file' || failures.has(filePath)) {
          throw new Error(`cannot read ${filePath}`);
        }

        return entry.content;
      },
      rename(from, to) {
        renames.push([from, to]);
        entries[to] = entries[from];
        delete entries[from];
      },
      stat(filePath) {
        const entry = entries[filePath];

        if (!entry) {
          throw new Error(`missing ${filePath}`);
        }

        return createStats(entry.kind);
      },
      unlink(filePath) {
        if (!entries[filePath]) {
          const error = new Error(`missing ${filePath}`);
          error.code = 'ENOENT';
          throw error;
        }

        unlinks.push(filePath);
        delete entries[filePath];
      },
      writeFile(filePath, data) {
        writes.push([filePath, data]);
        entries[filePath] = {kind: 'file', content: data};
      }
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

test('resolveSystemPromptSnapshot reports both targets and prefers the project file', () => {
  const fs = createFakeFs({
    '/home/user/.echo/SYSTEM.md': {kind: 'file', content: 'global prompt'},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/SYSTEM.md': {kind: 'file', content: 'project prompt'}
  });

  const snapshot = resolveSystemPromptSnapshot({
    cwd: '/work/repo/src',
    fs: {readFile: fs.readFile, stat: fs.stat},
    homedir: '/home/user',
  });

  assert.equal(snapshot.sourceKind, 'project');
  assert.equal(snapshot.baseContent, 'project prompt');
  assert.deepEqual(snapshot.project, {
    content: 'project prompt',
    exists: true,
    filePath: '/work/repo/SYSTEM.md',
    lines: 1
  });
  assert.equal(snapshot.global.exists, true);
  assert.equal(snapshot.global.filePath, '/home/user/.echo/SYSTEM.md');
});

test('resolveSystemPromptSnapshot treats empty files as absent and isolates unreadable targets', () => {
  const fs = createFakeFs({
    '/home/user/.echo/SYSTEM.md': {kind: 'file', content: 'global prompt'},
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/SYSTEM.md': {kind: 'file', content: ' \r\n '}
  }, ['/work/repo/SYSTEM.md']);

  const snapshot = resolveSystemPromptSnapshot({
    cwd: '/work/repo',
    fs: {readFile: fs.readFile, stat: fs.stat},
    homedir: '/home/user',
  });

  assert.equal(snapshot.project.exists, false);
  assert.equal(snapshot.project.unavailableReason, '读取失败（权限或编码问题）');
  assert.equal(snapshot.sourceKind, 'global');
  assert.equal(snapshot.baseContent, 'global prompt');
});

test('resolveSystemPromptSnapshot falls back to builtin when no override exists', () => {
  const fs = createFakeFs({});

  const snapshot = resolveSystemPromptSnapshot({
    cwd: '/work/repo',
    fs: {readFile: fs.readFile, stat: fs.stat},
    homedir: '/home/user',
  });

  assert.equal(snapshot.sourceKind, 'builtin');
  assert.equal(snapshot.baseContent.startsWith("You are Echo TUI's built-in terminal development assistant."), true);
  assert.equal(snapshot.project.exists, false);
  assert.equal(snapshot.global.exists, false);
});

test('resolveSystemPromptSnapshot falls back to cwd when no project marker exists', () => {
  const fs = createFakeFs({});

  const snapshot = resolveSystemPromptSnapshot({
    cwd: '/tmp/plain',
    fs: {readFile: fs.readFile, stat: fs.stat},
    homedir: '/home/user'
  });

  assert.equal(snapshot.project.filePath, '/tmp/plain/SYSTEM.md');
  assert.equal(snapshot.global.filePath, '/home/user/.echo/SYSTEM.md');
});

test('writeSystemPromptOverride normalizes content, creates parents, and replaces atomically', () => {
  const fs = createWritableFs({});

  const result = writeSystemPromptOverride({
    content: '  first line\r\nsecond line  ',
    cwd: '/work/repo',
    fs: fs.io,
    homedir: '/home/user',
    target: 'project'
  });

  assert.deepEqual(result, {
    ok: true,
    filePath: '/work/repo/SYSTEM.md',
    overwritten: false,
    unchanged: false
  });
  assert.deepEqual(fs.mkdirs, [['/work/repo', {recursive: true}]]);
  assert.deepEqual(fs.writes, [['/work/repo/SYSTEM.md.tmp', 'first line\nsecond line']]);
  assert.deepEqual(fs.renames, [['/work/repo/SYSTEM.md.tmp', '/work/repo/SYSTEM.md']]);
  assert.equal(fs.entries['/work/repo/SYSTEM.md'].content, 'first line\nsecond line');
});

test('writeSystemPromptOverride skips writing when normalized content is unchanged', () => {
  const fs = createWritableFs({
    '/home/user/.echo/SYSTEM.md': {kind: 'file', content: 'same prompt\r\n'}
  });

  const result = writeSystemPromptOverride({
    content: 'same prompt',
    cwd: '/work/repo',
    fs: fs.io,
    homedir: '/home/user',
    target: 'global'
  });

  assert.deepEqual(result, {
    ok: true,
    filePath: '/home/user/.echo/SYSTEM.md',
    overwritten: true,
    unchanged: true
  });
  assert.deepEqual(fs.writes, []);
  assert.deepEqual(fs.renames, []);
});

test('writeSystemPromptOverride rejects empty content without touching disk', () => {
  const fs = createWritableFs({});

  const result = writeSystemPromptOverride({
    content: '  \r\n ',
    cwd: '/work/repo',
    fs: fs.io,
    homedir: '/home/user',
    target: 'project'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'empty');
  assert.match(result.error, /内容为空/);
  assert.deepEqual(fs.writes, []);
  assert.deepEqual(fs.renames, []);
});

test('writeSystemPromptOverride reports write failures without leaving a temp file rename', () => {
  const fs = createWritableFs({});
  fs.io.writeFile = () => {
    throw new Error('磁盘只读');
  };

  const result = writeSystemPromptOverride({
    content: 'prompt',
    cwd: '/work/repo',
    fs: fs.io,
    homedir: '/home/user',
    target: 'project'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write_failed');
  assert.match(result.error, /磁盘只读/);
  assert.match(result.error, /写入临时文件/);
  assert.deepEqual(fs.renames, []);
  // 临时文件写失败后会被尽力清理，避免留下半成品。
  assert.deepEqual(fs.entries['/work/repo/SYSTEM.md.tmp'], undefined);
});

test('deleteSystemPromptOverride removes only the target and treats ENOENT as success', () => {
  const fs = createWritableFs({
    '/work/repo/.git': {kind: 'dir'},
    '/work/repo/AGENTS.md': {kind: 'file', content: 'agents'},
    '/work/repo/SYSTEM.md': {kind: 'file', content: 'project prompt'},
    '/home/user/.echo/SYSTEM.md': {kind: 'file', content: 'global prompt'}
  });

  assert.deepEqual(deleteSystemPromptOverride({
    cwd: '/work/repo',
    fs: fs.io,
    homedir: '/home/user',
    target: 'project'
  }), {ok: true, filePath: '/work/repo/SYSTEM.md', removed: true});
  assert.deepEqual(fs.unlinks, ['/work/repo/SYSTEM.md']);
  assert.equal(fs.entries['/work/repo/AGENTS.md'].content, 'agents');
  assert.equal(fs.entries['/home/user/.echo/SYSTEM.md'].content, 'global prompt');

  assert.deepEqual(deleteSystemPromptOverride({
    cwd: '/work/repo',
    fs: fs.io,
    homedir: '/home/user',
    target: 'project'
  }), {ok: true, filePath: '/work/repo/SYSTEM.md', removed: false});
  assert.deepEqual(fs.unlinks, ['/work/repo/SYSTEM.md']);
});
