const HANDOFF_MAX_CHARS = 2000;

type WorkerWorkspaceHandoffInput = {
  baseCommit: string; // 段级冻结的完整基线。
  cleanup?: {kind: 'removed' | 'retained'; message?: string}; // 结束时的清理结果。
  execCwd: string; // Worker 实际执行目录。
  hasIgnoredFiles?: boolean; // 是否存在未纳入结果的 ignored 遗留。
  workspaceRoot: string; // 完整 worktree 根。
};

/**
 * 生成 Worker 工作区交接块。
 *
 * 成果是 worktree 里的文件本身，所以交接只提供定位与自查命令：基线、路径、
 * 建议的 git 命令和「未集成」事实。它不含文件内容或 diff，也不声称已验证。
 */
function buildWorkerWorkspaceHandoff(input: WorkerWorkspaceHandoffInput): string {
  // 空运行被回收：没有成果可交接，也不再给出已经不存在的工作区路径。
  if (input.cleanup?.kind === 'removed') {
    return '## Worker Workspace Handoff\n\n- No changes: the workspace matched the base commit and was removed.';
  }

  // 定位必须完整：路径不参与截断，说明文字在剩余预算内压缩。
  const essential = [
    '## Worker Workspace Handoff',
    '',
    `- Workspace: ${input.workspaceRoot} (managed detached worktree)`,
    // 父 cwd 就是仓库根时两者相同，省掉重复的一行路径。
    ...(input.execCwd === input.workspaceRoot ? [] : [`- Execution directory: ${input.execCwd}`]),
    `- Base commit: ${input.baseCommit} — compare workspace changes against this commit, not HEAD or the index`,
    '',
    `- Cleanup: workspace retained.${input.cleanup?.message ? ` ${boundedText(input.cleanup.message, 240)}` : ''}`
  ].join('\n');

  const notes = [
    '- Base contents: committed files only; the parent working tree\'s staged, unstaged, and untracked changes are not visible here.',
    '- Integration: not applied. The workspace files are the result; review and integrate them with your own tools.',
    ...(input.hasIgnoredFiles === true
      ? ['- Ignored files remain in the workspace and are not part of the result.']
      : [])
  ].join('\n');

  const remaining = HANDOFF_MAX_CHARS - essential.length - 2;
  return remaining > 0 ? `${essential}\n\n${boundedText(notes, remaining)}` : essential;
}

function boundedText(value: string, maxChars: number): string {
  const normalized = value.replace(/\r\n?/gu, '\n').trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

export {buildWorkerWorkspaceHandoff};
export type {WorkerWorkspaceHandoffInput};
