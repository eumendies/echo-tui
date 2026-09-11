const test = require('node:test');
const assert = require('node:assert/strict');

const {MISSING_GOAL_EVALUATION_MODEL_ERROR, createGoalController} = require('../../src/app/goal/goal-controller');

function flushAsync() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createActiveGoal(overrides = {}) {
  return {
    condition: 'make tests green',
    status: 'active',
    revision: 1,
    startedAt: '2026-05-19T00:00:01.000Z',
    turns: 0,
    maxTurns: 20,
    ...overrides
  };
}

test('goalController exposes evaluation activity only while the evaluator request is pending', async () => {
  let resolveEvaluation;
  const {controller} = createHarness({
    goalState: createActiveGoal({turns: 1}),
    canStartContinuation: () => true,
    evaluator: () => new Promise((resolve) => {
      resolveEvaluation = resolve;
    })
  });

  assert.equal(controller.getEvaluationActivity(), null);
  controller.handleTurnFinished('completed');
  await flushAsync();

  const activity = controller.getEvaluationActivity();
  assert.notEqual(activity, null);
  assert.ok(activity.elapsedMs >= 0);

  resolveEvaluation({outcome: 'met', reason: 'green'});
  await flushAsync();

  assert.equal(controller.getEvaluationActivity(), null);
});

function createHarness(options = {}) {
  const calls = {
    appendedRecords: [],
    continuationRequests: [],
    evaluationInputs: [],
    order: [],
    renderedBatches: []
  };
  const evaluations = [...(options.evaluations || [])];
  const continueOutcomes = [...(options.continueOutcomes || [])];
  const transcript = {
    goalState: options.goalState ? structuredClone(options.goalState) : null,
    records: options.records ? structuredClone(options.records) : [],
    setGoalState(next) {
      calls.order.push('set_goal_state');
      this.goalState = next ? structuredClone(next) : null;
    },
    getRecords() {
      return this.records;
    },
    appendRecord(record) {
      calls.order.push('append_record');
      calls.appendedRecords.push(record);
      return record;
    }
  };
  const controller = createGoalController({
    transcript,
    evaluator: async (input) => {
      calls.evaluationInputs.push(input);

      if (options.evaluator) {
        return options.evaluator(input);
      }

      return evaluations.shift() || {outcome: 'not_met', reason: 'still failing'};
    },
    captureUserConfigSnapshot: () => ({revision: 1, resolveLlmConfigForProfile: () => ({})}),
    getGoalEvaluationModelProfileId: () => (options.profileId === undefined ? 'fast-profile' : options.profileId),
    getInteractionMode: () => 'normal',
    // 默认关闭让位检查，隔离生命周期测试；推进流程测试显式开启。
    canStartContinuation: options.canStartContinuation || (() => false),
    continueTurn: async (request) => {
      calls.continuationRequests.push(request);

      if (options.continueTurn) {
        return options.continueTurn(request);
      }

      return continueOutcomes.shift() || 'completed';
    },
    renderRecords: (records) => calls.renderedBatches.push(records)
  });

  return {calls, controller, transcript};
}

