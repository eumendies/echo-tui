const test = require('node:test');
const assert = require('node:assert/strict');

const { TasksCommandHandler } = require('../../src/commands/tasks-command-handler');
const { createBackgroundCommandPort } = require('../../src/app/command/background-command-port');
const { INPUT_EVENTS } = require('../../src/input/event-types');

function createTaskView(overrides = {}) {
  return {
    reference: {
      taskId: 'bash-1',
      sessionId: 'session-a',
      ownerInstanceId: 'instance-1',
      outputPath: '/tmp/bg/bash-1/output.log',
      statusPath: '/tmp/bg/bash-1/status.json'
    },
    managed: true,
    state: 'running',
    command: 'npm run dev',
    startedAt: '2026-11-11T08:00:00.000Z',
    finishedAt: null,
    exitCode: null,
    reason: null,
    elapsedMs: 1200,
    outputTruncated: false,
    ...overrides
  };
}

function createTaskHost(initialViews, overrides = {}) {
  const calls = { closes: 0, updates: 0, stops: [] };
  let views = initialViews;
  let active = null;
  const host = {
    background: {
      list: () => views,
      hasSessionTasks: () => views.length > 0,
      stop: async (taskId) => {
        calls.stops.push(taskId);
        return overrides.stopResult ?? true;
      },
      readLog: () => overrides.log ?? 'ready\nlistening on 3000\n',
      readReferenceLog: () => overrides.referenceLog ?? 'history line\n'
    },
    session: {
      open: (session) => {
        active = session;
      },
      update: (patch) => {
        active = { ...active, ...patch };
        calls.updates += 1;
      },
      close: () => {
        active = null;
        calls.closes += 1;
      },
      getActive: () => active
    }
  };

  return { calls, host, setViews: (next) => { views = next; } };
}

test('tasksCommandHandler shows the empty state without inventing entries', () => {
  const handler = new TasksCommandHandler();
  const { host } = createTaskHost([]);

  handler.start('', host);
  const session = host.session.getActive();

  assert.equal(session.surface.kind, 'tasks');
  assert.equal(session.surface.tasks.length, 0);
  assert.match(session.surface.title, /\(0\)/u);
});

test('tasksCommandHandler opens the detail snapshot and refreshes manually', async () => {
  const handler = new TasksCommandHandler();
  const { calls, host, setViews } = createTaskHost([createTaskView()]);

  handler.start('', host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);

  let session = host.session.getActive();
  assert.equal(session.surface.mode, 'detail');
  assert.deepEqual(session.surface.logLines, ['ready', 'listening on 3000']);

  // 新输出不会自动进入已打开的快照,必须显式刷新。
  setViews([createTaskView({ command: 'npm run dev -- --port 4000' })]);
  assert.equal(host.session.getActive().surface.tasks[0].command, 'npm run dev');

  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.TEXT, value: 'r' }, host);
  session = host.session.getActive();
  assert.equal(session.surface.tasks[0].command, 'npm run dev -- --port 4000');
  assert.equal(calls.stops.length, 0);
});

test('tasksCommandHandler requires confirmation before stopping and closes after success', async () => {
  const handler = new TasksCommandHandler();
  const { calls, host } = createTaskHost([createTaskView()]);

  handler.start('', host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.TEXT, value: 's' }, host);

  assert.equal(host.session.getActive().surface.mode, 'confirmStop');
  assert.equal(calls.stops.length, 0);

  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  assert.deepEqual(calls.stops, ['bash-1']);
});

test('tasksCommandHandler refuses stopping a historical entry without a local handle', async () => {
  const handler = new TasksCommandHandler();
  const historyView = createTaskView({ managed: false, state: 'exited', exitCode: 0 });
  const { calls, host } = createTaskHost([historyView]);

  handler.start('', host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.TEXT, value: 's' }, host);

  assert.equal(calls.stops.length, 0);
  assert.match(host.session.getActive().surface.error, /无法停止/u);
});

test('tasksCommandHandler walks back one level per Esc and closes from the list', async () => {
  const handler = new TasksCommandHandler();
  const { calls, host } = createTaskHost([createTaskView()]);

  handler.start('', host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  assert.equal(host.session.getActive().surface.mode, 'detail');

  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.ESCAPE }, host);
  assert.equal(host.session.getActive().surface.mode, 'list');
  assert.equal(calls.closes, 0);

  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.ESCAPE }, host);
  assert.equal(calls.closes, 1);
});

function createAppContextStub(options) {
  return {
    backgroundTasks: options.manager || null,
    transcriptContext: {
      getCompleteRecords: () => options.records || null,
      getResidentRecords: () => options.records || [],
      getCurrentSessionId: () => ('sessionId' in options ? options.sessionId : 'session-a')
    }
  };
}

test('background port merges managed entries over transcript references and drops foreign sessions', () => {
  const sharedReference = {
    taskId: 'bash-1',
    sessionId: 'session-a',
    ownerInstanceId: 'instance-1',
    outputPath: '/tmp/bg/bash-1/output.log',
    statusPath: '/tmp/bg/bash-1/status.json'
  };
  const records = [
    { role: 'tool_result', text: '', toolCallId: 'c1', toolName: 'run_bash_command', ok: true, details: { kind: 'bash', background: { ...sharedReference, state: 'running' } } },
    { role: 'tool_result', text: '', toolCallId: 'c2', toolName: 'run_bash_command', ok: true, details: { kind: 'bash', background: { ...sharedReference, taskId: 'bash-2', outputPath: '/tmp/missing/output.log', statusPath: '/tmp/missing/status.json', state: 'exited' } } },
    // fork 继承的源会话引用不得进入当前会话列表。
    { role: 'tool_result', text: '', toolCallId: 'c3', toolName: 'run_bash_command', ok: true, details: { kind: 'bash', background: { ...sharedReference, taskId: 'bash-9', sessionId: 'session-source' } } },
    { role: 'assistant', text: 'ignore me' }
  ];
  const manager = {
    ownerInstanceId: 'instance-1',
    listManaged: () => [createTaskView({ reference: sharedReference })],
    getManaged: () => null,
    stop: async () => false,
    readTaskLog: () => null,
    readReferenceLog: () => null
  };
  const port = createBackgroundCommandPort(createAppContextStub({ manager, records: records }));
  const views = port.list();

  // 同身份只保留受管条目,并且只保留当前 session 的引用。
  assert.equal(views.length, 2);
  assert.equal(views[0].reference.taskId, 'bash-1');
  assert.equal(views[0].managed, true);
  assert.equal(views[1].reference.taskId, 'bash-2');
  assert.equal(views[1].managed, false);
  assert.match(views[1].unreadable, /已损坏/u);
});

test('background port reports nothing when the session has no identity yet', () => {
  const manager = {
    ownerInstanceId: 'instance-1',
    listManaged: () => [createTaskView()],
    getManaged: () => null,
    stop: async () => false,
    readTaskLog: () => null,
    readReferenceLog: () => null
  };
  const port = createBackgroundCommandPort(createAppContextStub({ manager, records: [], sessionId: null }));

  assert.deepEqual(port.list(), []);
});
