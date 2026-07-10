import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {createDiffFileFromContents} from './line-diff';
import {parseUnifiedDiff} from './unified-parser';

import type {ChangeCheckpoint, ChangeFileEntry} from '../../types/change-history';
import type {DiffFile, DiffSourceResult} from '../../types/diff';

const DEFAULT_GIT_TIMEOUT_MS = 5_000;
const DEFAULT_GIT_MAX_OUTPUT_BYTES = 2_000_000;
const DEFAULT_TEXT_FILE_MAX_BYTES = 1_000_000;
const FALLBACK_NOTICE = '非 Git 工作区：当前 diff 基于 apply_patch 历史拼接，可能不包含手动编辑或 shell 写入。';

type CreateDiffSourceOptions = {
  changeHistory: ChangeCheckpoint[];
  cwd: string;
  gitPath?: string;
};

type GitRunResult =
  | {ok: true; stdout: string}
  | {error: string; ok: false};

/**
 * 解析当前工作区 diff source：优先 Git，失败后回退到持久化 change history。
 */
function createDiffSourceResult(options: CreateDiffSourceOptions): DiffSourceResult {
  const git = createGitDiffSource(options);

  if (git) {
    return git;
  }

  return createHistoryDiffSource({
    changeHistory: options.changeHistory,
    cwd: options.cwd,
    reason: '当前目录不是 Git 工作区或 Git diff 不可用'
  });
}

/**
 * 从 Git 工作区读取真实 diff。返回 null 表示调用方应继续 fallback。
 */
function createGitDiffSource(options: CreateDiffSourceOptions): DiffSourceResult | null {
  const gitPath = options.gitPath || 'git';
  const worktree = runGit(gitPath, ['rev-parse', '--is-inside-work-tree'], options.cwd);

  if (!worktree.ok || worktree.stdout.trim() !== 'true') {
    return null;
  }

  const rootResult = runGit(gitPath, ['rev-parse', '--show-toplevel'], options.cwd);
  const root = rootResult.ok && rootResult.stdout.trim() !== '' ? rootResult.stdout.trim() : options.cwd;
  // `/diff` 是只读查看面板；禁用 external diff 和 textconv，避免仓库配置触发外部程序。
  let diff = runGit(gitPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', 'HEAD', '--'], options.cwd);

  if (!diff.ok) {
    // unborn HEAD 等场景下 HEAD diff 会失败，拆开读取 staged/unstaged 仍可展示可用部分。
    const unstaged = runGit(gitPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--'], options.cwd);
    const staged = runGit(gitPath, ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-color', '--'], options.cwd);

    if (!unstaged.ok && !staged.ok) {
      return createHistoryDiffSource({
        changeHistory: options.changeHistory,
        cwd: options.cwd,
        reason: `Git diff 读取失败：${diff.error}`
      });
    }

    diff = {
      ok: true,
      stdout: [unstaged.ok ? unstaged.stdout : '', staged.ok ? staged.stdout : ''].filter(Boolean).join('\n')
    };
  }

  const notices: string[] = [];
  const files = [
    ...parseUnifiedDiff(diff.stdout),
    ...createUntrackedDiffFiles({cwd: options.cwd, gitPath, root, notices})
  ];

  return files.length > 0
    ? {
      status: 'ready',
      source: {kind: 'git', label: 'Git workspace'},
      files,
      notices
    }
    : {
      status: 'empty',
      source: {kind: 'git', label: 'Git workspace'},
      files: [],
      notices
    };
}

/**
 * 使用 change history 生成 fallback diff；该来源只覆盖受控 apply_patch 历史。
 */
function createHistoryDiffSource(options: {changeHistory: ChangeCheckpoint[]; cwd: string; reason?: string}): DiffSourceResult {
  const lastInvalidIndex = findLastInvalidCheckpointIndex(options.changeHistory);
  const invalidCheckpoint = lastInvalidIndex >= 0 ? options.changeHistory[lastInvalidIndex] : null;
  const notices = [
    ...(options.reason ? [options.reason] : []),
    FALLBACK_NOTICE,
    ...(invalidCheckpoint ? [`已遇到不可追踪写入边界：${invalidCheckpoint.invalidReason || '上一轮包含不可安全追踪的写入操作'}；仅展示边界之后的 apply_patch 记录。`] : [])
  ];
  // invalid checkpoint 表示中间出现不可追踪写入，只能展示它之后仍可信的 apply_patch 历史。
  const entries = aggregateHistoryEntries(options.changeHistory.slice(lastInvalidIndex + 1));
  const files: DiffFile[] = [];

  for (const entry of entries) {
    const created = createHistoryEntryDiff(entry, options.cwd, notices);

    if (created) {
      files.push(created);
    }
  }

  return files.length > 0
    ? {
      status: 'ready',
      source: {kind: 'history', label: 'apply_patch history', ...(options.reason ? {reason: options.reason} : {})},
      files,
      notices
    }
    : {
      status: 'empty',
      source: {kind: 'history', label: 'apply_patch history', ...(options.reason ? {reason: options.reason} : {})},
      files: [],
      notices
    };
}

function findLastInvalidCheckpointIndex(history: ChangeCheckpoint[]): number {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].status === 'invalid') {
      return index;
    }
  }

  return -1;
}

