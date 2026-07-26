const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  INIT_WORKFLOW,
  createInitWorkflowPrompt
} = require('../../src/commands/agent-workflows/init-workflow');

test('/init workflow definition is an optional-argument plan-to-normal workflow', () => {
  assert.equal(INIT_WORKFLOW.name, 'init');
  assert.equal(INIT_WORKFLOW.argumentPolicy, 'optional');
  assert.equal(INIT_WORKFLOW.modePolicy, 'switch_plan_to_normal');
});

test('/init prompt defines evidence, create, review, and reload boundaries', () => {
  const prompt = createInitWorkflowPrompt({fileName: 'AGENTS.md'});

  assert.match(prompt, /nearest \.git file\/directory or a project-level \.echo directory/);
  assert.match(prompt, /Do not mistake the ~\/\.echo directory used for global configuration/);
  assert.match(prompt, /Prefer glob, grep, and read_files/);
  assert.match(prompt, /use run_bash_command for read-only checks/);
  assert.match(prompt, /Only adopt facts that can be verified in the repository/);
  assert.match(prompt, /If the file does not exist/);
  assert.match(prompt, /Use apply_patch to create the file/);
  assert.doesNotMatch(prompt, /\/undo|undo/);
  assert.match(prompt, /loaded starting from the next agent request/);
  assert.match(prompt, /If the file already exists/);
  assert.match(prompt, /Do not call apply_patch to modify, overwrite, or rewrite the file/);
  assert.match(prompt, /prioritized improvement suggestions/);
  assert.match(prompt, /repository evidence/);
  assert.match(prompt, /Markdown text or a localized diff/);
});

test('/init prompt includes user arguments when provided', () => {
  const prompt = createInitWorkflowPrompt({argumentsText: 'focus on monorepo package commands', fileName: 'AGENTS.md'});

  assert.match(prompt, /User-provided \/init arguments/);
  assert.match(prompt, /focus on monorepo package commands/);
});

test('/init prompt follows the selected CLAUDE.md instruction file', () => {
  const prompt = createInitWorkflowPrompt({fileName: 'CLAUDE.md'});

  assert.match(prompt, /generate or review the CLAUDE\.md/);
  assert.match(prompt, /target CLAUDE\.md path/);
  assert.doesNotMatch(prompt, /AGENTS\.md/);
});

test('/init prompt reads the current instruction selection from user config', () => {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-init-workflow-'));
  os.homedir = () => homeDir;

  try {
    fs.mkdirSync(path.join(homeDir, '.echo'), {recursive: true});
    fs.writeFileSync(path.join(homeDir, '.echo', 'config.json'), JSON.stringify({instructions: {fileName: 'CLAUDE.md'}}), 'utf8');

    const prompt = createInitWorkflowPrompt();
    assert.match(prompt, /generate or review the CLAUDE\.md/);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});
