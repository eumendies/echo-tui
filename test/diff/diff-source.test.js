const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const {parseUnifiedDiff} = require('../../src/app/diff/unified-parser');
const {createDiffSourceResult, createHistoryDiffSource} = require('../../src/app/diff/source');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-diff-source-'));
}

function removeTempDir(cwd) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.rmSync(cwd, {recursive: true, force: true});
      return;
    } catch (error) {
      if (attempt === 2 || !error || !['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error.code)) {
        throw error;
      }
    }
  }
}

function run(command, args, cwd) {
  return spawnSync(command, args, {cwd, encoding: 'utf8'});
}

function hasGit() {
  return !spawnSync('git', ['--version'], {encoding: 'utf8'}).error;
}

test('parseUnifiedDiff parses modified, added, deleted, and renamed textual files', () => {
  const files = parseUnifiedDiff([
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1,2 +1,2 @@',
    ' old',
    '-left',
    '+right',
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1 @@',
    '+created',
    'diff --git a/deleted.txt b/deleted.txt',
    'deleted file mode 100644',
    '--- a/deleted.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    'diff --git a/old-name.txt b/new-name.txt',
    'rename from old-name.txt',
    'rename to new-name.txt',
    '--- a/old-name.txt',
    '+++ b/new-name.txt',
    '@@ -1 +1 @@',
    '-old',
    '+new'
  ].join('\n'));

  assert.deepEqual(files.map((file) => ({path: file.path, oldPath: file.oldPath, kind: file.kind, added: file.added, removed: file.removed})), [
    {path: 'a.txt', oldPath: undefined, kind: 'modified', added: 1, removed: 1},
    {path: 'new.txt', oldPath: undefined, kind: 'added', added: 1, removed: 0},
    {path: 'deleted.txt', oldPath: undefined, kind: 'deleted', added: 0, removed: 1},
    {path: 'new-name.txt', oldPath: 'old-name.txt', kind: 'renamed', added: 1, removed: 1}
  ]);
});

test('createHistoryDiffSource folds multiple entries for one file into final diff', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'after\n', 'utf8');
  const result = createHistoryDiffSource({
    cwd,
    changeHistory: [
      {
        id: 'one',
        createdAt: '2026-05-19T00:00:00.000Z',
        cwd,
        transcriptStartIndex: 0,
        status: 'ready',
        files: [{path: target, snapshot: {exists: true, content: 'before\n'}, state: 'updated'}]
      },
      {
        id: 'two',
        createdAt: '2026-05-19T00:00:01.000Z',
        cwd,
        transcriptStartIndex: 1,
        status: 'ready',
        files: [{path: target, snapshot: {exists: true, content: 'middle\n'}, state: 'updated'}]
      }
    ]
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].path, 'file.txt');
  assert.equal(result.files[0].removed, 1);
  assert.equal(result.files[0].added, 1);
  assert.ok(result.notices.some((notice) => notice.includes('受控文件编辑历史拼接')));

  removeTempDir(cwd);
});

test('createHistoryDiffSource reports invalid boundary and skipped files', () => {
  const cwd = createTempDir();
  const directoryPath = path.join(cwd, 'dir');
  fs.mkdirSync(directoryPath);
  const result = createHistoryDiffSource({
    cwd,
    changeHistory: [
      {
        id: 'invalid',
        createdAt: '2026-05-19T00:00:00.000Z',
        cwd,
        transcriptStartIndex: 0,
        status: 'invalid',
        invalidReason: '写入型 bash 不可追踪',
        files: []
      },
      {
        id: 'after-invalid',
        createdAt: '2026-05-19T00:00:01.000Z',
        cwd,
        transcriptStartIndex: 1,
        status: 'ready',
        files: [{path: directoryPath, snapshot: {exists: true, content: 'before\n'}, state: 'updated'}]
      }
    ]
  });

  assert.equal(result.status, 'empty');
  assert.ok(result.notices.some((notice) => notice.includes('不可追踪写入边界')));
  assert.ok(result.notices.some((notice) => notice.includes('不是普通文件')));

  removeTempDir(cwd);
});

test('createDiffSourceResult falls back to history when git is unavailable', () => {
  const cwd = createTempDir();
  const target = path.join(cwd, 'file.txt');
  fs.writeFileSync(target, 'after\n', 'utf8');
  const result = createDiffSourceResult({
    cwd,
    gitPath: 'missing-git-for-echo-test',
    changeHistory: [
      {
        id: 'checkpoint',
        createdAt: '2026-05-19T00:00:00.000Z',
        cwd,
        transcriptStartIndex: 0,
        status: 'ready',
        files: [{path: target, snapshot: {exists: true, content: 'before\n'}, state: 'updated'}]
      }
    ]
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.source.kind, 'history');
  assert.ok(result.notices.some((notice) => notice.includes('Git')));

  removeTempDir(cwd);
});

test('createDiffSourceResult uses git source in a git worktree', () => {
  if (!hasGit()) {
    return;
  }

  const cwd = createTempDir();
  assert.equal(run('git', ['init'], cwd).status, 0);
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'before\n', 'utf8');
  assert.equal(run('git', ['add', 'file.txt'], cwd).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Echo', '-c', 'user.email=echo@example.com', 'commit', '-m', 'init'], cwd).status, 0);
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'after\n', 'utf8');

  const result = createDiffSourceResult({
    cwd,
    changeHistory: []
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.source.kind, 'git');
  assert.equal(result.files[0].path, 'file.txt');
  assert.equal(result.files[0].added, 1);
  assert.equal(result.files[0].removed, 1);

  removeTempDir(cwd);
});

test('createDiffSourceResult disables git textconv filters', () => {
  if (!hasGit()) {
    return;
  }

  const cwd = createTempDir();
  const sentinel = path.join(cwd, 'textconv-ran');
  const textconv = path.join(cwd, 'textconv.sh');
  fs.writeFileSync(textconv, `#!/bin/sh\ntouch "${sentinel}"\ncat "$1"\n`, {encoding: 'utf8', mode: 0o755});
  assert.equal(run('git', ['init'], cwd).status, 0);
  assert.equal(run('git', ['config', 'diff.echo-textconv.textconv', textconv], cwd).status, 0);
  fs.writeFileSync(path.join(cwd, '.gitattributes'), 'file.txt diff=echo-textconv\n', 'utf8');
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'before\n', 'utf8');
  assert.equal(run('git', ['add', '.gitattributes', 'file.txt'], cwd).status, 0);
  assert.equal(run('git', ['-c', 'user.name=Echo', '-c', 'user.email=echo@example.com', 'commit', '-m', 'init'], cwd).status, 0);
  fs.writeFileSync(path.join(cwd, 'file.txt'), 'after\n', 'utf8');

  const result = createDiffSourceResult({
    cwd,
    changeHistory: []
  });

  assert.equal(result.source.kind, 'git');
  assert.equal(fs.existsSync(sentinel), false);

  removeTempDir(cwd);
});
