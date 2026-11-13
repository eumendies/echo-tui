const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createBackgroundTaskManager, formatBackgroundTaskNotice } = require('../../src/tools/background-bash');
const { createBackgroundCommandPort } = require('../../src/app/command/background-command-port');
const { createTasksSurface } = require('../../src/commands/tasks-command-handler');
const { renderTasksSurface } = require('../../src/render/footer/tasks-surface');
const { TasksCommandHandler } = require('../../src/commands/tasks-command-handler');
const { INPUT_EVENTS } = require('../../src/input/event-types');
const { AppContext } = require('../../src/app/state/app-context');
const { UserConfigContext } = require('../../src/config/user-config-context');
const { stripAnsi } = require('../../src/render/layout');

function createWorkDir() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-bg-reg-'));
  const workDir = path.join(rootDir, 'work');
  fs.mkdirSync(workDir, { recursive: true });
  return { rootDir, workDir };
}

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

test('shutdown closes the start gate so late tool calls cannot register new tasks', async () => {
  const { rootDir, workDir } = createWorkDir();
  const manager = createBackgroundTaskManager({ rootDir });
  const startOptions = { command: 'sleep 0.1', cwd: workDir, sessionId: 'session-a', shell: '/bin/bash', timeoutMs: null };

  await manager.shutdown();
  const rejected = await manager.start(startOptions);

  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /退出/u);
  assert.deepEqual(manager.listManaged('session-a'), []);
});

test('unterminated output is written to the log immediately, not on task exit', async () => {
  const { rootDir, workDir } = createWorkDir();
  const manager = createBackgroundTaskManager({ rootDir });
  const started = await manager.start({ command: "printf ready; sleep 0.6", cwd: workDir, sessionId: 'session-a', shell: '/bin/bash', timeoutMs: null });

  assert.equal(started.ok, true);

  let observed = '';
  for (let attempt = 0; attempt < 40 && !observed.includes('ready'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 15));
    observed = fs.readFileSync(started.reference.outputPath, 'utf8');
  }

  // 关键点:任务仍在运行时日志就该可见,不能攒到关闭时才落盘。
  assert.match(observed, /ready/u);
  assert.equal(manager.getManaged(started.reference.taskId).state, 'running');

  await manager.shutdown();
});

test('history references from another app instance stay visible after restart', () => {
  const reference = {
    taskId: 'bash-7',
    sessionId: 'session-a',
    ownerInstanceId: 'instance-previous',
    outputPath: '/tmp/bg/bash-7/output.log',
    statusPath: '/tmp/bg/bash-7/status.json'
  };
  const records = [
    { role: 'tool_result', text: '', toolCallId: 'c1', toolName: 'run_bash_command', ok: true, details: { kind: 'bash', background: { ...reference, state: 'running' } } }
  ];
  const manager = {
    ownerInstanceId: 'instance-current',
    listManaged: () => [],
    getManaged: () => null,
    stop: async () => false,
    readTaskLog: () => null,
    readReferenceLog: () => null
  };
  const port = createBackgroundCommandPort({
    backgroundTasks: manager,
    transcriptContext: {
      getCompleteRecords: () => records,
      getResidentRecords: () => records,
      getCurrentSessionId: () => 'session-a'
    }
  });

  const views = port.list();

  // 旧实例身份不应被当成"其他会话"过滤掉。
  assert.equal(views.length, 1);
  assert.equal(views[0].reference.ownerInstanceId, 'instance-previous');
  assert.equal(views[0].managed, false);
});

function createAppContextWithManager(manager) {
  const transcriptStore = {
    createSession(cwd) {
      return { sessionId: 'session-1', cwd, createdAt: '', updatedAt: '', sequence: 1 };
    },
    appendSession(_cwd, reference) {
      return { ...reference, sequence: reference.sequence + 1 };
    },
    getSessionFilePath(_cwd, sessionId) {
      return `/tmp/${sessionId}.jsonl`;
    },
    listSessionSummaries() {
      return [];
    },
    loadSession() {
      return null;
    },
    loadSessionReadOnly() {
      return null;
    }
  };
  const settingsStore = { getFilePath: (_c, id) => `/tmp/${id}.json`, read: () => ({ kind: 'missing' }), write: () => ({}) };

  return new AppContext(
    { getSize() { return { columns: 80, rows: 24 }; } },
    transcriptStore,
    '/tmp/echo_tui',
    'v20.0.0',
    undefined,
    settingsStore,
    new UserConfigContext(),
    manager
  );
}

test('read-only runs do not receive the background capability', () => {
  const { rootDir } = createWorkDir();
  const manager = createBackgroundTaskManager({ rootDir });
  const app = createAppContextWithManager(manager);

  assert.equal(app.getAgentSession({}, undefined, 'readonly').backgroundTaskManager, undefined);
  assert.equal(app.getAgentSession({}, undefined, 'default').backgroundTaskManager, manager);
  assert.equal(app.getAgentSession({}, undefined).backgroundTaskManager, manager);
});

