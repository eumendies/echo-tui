const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {createAgentManagementStore} = require('../../src/agent/subagent/management-store');
const {parseCustomSubagentManifest, serializeCustomSubagentManifest} = require('../../src/agent/subagent/manifest');
const {
  deleteBuiltinSubagentOverride,
  readAgentsSettingsScope,
  writeBuiltinSubagentOverride
} = require('../../src/agent/subagent/settings');

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-management-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(project, {recursive: true});
  return {home, project, root};
}

function createConfigSnapshot(ids = ['parent', 'reviewer']) {
  return {
    getLlmModelConfigInfo() {
      return {
        kind: 'profiles',
        selectedModelId: ids[0],
        models: ids.map((id) => ({id, provider: 'fake', model: `model-${id}`}))
      };
    }
  };
}

function createDraft(overrides = {}) {
  return {
    capability: overrides.capability || 'readonly',
    description: overrides.description || 'Inspect a bounded area.',
    effort: overrides.effort || 'inherit',
    instructions: overrides.instructions || '# Role\n\nReturn concise evidence.',
    mcp: overrides.mcp || false,
    ...(overrides.modelProfileId ? {modelProfileId: overrides.modelProfileId} : {}),
    tools: overrides.tools || ['read_files', 'grep']
  };
}

function writeAgent(root, name, draft = createDraft()) {
  const dir = path.join(root, '.echo', 'agents');
  fs.mkdirSync(dir, {recursive: true});
  const filePath = path.join(dir, `${name}.md`);
  fs.writeFileSync(filePath, typeof draft === 'string' ? draft : serializeCustomSubagentManifest(draft), 'utf8');
  return filePath;
}

