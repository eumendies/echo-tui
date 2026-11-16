const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {probeWorkerWorkspace} = require('../../src/agent/subagent/workspace/git');
const {
  createManagedWorktree,
  removeManagedWorktree,
  verifyManagedWorktree
} = require('../../src/agent/subagent/workspace/worktree');
const {createWorkerWorkspaceStore, createWorkspaceId} = require('../../src/agent/subagent/workspace/registry');

const GIT_IDENTITY = [
  '-c', 'user.name=Echo Test',
  '-c', 'user.email=test@example.com',
  '-c', 'commit.gpgsign=false',
  '-c', 'init.defaultBranch=main'
];

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-workspace-'));
}

function gitEnvironment(overrides = {}) {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'Echo Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Echo Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
    // 隔离用户与系统配置，保证测试不依赖宿主机 git 设置。
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    ...overrides
  };
}

function runGit(cwd, args, overrides = {}) {
  return execFileSync('git', [...GIT_IDENTITY, ...args], {
    cwd,
    encoding: 'utf8',
    env: gitEnvironment(overrides)
  }).trim();
}

function initRepoWithCommit(repoPath, files = {'README.md': 'base\n'}) {
  fs.mkdirSync(repoPath, {recursive: true});
  runGit(repoPath, ['init']);
  for (const [relativePath, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repoPath, relativePath)), {recursive: true});
    fs.writeFileSync(path.join(repoPath, relativePath), content);
  }
  runGit(repoPath, ['add', '--all']);
  runGit(repoPath, ['commit', '-m', 'base']);
  return runGit(repoPath, ['rev-parse', 'HEAD']);
}

function createStore(rootDir) {
  return createWorkerWorkspaceStore({rootDir});
}

test('probeWorkerWorkspace distinguishes non-git, git, and hard Git errors', async () => {
  const root = createTempRoot();
  const plainDir = path.join(root, 'plain');
  fs.mkdirSync(plainDir);
  assert.deepEqual(await probeWorkerWorkspace(plainDir), {kind: 'non_git'});

  const repo = path.join(root, 'repo');
  const baseCommit = initRepoWithCommit(repo);
  const gitProbe = await probeWorkerWorkspace(repo);
  assert.equal(gitProbe.kind, 'git');
  assert.equal(gitProbe.baseCommit, baseCommit);
  assert.equal(gitProbe.repoRoot, fs.realpathSync(repo));
  assert.equal(gitProbe.execRelativeCwd, '');
  assert.ok(fs.statSync(gitProbe.gitCommonDir).isDirectory());
  assert.match(gitProbe.gitCommonDir, /\.git$/u);

  const bareDir = path.join(root, 'bare.git');
  runGit(root, ['init', '--bare', bareDir]);
  assert.equal((await probeWorkerWorkspace(bareDir)).code, 'bare_repository');

  const unbornDir = path.join(root, 'unborn');
  runGit(root, ['init', unbornDir]);
  assert.equal((await probeWorkerWorkspace(unbornDir)).code, 'unborn_head');

  assert.equal((await probeWorkerWorkspace(path.join(root, 'missing'))).code, 'unsupported_layout');
});

test('probeWorkerWorkspace maps a repository subdirectory as the execution directory', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  initRepoWithCommit(repo, {'README.md': 'base\n', 'packages/app/index.js': 'module.exports = 1;\n'});

  const probe = await probeWorkerWorkspace(path.join(repo, 'packages', 'app'));
  assert.equal(probe.kind, 'git');
  assert.equal(probe.execRelativeCwd, 'packages/app');
  assert.equal(probe.repoRoot, fs.realpathSync(repo));
});

