const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentSetupModule = require('../../src/agent/agent-setup');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {createObservation} = require('../../src/observation/observation-projector');
const {AgentAbortError} = require('../../src/types/agent');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');
const {createToolCallTranscriptRecord, createToolResultTranscriptRecord} = require('../../src/tools/tool-transcript-record');
const {createMcpToolRegistry, mergeToolRegistries} = require('../../src/mcp/tool-adapter');
const {createAskUserQuestionsSuccessResult} = require('../../src/tools/ask-user-questions-tool-handler');

const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake-subagent',
  contextWindow: 128000,
  tools: {
    bash: {timeoutMs: 1000, maxOutputBytes: 4096}
  }
};

function createConfigSnapshot() {
  return {
    revision: 7,
    getAppSettings() {
      return {
        agentInstructionFileName: 'AGENTS.md',
        compactionThresholdRatio: 0.8,
        skillCatalogContextRatio: 0.02,
        toolApprovalMode: 'manual'
      };
    },
    resolveLlmConfig() {
      return TEST_CONFIG;
    },
    resolveLlmConfigForProfile() {
      return TEST_CONFIG;
    }
  };
}

async function withPatchedAgents(cwd, createAgent, callback) {
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const preparations = [];
  agentSetupModule.prepareAgent = (options) => {
    const localRegistry = createDefaultToolRegistry(TEST_CONFIG, cwd, undefined, {
      allowedToolNames: options.allowedToolNames,
      subagentPort: options.subagentPort
    });
    const registry = options.mcpManager
      ? mergeToolRegistries(localRegistry, createMcpToolRegistry(options.mcpManager))
      : localRegistry;
    const kind = options.allowedToolNames ? 'subagent' : 'primary';
    preparations.push({kind, options, registry});
    return {agent: createAgent(kind, registry, preparations), config: TEST_CONFIG, registry};
  };

  try {
    return await callback(preparations);
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
  }
}