test('goalController sets an active goal and persists its notice with the state', () => {
  const {calls, controller, transcript} = createHarness();
  const result = controller.setGoal('make tests green');

  assert.deepEqual(result, {ok: true});
  assert.equal(transcript.goalState.condition, 'make tests green');
  assert.equal(transcript.goalState.status, 'active');
  assert.equal(transcript.goalState.revision, 1);
  assert.equal(transcript.goalState.turns, 0);
  assert.equal(transcript.goalState.maxTurns, 20);
  assert.match(transcript.goalState.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(calls.appendedRecords.length, 1);
  assert.equal(calls.appendedRecords[0].role, 'local_notice');
  assert.ok(calls.appendedRecords[0].text.includes('make tests green'));
  assert.ok(calls.appendedRecords[0].text.includes('20 轮'));
  assert.equal(calls.renderedBatches.length, 1);
  // 状态先于通知写入，二者随同一次 journal 持久化提交。
  assert.deepEqual(calls.order, ['set_goal_state', 'append_record']);
});

test('goalController replaces an existing goal with a fresh revision and baseline', () => {
  const {controller, transcript} = createHarness({
    goalState: {condition: 'old goal', status: 'paused', revision: 4, startedAt: '2026-05-19T00:00:01.000Z', turns: 2, maxTurns: 20}
  });

  assert.deepEqual(controller.setGoal('new goal'), {ok: true});
  assert.equal(transcript.goalState.condition, 'new goal');
  assert.equal(transcript.goalState.revision, 5);
  assert.equal(transcript.goalState.status, 'active');
  assert.equal(transcript.goalState.turns, 0);
});

test('goalController rejects invalid conditions and missing evaluator model', () => {
  const harness = createHarness();
  assert.deepEqual(harness.controller.setGoal('   '), {ok: false, error: '目标条件不能为空'});
  assert.deepEqual(harness.controller.setGoal('x'.repeat(4001)), {ok: false, error: '目标条件不能超过 4000 字符'});

  const withoutProfile = createHarness({profileId: null});
  assert.deepEqual(withoutProfile.controller.setGoal('anything'), {ok: false, error: MISSING_GOAL_EVALUATION_MODEL_ERROR});
  assert.equal(withoutProfile.transcript.goalState, null);
  assert.deepEqual(withoutProfile.calls.appendedRecords, []);
  assert.deepEqual(withoutProfile.calls.renderedBatches, []);
});

test('goalController pauses, resumes with a revision bump, and clears with notices', () => {
  const {calls, controller, transcript} = createHarness();
  controller.setGoal('keep green');
  transcript.goalState.turns = 3;

  assert.deepEqual(controller.pauseGoal(), {ok: true});
  assert.equal(transcript.goalState.status, 'paused');
  assert.equal(transcript.goalState.revision, 1);
  assert.ok(calls.appendedRecords.at(-1).text.includes('/goal resume'));

  // 已暂停时为幂等成功，不追加新通知。
  assert.deepEqual(controller.pauseGoal(), {ok: true});
  assert.equal(calls.appendedRecords.length, 2);

  assert.deepEqual(controller.resumeGoal(), {ok: true});
  assert.equal(transcript.goalState.status, 'active');
  assert.equal(transcript.goalState.revision, 2);
  assert.equal(transcript.goalState.turns, 3);
  assert.equal(calls.appendedRecords.at(-1).text, '目标已恢复：自动继续推进');

  // 已激活时为幂等成功。
  assert.deepEqual(controller.resumeGoal(), {ok: true});
  assert.equal(calls.appendedRecords.length, 3);

  assert.deepEqual(controller.clearGoal(), {ok: true});
  assert.equal(transcript.goalState, null);
  assert.ok(calls.appendedRecords.at(-1).text.includes('keep green'));
});

test('goalController reports missing goal and resume without a valid evaluator model', () => {
  const empty = createHarness();
  assert.deepEqual(empty.controller.pauseGoal(), {ok: false, error: '当前没有目标'});
  assert.deepEqual(empty.controller.resumeGoal(), {ok: false, error: '当前没有目标'});
  assert.deepEqual(empty.controller.clearGoal(), {ok: false, error: '当前没有目标'});
  assert.equal(empty.controller.getGoal(), null);

  const paused = createHarness({
    goalState: {condition: 'paused goal', status: 'paused', revision: 1, startedAt: '2026-05-19T00:00:01.000Z', turns: 0, maxTurns: 20},
    profileId: null
  });
  assert.deepEqual(paused.controller.resumeGoal(), {ok: false, error: MISSING_GOAL_EVALUATION_MODEL_ERROR});
  assert.equal(paused.transcript.goalState.status, 'paused');
});

test('goalController returns goal snapshots without aliasing stored state', () => {
  const {controller} = createHarness();
  controller.setGoal('isolate me');

  const snapshot = controller.getGoal();
  snapshot.turns = 99;
  assert.equal(controller.getGoal().turns, 0);
});

test('goalController evaluates a completed main turn and continues until met', async () => {
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluations: [
      {outcome: 'not_met', reason: 'auth spec still failing'},
      {outcome: 'met', reason: 'all auth tests pass'}
    ]
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.deepEqual(calls.continuationRequests, [
    {condition: 'make tests green', turn: 1, maxTurns: 20, previousReason: 'auth spec still failing'}
  ]);
  assert.equal(calls.evaluationInputs.length, 2);
  assert.equal(calls.evaluationInputs[0].condition, 'make tests green');
  assert.equal(calls.evaluationInputs[0].modelProfileId, 'fast-profile');
  assert.equal(calls.evaluationInputs[0].interactionMode, 'normal');
  assert.equal(transcript.goalState, null);

  const notices = calls.appendedRecords.map((record) => record.text);
  assert.ok(notices.some((text) => text.includes('未达成 — auth spec still failing')));
  assert.ok(notices.at(-1).includes('目标达成'));
  assert.ok(notices.at(-1).includes('（共 1 轮自动推进）'));
  assert.ok(notices.at(-1).includes('all auth tests pass'));
});

test('goalController starts the first continuation turn immediately after setGoal', async () => {
  const {calls, controller, transcript} = createHarness({
    canStartContinuation: () => true,
    evaluations: [{outcome: 'met', reason: 'done already'}]
  });

  controller.setGoal('ship the migration');

  // kickoff 在 setGoal 返回前同步发起第一轮推进回合。
  assert.equal(transcript.goalState.turns, 1);
  assert.deepEqual(calls.continuationRequests, [
    {condition: 'ship the migration', turn: 1, maxTurns: 20, previousReason: null}
  ]);

  await flushAsync();

  assert.equal(transcript.goalState, null);
  assert.equal(calls.evaluationInputs.length, 1);
});

test('goalController defers the first turn when the input channel is busy', () => {
  const {calls, controller, transcript} = createHarness();
  controller.setGoal('later goal');

  assert.equal(transcript.goalState.status, 'active');
  assert.equal(transcript.goalState.turns, 0);
  assert.deepEqual(calls.continuationRequests, []);
});

test('goalController pauses at the continuation limit', async () => {
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal({maxTurns: 1}),
    canStartContinuation: () => true,
    evaluations: [
      {outcome: 'not_met', reason: 'first check'},
      {outcome: 'not_met', reason: 'second check'}
    ]
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.equal(transcript.goalState.status, 'paused');
  assert.equal(transcript.goalState.turns, 1);
  assert.equal(transcript.goalState.lastEvaluation.outcome, 'not_met');
  assert.equal(transcript.goalState.lastEvaluation.reason, 'second check');
  assert.equal(calls.continuationRequests.length, 1);
  assert.ok(calls.appendedRecords.at(-1).text.includes('已达到 1 轮自动推进上限'));
});

test('goalController pauses when evaluation is unavailable', async () => {
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluations: [{outcome: 'unavailable', reason: '评估请求超时'}]
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.equal(transcript.goalState.status, 'paused');
  assert.equal(transcript.goalState.lastEvaluation.outcome, 'unavailable');
  assert.equal(transcript.goalState.lastEvaluation.reason, '评估请求超时');
  assert.deepEqual(calls.continuationRequests, []);
  assert.ok(calls.appendedRecords.at(-1).text.includes('评估不可用 — 评估请求超时'));
  assert.ok(calls.appendedRecords.at(-1).text.includes('/goal resume'));
});

test('goalController pauses when a continuation turn is cancelled or failed', async () => {
  const cancelled = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluations: [{outcome: 'not_met', reason: 'still red'}],
    continueOutcomes: ['cancelled']
  });
  cancelled.controller.handleTurnFinished('completed');
  await flushAsync();

  assert.equal(cancelled.transcript.goalState.status, 'paused');
  assert.ok(cancelled.calls.appendedRecords.at(-1).text.includes('自动推进回合被中断'));

  const failed = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluations: [{outcome: 'not_met', reason: 'still red'}],
    continueOutcomes: ['failed']
  });
  failed.controller.handleTurnFinished('completed');
  await flushAsync();

  assert.equal(failed.transcript.goalState.status, 'paused');
  assert.ok(failed.calls.appendedRecords.at(-1).text.includes('自动推进回合执行失败'));
});