test('task panel strips terminal control sequences from logs and commands', () => {
  const surface = createTasksSurface([createTaskView({ command: 'echo \u001b[2Jcleared' })], {
    mode: 'detail',
    selectedIndex: 0,
    logLines: ['ok', '\u001b[2Jmalicious', '\u001b[31mred']
  });
  const rendered = stripAnsi(renderTasksSurface(surface, 100, undefined).lines.join('\n'));

  assert.equal(rendered.includes('\u001b'), false);
  assert.match(rendered, /malicious/u);
  assert.match(rendered, /cleared/u);
});

test('every rendered task-panel row occupies exactly one physical line', () => {
  // 多行命令是列表行的主要来源:行内换行会让终端多吐一行,footer 整帧定位随之错位。
  const command = 'for i in {1..24}; do\n  printf x\n  sleep 5\ndone';
  const view = createTaskView({ command, state: 'running' });

  // 宽屏主从与窄屏单栏都要满足同一条几何不变量。
  for (const mode of ['list', 'detail']) {
    for (const width of [72, 120]) {
      const surface = createTasksSurface([view], { mode, selectedIndex: 0, logLines: ['line one', 'line two'] });

      for (const line of renderTasksSurface(surface, width).lines) {
        assert.equal(line.includes('\n'), false, `${mode}@${width} row must not embed a newline`);
        assert.equal(line.includes('\r'), false, `${mode}@${width} row must not embed a carriage return`);
      }
    }
  }

  // 窄屏仍是单行摘要:换行被折成空格。
  const short = createTaskView({ command: 'for i in 1; do\nprintf x\ndone', state: 'running' });
  const listSurface = createTasksSurface([short], { mode: 'list', selectedIndex: 0 });
  assert.match(stripAnsi(renderTasksSurface(listSurface, 72).lines.join('\n')), /for i in 1; do printf x done/u);
});

test('panel error text with newlines stays on a single row', () => {
  const surface = createTasksSurface([createTaskView()], {
    mode: 'detail',
    selectedIndex: 0,
    error: '写入失败: EACCES\n/path/status.json'
  });
  const lines = renderTasksSurface(surface, 100).lines;

  for (const line of lines) {
    assert.equal(line.includes('\n'), false);
  }
  assert.match(stripAnsi(lines.join('\n')), /写入失败: EACCES \/path\/status\.json/u);
});

test('moving the focus marker does not shift row content', () => {
  const first = createTaskView();
  const second = createTaskView({
    reference: { ...createTaskView().reference, taskId: 'bash-2' },
    command: 'npm run build'
  });
  const tasks = [first, second];
  const render = (selectedIndex) => renderTasksSurface(createTasksSurface(tasks, { mode: 'list', selectedIndex }), 100).lines
    .map((line) => stripAnsi(line));

  const withFirst = render(0);
  const withSecond = render(1);

  for (const command of ['npm run dev', 'npm run build']) {
    const before = withFirst.find((line) => line.includes(`● ${command}`));
    const after = withSecond.find((line) => line.includes(`● ${command}`));
    assert.ok(before);
    assert.ok(after);
    assert.equal(after.indexOf(command), before.indexOf(command), 'command column must not move with focus');
  }
});

function countDividers(line) {
  return (line.match(/│/gu) || []).length;
}

test('wide terminals render the task list and the selected task side by side', () => {
  const second = createTaskView({
    reference: { ...createTaskView().reference, taskId: 'bash-2' },
    command: 'npm run build',
    state: 'exited',
    exitCode: 0
  });
  const surface = createTasksSurface([createTaskView(), second], {
    mode: 'list',
    selectedIndex: 0,
    logLines: ['VITE ready in 423 ms']
  });
  const lines = renderTasksSurface(surface, 120).lines.map((line) => stripAnsi(line));

  // 中间多出一条分隔线,说明左右两栏合并到了同一行。
  assert.ok(lines.some((line) => countDividers(line) === 3), 'expected a two-pane row');
  // 左栏是任务列表,右栏依次是命令、状态行与日志预览。
  assert.ok(lines.some((line) => line.includes('● npm run dev')), 'left pane should list the command');
  assert.ok(lines.some((line) => line.includes('[running]')), 'right pane should show the selected task state');
  assert.equal(lines.some((line) => /bash-[12]/u.test(line)), false, 'list should not display internal task ids');
  assert.ok(lines.some((line) => line.includes('VITE ready in 423 ms')), 'right pane should preview the log');
});

test('narrow terminals fall back to the single-column list', () => {
  const surface = createTasksSurface([createTaskView()], { mode: 'list', selectedIndex: 0, logLines: ['VITE ready'] });
  const lines = renderTasksSurface(surface, 72).lines.map((line) => stripAnsi(line));

  assert.equal(lines.every((line) => countDividers(line) <= 2), true, 'narrow list must not split panes');
  assert.equal(lines.some((line) => line.includes('VITE ready')), false, 'narrow list has no log preview');
});

