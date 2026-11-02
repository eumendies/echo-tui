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
    getMainAgentToolsConfig() { return {disabledTools: []}; },
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
    assert.deepEqual(port.list().builtins.map((builtin) => builtin.policy), [
      {fields: [], status: 'none'},
      {fields: [], status: 'none'}
    ]);
    const written = port.writeBuiltinOverride('user', 'explorer', {modelProfileId: 'reviewer', effort: 'default'}, null);
    assert.equal(written.ok, true);
    let snapshot = port.list();
    const explorer = snapshot.builtins.find((builtin) => builtin.name === 'explorer');
    assert.deepEqual({model: explorer.modelProfileId, effort: explorer.effort}, {
      model: 'reviewer', effort: 'default'
    });
    assert.deepEqual(explorer.policy, {
      fields: ['model', 'effort'],
      sourceKind: 'user',
      sourcePath: path.join(home, '.echo', 'agents.settings.json'),
      status: 'applied'
    });
    const conflict = port.writeBuiltinOverride('user', 'worker', {effort: 'high'}, null);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.kind, 'conflict');
    assert.equal(port.deleteBuiltinOverride('user', 'explorer', written.fingerprint).ok, true);
    snapshot = port.list();
    assert.equal(snapshot.builtins.find((builtin) => builtin.name === 'explorer').modelProfileId, undefined);
    assert.deepEqual(snapshot.builtins.find((builtin) => builtin.name === 'explorer').policy, {fields: [], status: 'none'});
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('AgentsCommandPort projects which builtin policy source is effective', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agents-port-policy-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(home, '.echo'), {recursive: true});
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  fs.mkdirSync(path.join(project, '.echo'), {recursive: true});
  const userPath = path.join(home, '.echo', 'agents.settings.json');
  const projectPath = path.join(project, '.echo', 'agents.settings.json');
  fs.writeFileSync(userPath, JSON.stringify({schemaVersion: 2, overrides: {explorer: {effort: 'low'}}}), 'utf8');
  try {
    const port = createAgentsCommandPort({captureUserConfigSnapshot: createSnapshot, cwd: () => project, homedir: () => home});
    let snapshot = port.list();
    assert.deepEqual(snapshot.builtins.find((builtin) => builtin.name === 'explorer').policy, {
      fields: ['effort'], sourceKind: 'user', sourcePath: userPath, status: 'applied'
    });

    // 项目级条目整体遮蔽用户级；缺省字段不回退用户级值。
    fs.writeFileSync(projectPath, JSON.stringify({schemaVersion: 2, overrides: {explorer: {modelProfileId: 'reviewer'}}}), 'utf8');
    snapshot = port.list();
    const explorer = snapshot.builtins.find((builtin) => builtin.name === 'explorer');
    assert.equal(explorer.effort, 'inherit');
    assert.deepEqual(explorer.policy, {
      fields: ['model'], sourceKind: 'project', sourcePath: projectPath, status: 'applied'
    });

    // 引用已不存在的模型 profile：整条 override 未生效，但保留失效引用供界面点名。
    fs.writeFileSync(projectPath, JSON.stringify({schemaVersion: 2, overrides: {explorer: {modelProfileId: 'gone', effort: 'high'}}}), 'utf8');
    snapshot = port.list();
    assert.deepEqual(snapshot.builtins.find((builtin) => builtin.name === 'explorer').policy, {
      fields: [], missingModelProfileId: 'gone', sourceKind: 'project', sourcePath: projectPath, status: 'ignored'
    });
    assert.equal(snapshot.builtins.find((builtin) => builtin.name === 'explorer').effort, 'inherit');
    assert.deepEqual(snapshot.diagnostics.map((diagnostic) => diagnostic.code), ['builtin_model_profile_not_found']);

    // 无效 settings 是 fail-closed：两个 scope 都不生效。
    fs.writeFileSync(projectPath, '{not json', 'utf8');
    snapshot = port.list();
    assert.deepEqual(snapshot.builtins.find((builtin) => builtin.name === 'explorer').policy, {fields: [], status: 'none'});
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

function createEnablementFixture(t, disabledTools = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agents-enablement-port-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  const port = createAgentsCommandPort({
    captureUserConfigSnapshot: () => ({...createSnapshot(), getMainAgentToolsConfig: () => ({disabledTools})}),
    cwd: () => project,
    homedir: () => home
  });
  return {home, project, port};
}

test('AgentsCommandPort uses only the global switch independently from project model policies', (t) => {
  for (const globalEnabled of [undefined, false, true]) {
    for (const effort of ['low', 'high']) {
      const {port, project} = createEnablementFixture(t);
      assert.equal(port.create('project', 'reviewer', createDraft()).ok, true);
      if (globalEnabled !== undefined) assert.equal(port.writeEnablement('reviewer', globalEnabled, null).ok, true);
      const file = path.join(project, '.echo', 'agents.settings.json');
      fs.writeFileSync(file, JSON.stringify({schemaVersion: 2, overrides: {worker: {effort}}}));
      assert.equal(port.list().items.find((item) => item.name === 'reviewer').enablement.enabled, globalEnabled ?? true);
      assert.equal(port.list().overrides.find((source) => source.sourceKind === 'project').status, 'valid');
    }
  }
});

test('AgentsCommandPort keeps disabled and shadowed physical definitions with independent name enablement', (t) => {
  const {port, project} = createEnablementFixture(t, ['run_subagent']);
  assert.equal(port.create('user', 'reviewer', createDraft()).ok, true);
  assert.equal(port.create('project', 'reviewer', createDraft()).ok, true);
  assert.equal(port.writeEnablement('reviewer', false, null).ok, true);
  let snapshot = port.list();
  const reviewers = snapshot.items.filter((item) => item.name === 'reviewer');
  assert.deepEqual(reviewers.map((item) => item.status), ['shadowed', 'active']);
  assert.deepEqual(reviewers.map((item) => item.enablement), [
    {enabled: false},
    {enabled: false}
  ]);
  assert.equal(snapshot.delegationToolEnabled, false);
  assert.equal(port.writeBuiltinOverride('project', 'worker', {effort: 'high'}, null).ok, true);
  const projectSettings = path.join(project, '.echo', 'agents.settings.json');
  assert.equal(port.list().items.find((item) => item.name === 'reviewer').enablement.enabled, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(projectSettings, 'utf8')).overrides, {worker: {effort: 'high'}});
  const selected = port.list().items.find((item) => item.name === 'reviewer' && item.sourceKind === 'project');
  assert.equal(port.delete('project', 'reviewer', selected.fingerprint).ok, true);
  snapshot = port.list();
  const remaining = snapshot.items.find((item) => item.name === 'reviewer');
  assert.equal(remaining.status, 'active');
  assert.equal(remaining.enablement.enabled, false);
  assert.equal(port.delete('user', 'reviewer', remaining.fingerprint).ok, true);
  assert.equal(port.create('project', 'reviewer', createDraft()).ok, true);
  assert.equal(port.list().items.find((item) => item.name === 'reviewer').enablement.enabled, false);
});

