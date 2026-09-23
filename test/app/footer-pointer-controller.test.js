const assert = require('node:assert/strict');
const test = require('node:test');

const {FooterPointerController} = require('../../src/app/footer-pointer-controller');
const {INPUT_EVENTS} = require('../../src/input/event-types');

function mouse(phase, row, column, button = 'left') {
  return {type: INPUT_EVENTS.MOUSE, phase, row, column, button, shift: false, alt: false, ctrl: false};
}

function wheel(direction, row, column) {
  return {type: INPUT_EVENTS.MOUSE_WHEEL, direction, row, column};
}

function slashSnapshot(version, originStable = false) {
  return {
    version,
    cursorRow: 3,
    cursorColumn: 0,
    originStable,
    hitRegions: [{interactionId: 'slash', owner: 'slash_suggestion', target: {kind: 'slash_suggestion', index: 2}, rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 40}],
    wheelRegions: []
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
    hitRegions: [{interactionId: 'other', owner: 'choice', target: {kind: 'choice_option', index: 0, inlineInput: false}, rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 20}],
    wheelRegions: []
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
  controller.update({version: 2, cursorRow: 0, cursorColumn: 0, originStable: false, hitRegions: [], wheelRegions: []});
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  controller.handleEvent(mouse('down', 10, 4));

  assert.deepEqual(terminal.mouse, [true, false]);
  assert.deepEqual(calls, ['cpr']);
});

test('FooterPointerController routes a command semantic target without interpreting its command surface', () => {
  const calls = [];
  const activeConsumer = {
    current: {id: 'command-session', handlePointer(target, activate) { calls.push({target, activate}); }}
  };
  const controller = createController(activeConsumer, null, calls);
  controller.update({
    version: 1,
    cursorRow: 0,
    cursorColumn: 0,
    originStable: false,
    hitRegions: [{interactionId: 'command-session', owner: 'diff', target: {kind: 'command_diff_file', index: 4}, rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 20}],
    wheelRegions: []
  });

  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  controller.handleEvent(mouse('down', 12, 4));

  assert.deepEqual(calls, ['cpr', {target: {kind: 'command_diff_file', index: 4}, activate: true}]);
});

test('FooterPointerController enables wheel-only preview frames and ignores the left-list coordinates', () => {
  const calls = [];
  const terminal = {mouse: [], setMouseTracking(enabled) { this.mouse.push(enabled); }, requestCursorPosition() { calls.push('cpr'); return true; }};
  const active = {current: {id: 'file-picker', handleWheel(pane, direction) { calls.push(`${pane}:${direction}`); }}};
  const controller = createController(active, terminal, calls);
  controller.update({
    version: 1, cursorRow: 2, cursorColumn: 0, originStable: false, hitRegions: [],
    wheelRegions: [{interactionId: 'file-picker', owner: 'file_picker', pane: 'secondary', rowStart: 1, rowEnd: 3, columnStart: 16, columnEnd: 30}]
  });
  assert.deepEqual(terminal.mouse, [true]);
  assert.equal(controller.handleEvent(wheel('down', 10, 18)), true);
  assert.deepEqual(calls, ['cpr']);
  assert.equal(controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 11, column: 1}), true);
  for (const [row, column] of [[10, 3], [12, 12], [10, 16], [12, 30]]) {
    controller.handleEvent(wheel('down', row, column));
  }
  for (const [row, column] of [[9, 8], [13, 8], [11, 2], [11, 13], [11, 15], [11, 31]]) {
    controller.handleEvent(wheel('up', row, column));
  }
  controller.handleEvent(mouse('down', 10, 18));
  assert.deepEqual(calls, ['cpr', 'secondary:down', 'secondary:down']);
  controller.dispose();
  assert.equal(terminal.mouse.at(-1), false);
});

test('FooterPointerController gates wheel by CPR frame, active consumer identity and matching wheel regions', () => {
  const calls = [];
  const terminal = {mouse: [], setMouseTracking(enabled) { this.mouse.push(enabled); }, requestCursorPosition() { calls.push('cpr'); return true; }};
  const active = {current: {id: 'command-session', handleWheel(pane, direction) { calls.push(`${pane}:${direction}`); }}};
  const controller = createController(active, terminal, calls);
  const frame = (version, originStable = false) => ({
    version, cursorRow: 2, cursorColumn: 0, originStable, hitRegions: [],
    wheelRegions: [{interactionId: 'command-session', owner: 'resume', pane: 'secondary', rowStart: 1, rowEnd: 2, columnStart: 4, columnEnd: 20}]
  });
  controller.update(frame(1));
  controller.update(frame(2));
  controller.handleEvent(wheel('up', 10, 6));
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 11, column: 1});
  controller.handleEvent(wheel('up', 10, 6));
  assert.deepEqual(calls, ['cpr', 'cpr']);
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 11, column: 1});
  controller.handleEvent(wheel('down', 10, 6));
  controller.update(frame(3, true));
  controller.handleEvent(wheel('up', 11, 6));
  active.current = {id: 'other', handleWheel() { calls.push('wrong-consumer'); }};
  controller.handleEvent(wheel('down', 10, 6));
  active.current = {id: 'command-session', handlePointer() { calls.push('nonwheel'); }};
  controller.handleEvent(wheel('down', 10, 6));
  assert.deepEqual(calls, ['cpr', 'cpr', 'secondary:down', 'secondary:up']);
  controller.update(frame(4));
  controller.handleEvent(wheel('up', 10, 6));
  assert.deepEqual(terminal.mouse, [true, true, true, false]);
  controller.dispose();
});

test('FooterPointerController keeps wheel separate from clicks and re-enables hover after leaving the list', () => {
  const calls = [];
  const active = {current: {
    id: 'file-picker',
    handlePointer(target, activate) { calls.push(`hit:${target.index}:${activate}`); },
    handleWheel(pane, direction) { calls.push(`${pane}:${direction}`); }
  }};
  const controller = createController(active, null, calls);
  controller.update({
    ...slashSnapshot(1),
    hitRegions: [{interactionId: 'file-picker', owner: 'file_picker', target: {kind: 'file_picker_entry', index: 2}, rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 15}],
    wheelRegions: [{interactionId: 'file-picker', owner: 'file_picker', pane: 'secondary', rowStart: 2, rowEnd: 2, columnStart: 16, columnEnd: 40}]
  });
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(wheel('down', 10, 4));
  controller.handleEvent(wheel('up', 11, 20));
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(mouse('down', 11, 4));
  assert.deepEqual(calls, ['cpr', 'hit:2:false', 'secondary:up', 'hit:2:false']);
  controller.dispose();
});
