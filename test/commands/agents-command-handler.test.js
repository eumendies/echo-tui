const assert = require('node:assert/strict');
const {test} = require('node:test');

const {AgentsCommandHandler} = require('../../src/commands/agents-command-handler');
const {INPUT_EVENTS} = require('../../src/input/event-types');
const {selectSubagentEnablement} = require('../../src/agent/subagent/settings');

function draft(description) {
  return {capability: 'readonly', description, effort: 'inherit', instructions: '# Role\n\nInspect files.', mcp: false, tools: ['read_files', 'grep']};
}

function createSnapshot() {
  return {
    diagnostics: [],
    delegationToolEnabled: true,
    models: [{id: 'fast', provider: 'fake', model: 'fast-model'}],
    skills: [],
    overrides: [
      {sourceKind: 'user', sourcePath: '/home/.echo/agents.settings.json', status: 'missing'},
      {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'missing'}
    ],
    builtins: [
      {name: 'explorer', description: 'Explore safely.', capability: 'readonly', effort: 'inherit', includeMcpTools: false, localToolNames: ['read_files', 'grep'], policy: {fields: [], status: 'none'}},
      {name: 'worker', description: 'Work generally.', capability: 'general', effort: 'inherit', includeMcpTools: true, localToolNames: ['apply_patch', 'read_files'], policy: {fields: [], status: 'none'}}
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
  const calls = {created: [], updated: [], deleted: [], overrides: [], removedOverrides: [], enablement: []};
  const snapshot = options.snapshot || createSnapshot();
  const host = {
    agents: {
      list() {
        const result = structuredClone(snapshot);
        result.items = result.items.map((item) => ({...item, enablement: selectSubagentEnablement(item.name, result.overrides)}));
        return result;
      },
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
      writeEnablement(name, value, fingerprint) {
        calls.enablement.push({name, value, fingerprint});
        if (options.enablementResult) return options.enablementResult;
        const source = snapshot.overrides.find((entry) => entry.sourceKind === 'user');
        source.settings ||= {schemaVersion: 3, enabled: {}, overrides: {}};
        source.settings.enabled ||= {};
        if (value === null) delete source.settings.enabled[name];
        else source.settings.enabled[name] = value;
        source.status = 'valid';
        source.fingerprint = 'enabled-fp';
        return {ok: true, sourcePath: source.sourcePath, fingerprint: 'enabled-fp'};
      },
      writeBuiltinOverride(scope, name, value, fingerprint) {
        calls.overrides.push({scope, name, value, fingerprint});
        const source = snapshot.overrides.find((entry) => entry.sourceKind === scope);
        source.settings ||= {schemaVersion: scope === 'user' ? 3 : 2, overrides: {}};
        source.settings.overrides[name] = structuredClone(value);
        source.status = 'valid';
        source.fingerprint = 'settings-fp';
        return {ok: true, sourcePath: source.sourcePath, fingerprint: 'settings-fp'};
      },
      deleteBuiltinOverride(scope, name, fingerprint) {
        calls.removedOverrides.push({scope, name, fingerprint});
        const source = snapshot.overrides.find((entry) => entry.sourceKind === scope);
        delete source.settings.overrides[name];
        if (!Object.keys(source.settings.overrides).length && !Object.keys(source.settings.enabled || {}).length) {
          source.status = 'missing';
          delete source.settings;
          delete source.fingerprint;
        } else source.fingerprint = 'removed-fp';
        return {ok: true, sourcePath: source.sourcePath, fingerprint: source.fingerprint};
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
  assert.deepEqual(surface.tabs.map((tab) => tab.label), ['总览', '项目', '用户', '内置']);
  assert.deepEqual(surface.stats, {agentCount: 3, issueCount: 1, enabledCount: 3, disabledCount: 0});
  assert.equal(surface.summary.title, 'explorer');
  assert.deepEqual(surface.summary.fields.slice(0, 3), [
    {label: '模型', value: '继承父模型'},
    {label: 'Effort', value: '继承父 effort'},
    {label: '工具', value: '2 个'}
  ]);
  assert.deepEqual(surface.rows.filter((row) => row.kind === 'agent').map((row) => row.label), ['explorer', 'worker', 'reviewer']);
  assert.equal(surface.rows.find((row) => row.label.includes('broken')).kind, 'field');
  for (const value of ['a', 'd', 'e']) send(handler, host, {type: INPUT_EVENTS.TEXT, value});
  assert.equal(host.session.getActive().surface.mode, 'list');
  send(handler, host, {type: INPUT_EVENTS.TAB});
  surface = host.session.getActive().surface;
  assert.equal(surface.activeTab, 'project');
  assert.equal(surface.rows.at(-1).label, '新建 Agent');
  down(handler, host, 2);
  surface = host.session.getActive().surface;
  assert.equal(surface.summary.title, '新建 Agent');
  assert.equal(surface.summary.sourceKind, 'project');
  assert.deepEqual(surface.summary.fields, []);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  surface = host.session.getActive().surface;
  assert.equal(surface.mode, 'form');
  assert.deepEqual(surface.rows.map((row) => row.id), ['name', 'description', 'model', 'effort', 'capability', 'tools', 'skills', 'mcp', 'instructions', 'save', 'cancel']);
  assert.deepEqual(surface.rows.map((row) => row.section), ['identity', 'identity', 'policy', 'policy', 'capability', 'capability', 'capability', 'capability', 'capability', 'actions', 'actions']);
});

test('/agents summarizes an invalid physical item without duplicating diagnostics or inventing inherited policy', () => {
  const handler = new AgentsCommandHandler();
  const {host} = createHost();
  handler.start('/agents', host);
  down(handler, host, 3);
  const surface = host.session.getActive().surface;

  // 无效项没有可解析定义：摘要只保留名称、状态、来源路径与诊断，不显示继承自父级的模型策略。
  assert.equal(surface.summary.title, 'broken · missing_body');
  assert.equal(surface.summary.description, undefined);
  assert.deepEqual(surface.summary.diagnostics, ['Body is missing.']);
  assert.deepEqual(surface.summary.fields, [{label: '来源路径', value: '/repo/.echo/agents/broken.md'}]);
  assert.equal(surface.summary.status, 'invalid');
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
  activateRow(handler, host, 'instructions');
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: '# Role'});
  send(handler, host, {type: INPUT_EVENTS.INSERT_NEWLINE});
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: 'Inspect.'});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  assert.equal(host.session.getActive().data.customForm.draft.instructions, '# Role\nInspect.');
  activateRow(handler, host, 'save');
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
  activateRow(handler, host, 'custom:edit');
  activateRow(handler, host, 'model');
  activateRow(handler, host, 'save');
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
  snapshot.builtins = snapshot.builtins.map((builtin) => builtin.name === 'explorer'
    ? {...builtin, effort: 'high', policy: {fields: ['effort'], sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'applied'}}
    : builtin);
  const {calls, host} = createHost({snapshot});
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:description').readonly, true);
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:description').section, 'identity');
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:model').section, 'policy');
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:tools').section, 'capability');
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:project').section, 'actions');
  assert.equal(host.session.getActive().surface.rows.some((row) => row.label === '编辑配置'), false);
  assert.equal(host.session.getActive().surface.rows.some((row) => row.id.startsWith('builtin:copy:')), false);
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:policy').description, '项目级 override 生效 · /repo/.echo/agents.settings.json');
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:effort').description, 'high（项目级策略）');
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:project').description, '当前生效');
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'builtin:user').description, '未配置');
  activateRow(handler, host, 'builtin:project');
  assert.deepEqual(host.session.getActive().surface.rows.map((row) => row.id), ['policy', 'model', 'effort', 'skills', 'save', 'remove', 'cancel']);
  assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'remove').tone, 'danger');
  activateRow(handler, host, 'remove');
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
  activateRow(handler, host, 'custom:edit');
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
  activateRow(handler, host, 'builtin:project');
  down(handler, host, 3);
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.mode, 'skills');
  assert.deepEqual(host.session.getActive().surface.rows.map((row) => row.id), ['skills:all', 'skills:done']);
  // 空目录下显式空 allowlist 保存为空序列。
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  activateRow(handler, host, 'save');
  assert.deepEqual(calls.overrides[0].value.skillNames, []);
  // 保存成功后回到详情；重新打开策略恢复缺省，draft 不携带 skills 字段。
  activateRow(handler, host, 'builtin:project');
  activateRow(handler, host, 'skills');
  activateRow(handler, host, 'skills:all');
  send(handler, host, {type: INPUT_EVENTS.ESCAPE});
  activateRow(handler, host, 'effort');
  activateRow(handler, host, 'save');
  assert.equal(Object.hasOwn(calls.overrides[1].value, 'skillNames'), false);
});