test('probeWorkerWorkspace reports a missing git executable as a hard error', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  initRepoWithCommit(repo);

  const originalPath = process.env.PATH;
  process.env.PATH = '';
  try {
    const probe = await probeWorkerWorkspace(repo);
    assert.equal(probe.kind, 'error');
    assert.equal(probe.code, 'git_missing');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('createManagedWorktree freezes the base commit and ignores parent working tree changes', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  const baseCommit = initRepoWithCommit(repo);
  // 父工作区同时存在 staged、unstaged 与未跟踪内容；这些都不应进入 Worker 基线。
  fs.writeFileSync(path.join(repo, 'README.md'), 'parent unstaged\n');
  fs.writeFileSync(path.join(repo, 'staged.txt'), 'parent staged\n');
  runGit(repo, ['add', 'staged.txt']);
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'parent untracked\n');

  const probe = await probeWorkerWorkspace(repo);
  const store = createStore(path.join(root, 'store'));
  const workspaceId = createWorkspaceId('abcdef123456', 1);
  const workspaceRoot = store.getWorkspaceRoot(repo, workspaceId);
  const created = await createManagedWorktree({
    baseCommit: probe.baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot
  });

  assert.equal(created.kind, 'ok');
  assert.equal(fs.readFileSync(path.join(created.workspaceRoot, 'README.md'), 'utf8'), 'base\n');
  assert.equal(fs.existsSync(path.join(created.workspaceRoot, 'staged.txt')), false);
  assert.equal(fs.existsSync(path.join(created.workspaceRoot, 'untracked.txt')), false);
  assert.equal(created.git.baseCommit, baseCommit);
  // 私有 gitDir 必须是 worktree 自己的，而不是源仓库的 .git。
  assert.notEqual(created.git.worktreeGitDir, path.join(repo, '.git'));
  assert.equal(created.git.gitCommonDir, probe.gitCommonDir);

  // 父工作区的三份修改必须保持原样：创建 worktree 不改 index、branch 或工作树。
  assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'parent unstaged\n');
  assert.match(runGit(repo, ['status', '--short']), /staged\.txt/u);
  assert.equal(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf8'), 'parent untracked\n');

  // 同一段内冻结的 SHA 不随父 HEAD 移动而漂移。
  fs.writeFileSync(path.join(repo, 'README.md'), 'next commit\n');
  runGit(repo, ['add', 'README.md']);
  runGit(repo, ['commit', '-m', 'move head']);
  const secondWorkspaceId = createWorkspaceId('abcdef123457', 2);
  const second = await createManagedWorktree({
    baseCommit: probe.baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot: store.getWorkspaceRoot(repo, secondWorkspaceId)
  });
  assert.equal(second.kind, 'ok');
  assert.equal(fs.readFileSync(path.join(second.workspaceRoot, 'README.md'), 'utf8'), 'base\n');
});

test('createManagedWorktree maps a subdirectory cwd and fails when it is absent from the base', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  initRepoWithCommit(repo, {'README.md': 'base\n', 'packages/app/index.js': 'module.exports = 1;\n'});
  const probe = await probeWorkerWorkspace(path.join(repo, 'packages', 'app'));
  const store = createStore(path.join(root, 'store'));

  const created = await createManagedWorktree({
    baseCommit: probe.baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot: store.getWorkspaceRoot(repo, createWorkspaceId('abcdef123458', 3))
  });
  assert.equal(created.kind, 'ok');
  assert.equal(created.execCwd, path.join(created.workspaceRoot, 'packages', 'app'));

  // 基线里不存在的子目录必须明确失败，而不是退回父目录或仓库根。
  const missing = await createManagedWorktree({
    baseCommit: probe.baseCommit,
    execRelativeCwd: 'packages/absent',
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot: store.getWorkspaceRoot(repo, createWorkspaceId('abcdef123459', 4))
  });
  assert.equal(missing.kind, 'failed');
  assert.match(missing.message, /does not exist in the frozen base commit/u);
});

