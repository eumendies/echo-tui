const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createDefaultToolRegistry, createToolRegistry} = require('../../src/tools/tool-registry');
const {createRunSubagentToolHandler, RUN_SUBAGENT_TOOL_NAME} = require('../../src/tools/run-subagent-tool-handler');
const {BUILTIN_SUBAGENT_DEFINITIONS} = require('../../src/agent/subagent/definition');
const {createToolResultStore} = require('../../src/tools/tool-result-offloading');
const {DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES} = require('../../src/tools/tool-handler-utils');

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
  assert.equal(handler.definition.description, 'Delegate a self-contained task to a named subagent and return only its bounded final result. Oversized reports may be saved to a local artifact that can be inspected with read_files.');
  assert.deepEqual(handler.definition.parameters.required, ['agent', 'task']);
  assert.deepEqual(handler.definition.parameters.properties.agent.enum, ['explorer']);
  assert.match(handler.definition.parameters.properties.agent.description, /explorer: Investigate broad bounded tasks/u);
  assert.equal(handler.definition.parameters.properties.task.description, 'The selected subagent runs in an isolated context and cannot see the parent conversation. Include all necessary context directly; do not refer to prior messages or the user request.');
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
  const definitions = BUILTIN_SUBAGENT_DEFINITIONS;
  assert.deepEqual(definitions.map((definition) => definition.name), ['explorer', 'worker']);
  assert.deepEqual(definitions.map((definition) => definition.executionPolicy), ['readonly_investigation', 'general_purpose']);
  assert.equal(definitions[0].includeMcpTools, false);
  assert.equal(definitions[1].includeMcpTools, true);
  assert.equal(definitions.every((definition) => !definition.localToolNames.includes(RUN_SUBAGENT_TOOL_NAME)), true);
  assert.equal(definitions[1].localToolNames.includes('apply_patch'), true);
  assert.equal(definitions[1].localToolNames.includes('ask_user_questions'), true);
  assert.equal(definitions[1].localToolNames.includes('create_todos'), true);
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

test('run_subagent bounds success and failure handoffs with head previews and optional artifacts', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-subagent-result-'));
  const store = createToolResultStore({cwd: process.cwd(), rootDir});
  const text = `结论在前\n${'你'.repeat(DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES)}`;
  const createPort = (ok) => ({
    listDefinitions() { return [{name: 'explorer', description: 'Explore'}]; },
    async run() { return {ok, text}; }
  });
  const call = {callId: 'bounded', toolName: RUN_SUBAGENT_TOOL_NAME, argumentsText: '{"agent":"explorer","task":"inspect"}'};
  const success = await createToolExecutor(createToolRegistry([createRunSubagentToolHandler(createPort(true), store)])).execute(call);
  const failure = await createToolExecutor(createToolRegistry([createRunSubagentToolHandler(createPort(false))])).execute({...call, callId: 'failed'});
  const artifactPath = success.text.match(/\[tool result truncated: ([^\]]+)\]$/)?.[1];

  assert.equal(success.ok, true);
  assert.equal(success.text.startsWith('结论在前'), true);
  assert.ok(artifactPath);
  assert.equal(fs.readFileSync(artifactPath, 'utf8'), text);
  assert.ok(Buffer.byteLength(success.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  assert.equal(failure.ok, false);
  assert.match(failure.text, /Subagent result was truncated/);
  assert.ok(Buffer.byteLength(failure.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  assert.doesNotMatch(failure.text, /\uFFFD/);
});

test('run_subagent bounds unexpected Port exceptions', async () => {
  const handler = createRunSubagentToolHandler({
    listDefinitions() { return [{name: 'explorer', description: 'Explore'}]; },
    async run() { throw new Error('异常'.repeat(DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES)); }
  });
  const result = await createToolExecutor(createToolRegistry([handler])).execute({
    callId: 'exception', toolName: RUN_SUBAGENT_TOOL_NAME, argumentsText: '{"agent":"explorer","task":"inspect"}'
  });
  assert.equal(result.ok, false);
  assert.match(result.text, /^Subagent failed:/);
  assert.match(result.text, /Subagent result was truncated/);
  assert.ok(Buffer.byteLength(result.text, 'utf8') <= DEFAULT_TOOL_RESULT_MAX_OUTPUT_BYTES);
  assert.doesNotMatch(result.text, /\uFFFD/);
});
