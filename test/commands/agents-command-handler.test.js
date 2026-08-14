const assert = require('node:assert/strict');
const {test} = require('node:test');

const {AgentsCommandHandler} = require('../../src/commands/agents-command-handler');
const {INPUT_EVENTS} = require('../../src/input/event-types');

function draft(description) {
  return {capability: 'readonly', description, effort: 'inherit', instructions: '# Role\n\nInspect files.', mcp: false, tools: ['read_files', 'grep']};
}

function createSnapshot() {
  return {
    diagnostics: [],
    models: [{id: 'fast', provider: 'fake', model: 'fast-model'}],
    overrides: [
      {sourceKind: 'user', sourcePath: '/home/.echo/agents.settings.json', status: 'missing'},
      {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'missing'}
    ],
    builtins: [
      {name: 'explorer', description: 'Explore safely.', capability: 'readonly', effort: 'inherit', includeMcpTools: false, localToolNames: ['read_files', 'grep']},
      {name: 'worker', description: 'Work generally.', capability: 'general', effort: 'inherit', includeMcpTools: true, localToolNames: ['apply_patch', 'edit_file', 'read_files']}
    ],
    items: [
      {name: 'explorer', sourceKind: 'builtin', status: 'active', diagnostics: []},
      {name: 'worker', sourceKind: 'builtin', status: 'active', diagnostics: []},
      {name: 'reviewer', sourceKind: 'user', sourcePath: '/home/.echo/agents/reviewer.md', status: 'shadowed', diagnostics: [{code: 'shadowed_by_project', message: 'Project wins.'}], draft: draft('User reviewer'), fingerprint: 'user-fp'},
      {name: 'reviewer', sourceKind: 'project', sourcePath: '/repo/.echo/agents/reviewer.md', status: 'active', diagnostics: [], draft: draft('Project reviewer'), fingerprint: 'project-fp'},
      {name: 'broken', sourceKind: 'project', sourcePath: '/repo/.echo/agents/broken.md', status: 'invalid', diagnostics: [{code: 'missing_body', message: 'Body is missing.'}], fingerprint: 'broken-fp'}
    ]
  };
}

function createHost(options = {}) {
  let active = null;
  const calls = {created: [], updated: [], deleted: [], overrides: [], removedOverrides: []};
  const snapshot = options.snapshot || createSnapshot();
  const host = {
    agents: {
      list() { return structuredClone(snapshot); },
      validate(scope, name) {
        if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(name)) return {ok: false, kind: 'validation', code: 'invalid_name', message: 'invalid name'};
        return {ok: true, sourcePath: `${scope === 'project' ? '/repo' : '/home'}/.echo/agents/${name}.md`};
      },
      create(scope, name, value) {
        calls.created.push({scope, name, value});
        return options.createResult || {ok: true, sourcePath: `/repo/.echo/agents/${name}.md`, fingerprint: 'new-fp'};
      },
      update(scope, name, value, fingerprint) {
        calls.updated.push({scope, name, value, fingerprint});
        return options.updateResult || {ok: true, sourcePath: '/repo/.echo/agents/reviewer.md', fingerprint: 'updated-fp'};
      },
      delete(scope, name, fingerprint) {
        calls.deleted.push({scope, name, fingerprint});
        return options.deleteResult || {ok: true, sourcePath: '/repo/.echo/agents/broken.md'};
      },
      writeBuiltinOverride(scope, name, value, fingerprint) {
        calls.overrides.push({scope, name, value, fingerprint});
        return {ok: true, sourcePath: '/repo/.echo/agents.settings.json', fingerprint: 'settings-fp'};
      },
      deleteBuiltinOverride(scope, name, fingerprint) {
        calls.removedOverrides.push({scope, name, fingerprint});
        return {ok: true, sourcePath: '/repo/.echo/agents.settings.json'};
      }
    },
    session: {
      open(session) { active = session; },
      update(patch) { active = {...active, ...patch}; },
      close() { active = null; },
      getActive() { return active; }
    }
  };
  return {calls, host};
}

