const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('createApp routes response-time commands and pending messages without replacing command surfaces', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-controller-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-response-time-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 15_000
    });
    const result = JSON.parse(output);

    assert.deepEqual(result, {
      configDeferred: true,
      configOpenedOnce: true,
      escapeKeptSecondTurn: true,
      helpStayedOpen: true,
      immediateHelp: true,
      pendingBeforeHelp: true,
      secondTurnUserText: 'queued ordinary',
      turnCount: 2
    });
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});


test('createApp isolates background main streaming while BTW owns the terminal projection', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-stream-owner-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-streaming-owner-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 15_000
    });
    const result = JSON.parse(output);

    assert.equal(result.commitsBeforeBtw, 1);
    assert.equal(result.commitsWhileBtw, 1);
    assert.match(result.restoredAssistant, /gamma/);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});


test('createApp suppresses timed footer redraws while a user question surface is open', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-question-timer-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-question-timed-render-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 15_000
    });
    const result = JSON.parse(output);

    assert.equal(result.composerTimedRenders > 0, true);
    assert.equal(result.rendersDuringQuestion, 0);
    assert.equal(result.rendersAfterCancel > 0, true);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});

test('createApp gates UI mouse interaction by the saved setting and applies changes immediately', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-ui-mouse-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-ui-mouse-interaction-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 15_000
    });
    const result = JSON.parse(output);

    assert.equal(result.disabledEnabled, false);
    assert.equal(result.disabledRequests, 0);
    assert.equal(result.enabledInteractionId, 'user-question');
    assert.equal(result.enabledRequests > 0, true);
    assert.equal(result.disabledAfterEnable, true);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});

test('createApp persists an interrupted tool call as a paired result before the interrupt notice', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-interrupted-tool-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-interrupted-tool-pair-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 15_000
    });
    const result = JSON.parse(output);

    assert.deepEqual(result, {
      journalBatchRoles: ['user', 'tool_call,tool_result', 'local_notice'],
      journalInterruptedResultText: 'Tool execution was interrupted by the user before it returned a result.',
      noticeRenderedAfterPair: true,
      pairBatchRoles: ['tool_call', 'tool_result'],
      pendingAfterInterrupt: null,
      renderedInterruptedResultOk: false
    });
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});

test('createApp defers the update request until the composer is empty and input is idle', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-update-gating-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-auto-update-gating-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 20_000
    });
    const result = JSON.parse(output);

    assert.deepEqual(result, {
      defaultFocus: 1,
      visibleAfterLater: false,
      visibleWhenIdle: true,
      visibleWhileComposerFilled: false,
      visibleWhileTyping: false
    });
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});

test('createApp restores the terminal before applying an update and exits with the update result', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-main-update-apply-'));

  try {
    const fixturePath = path.join(__dirname, 'fixtures/main-update-apply-scenario.js');
    const output = childProcess.execFileSync(process.execPath, [fixturePath], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
      env: {...process.env, HOME: home},
      timeout: 20_000
    });
    const result = JSON.parse(output);

    assert.deepEqual(result.appliedUpdates, ['1.4.5']);
    assert.deepEqual(result.exitCodes, [0]);
    assert.equal(result.footerCleared, true);
    assert.equal(result.terminalCleanedUp, true);
    assert.match(result.autoUpdateOutput, /\n/);
    assert.equal(result.stdinListenersAttachedAtStart, true);
    assert.equal(result.resizeListenerAttachedAtStart, true);
    assert.equal(result.stdinDataListenersAfterUpdate, result.stdinDataListenersBefore);
    assert.equal(result.resizeListenersAfterUpdate, result.resizeListenersBefore);
    assert.equal(result.stdinPausedAfterUpdate, true);
  } finally {
    fs.rmSync(home, {recursive: true, force: true});
  }
});
