import {spawn} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {AgentAbortError} from '../../../types/agent';

import type {SubagentWorkspaceProbe} from '../../../types/agent';

const GIT_MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const GIT_MAX_STDERR_BYTES = 64 * 1024;
const NOT_A_REPOSITORY_MARKER = 'not a git repository';

type ProbeError = Extract<SubagentWorkspaceProbe, {kind: 'error'}>;

type GitCommandExecution =
  | {kind: 'ok'; stdout: string} // 退出码 0；stdout 已裁剪单个尾部换行。
  | {exitCode: number | null; kind: 'failed'; stderr: string} // 非 0 退出；仅保留有界 stderr 供分类。
  | {kind: 'missing'} // 无法启动 git 可执行文件。
  | {kind: 'aborted'}; // 父 turn 取消；调用方必须按取消语义传播。

type GitCommandOptions = {
  abortSignal?: AbortSignal; // 父 turn 取消信号；命中时立即终止子进程。
  cwd: string; // git 命令的工作目录；不改变进程级 cwd。
};

/** 构造确定性 Git 环境：禁用交互提示与可选锁写，并固定英文诊断便于稳定分类。 */
function createGitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // 只读检查不应为了刷新 index 而获取可选锁；这是只读可见性优化，不构成写权限授权。
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C'
  };
}

/**
 * 以参数数组执行 Git，不拼接 shell 字符串。
 * 输出有界保留，避免异常仓库把巨大输出读入内存；取消由父信号驱动。
 */
function runGitCommand(args: readonly string[], options: GitCommandOptions): Promise<GitCommandExecution> {
  return new Promise<GitCommandExecution>((resolve) => {
    const stdoutChunks: Buffer[] = [];
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let child: ReturnType<typeof spawn> | undefined;

    const onAbort = (): void => {
      child?.kill('SIGKILL');
      finish({kind: 'aborted'});
    };
    const finish = (result: GitCommandExecution): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.abortSignal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    if (options.abortSignal?.aborted) {
      resolve({kind: 'aborted'});
      return;
    }

    try {
      child = spawn('git', [...args], {
        cwd: options.cwd,
        env: createGitEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch {
      resolve({kind: 'missing'});
      return;
    }

    options.abortSignal?.addEventListener('abort', onAbort, {once: true});
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= GIT_MAX_STDOUT_BYTES) {
        return;
      }
      stdoutBytes += chunk.length;
      stdoutChunks.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrBytes >= GIT_MAX_STDERR_BYTES) {
        return;
      }
      stderrBytes += chunk.length;
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ENOENT'
        ? {kind: 'missing'}
        : {exitCode: null, kind: 'failed', stderr: stderr || error.message});
    });
    child.on('close', (code) => {
      finish(code === 0
        ? {kind: 'ok', stdout: trimTrailingNewline(Buffer.concat(stdoutChunks).toString('utf8'))}
        : {exitCode: code, kind: 'failed', stderr: trimTrailingNewline(stderr)});
    });
  });
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/u, '');
}

/**
 * 探测父 cwd 的工作区类型。
 * 只有明确结论 not a git repository 才返回 non_git；其余失败都带分类错误返回，
 * 让调度层生成原序失败结果而不是静默回退共享目录。
 */
