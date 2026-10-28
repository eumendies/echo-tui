const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

const {createAgentsCommandPort} = require('../../src/app/command/agents-command-port');

function createDraft(overrides = {}) {
  return {
    capability: 'readonly',
    description: 'Inspect the selected files.',
    effort: 'inherit',
    instructions: '# Role\n\nReturn concise evidence.',
    mcp: false,
    tools: ['read_files', 'grep'],
    ...overrides
  };
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agents-form-save-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(path.join(project, '.git'), {recursive: true});
  const models = [{id: 'parent'}, {id: 'reviewer'}];
  const port = createAgentsCommandPort({
    captureUserConfigSnapshot: () => ({
      getLlmModelConfigInfo: () => ({kind: 'profiles', selectedModelId: 'parent', models}),
      getMainAgentToolsConfig: () => ({disabledTools: []})
    }),
    cwd: () => project,
    homedir: () => home
  });
  const settingsPath = (scope) => path.join(scope === 'user' ? home : project, '.echo', 'agents.settings.json');
  const definitionPath = (scope, name = 'reviewer') => path.join(scope === 'user' ? home : project, '.echo', 'agents', `${name}.md`);
  return {root, home, project, port, models, settingsPath, definitionPath};
}

function readSettings(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function createDetailSession(port, name, sourceKind = 'builtin') {
  const {AgentsCommandHandler} = require('../../src/commands/agents-command-handler');
  const {INPUT_EVENTS} = require('../../src/input/event-types');
  const handler = new AgentsCommandHandler();
  let active;
  const host = {agents: port, session: {
    open(value) {active = value;}, update(patch) {active = {...active, ...patch};}, close() {active = undefined;}
  }};
  const send = (event) => handler.handleEvent(active, event, host);
  const activate = (id) => {
    const target = active.surface.rows.findIndex((row) => row.id === id);
    assert.notEqual(target, -1, `Missing row ${id}`);
    while (active.surface.selectedIndex !== target) send({type: target > active.surface.selectedIndex ? INPUT_EVENTS.MOVE_DOWN : INPUT_EVENTS.MOVE_UP});
    send({type: INPUT_EVENTS.SUBMIT});
  };
  handler.start('/agents', host);
  activate(`agent:${sourceKind}:${name}`);
  return {activate, send, current: () => active, events: INPUT_EVENTS};
}

test('global detail saves one file without rewriting definitions or touching project policies', (t) => {
  const {port, settingsPath, definitionPath} = createFixture(t);
  assert.equal(port.create('project', 'reviewer', createDraft()).ok, true);
  fs.appendFileSync(definitionPath('project'), '\n\n');
  const original = fs.readFileSync(definitionPath('project'));
  const project = JSON.stringify({schemaVersion: 2, overrides: {worker: {effort: 'high'}}});
  fs.writeFileSync(settingsPath('project'), project);
  assert.equal(port.list().items.find((item) => item.name === 'reviewer').enablement.enabled, true);
  const detail = createDetailSession(port, 'reviewer', 'project');
  detail.activate('enablement:toggle');
  detail.activate('enablement:save');
  assert.equal(readSettings(settingsPath('user')).enabled.reviewer, false);
  assert.deepEqual(readSettings(settingsPath('user')).overrides, {});
  assert.deepEqual(fs.readFileSync(definitionPath('project')), original);
  assert.equal(fs.readFileSync(settingsPath('project'), 'utf8'), project);
});

test('global detail draft survives policy cancel but detail cancel never creates settings', (t) => {
  const {port, settingsPath} = createFixture(t);
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  detail.activate('builtin:project');
  assert.equal(detail.current().surface.rows.some((row) => row.id.startsWith('enablement:')), false);
  detail.send({type: detail.events.ESCAPE});
  assert.equal(detail.current().data.enablement.value, false);
  detail.activate('enablement:cancel');
  assert.equal(fs.existsSync(settingsPath('user')), false);
  assert.equal(fs.existsSync(settingsPath('project')), false);
});

test('global draft remains unsaved through either policy save and same-file writes do not self-conflict', (t) => {
  for (const scope of ['user', 'project']) {
    const {port, settingsPath} = createFixture(t);
    const detail = createDetailSession(port, 'explorer');
    detail.activate('enablement:toggle');
    detail.activate(`builtin:${scope}`);
    detail.activate('model');
    detail.activate('save');
    assert.equal(detail.current().surface.mode, 'detail');
    if (scope === 'user') assert.deepEqual(readSettings(settingsPath(scope)).enabled, {});
    const originalPolicy = readSettings(settingsPath(scope)).overrides;
    detail.activate('enablement:save');
    assert.equal(detail.current().surface.error, undefined);
    assert.equal(readSettings(settingsPath('user')).enabled.explorer, false);
    assert.deepEqual(readSettings(settingsPath(scope)).overrides, originalPolicy);
  }
});

test('explicit default project policy replaces the whole user policy instead of being skipped as unchanged', (t) => {
  const {port, settingsPath} = createFixture(t);
  assert.equal(port.writeBuiltinOverride('user', 'explorer', {modelProfileId: 'reviewer', effort: 'high', skillNames: []}, null).ok, true);
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  detail.activate('builtin:project');
  assert.deepEqual(detail.current().data.builtinForm.draft, {effort: 'inherit'});
  detail.activate('save');
  assert.deepEqual(readSettings(settingsPath('project')).overrides, {explorer: {effort: 'inherit'}});
  const explorer = port.list().builtins.find((item) => item.name === 'explorer');
  assert.equal(explorer.policy.sourceKind, 'project');
  assert.equal(explorer.modelProfileId, undefined);
  assert.equal(explorer.effort, 'inherit');
  assert.equal(explorer.skillNames, undefined);
  assert.deepEqual(readSettings(settingsPath('user')).enabled, {});
  assert.equal(detail.current().data.enablement.value, false);
  detail.activate('enablement:save');
  assert.equal(detail.current().surface.error, undefined);
  assert.equal(readSettings(settingsPath('user')).enabled.explorer, false);
});

test('constructor detail uses a boolean default and reverting its toggle does not create a false dirty state', (t) => {
  const {port, settingsPath} = createFixture(t);
  assert.equal(port.create('project', 'constructor', createDraft()).ok, true);
  assert.equal(port.writeEnablement('worker', false, null).ok, true);
  const original = fs.readFileSync(settingsPath('user'));
  const detail = createDetailSession(port, 'constructor', 'project');
  assert.equal(detail.current().data.enablement.value, true);
  assert.equal(detail.current().data.enablement.original, true);
  assert.equal(detail.current().surface.rows.find((row) => row.id === 'enablement:toggle').selected, true);
  detail.activate('enablement:toggle');
  detail.activate('enablement:toggle');
  assert.doesNotMatch(detail.current().surface.dismissHint, /未保存/);
  detail.activate('enablement:save');
  assert.deepEqual(fs.readFileSync(settingsPath('user')), original);
  detail.activate('enablement:toggle');
  detail.activate('enablement:save');
  assert.equal(readSettings(settingsPath('user')).enabled.constructor, false);
});

test('unchanged definition saves keep bytes and global drafts without reporting a fictitious write', (t) => {
  const {port, definitionPath, settingsPath} = createFixture(t);
  assert.equal(port.create('project', 'reviewer', createDraft()).ok, true);
  fs.appendFileSync(definitionPath('project'), '\n\n');
  const original = fs.readFileSync(definitionPath('project'));
  const detail = createDetailSession(port, 'reviewer', 'project');
  detail.activate('enablement:toggle');
  detail.activate('custom:edit');
  detail.activate('save');
  assert.equal(detail.current().surface.mode, 'detail');
  assert.equal(detail.current().surface.feedback, undefined);
  assert.equal(detail.current().data.enablement.value, false);
  assert.deepEqual(fs.readFileSync(definitionPath('project')), original);
  assert.equal(fs.existsSync(settingsPath('user')), false);
});

test('invalid policy scopes stay at the detail entry without writable or misleading readonly forms', (t) => {
  for (const scope of ['user', 'project']) {
    const {port, settingsPath} = createFixture(t);
    fs.mkdirSync(path.dirname(settingsPath(scope)), {recursive: true});
    fs.writeFileSync(settingsPath(scope), '{invalid');
    const detail = createDetailSession(port, 'explorer');
    detail.activate(`builtin:${scope}`);
    assert.equal(detail.current().surface.mode, 'detail');
    assert.equal(detail.current().data.builtinForm, undefined);
    assert.equal(detail.current().surface.feedback, undefined);
    assert.match(detail.current().surface.error, /无法编辑无效 settings/);
    assert.equal(fs.readFileSync(settingsPath(scope), 'utf8'), '{invalid');
    if (scope === 'project') {
      detail.activate('enablement:toggle');
      detail.activate('enablement:save');
      assert.equal(detail.current().surface.error, undefined);
      assert.equal(readSettings(settingsPath('user')).enabled.explorer, false);
    }
  }
});

test('removing the last global override advances pending toggle to a missing file fingerprint', (t) => {
  const {port, settingsPath} = createFixture(t);
  assert.equal(port.writeBuiltinOverride('user', 'explorer', {effort: 'high'}, null).ok, true);
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  detail.activate('builtin:user');
  detail.activate('remove');
  detail.activate('confirm:execute');
  assert.equal(fs.existsSync(settingsPath('user')), false);
  assert.equal(detail.current().data.enablement.fingerprint, null);
  detail.activate('enablement:save');
  assert.equal(detail.current().surface.error, undefined);
  assert.equal(readSettings(settingsPath('user')).enabled.explorer, false);
});

test('global conflicts remain detectable after project policy save refreshes management facts', (t) => {
  const {port, settingsPath} = createFixture(t);
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  detail.activate('builtin:project');
  assert.equal(port.writeEnablement('worker', false, null).ok, true);
  const external = fs.readFileSync(settingsPath('user'));
  detail.activate('model');
  detail.activate('save');
  detail.activate('enablement:save');
  assert.match(detail.current().surface.error, /冲突/);
  assert.deepEqual(fs.readFileSync(settingsPath('user')), external);
  assert.equal(detail.current().data.enablement.original, true);
});

test('global atomic write failure preserves bytes and draft and retry succeeds without partial saves', (t) => {
  const {port, settingsPath} = createFixture(t);
  assert.equal(port.writeEnablement('worker', false, null).ok, true);
  const original = fs.readFileSync(settingsPath('user'));
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => {throw Object.assign(new Error('injected'), {code: 'EIO'});};
    detail.activate('enablement:save');
  } finally {fs.renameSync = rename;}
  assert.match(detail.current().surface.error, /I\/O/);
  assert.doesNotMatch(detail.current().surface.error, /部分保存/);
  assert.deepEqual(fs.readFileSync(settingsPath('user')), original);
  detail.activate('enablement:save');
  assert.equal(detail.current().surface.error, undefined);
  assert.equal(readSettings(settingsPath('user')).enabled.explorer, false);
});

