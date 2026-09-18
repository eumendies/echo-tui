const test = require('node:test');
const assert = require('node:assert/strict');

const { createTuiTheme } = require('../../src/config/theme-config');
const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const { renderBanner } = require('../../src/render/blocks/banner-renderer');
test('renderBanner returns a large startup header at wide widths', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    appVersion: '1.2.5',
    terminalSize: { columns: 80, rows: 24 },
    mode: 'current terminal'
  }).split('\n');

  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('███████╗ ██████╗██╗  ██╗ ██████╗')));
  assert.ok(plainLines.some((line) => line.includes('╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝')));
  assert.ok(plainLines.some((line) => line.includes('cwd  /tmp/echo_tui')));
  assert.ok(plainLines.some((line) => line.includes('echo_tui 1.2.5 · node v20.0.0')));
  assert.ok(plainLines.some((line) => line.includes('node v20.0.0')));
  assert.equal(plainLines.some((line) => line.includes('terminal session')), false);
  assert.equal(plainLines.some((line) => line.includes('current terminal')), false);
  assert.equal(plainLines.some((line) => line.includes('tty')), false);
  assert.equal(plainLines.some((line) => line.includes('records append-only')), false);
});

test('renderBanner uses a compact BTW workspace header without the main title art', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    terminalSize: {columns: 80, rows: 24},
    mode: 'current terminal',
    variant: 'btw',
    parentActivity: 'MAIN streaming'
  }).split('\n').map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('BTW · 临时只读会话')));
  assert.ok(lines.some((line) => line.includes('MAIN streaming')));
  assert.equal(lines.some((line) => line.includes('███████╗')), false);
  for (const line of lines) assert.ok(displayWidth(line) <= safeRenderWidth(80));
});

test('renderBanner keeps uneven title rows aligned when safe width is even', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    terminalSize: { columns: 81, rows: 24 },
    mode: 'current terminal'
  }).split('\n').map((line) => stripAnsi(line));

  const titleOffsets = lines.slice(1, 7).map((line) => line.search(/\S/));

  assert.deepEqual(titleOffsets, Array(6).fill(titleOffsets[0]));
});

test('renderBanner falls back to a compact boxed header on narrower terminals', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    appVersion: '1.2.5',
    terminalSize: { columns: 20, rows: 24 },
    mode: 'current terminal'
  }).split('\n');

  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('╭')));
  assert.ok(plainLines.some((line) => line.includes('echo_tui')));
  assert.ok(plainLines.some((line) => line.includes('echo_tui 1.2.5')));
  assert.ok(plainLines.some((line) => line.includes('node v20.0.0')));
  assert.equal(plainLines.some((line) => line.includes('session')), false);
  assert.equal(plainLines.some((line) => line.includes('tty')), false);
});

test('renderBanner omits the app version label when it is not provided', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    terminalSize: { columns: 80, rows: 24 },
    mode: 'current terminal'
  }).split('\n').map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes('node v20.0.0')));
  assert.equal(lines.some((line) => line.includes('echo_tui 1.2.5')), false);
  assert.equal(lines.some((line) => line.includes('undefined')), false);
});

test('renderBanner keeps every line within the safe render width', () => {
  const width = 30;
  const lines = renderBanner({
    cwd: '/very/long/path/to/project/echo_tui',
    nodeVersion: 'v20.0.0',
    terminalSize: { columns: width, rows: 24 },
    mode: 'current terminal'
  }).split('\n');

  for (const line of lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(width));
  }
});
