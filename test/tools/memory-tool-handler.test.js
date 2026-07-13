const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {createMemoryToolHandlers} = require('../../src/tools/memory-tool-handler');
const {classifyToolCallRisk, createMemoryApprovalPreview} = require('../../src/tools/tool-risk-classifier');

function call(toolName, args, callId = 'call-1') { return {callId, toolName, argumentsText: JSON.stringify(args)}; }
function execute(handlers, toolName, args) { return handlers.find((handler) => handler.definition.name === toolName).execute(args, call(toolName, args)); }

test('memory tools add, read, update and remove user and agent memories', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-memory-tools-'));
  const original = os.homedir;
  os.homedir = () => home;
  try {
    const cwd = path.join(home, 'project');
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    const handlers = createMemoryToolHandlers(cwd);
    let result = execute(handlers, 'add_memory', {type: 'user', content: 'Use Chinese'});
    assert.equal(result.ok, true);
    const userId = JSON.parse(result.text).memory.id;
    assert.equal(execute(handlers, 'update_memory', {type: 'user', target: 'item', itemId: userId, content: 'Use concise Chinese'}).ok, true);
    assert.match(execute(handlers, 'read_memory', {type: 'user'}).text, /Use concise Chinese/);

    result = execute(handlers, 'add_memory', {type: 'agent', catalog: 'rendering', catalogDescription: 'Terminal rules', content: 'Use real cursors'});
    assert.equal(result.ok, true);
    const itemId = JSON.parse(result.text).memory.id;
    assert.match(execute(handlers, 'read_memory', {type: 'agent', catalog: 'rendering'}).text, /Use real cursors/);
    assert.equal(execute(handlers, 'update_memory', {type: 'agent', target: 'item', catalog: 'rendering', itemId, content: 'Use terminal cursors'}).ok, true);
    result = execute(handlers, 'remove_memory', {type: 'agent', target: 'item', catalog: 'rendering', itemId});
    assert.equal(JSON.parse(result.text).removedCatalog, true);
    assert.equal(execute(handlers, 'remove_memory', {type: 'user', target: 'item', itemId: userId}).ok, true);
  } finally {
    os.homedir = original;
  }
});

test('memory tools validate required type-specific arguments', () => {
  const handlers = createMemoryToolHandlers('/tmp/project');
  assert.equal(execute(handlers, 'read_memory', {type: 'agent'}).ok, false);
  assert.equal(execute(handlers, 'add_memory', {type: 'unknown', content: 'x'}).ok, false);
  assert.equal(execute(handlers, 'update_memory', {type: 'user', target: 'catalog'}).ok, false);
  assert.equal(execute(handlers, 'remove_memory', {type: 'agent', target: 'item', catalog: 'x'}).ok, false);
});

test('memory mutation tools require approval while read_memory stays safe and plan rejects writes', () => {
  assert.equal(classifyToolCallRisk(call('read_memory', {type: 'user'})).risk, 'safe');
  for (const name of ['add_memory', 'update_memory', 'remove_memory']) {
    assert.equal(classifyToolCallRisk(call(name, {type: 'user'})).risk, 'approval_required');
    assert.equal(classifyToolCallRisk(call(name, {type: 'user'}), 'plan').risk, 'rejected');
  }
  const preview = createMemoryApprovalPreview(call('add_memory', {type: 'agent', scope: 'global', catalog: 'rules', content: 'Stable rule'}));
  assert.match(preview, /Type: agent/);
  assert.match(preview, /Scope: GLOBAL/);
  assert.match(preview, /Catalog: rules/);
  assert.match(preview, /Stable rule/);
});

test('memory tool schemas expose four focused tools', () => {
  const definitions = createMemoryToolHandlers('/tmp').map((handler) => handler.definition);
  assert.deepEqual(definitions.map((definition) => definition.name), ['read_memory', 'add_memory', 'update_memory', 'remove_memory']);
  assert.equal(definitions.every((definition) => definition.parameters.additionalProperties === false), true);
});