test('global preferences remain writable when a model policy file is corrupted', (t) => {
  const {port, settingsPath} = createFixture(t);
  fs.mkdirSync(path.dirname(settingsPath('project')), {recursive: true});
  fs.writeFileSync(settingsPath('project'), '{invalid');
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  detail.activate('enablement:save');
  assert.equal(detail.current().surface.error, undefined);
  assert.equal(readSettings(settingsPath('user')).enabled.explorer, false);
  assert.equal(fs.readFileSync(settingsPath('project'), 'utf8'), '{invalid');
});

test('external global corruption remains unavailable after a project policy save', (t) => {
  const {port, settingsPath} = createFixture(t);
  const detail = createDetailSession(port, 'explorer');
  detail.activate('enablement:toggle');
  detail.activate('builtin:project');
  fs.mkdirSync(path.dirname(settingsPath('user')), {recursive: true});
  fs.writeFileSync(settingsPath('user'), '{invalid');
  detail.activate('model');
  detail.activate('save');
  const rows = detail.current().surface.rows;
  assert.equal(rows.find((row) => row.id === 'enablement:toggle').readonly, true);
  assert.match(rows.find((row) => row.id === 'enablement:toggle').description, /不可用/);
  assert.equal(rows.some((row) => row.id === 'enablement:effective'), false);
  detail.activate('enablement:save');
  assert.match(detail.current().surface.error, /冲突/);
  assert.equal(fs.readFileSync(settingsPath('user'), 'utf8'), '{invalid');
});