test('runtime synchronously delegates through an isolated explorer and commits process before the outer pair', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-subagent-runtime-'));
  fs.writeFileSync(path.join(cwd, 'evidence.txt'), 'isolated evidence\n', 'utf8');
  const parentRequests = [];
  const childRequests = [];
  const hookEvents = [];
  let parentTurn = 0;
  let childTurn = 0;

  try {
    await withPatchedAgents(cwd, (kind, registry) => ({
      async runTurn(records, callbacks) {
        if (kind === 'primary') {
          parentRequests.push(records);
          parentTurn += 1;
          if (parentTurn === 1) {
            assert.ok(registry.getHandler('run_subagent'));
            fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'changed after parent initialization', 'utf8');
            return {
              draft: '',
              toolCalls: [{callId: 'outer_1', toolName: 'run_subagent', argumentsText: JSON.stringify({agent: 'explorer', task: 'find isolated evidence'})}]
            };
          }
          return {draft: 'parent continued', toolCalls: []};
        }

        childRequests.push(records);
        childTurn += 1;
        const names = new Set(registry.listDefinitions().map((definition) => definition.name));
        assert.deepEqual(names, new Set(['read_files', 'glob', 'grep', 'run_bash_command', 'web_fetch', 'web_search', 'use_skill']));
        assert.equal(registry.getHandler('run_subagent'), undefined);
        assert.equal(registry.getHandler('apply_patch'), undefined);
        if (childTurn === 1) {
          assert.match(records[0].text, /Explorer Subagent/);
          assert.match(records[0].text, /Omit search narration, redundant excerpts/u);
          assert.match(records[0].text, /stable parent instructions/);
          assert.doesNotMatch(records[0].text, /changed after parent initialization/);
          assert.equal(records.some((record) => record.text.includes('parent-only secret')), false);
          assert.equal(records.filter((record) => record.role === 'user').at(-1).text, 'find isolated evidence');
          callbacks?.onReasoningUpdate?.({kind: 'complete', text: 'Need direct file evidence.'});
          return {
            draft: '',
            toolCalls: [{
              callId: 'inner_read',
              toolName: 'read_files',
              argumentsText: JSON.stringify({files: [{path: 'evidence.txt'}]})
            }]
          };
        }
        assert.ok(records.some((record) => record.role === 'tool_result' && record.toolCallId === 'inner_read'));
        return {draft: 'Found `evidence.txt` with isolated evidence.', toolCalls: []};
      }
    }), async (preparations) => {
      fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'stable parent instructions', 'utf8');
      const snapshot = createConfigSnapshot();
      const observation = createObservation(undefined, {emit(event, payload) { hookEvents.push({event, payload}); }});
      const runAgent = createAgentLoopRuntime(cwd, {capture: () => snapshot}, undefined, observation);
      const persisted = [];
      let pendingOuterCall = null;
      let finalText = '';
      const result = await runAgent({
        records: [{role: 'user', text: 'parent-only secret'}],
        userConfigSnapshot: snapshot
      }, {
        onToolCall(call) {
          pendingOuterCall = call;
        },
        onSubagentRecords(records) {
          persisted.push(...records);
        },
        onToolResult(toolResult) {
          persisted.push(createToolCallTranscriptRecord(pendingOuterCall), createToolResultTranscriptRecord(toolResult));
          pendingOuterCall = null;
        },
        onComplete(text) {
          finalText = text;
        }
      });

      assert.equal(result, 'parent continued');
      assert.equal(finalText, 'parent continued');
      assert.equal(preparations.filter((entry) => entry.kind === 'subagent').length, 1);
      assert.deepEqual(persisted.slice(-2).map((record) => record.role), ['tool_call', 'tool_result']);
      const failedSubagentRecord = persisted.find((record) => record.role === 'subagent' && record.event.kind === 'failed');
      assert.equal(failedSubagentRecord, undefined, failedSubagentRecord?.text);
      const innerReadResult = persisted.find((record) => record.role === 'subagent' && record.event.kind === 'tool_result');
      assert.match(innerReadResult.text, /isolated evidence/);
      assert.deepEqual(persisted.filter((record) => record.role === 'subagent').map((record) => record.event.kind), [
        'start',
        'reasoning_summary',
        'tool_call',
        'tool_result',
        'assistant',
        'completed'
      ]);
      assert.equal(persisted.find((record) => record.role === 'subagent' && record.event.kind === 'completed').text, '');
      assert.equal(persisted.filter((record) => record.text === 'Found `evidence.txt` with isolated evidence.').length, 2);
      assert.equal(persisted.at(-1).text, 'Found `evidence.txt` with isolated evidence.');
      assert.equal(parentRequests[1].some((record) => record.role === 'subagent'), false);
      assert.ok(parentRequests[1].some((record) => record.role === 'tool_call' && record.toolName === 'run_subagent'));
      assert.ok(parentRequests[1].some((record) => record.role === 'tool_result' && record.text.includes('Found `evidence.txt`')));
      assert.equal(childRequests.length, 2);
      const outerStart = hookEvents.find((event) => event.event === 'tool_call_start' && event.payload.toolCallId === 'outer_1');
      const innerStart = hookEvents.find((event) => event.event === 'tool_call_start' && event.payload.toolCallId === 'inner_read');
      const innerEnd = hookEvents.find((event) => event.event === 'tool_call_end' && event.payload.toolCallId === 'inner_read');
      assert.equal(outerStart.payload.conversationKind, 'primary');
      assert.equal(Object.hasOwn(outerStart.payload, 'agentName'), false);
      assert.equal(innerStart.payload.conversationKind, 'subagent');
      assert.equal(innerStart.payload.agentName, 'explorer');
      assert.equal(innerEnd.payload.conversationKind, 'subagent');
      assert.equal(innerEnd.payload.agentName, 'explorer');
      assert.equal(Object.hasOwn(innerStart.payload, 'runId'), false);
      assert.equal(Object.hasOwn(innerStart.payload, 'parentToolCallId'), false);
    });
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('runtime enforces four delegations per parent run and normalizes the fifth as a tool failure', async () => {
  const snapshot = createConfigSnapshot();
  let parentTurn = 0;
  let childRuns = 0;
  let outerResults = [];

  await withPatchedAgents('/tmp/echo-subagent-budget', (kind) => ({
    async runTurn(records) {
      if (kind === 'subagent') {
        childRuns += 1;
        return {draft: `child ${childRuns}`, toolCalls: []};
      }
      parentTurn += 1;
      if (parentTurn === 1) {
        return {
          draft: '',
          toolCalls: Array.from({length: 5}, (_, index) => ({
            callId: `outer_${index}`,
            toolName: 'run_subagent',
            argumentsText: JSON.stringify({agent: 'explorer', task: `task ${index}`})
          }))
        };
      }
      outerResults = records.filter((record) => record.role === 'tool_result' && record.toolName === 'run_subagent');
      return {draft: 'done', toolCalls: []};
    }
  }), async () => {
    const runAgent = createAgentLoopRuntime('/tmp/echo-subagent-budget', {capture: () => snapshot});
    await runAgent({records: [{role: 'user', text: 'delegate five'}], userConfigSnapshot: snapshot});
  });

  assert.equal(childRuns, 4);
  assert.equal(outerResults.length, 5);
  assert.equal(outerResults.slice(0, 4).every((record) => record.ok), true);
  assert.equal(outerResults[4].ok, false);
  assert.match(outerResults[4].text, /Delegation limit reached/);
});