test('goalController pauses when the finished main turn was interrupted or failed', () => {
  const cancelled = createHarness({goalState: createActiveGoal()});
  cancelled.controller.handleTurnFinished('cancelled');
  assert.equal(cancelled.transcript.goalState.status, 'paused');
  assert.ok(cancelled.calls.appendedRecords.at(-1).text.includes('回合已被中断'));

  const failed = createHarness({goalState: createActiveGoal()});
  failed.controller.handleTurnFinished('failed');
  assert.equal(failed.transcript.goalState.status, 'paused');
  assert.ok(failed.calls.appendedRecords.at(-1).text.includes('回合执行失败'));
});

test('goalController yields to busy input channels without evaluating', async () => {
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => false,
    evaluations: [{outcome: 'not_met', reason: 'never used'}]
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.deepEqual(calls.evaluationInputs, []);
  assert.deepEqual(calls.continuationRequests, []);
  assert.equal(transcript.goalState.status, 'active');
  assert.equal(transcript.goalState.turns, 0);
});

test('goalController ignores finished turns without an active goal', async () => {
  const {calls, controller} = createHarness();
  controller.handleTurnFinished('completed');
  await flushAsync();
  assert.deepEqual(calls.evaluationInputs, []);

  const paused = createHarness({goalState: createActiveGoal({status: 'paused'})});
  paused.controller.handleTurnFinished('completed');
  await flushAsync();
  assert.deepEqual(paused.calls.evaluationInputs, []);
});

