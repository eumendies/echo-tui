const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {
  deleteBuiltinSubagentOverride,
  loadAgentsSettingsSources,
  parseAgentsSettings,
  readAgentsSettingsScope,
  selectBuiltinSubagentOverride,
  selectSubagentEnablement,
  serializeAgentsSettings,
  writeBuiltinSubagentOverride,
  writeSubagentEnablement
} = require('../../src/agent/subagent/settings');

/** 为每个存储用例创建隔离的可信 scope 根，并在结束时清理。 */
function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-enablement-settings-'));
  const options = {homedir: path.join(root, 'home'), projectRoot: path.join(root, 'project')};
  fs.mkdirSync(options.homedir);
  fs.mkdirSync(options.projectRoot);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return {root, options};
}

test('global settings versions preserve defaults without migrating reads', (t) => {
  const {options} = createWorkspace(t);
  fs.mkdirSync(path.join(options.homedir, '.echo'));
  const filePath = path.join(options.homedir, '.echo', 'agents.settings.json');
  for (const schemaVersion of [1, 2, 3]) {
    const content = JSON.stringify({schemaVersion, overrides: {worker: {effort: 'low'}}});
    fs.writeFileSync(filePath, content);
    const read = readAgentsSettingsScope('user', options);
    assert.equal(read.status, 'valid');
    if (schemaVersion === 3) {
      assert.deepEqual(read.settings.enabled, {});
      assert.equal(Object.isFrozen(read.settings.enabled), true);
    } else {
      assert.equal(Object.hasOwn(read.settings, 'enabled'), false);
    }
    assert.deepEqual(selectSubagentEnablement('worker', [read]), {enabled: true});
    assert.equal(fs.readFileSync(filePath, 'utf8'), content);
    assert.equal(JSON.parse(serializeAgentsSettings(read.settings)).schemaVersion, schemaVersion === 3 ? 3 : 2);
  }
  const parsed = parseAgentsSettings(JSON.stringify({
    schemaVersion: 3, enabled: {worker: false, explorer: true, 'unknown-agent': false, constructor: false}, overrides: {}
  }), 3);
  assert.equal(parsed.ok, true);
  assert.equal(Object.isFrozen(parsed.settings.enabled), true);
  assert.deepEqual(parseAgentsSettings(serializeAgentsSettings(parsed.settings), 3).settings, parsed.settings);
});

test('project versions preserve legacy model policies without read migration', (t) => {
  const {options} = createWorkspace(t);
  fs.mkdirSync(path.join(options.projectRoot, '.echo'));
  const filePath = path.join(options.projectRoot, '.echo', 'agents.settings.json');
  for (const schemaVersion of [1, 2]) {
    const override = {modelProfileId: 'legacy-model', ...(schemaVersion === 1 ? {} : {skills: []})};
    const content = JSON.stringify({schemaVersion, overrides: {worker: override}});
    const parsed = parseAgentsSettings(content);
    assert.equal(parsed.ok, true);
    assert.equal(Object.isFrozen(parsed.settings), true);
    assert.deepEqual(parsed.settings.overrides.worker, {
      effort: 'inherit', modelProfileId: 'legacy-model', ...(schemaVersion === 1 ? {} : {skillNames: []})
    });
    fs.writeFileSync(filePath, content);
    const read = readAgentsSettingsScope('project', options);
    assert.equal(read.status, 'valid');
    assert.equal(fs.readFileSync(filePath, 'utf8'), content);
    const serialized = serializeAgentsSettings(read.settings);
    assert.deepEqual(Object.keys(JSON.parse(serialized)), ['schemaVersion', 'overrides']);
    assert.equal(JSON.parse(serialized).schemaVersion, 2);
    assert.deepEqual(parseAgentsSettings(serialized).settings.overrides, parsed.settings.overrides);
  }
});