test('elapsed time switches to minutes for long-running tasks', () => {
  const surface = createTasksSurface([createTaskView({ elapsedMs: 192_000 })], { mode: 'list', selectedIndex: 0 });
  const rendered = stripAnsi(renderTasksSurface(surface, 120).lines.join('\n'));

  assert.match(rendered, /3m 12s/u);
  assert.equal(rendered.includes('192s'), false);
});

test('stop confirmation renders its own body instead of the list', () => {
  const surface = createTasksSurface([createTaskView()], { mode: 'confirmStop', selectedIndex: 0 });
  const rendered = stripAnsi(renderTasksSurface(surface, 100, undefined).lines.join('\n'));

  assert.match(rendered, /确认停止这个任务/u);
  assert.match(rendered, /npm run dev/u);
  assert.equal(rendered.includes('任务: bash-1'), false);
});

test('task panels hide internal ids while keeping commands and operation titles', () => {
  for (const width of [72, 120]) {
    for (const mode of ['list', 'detail', 'confirmStop']) {
      const task = createTaskView({reference: {
        ...createTaskView().reference,
        taskId: 'private-task-id',
        outputPath: '/tmp/output.log'
      }});
      const surface = createTasksSurface([task], {mode, selectedIndex: 0});
      const rendered = stripAnsi(renderTasksSurface(surface, width).lines.join('\n'));

      assert.match(rendered, /npm run dev/u);
      assert.equal(rendered.includes('private-task-id'), false);
      assert.equal(task.reference.taskId, 'private-task-id');
    }
  }
});

test('completion notices use a bounded single-line command instead of the task id', () => {
  const notice = formatBackgroundTaskNotice(createTaskView({
    command: 'npm run\n dev', state: 'exited', exitCode: 0
  }));
  assert.match(notice, /后台任务「npm run dev」已完成/u);
  assert.equal(notice.includes('bash-1'), false);
  assert.equal(notice.includes('\n'), false);

  const longNotice = formatBackgroundTaskNotice(createTaskView({command: '构建'.repeat(200)}));
  assert.match(longNotice, /…」/u);
  assert.equal(longNotice.includes('\uFFFD'), false);
  assert.ok(Buffer.byteLength(longNotice, 'utf8') < 300);
});

test('detail view keeps every line of a multi-line command', () => {
  const command = 'npm run build\n  && npm test\n  && echo done';
  const surface = createTasksSurface([createTaskView({ command })], { mode: 'detail', selectedIndex: 0, logLines: [] });
  const rendered = stripAnsi(renderTasksSurface(surface, 100).lines.join('\n'));

  assert.match(rendered, /npm run build/u);
  assert.match(rendered, /npm test/u);
  assert.match(rendered, /echo done/u);
});

test('detail view wraps a long single-line command instead of truncating it', () => {
  const command = `echo ${'x'.repeat(200)}`;
  const surface = createTasksSurface([createTaskView({ command })], { mode: 'detail', selectedIndex: 0, logLines: [] });
  const rendered = stripAnsi(renderTasksSurface(surface, 60).lines.join('\n'));
  const commandRows = rendered.split('\n').filter((line) => line.includes('xxxx'));

  assert.ok(commandRows.length > 1, 'long command should wrap across rows');
  assert.equal(rendered.includes('…'), false);
});

test('an over-long command reports how many lines were dropped', () => {
  const command = Array.from({ length: 20 }, (_, index) => `step-${index + 1}`).join('\n');
  const surface = createTasksSurface([createTaskView({ command })], { mode: 'detail', selectedIndex: 0, logLines: [] });
  const rendered = stripAnsi(renderTasksSurface(surface, 100).lines.join('\n'));

  assert.match(rendered, /命令:/u);
  assert.match(rendered, /还有 12 行/u);
});

test('a late stop result cannot overwrite another command surface', async () => {
  const handler = new TasksCommandHandler();
  const views = [createTaskView()];
  let active = null;
  let resolveStop = () => {};
  const stopPromise = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const host = {
    background: {
      list: () => views,
      hasSessionTasks: () => true,
      stop: () => stopPromise,
      readLog: () => '',
      readReferenceLog: () => ''
    },
    session: {
      open: (session) => { active = session; },
      update: (patch) => { active = { ...active, ...patch }; },
      close: () => { active = null; },
      getActive: () => active
    }
  };

  handler.start('', host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.SUBMIT }, host);
  await handler.handleEvent(host.session.getActive(), { type: INPUT_EVENTS.TEXT, value: 's' }, host);
  const tasksSession = host.session.getActive();
  const pending = handler.handleEvent(tasksSession, { type: INPUT_EVENTS.SUBMIT }, host);

  // 等待期间用户打开了别的命令界面。
  const helpSession = { commandName: 'help', handler: {}, surface: { kind: 'info', title: '/help', lines: [], dismissHint: '' }, data: null };
  host.session.open(helpSession);
  resolveStop(true);
  await pending;

  assert.equal(host.session.getActive(), helpSession);
});