test('goalController discards a late evaluation result after the goal is replaced', async () => {
  let resolvePending;
  let evaluationCount = 0;
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluator: () => {
      evaluationCount += 1;

      if (evaluationCount === 1) {
        return new Promise((resolve) => {
          resolvePending = resolve;
        });
      }

      return Promise.resolve({outcome: 'met', reason: 'replacement done'});
    }
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  controller.setGoal('replacement goal');
  await flushAsync();

  resolvePending({outcome: 'met', reason: 'stale result'});
  await flushAsync();

  const notices = calls.appendedRecords.map((record) => record.text);
  assert.equal(notices.some((text) => text.includes('stale result')), false);
  assert.deepEqual(calls.continuationRequests.map((request) => request.condition), ['replacement goal']);
  assert.equal(calls.continuationRequests[0].turn, 1);
  assert.equal(calls.continuationRequests[0].previousReason, null);
  assert.equal(transcript.goalState, null);
  assert.ok(notices.at(-1).includes('目标达成'));
  assert.ok(notices.at(-1).includes('replacement done'));
});

test('goalController discards a late evaluation result after the goal is paused', async () => {
  let resolvePending;
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluator: () => new Promise((resolve) => {
      resolvePending = resolve;
    })
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  controller.pauseGoal();
  resolvePending({outcome: 'met', reason: 'too late'});
  await flushAsync();

  assert.equal(transcript.goalState.status, 'paused');
  const notices = calls.appendedRecords.map((record) => record.text);
  assert.equal(notices.some((text) => text.includes('too late')), false);
  assert.equal(notices.some((text) => text.includes('目标达成')), false);
  assert.deepEqual(calls.continuationRequests, []);
});

test('goalController discards a late continuation outcome after the goal is cleared', async () => {
  let resolveTurn;
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    evaluations: [{outcome: 'not_met', reason: 'still red'}],
    continueTurn: () => new Promise((resolve) => {
      resolveTurn = resolve;
    })
  });

  controller.handleTurnFinished('completed');
  await flushAsync();
  assert.equal(calls.continuationRequests.length, 1);

  controller.clearGoal();
  resolveTurn('completed');
  await flushAsync();

  assert.equal(transcript.goalState, null);
  const notices = calls.appendedRecords.map((record) => record.text);
  assert.equal(notices.some((text) => text.includes('目标达成')), false);
  assert.equal(notices.some((text) => text.includes('目标已暂停')), false);
});

test('goalController records not_met and yields when the channel becomes busy', async () => {
  let canStart = true;
  const {calls, controller, transcript} = createHarness({
    goalState: createActiveGoal(),
    canStartContinuation: () => canStart,
    evaluator: async () => {
      canStart = false;
      return {outcome: 'not_met', reason: 'still red'};
    }
  });

  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.deepEqual(calls.continuationRequests, []);
  assert.equal(transcript.goalState.status, 'active');
  assert.equal(transcript.goalState.lastEvaluation.outcome, 'not_met');
  assert.equal(transcript.goalState.lastEvaluation.reason, 'still red');
  assert.ok(calls.appendedRecords.some((record) => record.text.includes('未达成 — still red')));
});

test('goalController projects evaluation evidence from the activation boundary', async () => {
  let canStart = false;
  const {calls, controller, transcript} = createHarness({
    records: [{role: 'user', text: 'before goal'}],
    canStartContinuation: () => canStart,
    evaluations: [{outcome: 'met', reason: 'boundary check'}]
  });

  controller.setGoal('boundary goal');
  assert.equal(transcript.goalState.turns, 0);

  transcript.records.push({role: 'assistant', text: 'after goal'});
  canStart = true;
  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.equal(calls.evaluationInputs.length, 1);
  assert.equal(calls.evaluationInputs[0].condition, 'boundary goal');
  assert.deepEqual(calls.evaluationInputs[0].records, [{role: 'assistant', text: 'after goal'}]);
});

test('goalController keeps an in-flight evaluation on its startup profile', async () => {
  let resolveEvaluation;
  const options = {
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    profileId: 'first-profile',
    evaluator: () => new Promise((resolve) => {
      resolveEvaluation = resolve;
    })
  };
  const {calls, controller} = createHarness(options);

  controller.handleTurnFinished('completed');
  await flushAsync();

  options.profileId = 'second-profile';
  resolveEvaluation({outcome: 'met', reason: 'green'});
  await flushAsync();

  assert.equal(calls.evaluationInputs.length, 1);
  assert.equal(calls.evaluationInputs[0].modelProfileId, 'first-profile');
});

test('goalController uses the refreshed evaluation profile for later evaluations', async () => {
  const options = {
    goalState: createActiveGoal(),
    canStartContinuation: () => true,
    profileId: 'first-profile',
    evaluations: [
      {outcome: 'not_met', reason: 'still red'},
      {outcome: 'met', reason: 'green'}
    ],
    continueTurn: () => {
      options.profileId = 'second-profile';
      return 'completed';
    }
  };
  const {calls, controller} = createHarness(options);

  controller.handleTurnFinished('completed');
  await flushAsync();

  assert.deepEqual(calls.evaluationInputs.map((input) => input.modelProfileId), ['first-profile', 'second-profile']);
});
