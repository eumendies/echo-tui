const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REVIEW_WORKFLOW,
  createReviewWorkflowPrompt
} = require('../../src/commands/agent-workflows/review-workflow');

test('/review workflow definition is an optional-argument plan-to-normal workflow', () => {
  assert.equal(REVIEW_WORKFLOW.name, 'review');
  assert.equal(REVIEW_WORKFLOW.description, '审查当前代码变更');
  assert.equal(REVIEW_WORKFLOW.argumentPolicy, 'optional');
  assert.equal(REVIEW_WORKFLOW.modePolicy, 'switch_plan_to_normal');
});

test('/review prompt defines Git scope and read-only review boundaries', () => {
  const prompt = createReviewWorkflowPrompt();

  assert.match(prompt, /Baseline is HEAD/);
  assert.match(prompt, /staged, unstaged, and untracked/);
  assert.match(prompt, /git status --short/);
  assert.match(prompt, /git diff --cached/);
  assert.match(prompt, /Stay read-only/);
  assert.match(prompt, /no output redirection, no commands that modify the workspace or system/);
  assert.match(prompt, /If this is not a Git workspace/);
  assert.match(prompt, /there are no changes vs HEAD/);
  assert.match(prompt, /do not call apply_patch/);
  assert.match(prompt, /write, format, auto-fix, or delete files/);
  assert.match(prompt, /do not load or supplement it with a skill named review/);
});

test('/review prompt asks for pragmatic actionable findings without exhaustive categories', () => {
  const prompt = createReviewWorkflowPrompt();

  assert.match(prompt, /like a pragmatic code reviewer/);
  assert.match(prompt, /Do not map the whole repository/);
  assert.match(prompt, /Report issues a maintainer would fix before merging/);
  assert.match(prompt, /Only report issues introduced or directly exposed by the diff/);
  assert.match(prompt, /grounded in changed code/);
  assert.match(prompt, /realistic trigger, broken contract, user-visible impact, or concrete maintenance cost/);
  assert.match(prompt, /broad refactor ideas, and nits/);
  assert.match(prompt, /you need not run tests for every finding/);
  assert.match(prompt, /do not treat it as a finding/);
  assert.match(prompt, /No actionable issues found/);
  assert.match(prompt, /at most one short sentence on the checked scope/);
});

test('/review prompt defines severity, finding fields, and ordering', () => {
  const prompt = createReviewWorkflowPrompt();
  const p0Index = prompt.indexOf('P0 catastrophic');
  const p1Index = prompt.indexOf('P1 high-impact');
  const p2Index = prompt.indexOf('P2 medium-impact');
  const p3Index = prompt.indexOf('P3 low-impact');

  assert.ok(p0Index >= 0);
  assert.ok(p1Index > p0Index);
  assert.ok(p2Index > p1Index);
  assert.ok(p3Index > p2Index);
  assert.match(prompt, /Lead with findings ordered P0 to P3/);
  assert.match(prompt, /For each finding give severity, file and line, issue, impact, and a concise fix/);
  assert.match(prompt, /put correctness first/);
  assert.match(prompt, /no pure nits/);
  assert.match(prompt, /do not inflate severity or pad with speculative suggestions/);
});

test('/review prompt includes user arguments as the primary lens when provided', () => {
  const prompt = createReviewWorkflowPrompt({argumentsText: 'focus on cancellation handling'});

  assert.match(prompt, /Focused review request/);
  assert.match(prompt, /within the baseline, scope, and read-only limits above/);
  assert.match(prompt, /focus on cancellation handling/);
  assert.match(prompt, /keep each one grounded in the changed code/);
});
