const test = require('node:test');
const assert = require('node:assert/strict');

const {GoalCommandHandler, formatGoalElapsed} = require('../../src/commands/goal-command-handler');
const {INPUT_EVENTS} = require('../../src/input/event-types');

function createFakeHost(options = {}) {
  const calls = {
    setGoals: [],
    pauseCalls: 0,
    resumeCalls: 0,
    clearCalls: 0,
    sessionOpens: [],
    sessionCloses: 0
  };
  let activeSession = null;

  const host = {
    goal: {
      getGoal() {
        return options.goal ? structuredClone(options.goal) : null;
      },
      setGoal(condition) {
        calls.setGoals.push(condition);
        return options.setGoalResult || {ok: true};
      },
      pauseGoal() {
        calls.pauseCalls += 1;
        return options.pauseResult || {ok: true};
      },
      resumeGoal() {
        calls.resumeCalls += 1;
        return options.resumeResult || {ok: true};
      },
      clearGoal() {
        calls.clearCalls += 1;
        return options.clearResult || {ok: true};
      }
    },
    session: {
      open(session) {
        activeSession = session;
        calls.sessionOpens.push(session);
      },
      update() {},
      close() {
        activeSession = null;
        calls.sessionCloses += 1;
      },
      getActive() {
        return activeSession;
      }
    }
  };

  return {calls, host};
}

function startCommand(handler, text, host) {
  handler.start(text, host);
  return host.session.getActive();
}

test('goalCommandHandler matches only the /goal command form', () => {
  const handler = new GoalCommandHandler();

  assert.equal(handler.match('/goal'), true);
  assert.equal(handler.match('/goal '), true);
  assert.equal(handler.match('/goal make tests green'), true);
  assert.equal(handler.match('/goals'), false);
  assert.equal(handler.match('/goalx make'), false);
  assert.equal(handler.match(' /goal'), false);
});

test('goalCommandHandler opens a status card for an active goal', () => {
  const handler = new GoalCommandHandler();
  const goal = {
    condition: 'make tests green',
    status: 'active',
    revision: 2,
    startedAt: new Date(Date.now() - 90_000).toISOString(),
    turns: 3,
    maxTurns: 20,
    lastEvaluation: {outcome: 'not_met', reason: 'still red', at: '2026-05-19T00:00:02.000Z'}
  };
  const {calls, host} = createFakeHost({goal});
  const session = startCommand(handler, '/goal', host);

  assert.equal(session.surface.kind, 'info');
  assert.equal(session.surface.title, '/goal');
  assert.ok(session.surface.lines.some((line) => line.includes('make tests green')));
  assert.ok(session.surface.lines.some((line) => line.includes('active') && line.includes('3/20')));
  assert.ok(session.surface.lines.some((line) => line.includes('1 分钟')));
  assert.ok(session.surface.lines.some((line) => line.includes('最近评估') && line.includes('未达成') && line.includes('still red')));
  assert.deepEqual(calls.setGoals, []);
});

test('goalCommandHandler marks a paused goal as resumable', () => {
  const handler = new GoalCommandHandler();
  const goal = {
    condition: 'make tests green',
    status: 'paused',
    revision: 3,
    startedAt: '2026-05-19T00:00:01.000Z',
    turns: 1,
    maxTurns: 20
  };
  const {host} = createFakeHost({goal});
  const session = startCommand(handler, '/goal', host);

  assert.ok(session.surface.lines.some((line) => line.includes('paused') && line.includes('resume')));
  assert.equal(session.surface.lines.some((line) => line.includes('最近评估')), false);
});

test('goalCommandHandler shows usage when no goal exists', () => {
  const handler = new GoalCommandHandler();
  const {host} = createFakeHost();
  const session = startCommand(handler, '/goal', host);

  assert.equal(session.surface.kind, 'info');
  assert.ok(session.surface.lines.includes('当前没有目标。'));
  assert.ok(session.surface.lines.some((line) => line.includes('用法: /goal')));
});

test('goalCommandHandler dispatches conditions, subcommands, and clear aliases', () => {
  const handler = new GoalCommandHandler();
  const {calls, host} = createFakeHost();

  startCommand(handler, '/goal make tests green', host);
  assert.deepEqual(calls.setGoals, ['make tests green']);

  startCommand(handler, '/goal pause now', host);
  assert.deepEqual(calls.setGoals, ['make tests green', 'pause now']);

  startCommand(handler, '/goal pause', host);
  startCommand(handler, '/goal resume', host);
  assert.equal(calls.pauseCalls, 1);
  assert.equal(calls.resumeCalls, 1);

  for (const alias of ['clear', 'stop', 'off', 'reset', 'cancel']) {
    startCommand(handler, `/goal ${alias}`, host);
  }
  assert.equal(calls.clearCalls, 5);
  assert.deepEqual(calls.sessionOpens, []);
});

test('goalCommandHandler surfaces mutation errors from the goal port', () => {
  const handler = new GoalCommandHandler();
  const error = '未配置可用的 goal 评估模型：请在 /config 选择 goal 评估模型';
  const {calls, host} = createFakeHost({setGoalResult: {ok: false, error}});
  const session = startCommand(handler, '/goal make tests green', host);

  assert.equal(session.surface.kind, 'info');
  assert.ok(session.surface.lines.some((line) => line.includes(error)));
  assert.equal(calls.setGoals.length, 1);
});

test('goalCommandHandler closes its surface on Esc only', () => {
  const handler = new GoalCommandHandler();
  const {calls, host} = createFakeHost();
  const session = startCommand(handler, '/goal', host);

  handler.handleEvent(session, {type: INPUT_EVENTS.SUBMIT}, host);
  assert.equal(host.session.getActive(), session);
  assert.equal(calls.sessionCloses, 0);

  handler.handleEvent(session, {type: INPUT_EVENTS.ESCAPE}, host);
  assert.equal(host.session.getActive(), null);
  assert.equal(calls.sessionCloses, 1);
});

test('formatGoalElapsed renders coarse durations and rejects invalid input', () => {
  assert.equal(formatGoalElapsed(new Date(Date.now() - 2 * 3600_000 - 5 * 60_000).toISOString()), '2 小时 5 分钟');
  assert.equal(formatGoalElapsed(new Date(Date.now() - 90_000).toISOString()), '1 分钟');
  assert.equal(formatGoalElapsed('not-a-date'), '未知');
});