function aggregateHistoryEntries(history: ChangeCheckpoint[]): ChangeFileEntry[] {
  const byPath = new Map<string, ChangeFileEntry>();

  for (const checkpoint of history) {
    if (checkpoint.status !== 'ready') {
      continue;
    }

    for (const file of checkpoint.files) {
      if (file.state === 'pending') {
        continue;
      }

      // 同一文件只保留最早的 before 快照，再和当前文件内容比较得到累计差异。
      if (!byPath.has(file.path)) {
        byPath.set(file.path, file);
      }
    }
  }

  return Array.from(byPath.values());
}

function createHistoryEntryDiff(entry: ChangeFileEntry, cwd: string, notices: string[]): DiffFile | null {
  const displayPath = displayPathFor(cwd, entry.path);
  const current = readTextSnapshot(entry.path);

  if (!current.ok) {
    notices.push(`${displayPath}: ${current.reason}`);
    return null;
  }

  return createDiffFileFromContents({
    path: displayPath,
    oldExists: entry.snapshot.exists,
    oldContent: entry.snapshot.exists ? entry.snapshot.content || '' : undefined,
    newExists: current.exists,
    newContent: current.exists ? current.content : undefined
  });
}

function createUntrackedDiffFiles(options: {cwd: string; gitPath: string; notices: string[]; root: string}): DiffFile[] {
  const result = runGit(options.gitPath, ['ls-files', '--others', '--exclude-standard', '-z'], options.cwd);

  if (!result.ok || result.stdout.trim() === '') {
    return [];
  }

  return result.stdout
    .split('\0')
    .filter((filePath) => filePath.trim() !== '')
    .map((filePath) => createUntrackedDiffFile(path.join(options.root, filePath), filePath, options.notices))
    .filter((file): file is DiffFile => file !== null);
}

function createUntrackedDiffFile(absolutePath: string, displayPath: string, notices: string[]): DiffFile | null {
  const snapshot = readTextSnapshot(absolutePath);

  if (!snapshot.ok) {
    notices.push(`${displayPath}: ${snapshot.reason}`);
    return null;
  }

  if (!snapshot.exists) {
    return null;
  }

  return createDiffFileFromContents({
    path: displayPath,
    oldExists: false,
    newExists: true,
    newContent: snapshot.content
  });
}

function readTextSnapshot(filePath: string): {content?: string; exists: boolean; ok: true} | {ok: false; reason: string} {
  if (!fs.existsSync(filePath)) {
    return {ok: true, exists: false};
  }

  let stat: fs.Stats;

  try {
    stat = fs.statSync(filePath);
  } catch (error: unknown) {
    return {ok: false, reason: error instanceof Error ? error.message : '无法读取文件状态'};
  }

  if (!stat.isFile()) {
    return {ok: false, reason: '当前路径不是普通文件，已跳过'};
  }

  if (stat.size > DEFAULT_TEXT_FILE_MAX_BYTES) {
    return {ok: false, reason: `文件超过 ${DEFAULT_TEXT_FILE_MAX_BYTES} bytes，已跳过`};
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // history fallback 只生成文本 diff；二进制或过大的文件用 notice 告知，不强行渲染。
    if (content.includes('\0')) {
      return {ok: false, reason: '疑似二进制文件，已跳过'};
    }

    return {ok: true, exists: true, content};
  } catch (error: unknown) {
    return {ok: false, reason: error instanceof Error ? error.message : '文件读取失败'};
  }
}

function displayPathFor(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);

  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function runGit(gitPath: string, args: string[], cwd: string): GitRunResult {
  const result = spawnSync(gitPath, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_EXTERNAL_DIFF: '',
      GIT_PAGER: 'cat',
      PAGER: 'cat'
    },
    maxBuffer: DEFAULT_GIT_MAX_OUTPUT_BYTES,
    timeout: DEFAULT_GIT_TIMEOUT_MS
  });

  if (result.error) {
    return {ok: false, error: result.error.message};
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === 'string' && result.stderr.trim() !== '' ? result.stderr.trim() : `git exited with ${result.status}`;
    return {ok: false, error: stderr};
  }

  return {
    ok: true,
    stdout: typeof result.stdout === 'string' ? result.stdout : ''
  };
}

export {
  FALLBACK_NOTICE,
  createDiffSourceResult,
  createGitDiffSource,
  createHistoryDiffSource,
  runGit
};
