const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {createMainAgentToolCatalog} = require('../../src/tools/main-agent-tool-catalog');
const {prepareAgent} = require('../../src/agent/agent-setup');
const {MCP_RESOURCE_TOOL_NAMES} = require('../../src/tools/mcp-resource-tools');

const config = {
  agentType: 'fake', apiKey: '', model: 'fake',
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 1024},
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

test('candidate catalog retains disabled builtins, both editors, Todo and offline resource preferences', () => {
  const disabledTools = ['read_files', 'create_todos', 'edit_file', 'mcp__offline__lookup', 'unknown', 'unknown'];
  const catalog = createMainAgentToolCatalog({disabledTools});
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  const prepared = prepareAgent({config, mainAgentTools: {disabledTools}});

  for (const name of ['read_files', 'apply_patch', 'edit_file', 'create_todos', 'complete_todo', 'run_subagent']) {
    assert.equal(byName.get(name).available, true, name);
  }
  assert.equal(prepared.registry.getHandler('read_files'), undefined);
  assert.equal(prepared.registry.getHandler('create_todos'), undefined);
  for (const name of MCP_RESOURCE_TOOL_NAMES) {
    assert.deepEqual(byName.get(name), {name, available: false});
    assert.equal(prepared.registry.getHandler(name), undefined);
  }
  for (const name of ['unknown', 'mcp__offline__lookup']) {
    assert.equal(byName.get(name).available, false);
    assert.equal(byName.get(name).unknown, true);
    assert.equal(catalog.filter((entry) => entry.name === name).length, 1);
    assert.equal(prepared.registry.getHandler(name), undefined);
  }

  const reopened = createMainAgentToolCatalog({disabledTools: []});
  for (const {name} of reopened) {
    assert.equal(byName.get(name).name, name);
    assert.notEqual(byName.get(name).unknown, true);
  }
  const enabled = prepareAgent({config, mainAgentTools: {disabledTools: []}});
  assert.ok(enabled.registry.getHandler('read_files'));
  assert.ok(enabled.registry.getHandler('create_todos'));
  assert.ok(enabled.registry.getHandler('complete_todo'));
});

test('catalog consumes only discovered MCP metadata and exactly matches real registry names', () => {
  const mcpManager = {
    listServerNames: () => ['docs'],
    listTools: () => [{serverName: 'docs', toolName: 'search', namespacedName: 'mcp__docs__search', inputSchema: {type: 'object'}}],
    bootstrap() { assert.fail('catalog must not connect'); },
    reload() { assert.fail('catalog must not reload'); },
    callTool() { assert.fail('catalog must not execute'); }
  };
  const catalog = createMainAgentToolCatalog({mcpManager, disabledTools: ['mcp__docs__search']});
  const all = prepareAgent({
    config, mcpManager, mainAgentTools: {disabledTools: []},
    subagentPort: {listDefinitions: () => [], run() { assert.fail('catalog must not delegate'); }}
  });
  assert.deepEqual(new Set(catalog.map(({name}) => name)), new Set(all.registry.listDefinitions().map(({name}) => name)));
  for (const {name} of all.registry.listDefinitions()) {
    const candidate = catalog.find((entry) => entry.name === name);
    assert.equal(candidate.available, true, name);
  }
  const mcpEntry = catalog.find(({name}) => name === 'mcp__docs__search');
  assert.equal(mcpEntry.serverName, 'docs');
  assert.equal(mcpEntry.available, true);
  assert.equal(prepareAgent({config, mcpManager, mainAgentTools: {disabledTools: ['mcp__docs__search']}})
    .registry.getHandler(mcpEntry.name), undefined);
});

test('an empty MCP manager does not make resource tools available', () => {
  const mcpManager = {listServerNames: () => [], listTools: () => []};
  const catalog = createMainAgentToolCatalog({mcpManager, disabledTools: []});
  const prepared = prepareAgent({config, mcpManager, mainAgentTools: {disabledTools: []}});
  for (const name of MCP_RESOURCE_TOOL_NAMES) {
    assert.equal(catalog.find((entry) => entry.name === name).available, false);
    assert.equal(prepared.registry.getHandler(name), undefined);
  }
});

test('catalog enumeration performs no file or skill-directory reads', (t) => {
  const readFile = t.mock.method(fs, 'readFileSync', () => '');
  const readDirectory = t.mock.method(fs, 'readdirSync', () => []);
  const catalog = createMainAgentToolCatalog({disabledTools: ['mcp__offline__search']});
  assert.ok(catalog.some(({name}) => name === 'use_skill'));
  assert.equal(readFile.mock.callCount(), 0);
  assert.equal(readDirectory.mock.callCount(), 0);
  assert.ok(catalog.every((entry) => !Object.hasOwn(entry, 'description')));
});
