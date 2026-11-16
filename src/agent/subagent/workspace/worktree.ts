import * as fs from 'node:fs';
import * as path from 'node:path';

import {AgentAbortError} from '../../../types/agent';
import {realpathOrSelf, runGitCommand} from './git';
import {WORKTREE_DIR_SEGMENTS} from './registry';

import type {SubagentWorkspaceGitIdentity} from '../../../types/agent';

type CreateManagedWorktreeOptions = {
  abortSignal?: AbortSignal; // 父 turn 取消信号；段内 Agent 全部共享同一个信号。
  baseCommit: string; // 段级冻结的完整 HEAD SHA。
  execRelativeCwd: string; // 执行子目录的仓库相对路径，空字符串代表仓库根。
  gitCommonDir: string; // 父仓库归一化的共享元数据目录，创建后必须与读回值一致。
  repoRoot: string; // 源仓库根；worktree 从这里派生。
  workspaceRoot: string; // 计划创建的受管 worktree 绝对路径，由系统生成。
};

type CreateManagedWorktreeResult =
  | {execCwd: string; git: SubagentWorkspaceGitIdentity; kind: 'ok'; workspaceRoot: string} // 已创建并核验归属。
  | {kind: 'failed'; message: string}; // 创建或核验失败；调用方必须按失败结果返回，不得回退共享目录。

type VerifyManagedWorktreeResult =
  | {kind: 'ok'} // 路径、私有 gitDir 与 common dir 均与登记一致。
  | {code: 'missing' | 'mismatch' | 'unsafe'; kind: 'invalid'; message: string}; // 归属无法确认。

/** 对比两个路径是否指向同一位置；两侧都已 realpath 归一化。 */
function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/**
 * 确保受管工作区路径被 git 忽略。
 *
 * 优先复用仓库已有的忽略规则（`.gitignore` 或 `info/exclude`）；两者都没覆盖时才往
 * common dir 的 `info/exclude` 追加一行 —— 不改用户的 `.gitignore`，也不进入版本控制。
 * 无法确认时保持原样：创建继续，未忽略状态会由 `git status` 如实暴露。
 */
