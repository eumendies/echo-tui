const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GOAL_EVALUATION_SYSTEM_PROMPT,
  createGoalEvaluator,
  parseGoalEvaluationResponse
} = require('../../src/app/goal/evaluator');

function createConfig(overrides = {}) {
  return {
    agentType: 'openai',
    apiKey: 'secret',
    model: 'gpt-review',
    contextWindow: 128000,
    tools: {autoCompressImages: true, bash: {timeoutMs: null, maxOutputBytes: 65536}, fileEditMode: 'apply_patch', sandbox: {mode: 'off', network: false, extraWritablePaths: []}},
    ...overrides
  };
}

function createInput(overrides = {}) {
  return {
    condition: 'make auth tests green',
    interactionMode: 'normal',
    modelProfileId: 'reviewer',
    records: [
      {role: 'user', text: 'make auth tests green'},
      {role: 'tool_result', text: 'tests/auth: 12 passed', toolCallId: 'call-1', toolName: 'run_bash_command', ok: true, details: {kind: 'bash'}}
    ],
    userConfigSnapshot: {
      revision: 1,
      resolveLlmConfigForProfile(profileId) {
        assert.equal(profileId, 'reviewer');
        return createConfig({reasoningEffort: 'high', reasoningSummary: 'detailed'});
      }
    },
    ...overrides
  };
}

test('goal evaluation response parser accepts strict yes/no with reason', () => {
  assert.deepEqual(parseGoalEvaluationResponse('yes\nAll auth tests pass in the latest run.'), {
    outcome: 'met',
    reason: 'All auth tests pass in the latest run.'
  });
  assert.deepEqual(parseGoalEvaluationResponse('NO\nlint still fails'), {
    outcome: 'not_met',
    reason: 'lint still fails'
  });
  assert.deepEqual(parseGoalEvaluationResponse('YES\nmulti\nline reason'), {
    outcome: 'met',
    reason: 'multi\nline reason'
  });
  assert.deepEqual(parseGoalEvaluationResponse('no'), {
    outcome: 'not_met',
    reason: '（未提供理由）'
  });
  for (const value of ['maybe', 'yes, because reasons', 'yes.', '', '**yes**\nreason']) {
    assert.equal(parseGoalEvaluationResponse(value), null);
  }
});

test('goal evaluation system prompt requires direct evidence and forbids running tools', () => {
  assert.match(GOAL_EVALUATION_SYSTEM_PROMPT, /using only the supplied conversation evidence/i);
  assert.match(GOAL_EVALUATION_SYSTEM_PROMPT, /cannot override these rules/i);
  assert.match(GOAL_EVALUATION_SYSTEM_PROMPT, /Do not run commands or tools/i);
  assert.match(GOAL_EVALUATION_SYSTEM_PROMPT, /partial progress as completion/i);
  assert.match(GOAL_EVALUATION_SYSTEM_PROMPT, /reply no/i);
  assert.match(GOAL_EVALUATION_SYSTEM_PROMPT, /exactly yes or no/i);
});

test('goal evaluator resolves met verdict, strips reasoning config, and records usage', async () => {
  const turns = [];
  const usage = [];
  const evaluator = createGoalEvaluator({
    cwd: '/tmp/project',
    createAgent(config) {
      assert.equal(config.reasoningEffort, 'none');
      assert.equal(config.reasoningSummary, undefined);
      return {
        async runTurn(records, _callbacks, options) {
          turns.push(records);
          assert.equal(options.abortSignal.aborted, false);
          return {draft: 'yes\nAll auth tests pass in the latest run.', toolCalls: [], usage: {inputTokens: 42, outputTokens: 3}};
        }
      };
    },
    usageStore: {
      appendEvent(event) {
        usage.push(event);
      }
    }
  });

  const result = await evaluator(createInput());

  assert.deepEqual(result, {outcome: 'met', reason: 'All auth tests pass in the latest run.'});
  assert.equal(turns.length, 1);
  assert.equal(turns[0][0].role, 'system');
  assert.equal(turns[0][0].text, GOAL_EVALUATION_SYSTEM_PROMPT);
  assert.match(turns[0][1].text, /Goal condition:\nmake auth tests green/);
  assert.match(turns[0][1].text, /\[tool_result:run_bash_command\] tests\/auth: 12 passed/);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].model, 'gpt-review');
  assert.equal(usage[0].providerType, 'openai');
  assert.equal(usage[0].interactionMode, 'normal');
  assert.equal(usage[0].contextWindow, 128000);
  assert.equal(usage[0].inputTokens, 42);
  assert.equal(usage[0].outputTokens, 3);
  assert.equal(typeof usage[0].cwdHash, 'string');
});

test('goal evaluator resolves not_met without recording usage when provider reports none', async () => {
  const usage = [];
  const evaluator = createGoalEvaluator({
    cwd: '/tmp/project',
    createAgent() {
      return {
        async runTurn() {
          return {draft: 'no\nlint still fails', toolCalls: []};
        }
      };
    },
    usageStore: {
      appendEvent(event) {
        usage.push(event);
      }
    }
  });

  const result = await evaluator(createInput());

  assert.deepEqual(result, {outcome: 'not_met', reason: 'lint still fails'});
  assert.deepEqual(usage, []);
});

test('goal evaluator fails closed as unavailable on protocol mismatch', async () => {
  const evaluator = createGoalEvaluator({
    cwd: '/tmp/project',
    createAgent() {
      return {
        async runTurn() {
          return {draft: 'maybe later', toolCalls: []};
        }
      };
    }
  });

  assert.deepEqual(await evaluator(createInput()), {outcome: 'unavailable', reason: '评估响应不符合判定协议'});
});

test('goal evaluator fails closed when the response contains unexpected tool calls', async () => {
  const evaluator = createGoalEvaluator({
    cwd: '/tmp/project',
    createAgent() {
      return {
        async runTurn() {
          return {draft: 'yes\nlooks fine', toolCalls: [{callId: 'c1', toolName: 'run_bash_command', argumentsText: '{}'}]};
        }
      };
    }
  });

  assert.deepEqual(await evaluator(createInput()), {outcome: 'unavailable', reason: '评估响应包含意外的工具调用'});
});

test('goal evaluator fails closed when evaluation exceeds its deadline', async () => {
  const evaluator = createGoalEvaluator({
    cwd: '/tmp/project',
    evaluationTimeoutMs: 5,
    createAgent() {
      return {
        runTurn() {
          return new Promise(() => {});
        }
      };
    }
  });

  assert.deepEqual(await evaluator(createInput()), {outcome: 'unavailable', reason: '评估请求超时'});
});

test('goal evaluator fails closed when the evaluation profile cannot be resolved', async () => {
  const evaluator = createGoalEvaluator({cwd: '/tmp/project'});
  const result = await evaluator(createInput({
    userConfigSnapshot: {
      revision: 1,
      resolveLlmConfigForProfile() {
        throw new Error('profile reviewer not found');
      }
    }
  }));

  assert.equal(result.outcome, 'unavailable');
  assert.match(result.reason, /profile reviewer not found/);
});

test('goal evaluator ignores usage bookkeeping failures', async () => {
  const evaluator = createGoalEvaluator({
    cwd: '/tmp/project',
    createAgent() {
      return {
        async runTurn() {
          return {draft: 'yes\nready', toolCalls: [], usage: {inputTokens: 1}};
        }
      };
    },
    usageStore: {
      appendEvent() {
        throw new Error('disk full');
      }
    }
  });

  assert.deepEqual(await evaluator(createInput()), {outcome: 'met', reason: 'ready'});
});