function send(handler, host, event) {
  handler.handleEvent(host.session.getActive(), event, host);
  return host.session.getActive();
}

function down(handler, host, count) {
  for (let index = 0; index < count; index += 1) send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  return host.session.getActive();
}

test('/agents navigates scopes, exposes mixed action rows, and ignores hidden mutation keys', () => {
  const handler = new AgentsCommandHandler();
  const {host} = createHost();
  handler.start('/agents', host);
  let surface = host.session.getActive().surface;
  assert.equal(surface.kind, 'agents');
  assert.equal(surface.activeTab, 'overview');
  assert.deepEqual(surface.rows.filter((row) => row.kind === 'agent').map((row) => row.label), ['explorer', 'worker', 'reviewer']);
  assert.equal(surface.rows.find((row) => row.label.includes('broken')).kind, 'field');
  for (const value of ['a', 'd', 'e']) send(handler, host, {type: INPUT_EVENTS.TEXT, value});
  assert.equal(host.session.getActive().surface.mode, 'list');
  send(handler, host, {type: INPUT_EVENTS.TAB});
  surface = host.session.getActive().surface;
  assert.equal(surface.activeTab, 'project');
  assert.equal(surface.rows.at(-1).label, '新建 Agent');
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  surface = host.session.getActive().surface;
  assert.equal(surface.mode, 'form');
  assert.deepEqual(surface.rows.map((row) => row.id), ['name', 'description', 'capability', 'model', 'effort', 'tools', 'mcp', 'instructions', 'save', 'cancel']);
});

test('/agents create uses instructions composer and default-cancel confirmation while preserving draft', () => {
  const handler = new AgentsCommandHandler();
  const {calls, host} = createHost();
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.TAB});
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: 'new-agent'});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 7);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: '# Role'});
  send(handler, host, {type: INPUT_EVENTS.INSERT_NEWLINE});
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: 'Inspect.'});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.equal(host.session.getActive().data.customForm.draft.instructions, '# Role\nInspect.');
  send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.selectedIndex, 0);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().data.customForm.draft.name, 'new-agent');
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(calls.created[0].name, 'new-agent');
  assert.match(host.session.getActive().surface.feedback, /下一次 assistant turn/);
});

test('/agents keeps edit draft on conflict and limits invalid files to view/delete', () => {
  const handler = new AgentsCommandHandler();
  const {host} = createHost({updateResult: {ok: false, kind: 'conflict', code: 'content_conflict', message: 'changed externally'}});
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.TAB});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.rows.some((row) => row.id.startsWith('custom:copy:')), false);
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 8);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.mode, 'form');
  assert.equal(host.session.getActive().data.customForm.draft.name, 'reviewer');
  assert.match(host.session.getActive().surface.error, /冲突/);
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  down(handler, host, 1);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  const labels = host.session.getActive().surface.rows.map((row) => row.label);
  assert.equal(labels.includes('编辑配置'), false);
  assert.equal(labels.includes('删除 Agent'), true);
});

test('/agents built-in safety fields are readonly and override removal requires confirmation', () => {
  const handler = new AgentsCommandHandler();
  const snapshot = createSnapshot();
  snapshot.overrides[1] = {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'valid', fingerprint: 'settings-fp', settings: {schemaVersion: 1, overrides: {explorer: {effort: 'high'}}}};
  const {calls, host} = createHost({snapshot});
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:description').readonly, true);
  assert.equal(host.session.getActive().surface.rows.some((row) => row.label === '编辑配置'), false);
  assert.equal(host.session.getActive().surface.rows.some((row) => row.id.startsWith('builtin:copy:')), false);
  down(handler, host, 6);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(host.session.getActive().surface.rows.map((row) => row.id), ['model', 'effort', 'save', 'remove', 'cancel']);
  down(handler, host, 3);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.selectedIndex, 0);
  send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(calls.removedOverrides, [{scope: 'project', name: 'explorer', fingerprint: 'settings-fp'}]);
});
