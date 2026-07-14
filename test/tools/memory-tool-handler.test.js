const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {createMemoryToolHandlers} = require('../../src/tools/memory-tool-handler');
const {createUserMemory, readUserMemories} = require('../../src/memory/memory-store');
const {classifyToolCallRisk, createMemoryApprovalPreview} = require('../../src/tools/tool-risk-classifier');
const {addAgentMemory, setAgentMemoryCatalogEnabled, setAgentMemoryItemEnabled} = require('../../src/memory/agent-memory-store');

function call(toolName, args, callId = 'call-1') { return {callId, toolName, argumentsText: JSON.stringify(args)}; }
function execute(handlers, toolName, args) { return handlers.find((handler) => handler.definition.name === toolName).execute(args, call(toolName, args)); }

test('memory tools add, read, update and remove agent catalog and items', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-memory-tools-'));
  const original = os.homedir;
  os.homedir = () => home;
  try {
    const cwd = path.join(home, 'project');
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    const handlers = createMemoryToolHandlers(cwd);
    let result = execute(handlers, 'add_memory', {catalog: 'rendering', catalogDescription: 'Terminal rules', content: 'Use real cursors'});
    assert.equal(result.ok, true);
    const added = JSON.parse(result.text);
    assert.equal(added.type, undefined);
    const itemId = added.memory.id;
    assert.match(execute(handlers, 'read_memory', {catalog: 'rendering'}).text, /Use real cursors/);

    result = execute(handlers, 'update_memory', {target: 'item', catalog: 'rendering', itemId, content: 'Use terminal cursors'});
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(result.text).type, undefined);
    result = execute(handlers, 'update_memory', {target: 'catalog', catalog: 'rendering', name: 'terminal', description: 'Terminal rendering rules'});
    assert.equal(result.ok, true);
    assert.match(execute(handlers, 'read_memory', {catalog: 'terminal'}).text, /Use terminal cursors/);

    assert.equal(execute(handlers, 'remove_memory', {target: 'catalog', catalog: 'terminal'}).ok, true);
    result = execute(handlers, 'add_memory', {catalog: 'temporary', catalogDescription: 'Temporary rules', content: 'Remove me'});
    const temporaryId = JSON.parse(result.text).memory.id;
    result = execute(handlers, 'remove_memory', {target: 'item', catalog: 'temporary', itemId: temporaryId});
    assert.equal(JSON.parse(result.text).removedCatalog, true);
  } finally {
    os.homedir = original;
  }
});

test('memory tools validate required agent arguments', () => {
  const handlers = createMemoryToolHandlers('/tmp/project');
  assert.equal(execute(handlers, 'read_memory', {}).ok, false);
  assert.equal(execute(handlers, 'add_memory', {content: 'x'}).ok, false);
  assert.equal(execute(handlers, 'update_memory', {target: 'catalog'}).ok, false);
  assert.equal(execute(handlers, 'remove_memory', {target: 'item', catalog: 'x'}).ok, false);
});

test('agent memory tool calls never modify user memory', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-memory-tools-user-'));
  const original = os.homedir;
  os.homedir = () => home;
  try {
    const cwd = path.join(home, 'project');
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    createUserMemory('Prefer Chinese');
    const before = readUserMemories();
    const handlers = createMemoryToolHandlers(cwd);

    const added = execute(handlers, 'add_memory', {catalog: 'preferences', catalogDescription: 'Agent preferences', content: 'Use concise Chinese'});
    assert.equal(added.ok, true);
    const itemId = JSON.parse(added.text).memory.id;
    assert.equal(execute(handlers, 'read_memory', {catalog: 'preferences'}).ok, true);
    assert.equal(execute(handlers, 'update_memory', {target: 'item', catalog: 'preferences', itemId, content: 'Use concise Chinese'}).ok, true);
    assert.equal(execute(handlers, 'remove_memory', {target: 'item', catalog: 'preferences', itemId}).ok, true);

    assert.deepEqual(readUserMemories(), before);
  } finally {
    os.homedir = original;
  }
});

test('read_memory rejects disabled catalogs, filters disabled items and falls back to enabled global', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-memory-tool-enabled-'));
  const original = os.homedir;
  os.homedir = () => home;
  try {
    const cwd = path.join(home, 'project');
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    const handlers = createMemoryToolHandlers(cwd);
    addAgentMemory(cwd, {catalog: 'shared', description: 'global rules', content: 'global item', scope: 'global'});
    addAgentMemory(cwd, {catalog: 'shared', description: 'project rules', content: 'project item'});
    setAgentMemoryCatalogEnabled(cwd, 'shared', false, 'project');

    const fallback = execute(handlers, 'read_memory', {catalog: 'shared'});
    assert.equal(fallback.ok, true);
    assert.match(fallback.text, /global rules/);
    assert.doesNotMatch(fallback.text, /project item/);
    assert.equal(execute(handlers, 'read_memory', {catalog: 'shared', scope: 'project'}).ok, false);

    let result = addAgentMemory(cwd, {catalog: 'filtering', description: 'filter rules', content: 'disabled item'});
    const disabledId = result.memories[0].id;
    addAgentMemory(cwd, {catalog: 'filtering', content: 'enabled item'});
    setAgentMemoryItemEnabled(cwd, 'filtering', disabledId, false);
    result = execute(handlers, 'read_memory', {catalog: 'filtering'});
    assert.equal(result.ok, true);
    assert.doesNotMatch(result.text, /disabled item/);
    assert.match(result.text, /enabled item/);
  } finally {
    os.homedir = original;
  }
});

test('memory mutation tools require approval while read_memory stays safe and plan rejects writes', () => {
  assert.equal(classifyToolCallRisk(call('read_memory', {catalog: 'rules'})).risk, 'safe');
  for (const name of ['add_memory', 'update_memory', 'remove_memory']) {
    assert.equal(classifyToolCallRisk(call(name, {catalog: 'rules'})).risk, 'approval_required');
    assert.equal(classifyToolCallRisk(call(name, {catalog: 'rules'}), 'plan').risk, 'rejected');
  }
  const preview = createMemoryApprovalPreview(call('add_memory', {scope: 'global', catalog: 'rules', content: 'Stable rule'}));
  assert.doesNotMatch(preview, /Type:/);
  assert.match(preview, /Scope: GLOBAL/);
  assert.match(preview, /Catalog: rules/);
  assert.match(preview, /Stable rule/);
});

test('memory tool schemas expose four focused agent tools', () => {
  const definitions = createMemoryToolHandlers('/tmp').map((handler) => handler.definition);
  assert.deepEqual(definitions.map((definition) => definition.name), ['read_memory', 'add_memory', 'update_memory', 'remove_memory']);
  assert.equal(definitions.every((definition) => definition.parameters.additionalProperties === false), true);
  assert.equal(definitions.every((definition) => definition.parameters.properties.enabled === undefined), true);
  assert.equal(definitions.every((definition) => definition.parameters.properties.type === undefined), true);
  assert.deepEqual(definitions.map((definition) => definition.parameters.required), [
    ['catalog'],
    ['catalog', 'content'],
    ['target', 'catalog'],
    ['target', 'catalog']
  ]);
});