test('enablement parser rejects old-version fields, malformed names, values and structures as whole files', () => {
  const cases = [
    {schemaVersion: 1, enabled: {}, overrides: {}},
    {schemaVersion: 2, enabled: {}, overrides: {}},
    {schemaVersion: 3, enabled: null, overrides: {}},
    {schemaVersion: 3, enabled: [], overrides: {}},
    {schemaVersion: 3, enabled: false, overrides: {}},
    {schemaVersion: 3, enabled: {}, overrides: {}, extra: true},
    {schemaVersion: 3, enabled: {worker: false}},
    ...['../worker', '', 'Worker', '__proto__', 'a'.repeat(65), 'bad\u001b'].map((name) => ({
      schemaVersion: 3, enabled: {[name]: false}, overrides: {}
    })),
    ...['false', null, 0, {}, []].map((value) => ({
      schemaVersion: 3, enabled: {worker: false, explorer: value}, overrides: {}
    }))
  ];
  for (const value of cases) {
    const parsed = parseAgentsSettings(JSON.stringify(value), 3);
    assert.equal(parsed.ok, false, JSON.stringify(value));
    assert.equal(parsed.settings, undefined);
    assert.ok(parsed.error.message.length <= 500);
    assert.doesNotMatch(parsed.error.message, /\u001b/);
  }
});

test('only global enablement controls all projects independently from project model policy', (t) => {
  const {options} = createWorkspace(t);
  assert.deepEqual(selectSubagentEnablement('worker', loadAgentsSettingsSources(options)), {enabled: true});
  const user = writeSubagentEnablement('worker', false, null, options);
  assert.equal(user.ok, true);
  const project = writeBuiltinSubagentOverride('project', 'worker', {effort: 'high'}, null, options);
  assert.equal(project.ok, true);
  assert.deepEqual(selectSubagentEnablement('worker', loadAgentsSettingsSources(options)), {
    enabled: false
  });
  assert.equal(selectBuiltinSubagentOverride('worker', loadAgentsSettingsSources(options)).override.effort, 'high');
  const otherProject = {...options, projectRoot: path.join(path.dirname(options.projectRoot), 'other-project')};
  fs.mkdirSync(otherProject.projectRoot);
  assert.equal(writeBuiltinSubagentOverride('project', 'worker', {effort: 'low'}, null, otherProject).ok, true);
  assert.equal(selectBuiltinSubagentOverride('worker', loadAgentsSettingsSources(otherProject)).override.effort, 'low');
  assert.equal(selectSubagentEnablement('worker', loadAgentsSettingsSources(otherProject)).enabled, false);
  assert.equal(writeSubagentEnablement('worker', true, user.fingerprint, options).ok, true);
  for (const projectOptions of [options, otherProject]) {
    assert.equal(selectSubagentEnablement('worker', loadAgentsSettingsSources(projectOptions)).enabled, true);
  }
  fs.writeFileSync(project.sourcePath, '{broken');
  assert.equal(selectSubagentEnablement('worker', loadAgentsSettingsSources(options)).enabled, true);
  fs.writeFileSync(user.sourcePath, '{broken secret');
  assert.deepEqual(selectSubagentEnablement('worker', loadAgentsSettingsSources(options)), {enabled: undefined});
});

test('project model policy writes version 2 and deleting the last override removes only its sidecar', (t) => {
  const {options} = createWorkspace(t);
  const user = writeSubagentEnablement('worker', false, null, options);
  assert.equal(user.ok, true);
  const userContent = fs.readFileSync(user.sourcePath, 'utf8');
  let project = writeBuiltinSubagentOverride('project', 'worker', {effort: 'low'}, null, options);
  assert.equal(project.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(project.sourcePath, 'utf8')), {
    schemaVersion: 2, overrides: {worker: {effort: 'low'}}
  });
  project = writeBuiltinSubagentOverride('project', 'explorer', {effort: 'high'}, project.fingerprint, options);
  assert.equal(project.ok, true);
  project = deleteBuiltinSubagentOverride('project', 'worker', project.fingerprint, options);
  assert.equal(project.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(project.sourcePath, 'utf8')), {
    schemaVersion: 2, overrides: {explorer: {effort: 'high'}}
  });
  project = deleteBuiltinSubagentOverride('project', 'explorer', project.fingerprint, options);
  assert.equal(project.ok, true);
  assert.equal(fs.existsSync(project.sourcePath), false);
  assert.equal(project.fingerprint, undefined);
  assert.equal(fs.readFileSync(user.sourcePath, 'utf8'), userContent);
  assert.equal(selectSubagentEnablement('worker', loadAgentsSettingsSources(options)).enabled, false);
});

test('constructor enablement defaults to true unless explicitly disabled in global settings', (t) => {
  const {options} = createWorkspace(t);
  assert.deepEqual(selectSubagentEnablement('constructor', loadAgentsSettingsSources(options)), {enabled: true});
  assert.equal(writeSubagentEnablement('worker', false, null, options).ok, true);
  let sources = loadAgentsSettingsSources(options);
  let selected = selectSubagentEnablement('constructor', sources);
  assert.deepEqual(selected, {enabled: true});
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(writeSubagentEnablement('constructor', false, sources[0].fingerprint, options).ok, true);
  sources = loadAgentsSettingsSources(options);
  selected = selectSubagentEnablement('constructor', sources);
  assert.deepEqual(selected, {enabled: false});
  assert.equal(Object.isFrozen(selected), true);
});