test('AgentsCommandPort keeps management available with unknown delegation state when tools configuration is invalid', (t) => {
  const {port: setupPort, home, project} = createEnablementFixture(t);
  assert.equal(setupPort.create('project', 'reviewer', createDraft()).ok, true);
  assert.equal(setupPort.list().delegationToolEnabled, true);
  const secret = 'secret-config-value\u001b[31m' + 'x'.repeat(10000);
  const port = createAgentsCommandPort({
    captureUserConfigSnapshot: () => ({
      ...createSnapshot(),
      getMainAgentToolsConfig() { throw new Error(secret); }
    }),
    cwd: () => project,
    homedir: () => home
  });
  let snapshot = port.list();
  assert.deepEqual(snapshot.items.map((item) => item.name).sort(), ['explorer', 'reviewer', 'worker']);
  let fingerprint = null;
  for (const enabled of [false, true]) {
    assert.equal(snapshot.delegationToolEnabled, undefined);
    assert.deepEqual(snapshot.diagnostics, [{
      code: 'main_agent_tools_config_invalid',
      message: 'Main agent tools configuration could not be read; delegation availability is unknown.'
    }]);
    assert.doesNotMatch(JSON.stringify(snapshot), /secret-config-value|\\u001b/);
    const result = port.writeEnablement('reviewer', enabled, fingerprint);
    assert.equal(result.ok, true);
    fingerprint = result.fingerprint;
    snapshot = port.list();
    assert.equal(snapshot.items.find((item) => item.name === 'reviewer').enablement.enabled, enabled);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.echo', 'agents.settings.json'), 'utf8')).enabled, {reviewer: enabled});
  }
  assert.equal(snapshot.delegationToolEnabled, undefined);
});

