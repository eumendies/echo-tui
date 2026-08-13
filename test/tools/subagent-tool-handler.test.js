const assert = require('node:assert/strict');
const {test} = require('node:test');

const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createDefaultToolRegistry, createToolRegistry} = require('../../src/tools/tool-registry');
const {createRunSubagentToolHandler, RUN_SUBAGENT_TOOL_NAME} = require('../../src/tools/run-subagent-tool-handler');
const {listSubagentDefinitions} = require('../../src/agent/subagent/definition');

const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake',
  contextWindow: 128000,
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 1024}
  }
};

test('run_subagent is a normal pair-after ToolHandler executed through ToolExecutor', async () => {
  const invocations = [];
  const port = {
    listDefinitions() {
      return [{name: 'explorer', description: 'Investigate broad bounded tasks.'}];
    },
    async run(agentName, task, call, options) {
      invocations.push({agentName, task, call, options});
      return {ok: true, text: 'evidence-backed report'};
    }
  };
  const handler = createRunSubagentToolHandler(port);
  const executor = createToolExecutor(createToolRegistry([handler]));
  const call = {
    callId: 'outer_1',
    toolName: RUN_SUBAGENT_TOOL_NAME,
    argumentsText: JSON.stringify({agent: 'explorer', task: ' inspect config '})
  };
  const abortController = new AbortController();
  const result = await executor.execute(call, {abortSignal: abortController.signal});

  assert.equal(handler.transcriptCommitMode, 'pair_after_execute');
  assert.equal(handler.definition.description, 'Delegate a self-contained task to a named built-in subagent and return only its final result.');
  assert.deepEqual(handler.definition.parameters.required, ['agent', 'task']);
  assert.deepEqual(handler.definition.parameters.properties.agent.enum, ['explorer']);
  assert.match(handler.definition.parameters.properties.agent.description, /explorer: Investigate broad bounded tasks/u);
  assert.match(handler.definition.parameters.properties.task.description, /selected subagent/u);
  assert.deepEqual(invocations, [{agentName: 'explorer', task: 'inspect config', call, options: {abortSignal: abortController.signal}}]);
  assert.deepEqual(result, {
    callId: 'outer_1',
    toolName: RUN_SUBAGENT_TOOL_NAME,
    ok: true,
    details: {kind: 'generic'},
    text: 'evidence-backed report'
  });
});

test('built-in subagent definitions expose Explorer and Worker without nested delegation', () => {
  const definitions = listSubagentDefinitions();
  assert.deepEqual(definitions.map((definition) => definition.name), ['explorer', 'worker']);
  assert.deepEqual(definitions.map((definition) => definition.executionPolicy.kind), ['readonly_investigation', 'general_purpose']);
  assert.equal(definitions[0].includeMcpTools, false);
  assert.equal(definitions[1].includeMcpTools, true);
  assert.equal(definitions.every((definition) => !definition.localToolNames.has(RUN_SUBAGENT_TOOL_NAME)), true);
  assert.equal(definitions[1].localToolNames.has('apply_patch'), true);
  assert.equal(definitions[1].localToolNames.has('ask_user_questions'), true);
  assert.equal(definitions[1].localToolNames.has('create_todos'), true);
});

test('run_subagent rejects invalid task arguments before invoking its Port', async () => {
  let invoked = false;
  const executor = createToolExecutor(createToolRegistry([createRunSubagentToolHandler({
    listDefinitions() {
      return [{name: 'explorer', description: 'Investigate broad bounded tasks.'}];
    },
    async run() {
      invoked = true;
      return {ok: true, text: 'unexpected'};
    }
  })]));
  const result = await executor.execute({
    callId: 'outer_invalid',
    toolName: RUN_SUBAGENT_TOOL_NAME,
    argumentsText: JSON.stringify({agent: 'explorer', task: '   '})
  });

  assert.equal(invoked, false);
  assert.equal(result.ok, false);
  assert.match(result.text, /non-empty string/);
});

test('run_subagent rejects unknown agent names before invoking its Port', async () => {
  let invoked = false;
  const executor = createToolExecutor(createToolRegistry([createRunSubagentToolHandler({
    listDefinitions() {
      return [{name: 'explorer', description: 'Investigate broad bounded tasks.'}];
    },
    async run() {
      invoked = true;
      return {ok: true, text: 'unexpected'};
    }
  })]));
  const result = await executor.execute({
    callId: 'outer_unknown',
    toolName: RUN_SUBAGENT_TOOL_NAME,
    argumentsText: JSON.stringify({agent: 'reviewer', task: 'inspect'})
  });

  assert.equal(invoked, false);
  assert.equal(result.ok, false);
  assert.match(result.text, /agent must be one of: explorer/);
});

test('default registry only exposes run_subagent when a parent Port is injected and supports a real allowlist', () => {
  const parent = createDefaultToolRegistry(TEST_CONFIG, '/tmp/echo-subagent-registry', undefined, {
    subagentPort: {
      listDefinitions() { return [{name: 'explorer', description: 'Investigate broad bounded tasks.'}]; },
      async run() { return {ok: true, text: 'ok'}; }
    }
  });
  const ordinary = createDefaultToolRegistry(TEST_CONFIG, '/tmp/echo-subagent-registry');
  const allowlist = new Set(['read_files', 'glob', 'grep', 'run_bash_command', 'web_fetch', 'web_search', 'use_skill']);
  const child = createDefaultToolRegistry(TEST_CONFIG, '/tmp/echo-subagent-registry', undefined, {
    allowedToolNames: allowlist,
    subagentPort: {
      listDefinitions() { return [{name: 'explorer', description: 'Investigate broad bounded tasks.'}]; },
      async run() { return {ok: true, text: 'unexpected'}; }
    }
  });

  assert.equal(ordinary.getHandler(RUN_SUBAGENT_TOOL_NAME), undefined);
  assert.ok(parent.getHandler(RUN_SUBAGENT_TOOL_NAME));
  assert.deepEqual(new Set(child.listDefinitions().map((definition) => definition.name)), allowlist);
  assert.equal(child.getHandler('apply_patch'), undefined);
  assert.equal(child.getHandler('ask_user_questions'), undefined);
  assert.equal(child.getHandler(RUN_SUBAGENT_TOOL_NAME), undefined);
});