test('both mutation directions preserve unknown names and policies; only a doubly empty sidecar is deleted', (t) => {
  const {options} = createWorkspace(t);
  let result = writeSubagentEnablement('not-discovered', false, null, options);
  assert.equal(result.ok, true);
  result = writeBuiltinSubagentOverride('user', 'worker', {effort: 'low', skillNames: ['skill-one']}, result.fingerprint, options);
  assert.equal(result.ok, true);
  let read = readAgentsSettingsScope('user', options);
  assert.equal(read.settings.schemaVersion, 3);
  assert.deepEqual(read.settings.enabled, {'not-discovered': false});
  result = writeSubagentEnablement('explorer', false, result.fingerprint, options);
  assert.equal(result.ok, true);
  assert.deepEqual(readAgentsSettingsScope('user', options).settings.overrides, {worker: {effort: 'low', skillNames: ['skill-one']}});
  result = deleteBuiltinSubagentOverride('user', 'worker', result.fingerprint, options);
  assert.equal(result.ok, true);
  read = readAgentsSettingsScope('user', options);
  assert.deepEqual(read.settings.overrides, {});
  assert.deepEqual(read.settings.enabled, {explorer: false, 'not-discovered': false});
  result = writeSubagentEnablement('explorer', null, result.fingerprint, options);
  assert.equal(result.ok, true);
  result = writeBuiltinSubagentOverride('user', 'worker', {effort: 'high'}, result.fingerprint, options);
  assert.equal(result.ok, true);
  result = writeSubagentEnablement('not-discovered', null, result.fingerprint, options);
  assert.equal(result.ok, true);
  read = readAgentsSettingsScope('user', options);
  assert.deepEqual(read.settings.enabled, {});
  assert.deepEqual(read.settings.overrides, {worker: {effort: 'high'}});
  result = deleteBuiltinSubagentOverride('user', 'worker', result.fingerprint, options);
  assert.equal(result.ok, true);
  assert.equal(readAgentsSettingsScope('user', options).status, 'missing');
  assert.equal(writeSubagentEnablement('worker', null, null, options).ok, true);
  assert.equal(readAgentsSettingsScope('user', options).status, 'missing');
});

test('enablement mutations reject invalid input and whole-file conflicts without overwriting', (t) => {
  const {options} = createWorkspace(t);
  const created = writeSubagentEnablement('worker', false, null, options);
  assert.equal(created.ok, true);
  const original = fs.readFileSync(created.sourcePath, 'utf8');
  for (const [name, enabled] of [['../worker', false], ['worker', 'false'], ['worker', undefined]]) {
    const result = writeSubagentEnablement(name, enabled, created.fingerprint, options);
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'validation');
    assert.equal(fs.readFileSync(created.sourcePath, 'utf8'), original);
  }
  fs.writeFileSync(created.sourcePath, JSON.stringify({schemaVersion: 3, enabled: {worker: false}, overrides: {explorer: {effort: 'low'}}}));
  for (const enabled of [true, null]) {
    const result = writeSubagentEnablement('worker', enabled, created.fingerprint, options);
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'conflict');
  }
  const external = fs.readFileSync(created.sourcePath, 'utf8');
  assert.equal(JSON.parse(external).overrides.explorer.effort, 'low');
  fs.writeFileSync(created.sourcePath, '{broken');
  const invalid = readAgentsSettingsScope('user', options);
  const rejected = writeSubagentEnablement('worker', false, invalid.fingerprint, options);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.kind, 'validation');
  assert.equal(fs.readFileSync(created.sourcePath, 'utf8'), '{broken');
});

test('enablement writes preserve missing model references instead of treating them as invalid settings', (t) => {
  const {options} = createWorkspace(t);
  const echoDir = path.join(options.homedir, '.echo');
  fs.mkdirSync(echoDir);
  const filePath = path.join(echoDir, 'agents.settings.json');
  const override = {modelProfileId: 'missing-profile', effort: 'high', skills: []};
  fs.writeFileSync(filePath, JSON.stringify({schemaVersion: 3, enabled: {}, overrides: {worker: override}}));
  const read = readAgentsSettingsScope('user', options);
  assert.equal(read.status, 'valid');
  const written = writeSubagentEnablement('worker', false, read.fingerprint, options);
  assert.equal(written.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).overrides.worker, override);
  assert.equal(selectSubagentEnablement('worker', loadAgentsSettingsSources(options)).enabled, false);
});

