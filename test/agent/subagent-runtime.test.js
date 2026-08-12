const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const agentSetupModule = require('../../src/agent/agent-setup');
const {createAgentLoopRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {AgentAbortError} = require('../../src/types/agent');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');
const {createToolCallTranscriptRecord, createToolResultTranscriptRecord} = require('../../src/tools/tool-transcript-record');

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
    const registry = createDefaultToolRegistry(TEST_CONFIG, cwd, undefined, {
      allowedToolNames: options.allowedToolNames,
      subagentPort: options.subagentPort
    });
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
      const runAgent = createAgentLoopRuntime(cwd, {capture: () => snapshot});
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
    const runAgent = createAgentLoopRuntime('/tmp/echo-subagent-runtime-instances', {capture: () => snapshot});
    assert.equal(await runAgent({records: [{role: 'user', text: 'delegate twice'}], userConfigSnapshot: snapshot}), 'parent done');
    assert.equal(preparations.filter((entry) => entry.kind === 'subagent').length, 2);
  });

  assert.equal(childAgents.length, 2);
  assert.notEqual(childAgents[0], childAgents[1]);
  assert.deepEqual(childAgents.map((agent) => agent.turns), [1, 1]);
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