test('runtime creates a fresh loop runtime for every accepted delegation', async () => {
  const snapshot = createConfigSnapshot();
  let parentTurn = 0;
  const childAgents = [];
  const debugEvents = [];
  const debug = {
    enabled: true,
    logPath: '/tmp/subagent-debug.jsonl',
    emit(event, payload) {
      debugEvents.push({event, payload});
    },
    close() {}
  };

  await withPatchedAgents('/tmp/echo-subagent-runtime-instances', (kind) => {
    if (kind === 'subagent') {
      const instance = {turns: 0};
      childAgents.push(instance);
      return {
        async runTurn() {
          instance.turns += 1;
          return {draft: `child runtime ${childAgents.length}`, toolCalls: []};
        }
      };
    }

    return {
      async runTurn(records) {
        parentTurn += 1;
        if (parentTurn === 1) {
          return {
            draft: '',
            toolCalls: [
              {callId: 'outer-a', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"first"}'},
              {callId: 'outer-b', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"second"}'}
            ]
          };
        }
        assert.equal(records.filter((record) => record.role === 'tool_result' && record.toolName === 'run_subagent').length, 2);
        return {draft: 'parent done', toolCalls: []};
      }
    };
  }, async (preparations) => {
    const observation = createObservation(debug);
    const runAgent = createAgentLoopRuntime('/tmp/echo-subagent-runtime-instances', {capture: () => snapshot}, undefined, observation);
    assert.equal(await runAgent({records: [{role: 'user', text: 'delegate twice'}], userConfigSnapshot: snapshot}), 'parent done');
    assert.equal(preparations.filter((entry) => entry.kind === 'subagent').length, 2);
  });

  assert.equal(childAgents.length, 2);
  assert.notEqual(childAgents[0], childAgents[1]);
  assert.deepEqual(childAgents.map((agent) => agent.turns), [1, 1]);
  const childRequestEvents = debugEvents.filter((event) => event.event === 'provider_request_built' && event.payload.conversationKind === 'subagent');
  assert.equal(childRequestEvents.length, 2);
  assert.equal(new Set(childRequestEvents.map((event) => event.payload.runId)).size, 2);
  assert.equal(childRequestEvents.every((event) => event.payload.agentName === 'explorer'), true);
  assert.deepEqual(new Set(childRequestEvents.map((event) => event.payload.parentToolCallId)), new Set(['outer-a', 'outer-b']));
});