async function probeWorkerWorkspace(cwd: string, options: {abortSignal?: AbortSignal} = {}): Promise<SubagentWorkspaceProbe> {
  const commandOptions: GitCommandOptions = {cwd, ...(options.abortSignal ? {abortSignal: options.abortSignal} : {})};

  if (!isDirectory(cwd)) {
    return createProbeError('unsupported_layout', `Current working directory is unavailable: ${cwd}`);
  }

  const insideWorkTree = await runGitCommand(['rev-parse', '--is-inside-work-tree'], commandOptions);
  if (insideWorkTree.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (insideWorkTree.kind === 'missing') {
    return createProbeError('git_missing', 'git is not available on PATH; a managed worker worktree cannot be created.');
  }
  if (insideWorkTree.kind === 'failed') {
    if (insideWorkTree.stderr.toLowerCase().includes(NOT_A_REPOSITORY_MARKER)) {
      return {kind: 'non_git'};
    }
    return createProbeError('git_failed', describeGitFailure('git rev-parse --is-inside-work-tree', insideWorkTree.stderr, insideWorkTree.exitCode));
  }
  if (insideWorkTree.stdout === 'false') {
    return createProbeError('bare_repository', 'Current directory is inside a bare Git repository, which has no working tree to branch a worker workspace from.');
  }
  if (insideWorkTree.stdout !== 'true') {
    return createProbeError('git_failed', 'git rev-parse --is-inside-work-tree returned an unexpected result.');
  }

  // 仓库根与仓库身份必须按参数数组读取；不从路径字符串猜测 worktree 归属。
  const topLevel = await readPathFact(commandOptions, ['rev-parse', '--show-toplevel'], 'git rev-parse --show-toplevel');
  if (typeof topLevel !== 'string') {
    return topLevel;
  }
  const gitDir = await readPathFact(commandOptions, ['rev-parse', '--absolute-git-dir'], 'git rev-parse --absolute-git-dir');
  if (typeof gitDir !== 'string') {
    return gitDir;
  }
  const commonDir = await readPathFact(commandOptions, ['rev-parse', '--git-common-dir'], 'git rev-parse --git-common-dir');
  if (typeof commonDir !== 'string') {
    return commonDir;
  }
  const baseCommit = await readHeadCommit(commandOptions);
  if (typeof baseCommit !== 'string') {
    return baseCommit;
  }

  const repoRoot = realpathOrSelf(topLevel);
  const parentCwd = realpathOrSelf(cwd);
  const execRelativeCwd = toPosixRelative(repoRoot, parentCwd);
  if (execRelativeCwd === null) {
    return createProbeError('unsupported_layout', `Current working directory is outside the resolved Git repository root: ${repoRoot}`);
  }

  return {
    baseCommit,
    execRelativeCwd,
    gitCommonDir: realpathOrSelf(path.resolve(cwd, commonDir)),
    kind: 'git',
    repoRoot
  };
}

/** 读取完整 HEAD SHA；没有 commit 的仓库必须作为明确错误而不是空基线继续。 */
async function readHeadCommit(commandOptions: GitCommandOptions): Promise<string | ProbeError> {
  const result = await runGitCommand(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], commandOptions);
  if (result.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (result.kind === 'missing') {
    return createProbeError('git_missing', 'git is not available on PATH; a managed worker worktree cannot be created.');
  }
  if (result.kind === 'failed') {
    // 无 commit 的仓库让 rev-parse 以 1 退出且不打印诊断；必须与真正的失败区分开。
    return result.exitCode === 1 && result.stderr === ''
      ? createProbeError('unborn_head', 'The Git repository has no commit yet, so there is no base to start a worker workspace from.')
      : createProbeError('git_failed', describeGitFailure('git rev-parse --verify HEAD^{commit}', result.stderr, result.exitCode));
  }
  if (!/^[0-9a-f]{40,64}$/u.test(result.stdout)) {
    return createProbeError('git_failed', 'git rev-parse returned an unexpected HEAD object name.');
  }
  return result.stdout;
}

/** 读取一个必须非空的路径事实；失败时复用统一的错误构造。 */
async function readPathFact(commandOptions: GitCommandOptions, args: readonly string[], label: string): Promise<string | ProbeError> {
  const result = await runGitCommand(args, commandOptions);
  if (result.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (result.kind === 'missing') {
    return createProbeError('git_missing', 'git is not available on PATH; a managed worker worktree cannot be created.');
  }
  if (result.kind === 'failed') {
    return createProbeError('git_failed', describeGitFailure(label, result.stderr, result.exitCode));
  }
  if (result.stdout.trim() === '') {
    return createProbeError('git_failed', `${label} returned an empty result.`);
  }
  return result.stdout;
}

function createProbeError(code: ProbeError['code'], message: string): ProbeError {
  return {code, kind: 'error', message};
}

function describeGitFailure(label: string, stderr: string, exitCode: number | null): string {
  const detail = stderr.trim();
  const exit = exitCode === null ? 'no exit status' : `exit ${String(exitCode)}`;
  return detail === '' ? `${label} failed (${exit}).` : `${label} failed (${exit}): ${detail}`;
}

/** 计算 POSIX 风格的仓库相对路径；越出仓库根时返回 null。 */
function toPosixRelative(rootPath: string, targetPath: string): string | null {
  const relative = path.relative(rootPath, targetPath);
  if (relative === '') {
    return '';
  }
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

function realpathOrSelf(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isDirectory(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export {
  describeGitFailure,
  probeWorkerWorkspace,
  realpathOrSelf,
  runGitCommand
};

export type {GitCommandExecution, GitCommandOptions};
