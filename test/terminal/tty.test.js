const assert = require('node:assert/strict');
const test = require('node:test');

const {setupTerminal} = require('../../src/terminal/tty');
const ansi = require('../../src/terminal/ansi');

function createInput(isTTY = true) {
  return {
    isTTY,
    isRaw: false,
    isPaused: () => false,
    pause() {},
    resume() {},
    setEncoding() {},
    setRawMode() {}
  };
}

function createOutput(isTTY = true) {
  return {
    isTTY,
    columns: 80,
    rows: 24,
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
}

test('setupTerminal scopes SGR mouse tracking to interactive TTY and cleans it up', () => {
  const input = createInput(true);
  const output = createOutput(true);
  const terminal = setupTerminal(input, output);

  terminal.setMouseTracking(true);
  terminal.setMouseTracking(true);
  assert.equal(output.writes.filter((item) => item === ansi.enableMouseTracking()).length, 1);
  assert.equal(terminal.requestCursorPosition(), true);
  assert.equal(output.writes.at(-1), ansi.requestCursorPosition());

  terminal.cleanup();
  assert.match(output.writes.at(-1), /\x1b\[\?1006l\x1b\[\?1003l/);
});

test('setupTerminal keeps mouse control sequences out of non-TTY streams', () => {
  const input = createInput(false);
  const output = createOutput(false);
  const terminal = setupTerminal(input, output);

  terminal.setMouseTracking(true);
  assert.equal(terminal.requestCursorPosition(), false);
  assert.deepEqual(output.writes, []);
  terminal.cleanup();
  assert.match(output.writes.at(-1), /\x1b\[\?25h/);
});