test('parent abort propagates to the child provider and leaves no outer tool pair', async () => {
  const snapshot = createConfigSnapshot();
  const controller = new AbortController();
  const processEvents = [];
  let outerResults = 0;
  let childSignal;

  await withPatchedAgents('/tmp/echo-subagent-abort', (kind) => ({
    async runTurn(_records, _callbacks, options) {
      if (kind === 'primary') {
        return {draft: '', toolCalls: [{callId: 'outer-abort', toolName: 'run_subagent', argumentsText: '{"agent":"explorer","task":"wait"}'}]};
      }
      childSignal = options.abortSignal;
      return new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener('abort', () => reject(new AgentAbortError()), {once: true});
      });
    }
  }), async () => {
    const runAgent = createAgentLoopRuntime('/tmp/echo-subagent-abort', {capture: () => snapshot});
    const running = runAgent({
      records: [{role: 'user', text: 'delegate'}],
      abortSignal: controller.signal,
      userConfigSnapshot: snapshot
    }, {
      onSubagentRecords(records) {
        processEvents.push(...records.map((record) => record.event.kind));
      },
      onToolResult() {
        outerResults += 1;
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    await assert.rejects(running, AgentAbortError);
  });

  assert.equal(childSignal.aborted, true);
  assert.deepEqual(processEvents, ['start', 'cancelled']);
  assert.equal(outerResults, 0);
});

test('subagent approval-required Bash remains denied in headless full-access mode', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-subagent-headless-'));
  const snapshot = createConfigSnapshot();
  let childTurn = 0;
  let approvalRequests = 0;

  try {
    await withPatchedAgents(cwd, (kind) => ({
      async runTurn(records) {
        if (kind === 'primary') {
          const outerResult = records.find((record) => record.role === 'tool_result' && record.toolName === 'run_subagent');
          return outerResult
            ? {draft: 'parent done', toolCalls: []}
            : {draft: '', toolCalls: [{callId: 'outer_bash', toolName: 'run_subagent', argumentsText: JSON.stringify({agent: 'explorer', task: 'inspect with script'})}]};
        }

        childTurn += 1;
        if (childTurn === 1) {
          return {
            draft: '',
            toolCalls: [{
              callId: 'inner_bash',
              toolName: 'run_bash_command',
              argumentsText: JSON.stringify({command: 'printf changed > should-not-exist.txt'})
            }]
          };
        }
        const denied = records.find((record) => record.role === 'tool_result' && record.toolCallId === 'inner_bash');
        assert.equal(denied.ok, false);
        assert.match(denied.text, /interactive manual approval/);
        return {draft: 'Command was not executed.', toolCalls: []};
      }
    }), async () => {
      const runAgent = createAgentLoopRuntime(cwd, {capture: () => snapshot});
      await runAgent({
        records: [{role: 'user', text: 'delegate bash'}],
        executionMode: {kind: 'headless', approvalPolicy: 'full-access'},
        userConfigSnapshot: snapshot
      }, {
        onToolApprovalRequest() {
          approvalRequests += 1;
          return {kind: 'allow_once'};
        }
      });
    });

    assert.equal(approvalRequests, 0);
    assert.equal(fs.existsSync(path.join(cwd, 'should-not-exist.txt')), false);
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('Worker receives the full local registry, keeps Todo local, and rejects forged nested delegation', async () => {
  const snapshot = createConfigSnapshot();
  let parentTurn = 0;
  let childTurn = 0;
  let parentTodoUpdates = 0;
  const processRecords = [];

  await withPatchedAgents('/tmp/echo-worker-todo', (kind, registry) => ({
    async runTurn(records) {
      if (kind === 'primary') {
        parentTurn += 1;
        if (parentTurn === 1) {
          return {draft: '', toolCalls: [{callId: 'worker-outer', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"implement isolated task"}'}]};
        }
        assert.ok(records.some((record) => record.role === 'tool_result' && record.toolCallId === 'worker-outer' && record.ok));
        return {draft: 'parent done', toolCalls: []};
      }

      childTurn += 1;
      const names = new Set(registry.listDefinitions().map((definition) => definition.name));
      assert.deepEqual(names, new Set([
        'apply_patch', 'ask_user_questions', 'complete_todo', 'create_todos', 'glob', 'grep',
        'read_files', 'run_bash_command', 'use_skill', 'web_fetch', 'web_search'
      ]));
      assert.equal(registry.getHandler('run_subagent'), undefined);
      if (childTurn === 1) {
        assert.match(records[0].text, /Worker Subagent/u);
        assert.doesNotMatch(records[0].text, /parent todo/u);
        return {draft: '', toolCalls: [{callId: 'worker-todos', toolName: 'create_todos', argumentsText: '{"items":["local worker todo"]}'}]};
      }
      if (childTurn === 2) {
        assert.ok(records.some((record) => record.text.includes('[todo_1] local worker todo')));
        return {draft: '', toolCalls: [{callId: 'worker-complete', toolName: 'complete_todo', argumentsText: '{"ids":["todo_1"]}'}]};
      }
      if (childTurn === 3) {
        assert.equal(records.some((record) => record.text.includes('[todo_1] local worker todo') && record.text.includes('## Todos')), false);
        return {draft: '', toolCalls: [{callId: 'nested', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"nested"}'}]};
      }
      const nested = records.find((record) => record.role === 'tool_result' && record.toolCallId === 'nested');
      assert.equal(nested.ok, false);
      assert.match(nested.text, /Unknown tool: run_subagent/u);
      return {draft: 'worker done', toolCalls: []};
    }
  }), async () => {
    const runAgent = createAgentLoopRuntime('/tmp/echo-worker-todo', {capture: () => snapshot});
    assert.equal(await runAgent({
      records: [{role: 'user', text: 'delegate worker'}],
      todoState: {updatedAt: 'now', items: [{id: 'parent', text: 'parent todo', status: 'open'}]},
      userConfigSnapshot: snapshot
    }, {
      onSubagentRecords(records) { processRecords.push(...records); },
      onTodoStateChange() { parentTodoUpdates += 1; }
    }), 'parent done');
  });

  assert.equal(parentTodoUpdates, 0);
  assert.equal(childTurn, 4);
  assert.deepEqual(processRecords.filter((record) => record.event.kind === 'tool_call').map((record) => record.event.toolName), [
    'create_todos', 'complete_todo', 'run_subagent'
  ]);
});

test('Worker reuses initialized MCP tools without owning the manager lifecycle', async () => {
  const snapshot = createConfigSnapshot();
  let parentTurn = 0;
  let childTurn = 0;
  let calls = 0;
  let closes = 0;
  let approval;
  const manager = {
    listTools() {
      return [{serverName: 'docs', toolName: 'write', namespacedName: 'mcp__docs__write', approval: 'always', description: 'write docs', inputSchema: {type: 'object'}}];
    },
    getToolReference(name) {
      return name === 'mcp__docs__write' ? this.listTools()[0] : null;
    },
    async callTool(serverName, toolName, args) {
      calls += 1;
      assert.deepEqual({serverName, toolName, args}, {serverName: 'docs', toolName: 'write', args: {id: 1}});
      return {content: [{type: 'text', text: 'mcp wrote docs'}]};
    },
    async close() { closes += 1; }
  };

  await withPatchedAgents('/tmp/echo-worker-mcp', (kind, registry) => ({
    async runTurn(records) {
      if (kind === 'primary') {
        parentTurn += 1;
        return parentTurn === 1
          ? {draft: '', toolCalls: [{callId: 'worker-mcp', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"write docs"}'}]}
          : {draft: 'parent done', toolCalls: []};
      }
      childTurn += 1;
      assert.ok(registry.getHandler('mcp__docs__write'));
      assert.equal(registry.getHandler('run_subagent'), undefined);
      if (childTurn === 1) {
        return {draft: '', toolCalls: [{callId: 'inner-mcp', toolName: 'mcp__docs__write', argumentsText: '{"id":1}'}]};
      }
      assert.match(records.find((record) => record.role === 'tool_result' && record.toolCallId === 'inner-mcp').text, /mcp wrote docs/u);
      return {draft: 'worker mcp done', toolCalls: []};
    }
  }), async () => {
    const runAgent = createAgentLoopRuntime('/tmp/echo-worker-mcp', {capture: () => snapshot}, manager);
    assert.equal(await runAgent({records: [{role: 'user', text: 'delegate'}], userConfigSnapshot: snapshot}, {
      onToolApprovalRequest(_call, request) {
        approval = request;
        return {kind: 'allow_once'};
      }
    }), 'parent done');
  });

  assert.equal(calls, 1);
  assert.equal(closes, 0);
  assert.equal(approval.origin.agentName, 'worker');
  assert.equal(approval.previewTitle, 'mcp tool');
});

test('normal Worker uses shared approval callbacks with Worker origin', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-worker-approval-'));
  const snapshot = createConfigSnapshot();
  const delegatedTask = `write approved file ${'x'.repeat(2_500)} task-tail`;
  let parentTurn = 0;
  let childTurn = 0;
  let approval;
  let invalidations = 0;
  try {
    await withPatchedAgents(cwd, (kind) => ({
      async runTurn(records) {
        if (kind === 'primary') {
          parentTurn += 1;
          return parentTurn === 1
            ? {draft: '', toolCalls: [{callId: 'worker-write', toolName: 'run_subagent', argumentsText: JSON.stringify({agent: 'worker', task: delegatedTask})}]}
            : {draft: 'parent done', toolCalls: []};
        }
        childTurn += 1;
        if (childTurn === 1) {
          return {draft: '', toolCalls: [{callId: 'inner-write', toolName: 'run_bash_command', argumentsText: '{"command":"printf worker > approved.txt"}'}]};
        }
        assert.equal(records.find((record) => record.role === 'tool_result' && record.toolCallId === 'inner-write').ok, true);
        return {draft: 'worker wrote file', toolCalls: []};
      }
    }), async () => {
      const runAgent = createAgentLoopRuntime(cwd, {capture: () => snapshot});
      await runAgent({records: [{role: 'user', text: 'delegate'}], userConfigSnapshot: snapshot}, {
        changeRecorder: {
          captureFileBefore() {},
          captureFileAfter() {},
          invalidate() { invalidations += 1; }
        },
        onToolApprovalRequest(_call, request) {
          approval = request;
          return {kind: 'allow_once'};
        }
      });
    });
    assert.equal(fs.readFileSync(path.join(cwd, 'approved.txt'), 'utf8'), 'worker');
    assert.equal(approval.origin.agentName, 'worker');
    assert.equal(approval.origin.task, delegatedTask);
    assert.equal(invalidations, 1);
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('Worker plan and headless policies match the parent general-purpose boundary', async () => {
  for (const scenario of [
    {name: 'plan', interactionMode: 'plan', executionMode: {kind: 'interactive'}, expectedOk: false},
    {name: 'deny', interactionMode: 'normal', executionMode: {kind: 'headless', approvalPolicy: 'deny'}, expectedOk: false},
    {name: 'full', interactionMode: 'normal', executionMode: {kind: 'headless', approvalPolicy: 'full-access'}, expectedOk: true}
  ]) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `echo-worker-${scenario.name}-`));
    const snapshot = createConfigSnapshot();
    let parentTurn = 0;
    let childTurn = 0;
    try {
      await withPatchedAgents(cwd, (kind) => ({
        async runTurn(records) {
          if (kind === 'primary') {
            parentTurn += 1;
            return parentTurn === 1
              ? {draft: '', toolCalls: [{callId: `outer-${scenario.name}`, toolName: 'run_subagent', argumentsText: `{"agent":"worker","task":"${scenario.name} write"}`}]}
              : {draft: 'parent done', toolCalls: []};
          }
          childTurn += 1;
          if (childTurn === 1) {
            return {draft: '', toolCalls: [{callId: `inner-${scenario.name}`, toolName: 'run_bash_command', argumentsText: `{"command":"printf ${scenario.name} > result.txt"}`}]};
          }
          assert.equal(records.find((record) => record.role === 'tool_result' && record.toolCallId === `inner-${scenario.name}`).ok, scenario.expectedOk);
          return {draft: 'worker policy done', toolCalls: []};
        }
      }), async () => {
        const runAgent = createAgentLoopRuntime(cwd, {capture: () => snapshot});
        await runAgent({
          records: [{role: 'user', text: 'delegate'}], interactionMode: scenario.interactionMode,
          executionMode: scenario.executionMode, userConfigSnapshot: snapshot
        }, {onToolApprovalRequest() { throw new Error('headless/plan must not request interactive approval'); }});
      });
      assert.equal(fs.existsSync(path.join(cwd, 'result.txt')), scenario.expectedOk);
    } finally {
      fs.rmSync(cwd, {recursive: true, force: true});
    }
  }
});

test('Worker asks through the run-aware callback while headless returns cancellation', async () => {
  for (const headless of [false, true]) {
    const snapshot = createConfigSnapshot();
    let parentTurn = 0;
    let childTurn = 0;
    let questions = 0;
    const activities = [];
    const records = [];
    await withPatchedAgents(`/tmp/echo-worker-question-${headless}`, (kind) => ({
      async runTurn(providerRecords) {
        if (kind === 'primary') {
          parentTurn += 1;
          return parentTurn === 1
            ? {draft: '', toolCalls: [{callId: 'outer-question', toolName: 'run_subagent', argumentsText: '{"agent":"worker","task":"ask when necessary"}'}]}
            : {draft: 'parent done', toolCalls: []};
        }
        childTurn += 1;
        if (childTurn === 1) {
          return {draft: '', toolCalls: [{callId: 'inner-question', toolName: 'ask_user_questions', argumentsText: '{"questions":[{"question":"Choose?","options":[{"label":"A"},{"label":"B"}]}]}'}]};
        }
        const result = providerRecords.find((record) => record.role === 'tool_result' && record.toolCallId === 'inner-question');
        assert.equal(result.ok, !headless);
        assert.match(result.text, headless ? /cancelled/u : /"selected":"A"/u);
        return {draft: 'worker question done', toolCalls: []};
      }
    }), async () => {
      const runAgent = createAgentLoopRuntime(`/tmp/echo-worker-question-${headless}`, {capture: () => snapshot});
      await runAgent({
        records: [{role: 'user', text: 'delegate'}], userConfigSnapshot: snapshot,
        ...(headless ? {executionMode: {kind: 'headless', approvalPolicy: 'deny'}} : {})
      }, {
        onSubagentActivity(activity) { if (activity) activities.push(activity); },
        onSubagentRecords(batch) { records.push(...batch); },
        onSubagentUserQuestionRequest(metadata, call, request) {
          questions += 1;
          assert.equal(metadata.agentName, 'worker');
          return createAskUserQuestionsSuccessResult(call, [{question: request.questions[0].question, selectedOption: request.questions[0].options[0]}]);
        }
      });
    });
    assert.equal(questions, headless ? 0 : 1);
    assert.equal(activities.some((activity) => activity.phase === 'waiting_question'), !headless);
    assert.equal(records.some((record) => record.event.kind === 'tool_result' && record.event.toolName === 'ask_user_questions'), true);
  }
});
