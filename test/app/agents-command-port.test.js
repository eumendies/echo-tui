const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {createAgentsCommandPort} = require('../../src/app/command/agents-command-port');

function createDraft(overrides = {}) {
  return {
    capability: overrides.capability || 'readonly',
    description: overrides.description || 'Inspect the selected files.',
    effort: overrides.effort || 'inherit',
    instructions: overrides.instructions || '# Role\n\nReturn concise evidence.',
    mcp: overrides.mcp || false,
    ...(overrides.modelProfileId ? {modelProfileId: overrides.modelProfileId} : {}),
    tools: overrides.tools || ['read_files', 'grep']
  };
}

function createSnapshot() {
  return {
    getLlmModelConfigInfo() {
      return {
        kind: 'profiles',
        selectedModelId: 'parent',
        models: [
          {id: 'parent', model: 'model-parent', provider: 'fake'},
          {id: 'reviewer', model: 'model-reviewer', provider: 'fake', reasoningEffort: 'high'}
        ]
      };
    }
  };
}

test('AgentsCommandPort derives project root and exposes structured definition operations', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agents-port-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const nested = path.join(project, 'packages', 'app');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  fs.mkdirSync(nested, {recursive: true});
  try {
    const port = createAgentsCommandPort({captureUserConfigSnapshot: createSnapshot, cwd: () => nested, homedir: () => home});
    assert.deepEqual(port.validate('project', 'reviewer', createDraft({modelProfileId: 'reviewer'})), {
      ok: true,
      sourcePath: path.join(project, '.echo', 'agents', 'reviewer.md')
    });

    const created = port.create('project', 'reviewer', createDraft({modelProfileId: 'reviewer'}));
    assert.equal(created.ok, true);
    assert.match(created.fingerprint, /^sha256:/u);
    const duplicate = port.create('project', 'reviewer', createDraft());
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.kind, 'conflict');

    let snapshot = port.list();
    const item = snapshot.items.find((candidate) => candidate.sourceKind === 'project' && candidate.name === 'reviewer');
    assert.equal(item.status, 'active');
    assert.equal(item.draft.modelProfileId, 'reviewer');
    assert.deepEqual(snapshot.models.map((model) => model.id), ['parent', 'reviewer']);
    assert.deepEqual(snapshot.builtins.map((builtin) => builtin.name), ['explorer', 'worker']);

    const updated = port.update('project', 'reviewer', createDraft({description: 'Updated'}), item.fingerprint);
    assert.equal(updated.ok, true);
    const staleDelete = port.delete('project', 'reviewer', item.fingerprint);
    assert.equal(staleDelete.ok, false);
    assert.equal(staleDelete.kind, 'conflict');
    assert.equal(port.delete('project', 'reviewer', updated.fingerprint).ok, true);
    snapshot = port.list();
    assert.equal(snapshot.items.some((candidate) => candidate.name === 'reviewer'), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('AgentsCommandPort reads, writes and removes built-in overrides with conflicts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agents-port-settings-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(path.join(project, '.echo'), {recursive: true});
  try {
    const port = createAgentsCommandPort({captureUserConfigSnapshot: createSnapshot, cwd: () => project, homedir: () => home});
    assert.deepEqual(port.list().overrides.map((source) => source.status), ['missing', 'missing']);
    const written = port.writeBuiltinOverride('user', 'explorer', {modelProfileId: 'reviewer', effort: 'default'}, null);
    assert.equal(written.ok, true);
    let snapshot = port.list();
    const explorer = snapshot.builtins.find((builtin) => builtin.name === 'explorer');
    assert.deepEqual({model: explorer.modelProfileId, effort: explorer.effort}, {
      model: 'reviewer', effort: 'default'
    });
    const conflict = port.writeBuiltinOverride('user', 'worker', {effort: 'high'}, null);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.kind, 'conflict');
    assert.equal(port.deleteBuiltinOverride('user', 'explorer', written.fingerprint).ok, true);
    snapshot = port.list();
    assert.equal(snapshot.builtins.find((builtin) => builtin.name === 'explorer').modelProfileId, undefined);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('AgentsCommandPort exposes the current skill catalog and builtin skill policies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agents-port-skills-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  const skillsDir = path.join(project, '.echo', 'skills');
  fs.mkdirSync(path.join(skillsDir, 'review-skill'), {recursive: true});
  fs.writeFileSync(path.join(skillsDir, 'review-skill', 'SKILL.md'), '---\nname: review-skill\ndescription: Review code.\n---\n\n# Review\n', 'utf8');
  fs.mkdirSync(path.join(skillsDir, 'disabled-skill'), {recursive: true});
  fs.writeFileSync(path.join(skillsDir, 'disabled-skill', 'SKILL.md'), '---\nname: disabled-skill\ndescription: Disabled skill.\n---\n\n# Disabled\n', 'utf8');
  fs.writeFileSync(path.join(skillsDir, 'skills.json'), JSON.stringify({schemaVersion: 3, disabled: ['disabled-skill'], effortOverrides: {}, modelOverrides: {}}), 'utf8');
  fs.mkdirSync(path.join(home, '.echo'), {recursive: true});
  fs.writeFileSync(
    path.join(home, '.echo', 'agents.settings.json'),
    JSON.stringify({schemaVersion: 2, overrides: {explorer: {effort: 'low', skills: ['review-skill', 'missing-skill']}}}),
    'utf8'
  );
  try {
    const port = createAgentsCommandPort({captureUserConfigSnapshot: createSnapshot, cwd: () => project, homedir: () => home});
    const snapshot = port.list();
    assert.deepEqual(snapshot.skills.find((skill) => skill.name === 'review-skill'), {enabled: true, name: 'review-skill', sourceKind: 'project'});
    assert.equal(snapshot.skills.find((skill) => skill.name === 'disabled-skill').enabled, false);
    const explorer = snapshot.builtins.find((builtin) => builtin.name === 'explorer');
    assert.deepEqual(explorer.skillNames, ['review-skill', 'missing-skill']);

    const userFingerprint = port.list().overrides.find((source) => source.sourceKind === 'user').fingerprint;
    // 端口接收领域草稿形状（skillNames），由存储层映射回文件字段 skills。
    const written = port.writeBuiltinOverride('user', 'worker', {effort: 'high', skillNames: ['review-skill']}, userFingerprint);
    assert.equal(written.ok, true);
    assert.deepEqual(port.list().builtins.find((builtin) => builtin.name === 'worker').skillNames, ['review-skill']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