test('all settings mutations report serialization capacity failures without throwing or changing content', (t) => {
  const {options} = createWorkspace(t);
  const enabled = Object.fromEntries(Array.from({length: 230}, (_, index) => [
    `agent-${String(index).padStart(3, '0')}-${'x'.repeat(50)}`, false
  ]));
  const content = JSON.stringify({schemaVersion: 3, enabled, overrides: {worker: {effort: 'low'}}});
  assert.ok(Buffer.byteLength(content) < 16 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(JSON.parse(content), null, 2)) > 16 * 1024);
  fs.mkdirSync(path.join(options.homedir, '.echo'));
  const filePath = path.join(options.homedir, '.echo', 'agents.settings.json');
  fs.writeFileSync(filePath, content);
  const read = readAgentsSettingsScope('user', options);
  assert.equal(read.status, 'valid');
  for (const mutate of [
    () => writeSubagentEnablement('explorer', false, read.fingerprint, options),
    () => writeBuiltinSubagentOverride('user', 'explorer', {effort: 'low'}, read.fingerprint, options),
    () => deleteBuiltinSubagentOverride('user', 'worker', read.fingerprint, options)
  ]) {
    const result = mutate();
    assert.equal(result.ok, false);
    assert.equal(result.kind, 'validation');
    assert.equal(fs.readFileSync(filePath, 'utf8'), content);
  }
});

test('enablement storage rejects symlinks, unsafe directories, non-regular files and unreadable settings', (t) => {
  const {root, options} = createWorkspace(t);
  const echoDir = path.join(options.homedir, '.echo');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, echoDir);
  assert.equal(writeSubagentEnablement('worker', false, null, options).ok, false);
  assert.deepEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(echoDir);
  fs.mkdirSync(echoDir);
  const filePath = path.join(echoDir, 'agents.settings.json');
  const target = path.join(outside, 'target.json');
  fs.writeFileSync(target, '{"secret":true}');
  fs.symlinkSync(target, filePath);
  assert.equal(writeSubagentEnablement('worker', false, null, options).ok, false);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"secret":true}');
  fs.unlinkSync(filePath);
  fs.mkdirSync(filePath);
  assert.equal(writeSubagentEnablement('worker', false, null, options).ok, false);
  fs.rmdirSync(filePath);
  const created = writeSubagentEnablement('worker', false, null, options);
  assert.equal(created.ok, true);
  const original = fs.readFileSync(filePath, 'utf8');
  const unreadable = {...options, operations: {readFile() { throw new Error('secret read failure'); }}};
  assert.equal(readAgentsSettingsScope('user', unreadable).status, 'invalid');
  assert.equal(writeSubagentEnablement('worker', true, created.fingerprint, unreadable).ok, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('enablement I/O failures preserve existing content and clean exclusive create placeholders', (t) => {
  const {options} = createWorkspace(t);
  for (const operation of ['rename', 'writeFile', 'mkdir']) {
    const failed = writeSubagentEnablement('worker', false, null, {
      ...options, operations: {[operation]() { throw new Error('injected failure'); }}
    });
    assert.equal(failed.ok, false, operation);
    assert.equal(failed.kind, 'io', operation);
    const echoDir = path.join(options.homedir, '.echo');
    if (fs.existsSync(echoDir)) assert.deepEqual(fs.readdirSync(echoDir), []);
  }
  const created = writeSubagentEnablement('worker', false, null, options);
  assert.equal(created.ok, true);
  const original = fs.readFileSync(created.sourcePath, 'utf8');
  for (const [operation, enabled] of [['rename', true], ['writeFile', true], ['unlink', null]]) {
    const failed = writeSubagentEnablement('worker', enabled, created.fingerprint, {
      ...options, operations: {[operation]() { throw new Error('injected failure'); }}
    });
    assert.equal(failed.ok, false, operation);
    assert.equal(failed.kind, 'io', operation);
    assert.equal(fs.readFileSync(created.sourcePath, 'utf8'), original);
    assert.deepEqual(fs.readdirSync(path.dirname(created.sourcePath)), ['agents.settings.json']);
  }
});
