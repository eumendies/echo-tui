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
    hitRegions: [{owner: 'slash_suggestion', target: {kind: 'slash_suggestion', index: 2}, rowStart: 1, rowEnd: 1, columnStart: 1, columnEnd: 40}]
  };
}

test('FooterPointerController calibrates current frame, deduplicates hover, and routes a click semantically', () => {
  const calls = [];
  const terminal = {
    mouse: [],
    setMouseTracking(enabled) { this.mouse.push(enabled); },
    requestCursorPosition() { calls.push('cpr-request'); return true; }
  };
  const controller = new FooterPointerController({
    appContext: {handleSlashSuggestionPointer(index, activate) { calls.push(`slash:${index}:${activate}`); return true; }},
    filePicker: {hasActiveRequest: () => false, handlePointerEntry() { calls.push('file'); return true; }},
    render: () => calls.push('render'),
    terminal,
    toolApproval: {hasActiveRequest: () => false, handlePointerOption() { calls.push('approval'); return true; }},
    userQuestion: {hasActiveRequest: () => false, handlePointerOption() { calls.push('question'); return true; }, handlePointerTab() { return false; }}
  });
  controller.update(slashSnapshot(7));

  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  // SGR 空闲 hover 的编码为 button=other，而非 left。
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(mouse('move', 10, 4, 'other'));
  controller.handleEvent(mouse('down', 10, 4));

  assert.deepEqual(terminal.mouse, [true]);
  assert.deepEqual(calls, ['cpr-request', 'slash:2:false', 'render', 'slash:2:true', 'render']);
});

test('FooterPointerController ignores mouse reports without a current calibration', () => {
  const calls = [];
  const controller = new FooterPointerController({
    appContext: {handleSlashSuggestionPointer() { calls.push('slash'); return true; }},
    filePicker: {hasActiveRequest: () => false, handlePointerEntry: () => false},
    render: () => calls.push('render'),
    terminal: {setMouseTracking() {}, requestCursorPosition: () => false},
    toolApproval: {hasActiveRequest: () => false, handlePointerOption: () => false},
    userQuestion: {hasActiveRequest: () => false, handlePointerOption: () => false, handlePointerTab: () => false}
  });
  controller.update(slashSnapshot(1));

  controller.handleEvent(mouse('down', 1, 2));
  assert.deepEqual(calls, []);
});

test('FooterPointerController serializes CPR frames and reuses calibration only for position-stable redraws', () => {
  const calls = [];
  const controller = new FooterPointerController({
    appContext: {handleSlashSuggestionPointer(index, activate) { calls.push(`slash:${index}:${activate}`); return true; }},
    filePicker: {hasActiveRequest: () => false, handlePointerEntry: () => false},
    render: () => calls.push('render'),
    terminal: {setMouseTracking() {}, requestCursorPosition() { calls.push('cpr'); return true; }},
    toolApproval: {hasActiveRequest: () => false, handlePointerOption: () => false},
    userQuestion: {hasActiveRequest: () => false, handlePointerOption: () => false, handlePointerTab: () => false}
  });

  controller.update(slashSnapshot(1));
  controller.update(slashSnapshot(2));
  assert.deepEqual(calls, ['cpr']);

  // 这是 frame 1 的迟到回复，不能用于 frame 2；它只会触发 frame 2 的下一次查询。
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  assert.deepEqual(calls, ['cpr', 'cpr']);

  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 15, column: 1});
  controller.update(slashSnapshot(3, true));
  controller.handleEvent(mouse('move', 13, 4, 'other'));
  assert.deepEqual(calls, ['cpr', 'cpr', 'slash:2:false', 'render']);
});

test('FooterPointerController ignores middle and right drag moves and leaves unsupported choice surfaces disabled', () => {
  const calls = [];
  const terminal = {mouse: [], setMouseTracking(enabled) { this.mouse.push(enabled); }, requestCursorPosition() { calls.push('cpr'); return true; }};
  const controller = new FooterPointerController({
    appContext: {handleSlashSuggestionPointer() { calls.push('slash'); return true; }},
    filePicker: {hasActiveRequest: () => false, handlePointerEntry: () => false},
    render: () => calls.push('render'),
    terminal,
    toolApproval: {hasActiveRequest: () => false, handlePointerOption: () => false},
    userQuestion: {hasActiveRequest: () => false, handlePointerOption: () => false, handlePointerTab: () => false}
  });

  controller.update({
    version: 1,
    cursorRow: 0,
    cursorColumn: 0,
    originStable: false,
    hitRegions: [{owner: 'choice', target: {kind: 'choice_option', index: 0, inlineInput: false}, rowStart: 0, rowEnd: 0, columnStart: 1, columnEnd: 20}]
  });
  assert.deepEqual(terminal.mouse, [false]);
  assert.deepEqual(calls, []);

  controller.update(slashSnapshot(2));
  controller.handleEvent({type: INPUT_EVENTS.CURSOR_POSITION, row: 12, column: 1});
  controller.handleEvent(mouse('move', 10, 4, 'middle'));
  controller.handleEvent(mouse('move', 10, 4, 'right'));
  assert.deepEqual(calls, ['cpr']);
});
