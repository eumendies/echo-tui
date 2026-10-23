const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyMainAgentToolsDraft,
  normalizeDisabledTools,
  parseMainAgentToolsConfig
} = require('../../src/config/main-agent-tools-config');

test('main tools default to all enabled and ignore every legacy mode without mutating config', () => {
  assert.deepEqual(parseMainAgentToolsConfig({}), {disabledTools: []});
  for (const mode of [undefined, null, 'apply_patch', 'edit_file', 'invalid', true, {}, []]) {
    const root = {tools: {fileEdit: {mode}}};
    const before = structuredClone(root);
    assert.deepEqual(parseMainAgentToolsConfig(root), {disabledTools: []});
    assert.deepEqual(root, before);
  }
  for (const mode of ['apply_patch', 'edit_file', 'invalid']) {
    assert.deepEqual(parseMainAgentToolsConfig({tools: {fileEdit: {mode}, mainAgent: {disabledTools: []}}}), {disabledTools: []});
    assert.deepEqual(parseMainAgentToolsConfig({tools: {fileEdit: {mode}, mainAgent: {disabledTools: ['apply_patch', 'edit_file']}}}), {disabledTools: ['apply_patch', 'edit_file']});
  }
});

test('disabled names are exact, deduplicated, Bash-free, and preserve unknown tools', () => {
  const input = ['web_search', 'web_search', 'run_bash_command', 'mcp__offline__read', 'future_tool', 'WEB_SEARCH', '*', ' web_search '];
  const before = [...input];
  assert.deepEqual(normalizeDisabledTools(input), ['web_search', 'mcp__offline__read', 'future_tool', 'WEB_SEARCH', '*', ' web_search ']);
  assert.deepEqual(input, before);
  assert.deepEqual(normalizeDisabledTools(['run_bash_command', 'run_bash_command']), []);
  assert.deepEqual(normalizeDisabledTools([]), []);
});

test('either single Todo disable is normalized to both without modifying input', () => {
  for (const name of ['create_todos', 'complete_todo']) {
    const root = {tools: {mainAgent: {disabledTools: [name]}}};
    assert.deepEqual(new Set(parseMainAgentToolsConfig(root).disabledTools), new Set(['create_todos', 'complete_todo']));
    assert.deepEqual(root.tools.mainAgent.disabledTools, [name]);
    applyMainAgentToolsDraft(root, {disabledTools: [name]});
    assert.deepEqual(new Set(root.tools.mainAgent.disabledTools), new Set(['create_todos', 'complete_todo']));
    applyMainAgentToolsDraft(root, {disabledTools: []});
    assert.deepEqual(root.tools.mainAgent.disabledTools, []);
  }
});

test('invalid explicit lists fail strictly without falling back or mutating the root', () => {
  for (const value of [undefined, null, false, 1, '', {}, 'web_search', [null], [1], [''], ['  '], ['web_search', false], new Array(1)]) {
    const root = {tools: {mainAgent: {disabledTools: value}, fileEdit: {mode: 'edit_file'}}};
    const before = structuredClone(root);
    assert.throws(() => normalizeDisabledTools(value), /tools\.mainAgent\.disabledTools/);
    assert.throws(() => parseMainAgentToolsConfig(root), /tools\.mainAgent\.disabledTools/);
    assert.throws(() => applyMainAgentToolsDraft(root, {disabledTools: value}), /tools\.mainAgent\.disabledTools/);
    assert.deepEqual(root, before);
  }
});

test('applying main tools changes only its owned field and does not share the draft array', () => {
  const root = {
    tools: {mainAgent: {disabledTools: ['old'], future: 42}, fileEdit: {mode: 'edit_file'}, bash: {timeoutMs: 1000}},
    unknown: {kept: true}
  };
  const before = structuredClone(root);
  const draft = {disabledTools: ['future_tool', 'run_bash_command']};
  applyMainAgentToolsDraft(root, draft);
  assert.deepEqual(root, {...before, tools: {...before.tools, mainAgent: {future: 42, disabledTools: ['future_tool']}}});
  draft.disabledTools.push('web_search');
  assert.deepEqual(root.tools.mainAgent.disabledTools, ['future_tool']);
});
