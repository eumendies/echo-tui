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