async function ensureWorkspaceIgnored(repoRoot: string, gitCommonDir: string, abortSignal?: AbortSignal): Promise<void> {
  const entry = `${WORKTREE_DIR_SEGMENTS.join('/')}/`;
  const signal = abortSignal ? {abortSignal} : {};
  const check = await runGitCommand(['check-ignore', '-q', entry], {cwd: repoRoot, ...signal});
  if (check.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (check.kind === 'ok') {
    return;
  }
  // exit 1 才是「未被忽略」；git 缺失或其它错误不阻塞创建。
  if (check.kind !== 'failed' || check.exitCode !== 1) {
    return;
  }

  // common dir 已由段级预检解析并核验，这里直接用，不再重复 spawn git。
  const excludePath = path.join(gitCommonDir, 'info', 'exclude');
  try {
    let existing = '';
    try {
      existing = fs.readFileSync(excludePath, 'utf8');
    } catch {
      // info/exclude 不存在时按空文件处理。
    }
    if (existing.split('\n').some((line) => line.trim() === entry)) {
      return;
    }
    fs.mkdirSync(path.dirname(excludePath), {recursive: true});
    fs.appendFileSync(excludePath, `${existing !== '' && !existing.endsWith('\n') ? '\n' : ''}${entry}\n`);
  } catch {
    // 写入失败不阻塞创建：工作区仍可用，只是可能在 git status 中可见。
  }
}

/**
 * 在受管位置创建 detached worktree，并核验其 Git 归属与执行子目录。
 *
 * 创建命令由系统生成参数，不接受模型提供的路径；父 index、branch 与未提交内容都不参与。
 * 核验失败时会尽力移除刚创建的目录，避免留下无法归属的残留。
 */
async function createManagedWorktree(options: CreateManagedWorktreeOptions): Promise<CreateManagedWorktreeResult> {
  const parentDir = path.dirname(options.workspaceRoot);

  try {
    // 忽略规则写不进去不阻塞创建；取消必须照常传播。
    try {
      await ensureWorkspaceIgnored(options.repoRoot, options.gitCommonDir, options.abortSignal);
    } catch (error: unknown) {
      if (error instanceof AgentAbortError) {
        throw error;
      }
    }
    fs.mkdirSync(parentDir, {recursive: true, mode: 0o700});
  } catch (error: unknown) {
    if (error instanceof AgentAbortError) {
      throw error;
    }
    return {kind: 'failed', message: `Cannot create the managed workspace directory: ${describeError(error)}`};
  }
  if (fs.existsSync(options.workspaceRoot)) {
    return {kind: 'failed', message: `Managed workspace path already exists: ${options.workspaceRoot}`};
  }

  const added = await runGitCommand(
    ['worktree', 'add', '--detach', options.workspaceRoot, options.baseCommit],
    {cwd: options.repoRoot, ...(options.abortSignal ? {abortSignal: options.abortSignal} : {})}
  );
  if (added.kind === 'aborted') {
    await discardManagedWorktree(options.repoRoot, options.workspaceRoot);
    throw new AgentAbortError();
  }
  if (added.kind === 'missing') {
    return {kind: 'failed', message: 'git is not available on PATH; the managed worker worktree could not be created.'};
  }
  if (added.kind === 'failed') {
    await discardManagedWorktree(options.repoRoot, options.workspaceRoot);
    return {kind: 'failed', message: `git worktree add failed: ${added.stderr.trim() || `exit ${String(added.exitCode)}`}`};
  }

  const identity = await readWorktreeIdentity(options.workspaceRoot, options.abortSignal);
  if (identity.kind !== 'ok') {
    await discardManagedWorktree(options.repoRoot, options.workspaceRoot);
    return {kind: 'failed', message: identity.message};
  }
  if (!samePath(identity.commonDir, options.gitCommonDir)) {
    await discardManagedWorktree(options.repoRoot, options.workspaceRoot);
    return {
      kind: 'failed',
      message: `Managed workspace belongs to a different Git repository (expected common dir ${options.gitCommonDir}, got ${identity.commonDir}).`
    };
  }

  const workspaceRoot = realpathOrSelf(options.workspaceRoot);
  const execCwd = options.execRelativeCwd === ''
    ? workspaceRoot
    : path.resolve(workspaceRoot, ...options.execRelativeCwd.split('/'));
  const execCwdProblem = checkExecCwd(workspaceRoot, execCwd, options.execRelativeCwd);
  if (execCwdProblem !== null) {
    // 基线中不存在该子目录时必须明确失败：切换到父目录或仓库根都会让 Worker 在错误目录工作。
    await removeManagedWorktree({repoRoot: options.repoRoot, workspaceRoot});
    return {kind: 'failed', message: execCwdProblem};
  }

  return {
    execCwd,
    git: {
      baseCommit: options.baseCommit,
      execRelativeCwd: options.execRelativeCwd,
      gitCommonDir: identity.commonDir,
      repoRoot: realpathOrSelf(options.repoRoot),
      worktreeGitDir: identity.gitDir
    },
    kind: 'ok',
    workspaceRoot
  };
}

/** 执行子目录必须真实存在且其真实路径仍位于 worktree 根内。 */
function checkExecCwd(workspaceRoot: string, execCwd: string, execRelativeCwd: string): string | null {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(execCwd);
  } catch {
    return `The worker execution directory does not exist in the frozen base commit: ${execRelativeCwd}. Commit the required directory into the base, or delegate from the repository root.`;
  }
  if (!stats.isDirectory()) {
    return `The worker execution path is not a directory in the frozen base commit: ${execRelativeCwd}.`;
  }
  const realCwd = realpathOrSelf(execCwd);
  const relative = path.relative(workspaceRoot, realCwd);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
    ? null
    : `The worker execution directory resolves outside its managed workspace: ${execRelativeCwd}.`;
}

/**
 * 读取 worktree 自身的私有 gitDir 与共享 common dir。
 * 不从路径字符串推断归属；这里只信任 git 自己的回答。
 */
async function readWorktreeIdentity(workspaceRoot: string, abortSignal?: AbortSignal): Promise<
  {commonDir: string; gitDir: string; kind: 'ok'} | {kind: 'failed'; message: string}
