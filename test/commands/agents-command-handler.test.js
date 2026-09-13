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
    skills: [],
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
  assert.deepEqual(surface.rows.map((row) => row.id), ['name', 'description', 'capability', 'model', 'effort', 'tools', 'skills', 'mcp', 'instructions', 'save', 'cancel']);
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
  down(handler, host, 8);
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
  down(handler, host, 3);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 9);
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
  down(handler, host, 7);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(host.session.getActive().surface.rows.map((row) => row.id), ['model', 'effort', 'skills', 'save', 'remove', 'cancel']);
  down(handler, host, 4);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.selectedIndex, 0);
  send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(calls.removedOverrides, [{scope: 'project', name: 'explorer', fingerprint: 'settings-fp'}]);
});

test('/agents custom form manages the three-state skills policy through the multi-select layer', () => {
  const handler = new AgentsCommandHandler();
  const snapshot = createSnapshot();
  snapshot.skills = [
    {enabled: true, name: 'review-skill', sourceKind: 'project'},
    {enabled: true, name: 'unit-test', sourceKind: 'user'},
    {enabled: false, name: 'disabled-skill', sourceKind: 'user'}
  ];
  const {host} = createHost({snapshot});
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.TAB});
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 6);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  let surface = host.session.getActive().surface;
  assert.equal(surface.mode, 'skills');
  assert.equal(surface.title, 'AGENTS · SKILLS');
  // disabled 且未配置的名称不出现在多选层。
  assert.deepEqual(surface.rows.map((row) => row.id), ['skills:all', 'skill:review-skill', 'skill:unit-test', 'skills:done']);
  assert.equal(surface.rows[0].selected, true);

  // 关闭“全部 enabled Skills”后变为显式空 allowlist，再逐项选择两个 Skill。
  send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(host.session.getActive().data.customForm.draft.skillNames, ['review-skill']);
  send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  surface = host.session.getActive().surface;
  assert.deepEqual(surface.rows[1].selected, true);
  assert.deepEqual(surface.rows[2].selected, true);
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.deepEqual(host.session.getActive().data.customForm.draft.skillNames, ['review-skill', 'unit-test']);
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'skills').description, '2 个');

  // 在全部策略开启时按任意 Skill 行会直接切换为逐项 allowlist；再切回缺省恢复 undefined。
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(host.session.getActive().data.customForm.draft.skillNames, ['unit-test']);
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  const draft = host.session.getActive().data.customForm.draft;
  assert.equal(draft.skillNames, undefined);
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'skills').description, '全部 enabled Skills');
});

test('/agents skills layer preserves and removes stale configured names without losing them silently', () => {
  const handler = new AgentsCommandHandler();
  const snapshot = createSnapshot();
  snapshot.skills = [{enabled: true, name: 'review-skill', sourceKind: 'project'}];
  snapshot.items = snapshot.items.map((item) => item.name === 'reviewer' && item.sourceKind === 'project'
    ? {...item, draft: {...draft('Project reviewer'), skillNames: ['review-skill', 'missing-skill']}}
    : item);
  const {host} = createHost({snapshot});
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.TAB});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 3);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'skills').description, '1 个；1 个不可用');
  down(handler, host, 6);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  const rows = host.session.getActive().surface.rows;
  assert.deepEqual(rows.map((row) => row.id), ['skills:all', 'skill:review-skill', 'skill:missing-skill', 'skills:done']);
  assert.equal(rows[2].status, 'stale');
  assert.equal(rows[2].selected, true);
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(host.session.getActive().data.customForm.draft.skillNames, ['review-skill']);
});

test('/agents built-in policy form edits and persists the skills allowlist', () => {
  const handler = new AgentsCommandHandler();
  const {calls, host} = createHost();
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 7);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.mode, 'skills');
  assert.deepEqual(host.session.getActive().surface.rows.map((row) => row.id), ['skills:all', 'skills:done']);
  // 空目录下显式空 allowlist 保存为空序列。
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  down(handler, host, 1);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.deepEqual(calls.overrides[0].value.skillNames, []);
  // 保存成功后回到列表；重新打开并完成“关闭全部→恢复缺省”后保存，draft 不携带 skills 字段。
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 7);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  down(handler, host, 2);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  down(handler, host, 1);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(Object.hasOwn(calls.overrides[1].value, 'skillNames'), false);
});
