import type {AgentWorkflowDefinition} from '../../types/agent-workflow';

const REVIEW_WORKFLOW_PROMPT = `Run the Echo TUI built-in /review workflow: review the current Git workspace changes like a pragmatic code reviewer.

This is the complete built-in review instruction; do not load or supplement it with a skill named review.

Baseline and scope:
- Baseline is HEAD, covering staged, unstaged, and untracked changes; read untracked files directly and account for additions, deletions, and renames. Use read-only git commands (git status --short, git diff, git diff --cached) and file reads to understand them.
- Stay read-only: no output redirection, no commands that modify the workspace or system.
- If this is not a Git workspace, or there are no changes vs HEAD, say so clearly and stop; do not pivot to unrelated existing code.

Approach:
- Understand the intent first: read focused diffs, then surrounding code, callers, types, tests, config, or AGENTS.md when they clarify impact. Do not map the whole repository.
- Report issues a maintainer would fix before merging: correctness bugs, regressions, broken contracts, boundary conditions, error-handling gaps, security or data-loss risks, and maintainability issues with concrete impact.
- Only report issues introduced or directly exposed by the diff, each grounded in changed code with a realistic trigger, broken contract, user-visible impact, or concrete maintenance cost. Skip unrelated existing issues, missing tests alone, formatting or naming preferences, broad refactor ideas, and nits.
- Verify by reading the code path, tests, types, or a cheap targeted command; you need not run tests for every finding. If a command fails and you cannot tie it to the diff, do not treat it as a finding.

Output:
- Severity: P0 catastrophic (data corruption, serious security incident); P1 high-impact correctness that breaks core functionality or causes serious regressions; P2 medium-impact local correctness, reliability, or architecture issues to fix before merging; P3 low-impact but verified architecture or convention issues with a clear maintenance cost (no pure nits).
- Lead with findings ordered P0 to P3; within a level put correctness first, then impact and confidence. For each finding give severity, file and line, issue, impact, and a concise fix when obvious.
- Be concise; do not inflate severity or pad with speculative suggestions. If nothing is actionable, output "No actionable issues found." plus at most one short sentence on the checked scope.

The entire workflow only reviews: do not call apply_patch or write, format, auto-fix, or delete files.`;

function createReviewWorkflowPrompt({argumentsText}: {argumentsText?: string} = {}): string {
  if (!argumentsText) {
    return REVIEW_WORKFLOW_PROMPT;
  }

  return `${REVIEW_WORKFLOW_PROMPT}

Focused review request — make this the primary lens within the baseline, scope, and read-only limits above:
${argumentsText}

Lead with findings on this angle, and keep each one grounded in the changed code.`;
}

const REVIEW_WORKFLOW: AgentWorkflowDefinition = {
  name: 'review',
  description: '审查当前代码变更',
  argumentPolicy: 'optional',
  modePolicy: 'switch_plan_to_normal',
  createPrompt: createReviewWorkflowPrompt
};

export {
  REVIEW_WORKFLOW,
  REVIEW_WORKFLOW_PROMPT,
  createReviewWorkflowPrompt
};