> {
  // 一次 rev-parse 取回三项事实：创建与复核前各调用一次，共 2 次 spawn 而不是 6 次。
  const result = await runGitCommand(
    ['rev-parse', '--absolute-git-dir', '--git-common-dir', '--is-inside-work-tree'],
    {cwd: workspaceRoot, ...(abortSignal ? {abortSignal} : {})}
  );
  if (result.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (result.kind !== 'ok') {
    return {kind: 'failed', message: 'Cannot read the managed workspace Git identity.'};
  }
  const [gitDir, commonDir, insideWorkTree] = result.stdout.split('\n');
  if (!gitDir || !commonDir || insideWorkTree !== 'true') {
    return {kind: 'failed', message: 'Managed workspace is not a usable Git working tree.'};
  }

  return {
    commonDir: realpathOrSelf(path.resolve(workspaceRoot, commonDir)),
    gitDir: realpathOrSelf(gitDir),
    kind: 'ok'
  };
}

/**
 * 在恢复与清理前复核 worktree 归属。
 * 目录存在不等于归属正确：路径被别的仓库复用时必须拒绝自动操作。
 */
async function verifyManagedWorktree(options: {
  abortSignal?: AbortSignal;
  expected: Pick<SubagentWorkspaceGitIdentity, 'gitCommonDir' | 'worktreeGitDir'>;
  workspaceRoot: string;
}): Promise<VerifyManagedWorktreeResult> {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(options.workspaceRoot);
  } catch {
    return {code: 'missing', kind: 'invalid', message: `Managed workspace no longer exists: ${options.workspaceRoot}`};
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return {code: 'unsafe', kind: 'invalid', message: `Managed workspace path is not a real directory: ${options.workspaceRoot}`};
  }

  const identity = await readWorktreeIdentity(options.workspaceRoot, options.abortSignal);
  if (identity.kind !== 'ok') {
    return {code: 'mismatch', kind: 'invalid', message: identity.message};
  }
  if (!samePath(identity.commonDir, options.expected.gitCommonDir) || !samePath(identity.gitDir, options.expected.worktreeGitDir)) {
    return {
      code: 'mismatch',
      kind: 'invalid',
      message: `Managed workspace no longer belongs to the recorded Git repository: ${options.workspaceRoot}`
    };
  }
  return {kind: 'ok'};
}

/**
 * 从源仓库移除受管 worktree。
 *
 * 刻意不使用 --force：有修改或未跟踪遗留时 git 会拒绝，这正是「有成果就保留」的保守行为。
 * 失败时返回诊断，由调用方在登记里记录为清理受阻。
 */
async function removeManagedWorktree(options: {
  repoRoot: string;
  workspaceRoot: string;
  abortSignal?: AbortSignal;
}): Promise<{kind: 'ok'} | {kind: 'blocked'; message: string}> {
  const removed = await runGitCommand(['worktree', 'remove', options.workspaceRoot], {cwd: options.repoRoot, ...(options.abortSignal ? {abortSignal: options.abortSignal} : {})});
  if (removed.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (removed.kind === 'ok') {
    // worktree 本身已删除；父目录为空时一并收掉，避免在仓库里留下空壳目录。
    removeEmptyDirectoryQuietly(path.dirname(options.workspaceRoot));
    return {kind: 'ok'};
  }
  return {
    kind: 'blocked',
    message: removed.kind === 'missing'
      ? 'git is not available on PATH; the managed workspace was retained.'
      : `git worktree remove refused to delete the managed workspace: ${removed.stderr.trim() || `exit ${String(removed.exitCode)}`}`
  };
}

/**
 * 丢弃刚创建、尚未交给 Worker 的工作区。
 *
 * 这里允许 `--force`：该目录还没有任何成果，留下的只会是源仓库 `.git/worktrees/<name>`
 * 的注册残留，那才是真正的垃圾。git 清理失败时再退回目录删除。
 */
async function discardManagedWorktree(repoRoot: string, workspaceRoot: string): Promise<void> {
  await runGitCommand(['worktree', 'remove', '--force', workspaceRoot], {cwd: repoRoot});
  removeDirectoryQuietly(workspaceRoot);
  removeEmptyDirectoryQuietly(path.dirname(workspaceRoot));
}

/** 只在目录为空时移除；非空或不存在都保持现状。 */
function removeEmptyDirectoryQuietly(targetPath: string): void {
  try {
    fs.rmdirSync(targetPath);
  } catch {
    // 非空、已删除或权限不足：都不是错误，保持原状。
  }
}

function removeDirectoryQuietly(targetPath: string): void {
  try {
    fs.rmSync(targetPath, {force: true, recursive: true});
  } catch {
    // 清理失败由调用方的登记保留事实表达，避免掩盖原始创建错误。
  }
}

function describeError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : 'unknown error';
}

export {
  createManagedWorktree,
  removeManagedWorktree,
  verifyManagedWorktree
};

export type {
  CreateManagedWorktreeOptions,
  CreateManagedWorktreeResult,
  VerifyManagedWorktreeResult
};
