import {AgentAbortError} from '../../../types/agent';
import {describeGitFailure, runGitCommand} from './git';

type WorkspaceInspection =
  | {
      hasIgnoredFiles: boolean; // 是否存在 ignored 遗留；只用于提示有未纳入结果的本地状态。
      kind: 'dirty'; // 工作区仍有内容，必须保留现场。
    }
  | {hasIgnoredFiles: false; kind: 'clean'} // 与基线一致且无遗留，可回收。
  | {kind: 'error'; message: string}; // 状态不可读；调用方必须保留工作区。

/**
 * 检查受管工作区是否还留有内容。
 *
 * 成果就是 worktree 里的文件本身，所以这里只需要一个「干净 / 不干净」的判定：
 * 干净才允许自动回收，其余一律保留现场。父 Agent 需要细节时自己用 git 命令查看。
 */
async function inspectWorkspaceCleanliness(options: {
  abortSignal?: AbortSignal;
  baseCommit: string; // 冻结基线；HEAD 偏离它说明 Worker 自行提交过，不能当空工作区回收。
  workspaceRoot: string;
}): Promise<WorkspaceInspection> {
  // 先看 HEAD：Worker 自行提交后工作树是干净的，但提交本身就是成果。
  const head = await runGitCommand(
    ['rev-parse', 'HEAD'],
    {cwd: options.workspaceRoot, ...(options.abortSignal ? {abortSignal: options.abortSignal} : {})}
  );
  if (head.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (head.kind !== 'ok') {
    return {kind: 'error', message: describeInspectionFailure('git rev-parse HEAD', head)};
  }
  if (head.stdout !== options.baseCommit) {
    return {hasIgnoredFiles: false, kind: 'dirty'};
  }

  const result = await runGitCommand(
    ['status', '--porcelain=v1', '-z', '--ignored'],
    {cwd: options.workspaceRoot, ...(options.abortSignal ? {abortSignal: options.abortSignal} : {})}
  );
  if (result.kind === 'aborted') {
    throw new AgentAbortError();
  }
  if (result.kind !== 'ok') {
    return {kind: 'error', message: describeInspectionFailure('git status', result)};
  }

  // -z 输出以 NUL 分隔；ignored 条目以 `!!` 开头，其余都是 changes。
  // 逐条扫描而不 split 成数组：大 node_modules 下的 ignored 列表可能有几万条。
  // 只判断「有没有变化」和「有没有 ignored 遗留」：数量对清理决策没有意义，
  // 而且 rename 在 -z 下占两个字段、大输出还会被截断，计数本身不可靠。
  let hasChanges = false;
  let hasIgnoredFiles = false;
  let cursor = 0;
  while (cursor < result.stdout.length) {
    const end = result.stdout.indexOf('\0', cursor);
    if (end < 0) {
      break;
    }
    if (end > cursor) {
      if (result.stdout.startsWith('!! ', cursor)) {
        hasIgnoredFiles = true;
      } else {
        hasChanges = true;
      }
    }
    cursor = end + 1;
  }
  return hasChanges || hasIgnoredFiles
    ? {hasIgnoredFiles, kind: 'dirty'}
    : {hasIgnoredFiles: false, kind: 'clean'};
}

function describeInspectionFailure(label: string, result: {exitCode?: number | null; kind: string; stderr?: string}): string {
  if (result.kind === 'missing') {
    return 'git is not available on PATH; the managed workspace could not be inspected.';
  }
  return describeGitFailure(label, result.stderr ?? '', result.exitCode ?? null);
}

export {inspectWorkspaceCleanliness};
export type {WorkspaceInspection};