test('the managed worktree lives under the repository and never shows up in git status', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  const baseCommit = initRepoWithCommit(repo);
  const probe = await probeWorkerWorkspace(repo);
  const store = createStore(path.join(root, 'store'));
  const workspaceId = createWorkspaceId('abcdef12345c', 7);

  const created = await createManagedWorktree({
    baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot: store.getWorkspaceRoot(repo, workspaceId)
  });
  assert.equal(created.kind, 'ok');

  // worktree 跟随源仓库（realpath 归一化后比较，macOS 的 /var 会解析到 /private/var）。
  assert.equal(created.workspaceRoot, path.join(fs.realpathSync(repo), '.echo', 'worktrees', workspaceId));
  // 仓库没有 .gitignore 时由 info/exclude 兜住，父工作区不出现 untracked 的 .echo。
  assert.equal(runGit(repo, ['status', '--porcelain']), '');
  assert.match(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8'), /^\.echo\/worktrees\/$/mu);

  // 有改动时保留现场；清理后连空的 .echo/worktrees 一起收掉。
  fs.writeFileSync(path.join(created.workspaceRoot, 'left.txt'), 'x\n');
  assert.equal((await removeManagedWorktree({repoRoot: probe.repoRoot, workspaceRoot: created.workspaceRoot})).kind, 'blocked');
  fs.rmSync(path.join(created.workspaceRoot, 'left.txt'));
  assert.deepEqual(await removeManagedWorktree({repoRoot: probe.repoRoot, workspaceRoot: created.workspaceRoot}), {kind: 'ok'});
  assert.equal(fs.existsSync(path.join(repo, '.echo', 'worktrees')), false);
  assert.equal(runGit(repo, ['status', '--porcelain']), '');
});

test('a failed worktree verification leaves no registration in the source repository', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  const baseCommit = initRepoWithCommit(repo);
  const probe = await probeWorkerWorkspace(repo);

  // 故意传入不匹配的 common dir：git 已创建并注册 worktree，核验随后失败。
  const created = await createManagedWorktree({
    baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: path.join(root, 'unrelated', '.git'),
    repoRoot: probe.repoRoot,
    workspaceRoot: path.join(root, 'ws', 'worktree')
  });
  assert.equal(created.kind, 'failed');
  assert.match(created.message, /different Git repository/u);

  // 源仓库不能留下 .git/worktrees/<name> 注册垃圾。
  const worktreesDir = path.join(repo, '.git', 'worktrees');
  assert.deepEqual(fs.existsSync(worktreesDir) ? fs.readdirSync(worktreesDir) : [], []);
  assert.equal(fs.existsSync(path.join(root, 'ws', 'worktree')), false);
});

test('verifyManagedWorktree rejects a reused path that belongs to another repository', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  initRepoWithCommit(repo);
  const probe = await probeWorkerWorkspace(repo);
  const store = createStore(path.join(root, 'store'));
  const workspaceId = createWorkspaceId('abcdef12345a', 5);
  const created = await createManagedWorktree({
    baseCommit: probe.baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot: store.getWorkspaceRoot(repo, workspaceId)
  });
  assert.equal(created.kind, 'ok');
  assert.deepEqual(await verifyManagedWorktree({expected: created.git, workspaceRoot: created.workspaceRoot}), {kind: 'ok'});

  // 换成一个无关仓库：目录存在，但归属已不同，必须拒绝自动操作。
  fs.rmSync(created.workspaceRoot, {recursive: true, force: true});
  initRepoWithCommit(created.workspaceRoot, {'other.txt': 'other\n'});
  const verification = await verifyManagedWorktree({expected: created.git, workspaceRoot: created.workspaceRoot});
  assert.equal(verification.kind, 'invalid');
  assert.equal(verification.code, 'mismatch');

  fs.rmSync(created.workspaceRoot, {recursive: true, force: true});
  const missing = await verifyManagedWorktree({expected: created.git, workspaceRoot: created.workspaceRoot});
  assert.equal(missing.code, 'missing');
});

