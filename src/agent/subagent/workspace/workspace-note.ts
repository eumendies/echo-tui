import type {PreparedSubagentWorkspace} from '../../../types/agent';

/**
 * 生成进入 Worker 系统上下文的受管工作区说明。
 *
 * 这些事实直接影响 Worker 的判断：看不到父未提交内容、不负责集成、Git 元数据不在
 * 写边界内。提示词只描述边界，不构成权限保证；真正的边界仍由工具与沙箱执行。
 */
function createWorkspacePromptSection(workspace: PreparedSubagentWorkspace): string {
  return [
    '## Worker Workspace',
    '',
    '- You are working in a managed detached Git worktree owned by the system, not in the parent project directory.',
    `- Execution directory: ${workspace.execCwd}`,
    `- Workspace root: ${workspace.workspaceRoot}`,
    `- Base commit: ${workspace.git.baseCommit}`,
    '- This workspace contains only files committed at that base commit. The parent working directory\'s staged, unstaged, and untracked changes are not present here.',
    '- You do not see other workers\' changes, and they do not see yours.',
    '- You own changes inside this workspace only. Do not commit, merge, push, switch shared branches, or integrate into the parent yourself.',
    '- The parent agent reviews and integrates your changes after you finish. A successful run does not mean the change is integrated.',
    '- The effective bash sandbox may allow writes across this workspace root, but this worktree\'s private gitDir and the shared Git common dir are not automatically writable. Read-only Git inspection works without staging or committing.'
  ].join('\n');
}

export {createWorkspacePromptSection};