test('/agents built-in detail and policy form explain which scope is currently effective', () => {
  const rowsOf = (host) => host.session.getActive().surface.rows;

  // 未配置 override：详情页明确显示完整继承父策略。
  const noneHost = createHost();
  const noneHandler = new AgentsCommandHandler();
  noneHandler.start('/agents', noneHost.host);
  send(noneHandler, noneHost.host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(noneHandler, noneHost.host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(rowsOf(noneHost.host).find((row) => row.id === 'builtin:policy').description, '未配置 override；完整继承父策略');
  assert.equal(rowsOf(noneHost.host).find((row) => row.id === 'builtin:model').description, '继承父模型');
  assert.equal(rowsOf(noneHost.host).find((row) => row.id === 'builtin:effort').description, 'inherit（继承父 effort）');
  assert.equal(rowsOf(noneHost.host).find((row) => row.id === 'builtin:project').description, '未配置');
  assert.equal(rowsOf(noneHost.host).find((row) => row.id === 'builtin:user').description, '未配置');

  // 项目级生效：标注来源、路径与字段来源，并说明用户级被整体覆盖。
  const appliedSnapshot = createSnapshot();
  appliedSnapshot.skills = [{enabled: true, name: 'review-skill', sourceKind: 'project'}];
  appliedSnapshot.overrides[1] = {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'valid', fingerprint: 'settings-fp', settings: {schemaVersion: 2, overrides: {explorer: {modelProfileId: 'fast', effort: 'high', skills: ['review-skill']}}}};
  appliedSnapshot.overrides[0] = {sourceKind: 'user', sourcePath: '/home/.echo/agents.settings.json', status: 'valid', fingerprint: 'user-settings-fp', settings: {schemaVersion: 2, overrides: {explorer: {effort: 'low'}}}};
  appliedSnapshot.builtins = appliedSnapshot.builtins.map((builtin) => builtin.name === 'explorer'
    ? {...builtin, effort: 'high', modelProfileId: 'fast', policy: {fields: ['model', 'effort', 'skills'], sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'applied'}, skillNames: ['review-skill']}
    : builtin);
  const appliedHost = createHost({snapshot: appliedSnapshot});
  const appliedHandler = new AgentsCommandHandler();
  appliedHandler.start('/agents', appliedHost.host);
  send(appliedHandler, appliedHost.host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(appliedHandler, appliedHost.host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(rowsOf(appliedHost.host).find((row) => row.id === 'builtin:policy').description, '项目级 override 生效 · /repo/.echo/agents.settings.json');
  assert.equal(rowsOf(appliedHost.host).find((row) => row.id === 'builtin:model').description, 'fast（项目级策略）');
  assert.equal(rowsOf(appliedHost.host).find((row) => row.id === 'builtin:effort').description, 'high（项目级策略）');
  assert.equal(rowsOf(appliedHost.host).find((row) => row.id === 'builtin:skills').description, '1 个（项目级策略）');
  assert.equal(rowsOf(appliedHost.host).find((row) => row.id === 'builtin:project').description, '当前生效');
  assert.equal(rowsOf(appliedHost.host).find((row) => row.id === 'builtin:user').description, '已配置，被项目级策略整体覆盖');

  // 用户级表单在项目级生效时提示保存后不会生效；项目级表单提示本 scope 生效。
  activateRow(appliedHandler, appliedHost.host, 'builtin:user');
  let form = appliedHost.host.session.getActive();
  assert.equal(form.data.builtinForm.scope, 'user');
  assert.equal(form.surface.rows[0].id, 'policy');
  assert.equal(form.surface.rows[0].readonly, true);
  assert.equal(form.surface.rows[0].description, '项目级 override 生效；本 scope 保存后不会生效');
  send(appliedHandler, appliedHost.host, {type: INPUT_EVENTS.ESCAPE});
  activateRow(appliedHandler, appliedHost.host, 'builtin:project');
  form = appliedHost.host.session.getActive();
  assert.equal(form.data.builtinForm.scope, 'project');
  assert.equal(form.surface.rows[0].description, '本 scope 生效 · /repo/.echo/agents.settings.json');

  // 已声明但整体失效：不得显示为当前策略。
  const ignoredSnapshot = createSnapshot();
  ignoredSnapshot.overrides[1] = {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'valid', fingerprint: 'settings-fp', settings: {schemaVersion: 2, overrides: {explorer: {modelProfileId: 'gone'}}}};
  ignoredSnapshot.builtins = ignoredSnapshot.builtins.map((builtin) => builtin.name === 'explorer'
    ? {...builtin, policy: {fields: [], missingModelProfileId: 'gone', sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'ignored'}}
    : builtin);
  const ignoredHost = createHost({snapshot: ignoredSnapshot});
  const ignoredHandler = new AgentsCommandHandler();
  ignoredHandler.start('/agents', ignoredHost.host);
  send(ignoredHandler, ignoredHost.host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(ignoredHandler, ignoredHost.host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(rowsOf(ignoredHost.host).find((row) => row.id === 'builtin:policy').description, '项目级 override 已声明但整体失效（缺少模型 profile "gone"），当前完整继承父策略');
  assert.equal(rowsOf(ignoredHost.host).find((row) => row.id === 'builtin:model').description, '继承父模型');
  assert.equal(rowsOf(ignoredHost.host).find((row) => row.id === 'builtin:project').description, '已声明但缺少模型 profile，未生效');
  activateRow(ignoredHandler, ignoredHost.host, 'builtin:project');
  assert.equal(ignoredHost.host.session.getActive().surface.rows[0].description, '本 scope override 已声明但失效（缺少模型 profile "gone"）');

  // 无效 settings 是 fail-closed：不显示为生效策略，且表单拒绝静默覆盖。
  const blockedSnapshot = createSnapshot();
  blockedSnapshot.overrides[1] = {sourceKind: 'project', sourcePath: '/repo/.echo/agents.settings.json', status: 'invalid', error: {code: 'invalid_settings_json', message: 'Agents settings must contain valid JSON.'}};
  const blockedHost = createHost({snapshot: blockedSnapshot});
  const blockedHandler = new AgentsCommandHandler();
  blockedHandler.start('/agents', blockedHost.host);
  send(blockedHandler, blockedHost.host, {type: INPUT_EVENTS.SHIFT_TAB});
  send(blockedHandler, blockedHost.host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(rowsOf(blockedHost.host).find((row) => row.id === 'builtin:policy').description, '项目级 settings 无效（Agents settings must contain valid JSON.），当前完整继承父策略');
  activateRow(blockedHandler, blockedHost.host, 'builtin:project');
  assert.equal(blockedHost.host.session.getActive().surface.mode, 'detail');
  assert.match(blockedHost.host.session.getActive().surface.error, /无法编辑无效 settings.*valid JSON/);
  assert.equal(blockedHost.host.session.getActive().data.builtinForm, undefined);
  assert.equal(blockedHost.host.session.getActive().surface.feedback, undefined);
});

function activateRow(handler, host, id) {
  const surface = host.session.getActive().surface;
  const target = surface.rows.findIndex((row) => row.id === id);
  assert.notEqual(target, -1, `Missing row ${id}`);
  const distance = target - surface.selectedIndex;
  for (let step = 0; step < Math.abs(distance); step += 1) {
    send(handler, host, {type: distance < 0 ? INPUT_EVENTS.MOVE_UP : INPUT_EVENTS.MOVE_DOWN});
  }
  return send(handler, host, {type: INPUT_EVENTS.SUBMIT});
}

test('/agents first-level detail exposes only one global toggle and saves only enablement', () => {
  for (const name of ['explorer', 'worker', 'reviewer']) {
    const handler = new AgentsCommandHandler();
    const {calls, host} = createHost();
    handler.start('/agents', host);
    activateRow(handler, host, `agent:${name === 'reviewer' ? 'project' : 'builtin'}:${name}`);
    const surface = host.session.getActive().surface;
    assert.equal(surface.mode, 'detail');
    assert.deepEqual(surface.rows.filter((row) => row.kind === 'tool').map((row) => [row.id, row.label, row.selected]), [['enablement:toggle', '全局启用', true]]);
    assert.equal(surface.rows.some((row) => row.id === 'enablement:effective' || row.label === '有效启停'), false);
    activateRow(handler, host, 'enablement:toggle');
    assert.deepEqual(calls.enablement, []);
    assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'enablement:toggle').selected, false);
    assert.match(host.session.getActive().surface.dismissHint, /未保存/);
    activateRow(handler, host, 'enablement:save');
    assert.deepEqual(calls.enablement, [{name, value: false, fingerprint: null}]);
    assert.deepEqual(calls.overrides, []);
    assert.deepEqual(calls.updated, []);
    assert.equal(host.session.getActive().surface.mode, 'detail');
    assert.match(host.session.getActive().surface.feedback, /下一次 assistant turn/);
    assert.doesNotMatch(host.session.getActive().surface.dismissHint, /未保存/);
    send(handler, host, {type: INPUT_EVENTS.ESCAPE});
    assert.equal(host.session.getActive().surface.rows.find((row) => row.label === name).enablement.enabled, false);
  }
});

test('/agents policy and definition submenus never repeat the global toggle or discard its draft', () => {
  for (const id of ['builtin:user', 'builtin:project', 'custom:edit']) {
    const handler = new AgentsCommandHandler();
    const {calls, host} = createHost();
    handler.start('/agents', host);
    activateRow(handler, host, id === 'custom:edit' ? 'agent:project:reviewer' : 'agent:builtin:explorer');
    activateRow(handler, host, 'enablement:toggle');
    activateRow(handler, host, id);
    assert.equal(host.session.getActive().surface.rows.some((row) => row.id.startsWith('enablement:')), false);
    send(handler, host, {type: INPUT_EVENTS.ESCAPE});
    assert.equal(host.session.getActive().surface.rows.find((row) => row.id === 'enablement:toggle').selected, false);
    assert.deepEqual(calls.enablement, []);
  }
});

test('/agents project policy changes and errors do not hide the global switch', () => {
  for (const project of [
    {sourceKind: 'project', status: 'valid', sourcePath: '/repo/.echo/agents.settings.json', fingerprint: 'project-settings-fp', settings: {schemaVersion: 2, overrides: {explorer: {effort: 'high'}}}},
    {sourceKind: 'project', status: 'invalid', sourcePath: '/repo/.echo/agents.settings.json', error: {code: 'unknown_settings_field', message: 'Unknown root field'}}
  ]) {
    const snapshot = createSnapshot();
    snapshot.overrides[1] = project;
    const handler = new AgentsCommandHandler();
    const {host} = createHost({snapshot});
    handler.start('/agents', host);
    assert.equal(host.session.getActive().surface.stats.enabledCount, 3);
    activateRow(handler, host, 'agent:builtin:explorer');
    const row = host.session.getActive().surface.rows.find((row) => row.id === 'enablement:toggle');
    assert.equal(row.selected, true);
    assert.notEqual(row.readonly, true);
    assert.doesNotMatch(host.session.getActive().surface.notice || '', /委派不可用/);
  }
});

test('/agents global toggle supports Enter Space and arrows and cancel or Esc never persists', () => {
  for (const cancel of ['cancel', 'escape']) {
    const handler = new AgentsCommandHandler();
    const {calls, host} = createHost();
    handler.start('/agents', host);
    activateRow(handler, host, 'agent:builtin:explorer');
    activateRow(handler, host, 'enablement:toggle');
    for (const event of [{type: INPUT_EVENTS.TEXT, value: ' '}, {type: INPUT_EVENTS.MOVE_LEFT}, {type: INPUT_EVENTS.MOVE_RIGHT}]) {
      const before = host.session.getActive().data.enablement.value;
      send(handler, host, event);
      assert.equal(host.session.getActive().data.enablement.value, !before);
    }
    activateRow(handler, host, 'enablement:toggle');
    if (cancel === 'cancel') activateRow(handler, host, 'enablement:cancel');
    else send(handler, host, {type: INPUT_EVENTS.ESCAPE});
    assert.deepEqual(calls.enablement, []);
    activateRow(handler, host, 'agent:builtin:explorer');
    assert.equal(host.session.getActive().data.enablement.value, true);
  }
});

test('/agents create only creates a definition, with no enablement fields', () => {
  const handler = new AgentsCommandHandler();
  const {calls, host} = createHost();
  handler.start('/agents', host);
  send(handler, host, {type: INPUT_EVENTS.TAB});
  activateRow(handler, host, 'create:project');
  assert.equal(host.session.getActive().surface.rows.some((row) => row.id.startsWith('enablement:')), false);
  activateRow(handler, host, 'name');
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: 'new-agent'});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  activateRow(handler, host, 'save');
  assert.equal(host.session.getActive().surface.mode, 'confirm');
  activateRow(handler, host, 'confirm:execute');
  assert.equal(calls.created[0].name, 'new-agent');
  assert.deepEqual(calls.enablement, []);
});

test('/agents saving either policy scope retains global draft and only global policy advances its fingerprint', () => {
  for (const scope of ['user', 'project']) {
    const handler = new AgentsCommandHandler();
    const {calls, host} = createHost();
    handler.start('/agents', host);
    activateRow(handler, host, 'agent:builtin:explorer');
    activateRow(handler, host, 'enablement:toggle');
    activateRow(handler, host, `builtin:${scope}`);
    activateRow(handler, host, 'model');
    activateRow(handler, host, 'save');
    assert.deepEqual(calls.enablement, []);
    const entry = host.session.getActive().data.enablement;
    assert.equal(entry.fingerprint, scope === 'user' ? 'settings-fp' : null);
    assert.equal(entry.value, false);
    assert.equal(entry.original, true);
    activateRow(handler, host, 'enablement:save');
    assert.equal(calls.enablement[0].fingerprint, scope === 'user' ? 'settings-fp' : null);
  }
});

test('/agents global save failures keep the draft and original fingerprint for retry', () => {
  for (const kind of ['conflict', 'io']) {
    const handler = new AgentsCommandHandler();
    const {host} = createHost({enablementResult: {ok: false, kind, code: 'write_failed', message: 'external edit or disk failure'}});
    handler.start('/agents', host);
    activateRow(handler, host, 'agent:builtin:explorer');
    activateRow(handler, host, 'enablement:toggle');
    activateRow(handler, host, 'enablement:save');
    const session = host.session.getActive();
    assert.equal(session.surface.mode, 'detail');
    assert.match(session.surface.error, kind === 'conflict' ? /冲突/ : /I\/O/);
    assert.deepEqual(session.data.enablement, {value: false, original: true, fingerprint: null});
    assert.doesNotMatch(session.surface.error, /部分保存/);
  }
});

test('/agents malformed global settings make the only toggle unavailable and readonly', () => {
  const snapshot = createSnapshot();
  snapshot.overrides[0] = {sourceKind: 'user', sourcePath: '/home/.echo/agents.settings.json', status: 'invalid', error: {code: 'invalid_settings_json', message: 'Invalid JSON'}};
  const handler = new AgentsCommandHandler();
  const {calls, host} = createHost({snapshot});
  handler.start('/agents', host);
  activateRow(handler, host, 'agent:builtin:explorer');
  const row = host.session.getActive().surface.rows.find((row) => row.id === 'enablement:toggle');
  assert.equal(row.readonly, true);
  assert.equal(row.selected, undefined);
  activateRow(handler, host, 'enablement:toggle');
  send(handler, host, {type: INPUT_EVENTS.TEXT, value: ' '});
  activateRow(handler, host, 'enablement:save');
  assert.deepEqual(calls.enablement, []);
});

test('/agents deletion confirmation has only cancel and delete and never writes enablement', () => {
  const handler = new AgentsCommandHandler();
  const {calls, host} = createHost();
  handler.start('/agents', host);
  activateRow(handler, host, 'agent:project:reviewer');
  activateRow(handler, host, 'custom:delete');
  const surface = host.session.getActive().surface;
  assert.deepEqual(surface.rows.map((row) => [row.id, row.kind]), [['confirm:cancel', 'confirm'], ['confirm:execute', 'confirm']]);
  assert.equal(surface.selectedIndex, 0);
  assert.equal(surface.rows[1].description, '/repo/.echo/agents/reviewer.md；用户定义接替·启用');
  for (let index = 0; index < 5; index += 1) {
    send(handler, host, {type: INPUT_EVENTS.MOVE_DOWN});
    assert.equal(host.session.getActive().surface.selectedIndex, 1);
  }
  assert.deepEqual(calls.deleted, []);
  send(handler, host, {type: INPUT_EVENTS.MOVE_UP});
  send(handler, host, {type: INPUT_EVENTS.SUBMIT});
  assert.equal(host.session.getActive().surface.mode, 'detail');
  assert.deepEqual(calls.deleted, []);
  activateRow(handler, host, 'custom:delete');
  activateRow(handler, host, 'confirm:execute');
  assert.deepEqual(calls.deleted, [{scope: 'project', name: 'reviewer', fingerprint: 'project-fp'}]);
  assert.deepEqual(calls.enablement, []);
});

test('/agents counts enabled valid candidates independently of the disabled delegation tool', () => {
  const snapshot = createSnapshot();
  snapshot.delegationToolEnabled = false;
  const handler = new AgentsCommandHandler();
  const {host} = createHost({snapshot});
  handler.start('/agents', host);
  assert.equal(host.session.getActive().surface.stats.enabledCount, 3);
  assert.match(host.session.getActive().surface.notice, /委派工具已关闭/);
});

test('/agents keeps global switches usable when the main tool configuration is unavailable', () => {
  const snapshot = createSnapshot();
  snapshot.delegationToolEnabled = undefined;
  const handler = new AgentsCommandHandler();
  const {calls, host} = createHost({snapshot});
  handler.start('/agents', host);
  assert.match(host.session.getActive().surface.notice, /主工具配置异常，委派工具状态不可用/);
  assert.doesNotMatch(host.session.getActive().surface.notice, /委派工具已关闭/);
  assert.equal(host.session.getActive().surface.stats.enabledCount, 3);
  activateRow(handler, host, 'agent:builtin:explorer');
  activateRow(handler, host, 'enablement:toggle');
  activateRow(handler, host, 'enablement:save');
  assert.deepEqual(calls.enablement, [{name: 'explorer', value: false, fingerprint: null}]);
});