test('removeManagedWorktree refuses to delete a workspace that has leftover content', async () => {
  const root = createTempRoot();
  const repo = path.join(root, 'repo');
  const baseCommit = initRepoWithCommit(repo);
  const probe = await probeWorkerWorkspace(repo);
  const store = createStore(path.join(root, 'store'));
  const created = await createManagedWorktree({
    baseCommit,
    execRelativeCwd: probe.execRelativeCwd,
    gitCommonDir: probe.gitCommonDir,
    repoRoot: probe.repoRoot,
    workspaceRoot: store.getWorkspaceRoot(repo, createWorkspaceId('abcdef12345b', 6))
  });
  assert.equal(created.kind, 'ok');

  fs.writeFileSync(path.join(created.workspaceRoot, 'leftover.txt'), 'keep me\n');
  const blocked = await removeManagedWorktree({repoRoot: probe.repoRoot, workspaceRoot: created.workspaceRoot});
  assert.equal(blocked.kind, 'blocked');
  assert.equal(fs.existsSync(path.join(created.workspaceRoot, 'leftover.txt')), true);

  fs.rmSync(path.join(created.workspaceRoot, 'leftover.txt'));
  const removed = await removeManagedWorktree({repoRoot: probe.repoRoot, workspaceRoot: created.workspaceRoot});
  assert.deepEqual(removed, {kind: 'ok'});
  assert.equal(fs.existsSync(created.workspaceRoot), false);
});

test('workspace registry partitions by parent project cwd and keeps headless ownership', () => {
  const root = createTempRoot();
  const store = createStore(path.join(root, 'store'));
  const repo = path.join(root, 'repo');
  const subdir = path.join(repo, 'packages', 'app');
  fs.mkdirSync(subdir, {recursive: true});

  const now = new Date().toISOString();
  const baseEntry = {
    baseCommit: 'a'.repeat(40),
    createdAt: now,
    owner: {agentName: 'worker', parentToolCallId: 'call-1', projectCwd: repo, runId: 'run-1'},
    repoRoot: repo,
    schemaVersion: 1,
    status: 'running',
    updatedAt: now,
    workspaceId: 'ws-repo',
    workspaceRoot: store.getWorkspaceRoot(repo, 'ws-repo')
  };
  store.writeEntry(baseEntry);

  // 不同启动子目录保持各自既有分区：同一 id 在另一个分区里不可见。
  assert.equal(store.getEntry(repo, 'ws-repo').kind, 'ok');
  assert.equal(store.getEntry(subdir, 'ws-repo').kind, 'missing');
  const read = store.getEntry(repo, 'ws-repo');
  assert.equal(read.kind, 'ok');
  // headless 没有 session 时不伪造 journal 归属。
  assert.equal('sessionId' in read.entry.owner, false);
  assert.equal(store.getEntry(repo, 'ws-unknown').kind, 'missing');
  assert.equal(store.getEntry(repo, '../escape').kind, 'unsupported');
});

test('workspace registry reports unsupported and unsafe entries without deleting them', () => {
  const root = createTempRoot();
  const storeRoot = path.join(root, 'store');
  const store = createStore(storeRoot);
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, {recursive: true});

  const workspaceId = 'ws-version';
  const dirPath = store.ensureWorkspaceDir(repo, workspaceId);
  fs.writeFileSync(path.join(dirPath, 'workspace.json'), JSON.stringify({schemaVersion: 99}), 'utf8');
  assert.equal(store.getEntry(repo, workspaceId).kind, 'unsupported');

  // 登记文件被替换为符号链接时判为不安全，而不是跟随链接读取。
  const otherId = 'ws-link';
  const otherDir = store.ensureWorkspaceDir(repo, otherId);
  const target = path.join(root, 'outside.json');
  fs.writeFileSync(target, '{}', 'utf8');
  fs.symlinkSync(target, path.join(otherDir, 'workspace.json'));
  assert.equal(store.getEntry(repo, otherId).kind, 'unsafe');
});