test('AgentsCommandPort separates invalid definitions, bad settings and missing model references from enablement', (t) => {
  const {port, home, project} = createEnablementFixture(t);
  assert.equal(port.create('project', 'reviewer', createDraft()).ok, true);
  fs.writeFileSync(path.join(project, '.echo', 'agents', 'broken.md'), 'not a manifest', 'utf8');
  assert.equal(port.writeEnablement('reviewer', false, null).ok, true);
  const settingsPath = path.join(home, '.echo', 'agents.settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({schemaVersion: 3, enabled: {reviewer: false, broken: true, worker: false}, overrides: {worker: {modelProfileId: 'gone'}}}));
  let snapshot = port.list();
  assert.equal(snapshot.items.find((item) => item.name === 'broken').status, 'invalid');
  assert.equal(snapshot.items.find((item) => item.name === 'broken').enablement.enabled, true);
  assert.equal(snapshot.items.find((item) => item.name === 'reviewer').status, 'active');
  assert.equal(snapshot.items.find((item) => item.name === 'worker').enablement.enabled, false);
  assert.equal(snapshot.builtins.find((item) => item.name === 'worker').policy.status, 'ignored');
  const oldFingerprint = snapshot.overrides.find((source) => source.sourceKind === 'user').fingerprint;
  fs.writeFileSync(settingsPath, '{bad json');
  snapshot = port.list();
  assert.equal(snapshot.items.length, 4);
  for (const item of snapshot.items) assert.deepEqual(item.enablement, {enabled: undefined});
  assert.equal(snapshot.overrides[0].status, 'invalid');
  assert.ok(snapshot.diagnostics.some((item) => item.code === 'invalid_settings_json'));
  const conflict = port.writeEnablement('worker', true, oldFingerprint);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.kind, 'conflict');
  const invalidSave = port.writeEnablement('worker', true, snapshot.overrides[0].fingerprint);
  assert.equal(invalidSave.ok, false);
  assert.equal(invalidSave.kind, 'validation');
  assert.equal(fs.readFileSync(settingsPath, 'utf8'), '{bad json');
});

test('AgentsCommandPort returns structured enablement conflicts without discarding other policy values', (t) => {
  const {port, home} = createEnablementFixture(t);
  const original = port.writeBuiltinOverride('user', 'explorer', {effort: 'high', skillNames: []}, null);
  const changed = port.writeEnablement('worker', false, original.fingerprint);
  assert.equal(changed.ok, true);
  const conflict = port.writeEnablement('explorer', false, original.fingerprint);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.kind, 'conflict');
  const content = JSON.parse(fs.readFileSync(path.join(home, '.echo', 'agents.settings.json'), 'utf8'));
  assert.deepEqual(content.enabled, {worker: false});
  assert.deepEqual(content.overrides, {explorer: {effort: 'high', skills: []}});
  assert.equal(port.writeEnablement('worker', null, changed.fingerprint).ok, true);
  assert.equal(port.list().items.find((item) => item.name === 'worker').enablement.enabled, true);
});
