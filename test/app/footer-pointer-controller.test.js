const assert = require('node:assert/strict');
const test = require('node:test');

const {FooterPointerController} = require('../../src/app/footer-pointer-controller');
const {INPUT_EVENTS} = require('../../src/input/event-types');

function mouse(phase, row, column, button = 'left') {
  return {type: INPUT_EVENTS.MOUSE, phase, row, column, button, shift: false, alt: false, ctrl: false};
}

function slashSnapshot(version, originStable = false) {
  return {
    version,
    cursorRow: 3,
    cursorColumn: 0,
    originStable,
    hitRegions: [{interactionId: 'slash', owner: 'slash_suggestion', target: {kind: 'slash_suggestion', index: 2}, rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 40}]
  };
}

function createController(activeConsumer, terminal, calls) {
  return new FooterPointerController({
    getActivePointerConsumer: () => activeConsumer.current,
    terminal: terminal || {
      setMouseTracking() {},
      requestCursorPosition() {
        calls.push('cpr');
        return true;
      }
    }
  });
}

test('FooterPointerController calibrates current frame, deduplicates hover, and routes a click to its consumer', () => {
  const calls = [];
  const terminal = {
    mouse: [],
    setMouseTracking(enabled) { this.mouse.push(enabled); },
    requestCursorPosition() { calls.push('cpr-request'); return true; }
  };
  const activeConsumer = {
    current: {
      id: 'slash',
      handlePointer(target, activate) { calls.push(`slash:${target.index}:${activate}`); }
    }
  };
  const controller = createController(activeConsumer, terminal, calls);
  controller.update(slashSnapshot(7));

  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(mouse('down', 10, 4));

  assert.deepEqual(terminal.mouse, [true]);
  assert.deepEqual(calls, ['cpr-request', 'slash:2:false', 'slash:2:true']);
});

test('FooterPointerController ignores mouse reports without a current calibration', () => {
  const calls = [];
  const controller = createController({
    current: {id: 'slash', handlePointer() { calls.push('slash'); }}
  }, {
    setMouseTracking() {},
    requestCursorPosition: () => false
  }, calls);
  controller.update(slashSnapshot(1));

  controller.handleEvent(mouse('down', 1, 2));
  assert.deepEqual(calls, []);
});

test('FooterPointerController serializes CPR frames and reuses calibration only for position-stable redraws', () => {
  const calls = [];
  const activeConsumer = {
    current: {id: 'slash', handlePointer(target, activate) { calls.push(`slash:${target.index}:${activate}`); }}
  };
  const controller = createController(activeConsumer, null, calls);

  controller.update(slashSnapshot(1));
  controller.update(slashSnapshot(2));
  assert.deepEqual(calls, ['cpr']);

  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  assert.deepEqual(calls, ['cpr', 'cpr']);

  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 15, column: 1});
  controller.update(slashSnapshot(3, true));
  controller.handleEvent(mouse('move', 13, 4, 'other'));
  assert.deepEqual(calls, ['cpr', 'cpr', 'slash:2:false']);
});

test('FooterPointerController rejects stale consumer identities and keeps unsupported regions disabled', () => {
  const calls = [];
  const terminal = {mouse: [], setMouseTracking(enabled) { this.mouse.push(enabled); }, requestCursorPosition() { calls.push('cpr'); return true; }};
  const activeConsumer = {
    current: {id: 'slash', handlePointer() { calls.push('slash'); }}
  };
  const controller = createController(activeConsumer, terminal, calls);

  controller.update({
    version: 1,
    cursorRow: 0,
    cursorColumn: 0,
    originStable: false,
    hitRegions: [{interactionId: 'other', owner: 'choice', target: {kind: 'choice_option', index: 0, inlineInput: false}, rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 20}]
  });
  assert.deepEqual(terminal.mouse, [false]);

  controller.update(slashSnapshot(2));
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  activeConsumer.current = {id: 'replacement', handlePointer() { calls.push('replacement'); }};
  controller.handleEvent(mouse('down', 10, 4));
  controller.handleEvent(mouse('move', 10, 4, 'middle'));

  assert.deepEqual(calls, ['cpr']);
});

test('FooterPointerController disables tracking and cancels calibration when the current hit map disappears', () => {
  const calls = [];
  const terminal = {
    mouse: [],
    setMouseTracking(enabled) { this.mouse.push(enabled); },
    requestCursorPosition() { calls.push('cpr'); return true; }
  };
  const activeConsumer = {
    current: {id: 'slash', handlePointer() { calls.push('slash'); }}
  };
  const controller = createController(activeConsumer, terminal, calls);

  controller.update(slashSnapshot(1));
  controller.update({version: 2, cursorRow: 0, cursorColumn: 0, originStable: false, hitRegions: []});
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  controller.handleEvent(mouse('down', 10, 4));

  assert.deepEqual(terminal.mouse, [true, false]);
  assert.deepEqual(calls, ['cpr']);
});