function sha256(content) {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

test('management listing keeps built-in, user, and project physical items with effective statuses and safe drafts', () => {
  const workspace = createWorkspace();
  try {
    const userReviewer = writeAgent(workspace.home, 'reviewer', createDraft({description: 'User reviewer'}));
    writeAgent(workspace.home, 'user-only');
    writeAgent(workspace.home, 'explorer');
    writeAgent(workspace.home, 'Bad');
    const projectReviewer = writeAgent(workspace.project, 'reviewer', createDraft({description: 'Project reviewer', modelProfileId: 'reviewer'}));
    writeAgent(workspace.project, 'stale-model', createDraft({modelProfileId: 'deleted'}));
    const agentsDir = path.join(workspace.project, '.echo', 'agents');
    const outside = path.join(workspace.root, 'outside.md');
    fs.writeFileSync(outside, serializeCustomSubagentManifest(createDraft()), 'utf8');
    fs.symlinkSync(outside, path.join(agentsDir, 'linked.md'));

    const store = createAgentManagementStore({
      configSnapshot: createConfigSnapshot(),
      homedir: workspace.home,
      projectRoot: workspace.project
    });
    const snapshot = store.list();
    const byIdentity = new Map(snapshot.items.map((item) => [`${item.sourceKind}:${item.name}`, item]));

    assert.equal(byIdentity.get('builtin:explorer').status, 'active');
    assert.equal(byIdentity.get('builtin:worker').status, 'active');
    assert.equal(byIdentity.get('user:reviewer').status, 'shadowed');
    assert.equal(byIdentity.get('project:reviewer').status, 'active');
    assert.equal(byIdentity.get('user:user-only').status, 'active');
    assert.equal(byIdentity.get('user:explorer').status, 'reserved');
    assert.equal(byIdentity.get('user:Bad').status, 'invalid');
    assert.equal(byIdentity.get('project:stale-model').status, 'invalid');
    assert.equal(byIdentity.get('project:linked').status, 'invalid');
    assert.equal(byIdentity.get('project:stale-model').diagnostics[0].code, 'model_profile_not_found');
    assert.equal(byIdentity.get('project:linked').diagnostics[0].code, 'symbolic_link');
    assert.equal(byIdentity.get('user:reviewer').sourcePath, userReviewer);
    assert.equal(byIdentity.get('project:reviewer').sourcePath, projectReviewer);
    assert.equal(byIdentity.get('project:reviewer').draft.description, 'Project reviewer');
    assert.equal(byIdentity.get('project:stale-model').draft, undefined);
    const projectContent = fs.readFileSync(projectReviewer, 'utf8');
    assert.equal(byIdentity.get('project:reviewer').fingerprint, sha256(projectContent));
    assert.equal(Object.isFrozen(byIdentity.get('project:reviewer').draft.tools), true);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('definition mutations validate paths and models, refuse overwrite and stale fingerprints, and delete only matching regular files', () => {
  const workspace = createWorkspace();
  try {
    const store = createAgentManagementStore({
      configSnapshot: createConfigSnapshot(),
      homedir: workspace.home,
      projectRoot: workspace.project
    });

    for (const [scope, name, code] of [
      ['builtin', 'safe', 'invalid_scope'],
      ['user', '../escape', 'invalid_name'],
      ['project', 'worker', 'reserved_name']
    ]) {
      const result = store.create(scope, name, createDraft());
      assert.equal(result.ok, false);
      assert.equal(result.code, code);
    }
    const invalidModel = store.create('user', 'invalid-model', createDraft({modelProfileId: 'missing'}));
    assert.equal(invalidModel.ok, false);
    assert.equal(invalidModel.code, 'model_profile_not_found');

    const created = store.create('user', 'reviewer', createDraft({description: 'Initial'}));
    assert.equal(created.ok, true);
    assert.match(created.fingerprint, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(parseCustomSubagentManifest(fs.readFileSync(created.sourcePath, 'utf8')).manifest.description, 'Initial');
    const duplicate = store.create('user', 'reviewer', createDraft({description: 'Duplicate'}));
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.kind, 'conflict');
    assert.equal(parseCustomSubagentManifest(fs.readFileSync(created.sourcePath, 'utf8')).manifest.description, 'Initial');

    fs.writeFileSync(created.sourcePath, serializeCustomSubagentManifest(createDraft({description: 'External'})), 'utf8');
    const staleUpdate = store.update('user', 'reviewer', createDraft({description: 'Ours'}), created.fingerprint);
    assert.equal(staleUpdate.ok, false);
    assert.equal(staleUpdate.kind, 'conflict');
    const refreshed = store.list().items.find((item) => item.sourceKind === 'user' && item.name === 'reviewer');
    const updated = store.update('user', 'reviewer', createDraft({description: 'Ours'}), refreshed.fingerprint);
    assert.equal(updated.ok, true);
    assert.equal(parseCustomSubagentManifest(fs.readFileSync(created.sourcePath, 'utf8')).manifest.description, 'Ours');

    const staleDelete = store.remove('user', 'reviewer', refreshed.fingerprint);
    assert.equal(staleDelete.ok, false);
    assert.equal(staleDelete.kind, 'conflict');
    assert.equal(store.remove('user', 'reviewer', updated.fingerprint).ok, true);
    assert.equal(fs.existsSync(created.sourcePath), false);

    const projectAgents = path.join(workspace.project, '.echo', 'agents');
    fs.mkdirSync(path.join(projectAgents, 'directory.md'), {recursive: true});
    const nonFile = store.create('project', 'directory', createDraft());
    assert.equal(nonFile.ok, false);
    assert.equal(nonFile.code, 'not_regular_file');
    const outside = path.join(workspace.root, 'outside.md');
    fs.writeFileSync(outside, 'outside', 'utf8');
    fs.symlinkSync(outside, path.join(projectAgents, 'linked.md'));
    const symlink = store.create('project', 'linked', createDraft());
    assert.equal(symlink.ok, false);
    assert.equal(symlink.code, 'symbolic_link');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');

    const reservedPath = writeAgent(workspace.project, 'explorer');
    const invalidNamePath = writeAgent(workspace.project, 'Bad');
    const physicalItems = store.list().items;
    const reserved = physicalItems.find((item) => item.sourceKind === 'project' && item.name === 'explorer');
    const invalidName = physicalItems.find((item) => item.sourceKind === 'project' && item.name === 'Bad');
    assert.equal(store.remove('project', 'explorer', reserved.fingerprint).ok, true);
    assert.equal(store.remove('project', 'Bad', invalidName.fingerprint).ok, true);
    assert.equal(fs.existsSync(reservedPath), false);
    assert.equal(fs.existsSync(invalidNamePath), false);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('definition creation rejects a new unique name after the runtime catalog limit is reached', () => {
  const workspace = createWorkspace();
  try {
    for (let index = 0; index < 32; index += 1) {
      writeAgent(workspace.project, `agent-${String(index).padStart(2, '0')}`);
    }
    const store = createAgentManagementStore({
      configSnapshot: createConfigSnapshot(),
      homedir: workspace.home,
      projectRoot: workspace.project
    });

    const validation = store.validate('project', 'agent-over-limit', createDraft());
    assert.equal(validation.ok, false);
    assert.equal(validation.code, 'custom_limit_exceeded');
    const created = store.create('project', 'agent-over-limit', createDraft());
    assert.equal(created.ok, false);
    assert.equal(created.code, 'custom_limit_exceeded');
    assert.equal(fs.existsSync(path.join(workspace.project, '.echo', 'agents', 'agent-over-limit.md')), false);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('management reads reject oversized definition and settings files before parsing', () => {
  const workspace = createWorkspace();
  try {
    writeAgent(workspace.project, 'oversized', 'x'.repeat(40 * 1024 + 1));
    const settingsDir = path.join(workspace.home, '.echo');
    fs.mkdirSync(settingsDir, {recursive: true});
    fs.writeFileSync(path.join(settingsDir, 'agents.settings.json'), 'x'.repeat(16 * 1024 + 1), 'utf8');
    const options = {
      configSnapshot: createConfigSnapshot(),
      homedir: workspace.home,
      projectRoot: workspace.project
    };
    const store = createAgentManagementStore(options);

    const oversized = store.list().items.find((item) => item.sourceKind === 'project' && item.name === 'oversized');
    assert.equal(oversized.status, 'invalid');
    assert.equal(oversized.diagnostics[0].code, 'file_too_large');
    const settings = readAgentsSettingsScope('user', options);
    assert.equal(settings.status, 'invalid');
    assert.equal(settings.error.code, 'settings_too_large');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('definition atomic write cleans same-directory temporary and exclusive target files after rename failure', () => {
  const workspace = createWorkspace();
  try {
    const store = createAgentManagementStore({
      configSnapshot: createConfigSnapshot(),
      homedir: workspace.home,
      operations: {
        rename() {
          throw new Error('injected rename failure');
        }
      },
      projectRoot: workspace.project
    });
    const result = store.create('project', 'reviewer', createDraft());
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'io');
    const agentsDir = path.join(workspace.project, '.echo', 'agents');
    assert.deepEqual(fs.readdirSync(agentsDir), []);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('settings scope store canonicalizes overrides and protects writes and deletes with full-file fingerprints', () => {
  const workspace = createWorkspace();
  try {
    const options = {
      configSnapshot: createConfigSnapshot(['parent', 'fast']),
      homedir: workspace.home,
      projectRoot: workspace.project
    };
    assert.equal(readAgentsSettingsScope('user', options).status, 'missing');

    const created = writeBuiltinSubagentOverride('user', 'explorer', {modelProfileId: 'fast', effort: 'default'}, null, options);
    assert.equal(created.ok, true);
    let read = readAgentsSettingsScope('user', options);
    assert.equal(read.status, 'valid');
    assert.equal(read.fingerprint, created.fingerprint);
    assert.deepEqual(read.settings.overrides.explorer, {modelProfileId: 'fast', effort: 'default'});

    const staleFingerprint = read.fingerprint;
    fs.writeFileSync(read.sourcePath, JSON.stringify({schemaVersion: 1, overrides: {explorer: {effort: 'low'}}}), 'utf8');
    const conflict = writeBuiltinSubagentOverride('user', 'worker', {effort: 'high'}, staleFingerprint, options);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.kind, 'conflict');
    assert.equal(JSON.parse(fs.readFileSync(read.sourcePath, 'utf8')).overrides.worker, undefined);

    read = readAgentsSettingsScope('user', options);
    const invalidModel = writeBuiltinSubagentOverride('user', 'worker', {modelProfileId: 'deleted', effort: 'inherit'}, read.fingerprint, options);
    assert.equal(invalidModel.ok, false);
    assert.equal(invalidModel.code, 'model_profile_not_found');
    const withWorker = writeBuiltinSubagentOverride('user', 'worker', {effort: 'max'}, read.fingerprint, options);
    assert.equal(withWorker.ok, true);

    const staleDelete = deleteBuiltinSubagentOverride('user', 'explorer', read.fingerprint, options);
    assert.equal(staleDelete.ok, false);
    assert.equal(staleDelete.kind, 'conflict');
    const removedExplorer = deleteBuiltinSubagentOverride('user', 'explorer', withWorker.fingerprint, options);
    assert.equal(removedExplorer.ok, true);
    assert.deepEqual(readAgentsSettingsScope('user', options).settings.overrides, {worker: {effort: 'max'}});
    const removedWorker = deleteBuiltinSubagentOverride('user', 'worker', removedExplorer.fingerprint, options);
    assert.equal(removedWorker.ok, true);
    assert.equal(readAgentsSettingsScope('user', options).status, 'missing');
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});

test('settings store rejects symlinks and cleans temporary files when atomic rename fails', () => {
  const workspace = createWorkspace();
  try {
    const echoDir = path.join(workspace.project, '.echo');
    fs.mkdirSync(echoDir, {recursive: true});
    const outside = path.join(workspace.root, 'outside.json');
    fs.writeFileSync(outside, '{"outside":true}', 'utf8');
    const settingsPath = path.join(echoDir, 'agents.settings.json');
    fs.symlinkSync(outside, settingsPath);
    const options = {
      configSnapshot: createConfigSnapshot(),
      homedir: workspace.home,
      projectRoot: workspace.project
    };
    const read = readAgentsSettingsScope('project', options);
    assert.equal(read.status, 'invalid');
    assert.equal(read.error.code, 'symbolic_link');
    const rejected = writeBuiltinSubagentOverride('project', 'worker', {effort: 'high'}, null, options);
    assert.equal(rejected.ok, false);
    assert.equal(fs.readFileSync(outside, 'utf8'), '{"outside":true}');

    fs.unlinkSync(settingsPath);
    const failingOptions = {
      ...options,
      operations: {
        rename() {
          throw new Error('injected rename failure');
        }
      }
    };
    const failed = writeBuiltinSubagentOverride('project', 'worker', {effort: 'high'}, null, failingOptions);
    assert.equal(failed.ok, false);
    assert.equal(failed.kind, 'io');
    assert.deepEqual(fs.readdirSync(echoDir), []);
  } finally {
    fs.rmSync(workspace.root, {recursive: true, force: true});
  }
});
