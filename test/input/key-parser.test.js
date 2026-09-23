const test = require('node:test');
const assert = require('node:assert/strict');

const { INPUT_EVENTS } = require('../../src/input/event-types');
const { createKeyParser, parseKeyChunk } = require('../../src/input/key-parser');

test('parseKeyChunk parses text, tab, shift tab, submit, and backspace events from one chunk', () => {
  assert.deepEqual(parseKeyChunk('ab\t\x1b[Z\r\x7f'), [
    { type: INPUT_EVENTS.TEXT, value: 'a' },
    { type: INPUT_EVENTS.TEXT, value: 'b' },
    { type: INPUT_EVENTS.TAB },
    { type: INPUT_EVENTS.SHIFT_TAB },
    { type: INPUT_EVENTS.SUBMIT },
    { type: INPUT_EVENTS.BACKSPACE }
  ]);
});

test('parseKeyChunk parses common escape sequences', () => {
  assert.deepEqual(parseKeyChunk('\x1b[A\x1b[B\x1b[D\x1b[C\x1b[H\x1b[F\x1b[5~\x1b[6~\x1b[3~'), [
    { type: INPUT_EVENTS.MOVE_UP },
    { type: INPUT_EVENTS.MOVE_DOWN },
    { type: INPUT_EVENTS.MOVE_LEFT },
    { type: INPUT_EVENTS.MOVE_RIGHT },
    { type: INPUT_EVENTS.MOVE_HOME },
    { type: INPUT_EVENTS.MOVE_END },
    { type: INPUT_EVENTS.PAGE_UP },
    { type: INPUT_EVENTS.PAGE_DOWN },
    { type: INPUT_EVENTS.DELETE_FORWARD }
  ]);
});

test('parseKeyChunk parses control editing shortcuts', () => {
  assert.deepEqual(parseKeyChunk('\x01\x05\x15\x0b\x17'), [
    { type: INPUT_EVENTS.MOVE_HOME },
    { type: INPUT_EVENTS.MOVE_END },
    { type: INPUT_EVENTS.DELETE_TO_LINE_START },
    { type: INPUT_EVENTS.DELETE_TO_LINE_END },
    { type: INPUT_EVENTS.DELETE_PREVIOUS_WORD }
  ]);
});

test('parseKeyChunk parses ctrl-t model tuning shortcut in plain and mixed chunks', () => {
  assert.deepEqual(parseKeyChunk('\x14'), [
    { type: INPUT_EVENTS.TOGGLE_MODEL_TUNING }
  ]);
  assert.deepEqual(parseKeyChunk('a\x14\x1b[C'), [
    { type: INPUT_EVENTS.TEXT, value: 'a' },
    { type: INPUT_EVENTS.TOGGLE_MODEL_TUNING },
    { type: INPUT_EVENTS.MOVE_RIGHT }
  ]);
});

test('parseKeyChunk keeps printable unicode text and bare escape distinct', () => {
  assert.deepEqual(parseKeyChunk('你\x1b'), [
    { type: INPUT_EVENTS.TEXT, value: '你' },
    { type: INPUT_EVENTS.ESCAPE }
  ]);
});

test('parseKeyChunk maps line feed and ctrl-d to newline and exit', () => {
  assert.deepEqual(parseKeyChunk('\n\x04'), [
    { type: INPUT_EVENTS.INSERT_NEWLINE },
    { type: INPUT_EVENTS.EXIT }
  ]);
});

test('parseKeyChunk parses bracketed paste as one text event and normalizes newlines', () => {
  assert.deepEqual(parseKeyChunk('\x1b[200~hello\r\nworld\ragain\x1b[201~'), [
    { type: INPUT_EVENTS.TEXT, value: 'hello\nworld\nagain' }
  ]);
});

test('parseKeyChunk keeps submit outside bracketed paste', () => {
  assert.deepEqual(parseKeyChunk('a\x1b[200~b\rc\x1b[201~\r'), [
    { type: INPUT_EVENTS.TEXT, value: 'a' },
    { type: INPUT_EVENTS.TEXT, value: 'b\nc' },
    { type: INPUT_EVENTS.SUBMIT }
  ]);
});

test('parseKeyChunk does not buffer incomplete escape sequences across chunks', () => {
  assert.deepEqual(parseKeyChunk('\x1b'), [{ type: INPUT_EVENTS.ESCAPE }]);
  assert.deepEqual(parseKeyChunk('[A'), [
    { type: INPUT_EVENTS.TEXT, value: '[' },
    { type: INPUT_EVENTS.TEXT, value: 'A' }
  ]);
});

test('createKeyParser keeps bracketed paste state across chunks', () => {
  const parser = createKeyParser();

  assert.deepEqual(parser.parse('a\x1b[200~hello\r'), [
    { type: INPUT_EVENTS.TEXT, value: 'a' }
  ]);
  assert.deepEqual(parser.parse('\nworld\r'), []);
  assert.deepEqual(parser.parse('again\x1b[201~\r'), [
    { type: INPUT_EVENTS.TEXT, value: 'hello\nworld\nagain' },
    { type: INPUT_EVENTS.SUBMIT }
  ]);
});

test('createKeyParser handles split bracketed paste markers', () => {
  const parser = createKeyParser();

  assert.deepEqual(parser.parse('\x1b[20'), []);
  assert.deepEqual(parser.parse('0~hello\rwor'), []);
  assert.deepEqual(parser.parse('ld\x1b[20'), []);
  assert.deepEqual(parser.parse('1~x'), [
    { type: INPUT_EVENTS.TEXT, value: 'hello\nworld' },
    { type: INPUT_EVENTS.TEXT, value: 'x' }
  ]);
});

test('createKeyParser parses split SGR mouse reports without leaking bytes into text', () => {
  const parser = createKeyParser();

  assert.deepEqual(parser.parse('\x1b[<32;12'), []);
  assert.deepEqual(parser.parse(';8M'), [{
    type: INPUT_EVENTS.MOUSE,
    phase: 'move',
    button: 'left',
    column: 12,
    row: 8,
    shift: false,
    alt: false,
    ctrl: false
  }]);
  assert.deepEqual(parser.parse('\x1b[<0;12;8M\x1b[<0;12;8m'), [
    {
      type: INPUT_EVENTS.MOUSE,
      phase: 'down',
      button: 'left',
      column: 12,
      row: 8,
      shift: false,
      alt: false,
      ctrl: false
    },
    {
      type: INPUT_EVENTS.MOUSE,
      phase: 'up',
      button: 'left',
      column: 12,
      row: 8,
      shift: false,
      alt: false,
      ctrl: false
    }
  ]);
  assert.deepEqual(parser.parse('\x1b[<35;12;8M'), [{
    type: INPUT_EVENTS.MOUSE,
    phase: 'move',
    button: 'other',
    column: 12,
    row: 8,
    shift: false,
    alt: false,
    ctrl: false
  }]);
});

test('createKeyParser buffers split vertical wheel reports and preserves consecutive directions and nearby text', () => {
  const parser = createKeyParser();
  assert.deepEqual(parser.parse('a\x1b[<64;12'), [{type: INPUT_EVENTS.TEXT, value: 'a'}]);
  assert.deepEqual(parser.parse(';8M\x1b[<65;12;8M\x1b[<64;3;4'), [
    {type: INPUT_EVENTS.MOUSE_WHEEL, direction: 'up', column: 12, row: 8},
    {type: INPUT_EVENTS.MOUSE_WHEEL, direction: 'down', column: 12, row: 8}
  ]);
  assert.deepEqual(parser.parse('M\r'), [
    {type: INPUT_EVENTS.MOUSE_WHEEL, direction: 'up', column: 3, row: 4},
    {type: INPUT_EVENTS.SUBMIT}
  ]);
});

test('parseKeyChunk discards modified, horizontal, released and invalid wheel reports without leaking text or mouse clicks', () => {
  const invalid = [
    68, 72, 80, 96, 97, 66, 67, 255, 256
  ].map((code) => `\x1b[<${code};5;6M`).join('');
  assert.deepEqual(parseKeyChunk(`\x1b[<64;5;6m${invalid}\x1b[<64;0;6M\x1b[<65;5;0M\x1b[<65;99999;6M!`), [
    {type: INPUT_EVENTS.TEXT, value: '!'}
  ]);
  assert.deepEqual(parseKeyChunk('\x1b[<0;5;6M\x1b[<65;5;6M'), [
    {type: INPUT_EVENTS.MOUSE, phase: 'down', button: 'left', column: 5, row: 6, shift: false, alt: false, ctrl: false},
    {type: INPUT_EVENTS.MOUSE_WHEEL, direction: 'down', column: 5, row: 6}
  ]);
});

test('createKeyParser consumes cursor position replies and malformed mouse CSI without creating text', () => {
  const parser = createKeyParser();

  assert.deepEqual(parser.parse('\x1b[14;27R'), [{type: INPUT_EVENTS.CURSOR_POSITION, row: 14, column: 27}]);
  assert.deepEqual(parser.parse('\x1b[<xignored'), [
    {type: INPUT_EVENTS.TEXT, value: 'i'},
    {type: INPUT_EVENTS.TEXT, value: 'g'},
    {type: INPUT_EVENTS.TEXT, value: 'n'},
    {type: INPUT_EVENTS.TEXT, value: 'o'},
    {type: INPUT_EVENTS.TEXT, value: 'r'},
    {type: INPUT_EVENTS.TEXT, value: 'e'},
    {type: INPUT_EVENTS.TEXT, value: 'd'}
  ]);
  assert.deepEqual(parser.parse('\x1b[<9;2'), []);
  assert.deepEqual(parser.parse(';0M'), []);
});

test('createKeyParser drops overlong terminal reports until their CSI terminator', () => {
  const parser = createKeyParser();
  const prefix = `\x1b[<${'1'.repeat(62)}`;

  assert.deepEqual(parser.parse(prefix), []);
  assert.deepEqual(parser.parse(';2;3Mafter'), [
    {type: INPUT_EVENTS.TEXT, value: 'a'},
    {type: INPUT_EVENTS.TEXT, value: 'f'},
    {type: INPUT_EVENTS.TEXT, value: 't'},
    {type: INPUT_EVENTS.TEXT, value: 'e'},
    {type: INPUT_EVENTS.TEXT, value: 'r'}
  ]);
  assert.deepEqual(parser.parse(`\x1b[<${'1'.repeat(62)};2;3Mnext`), [
    {type: INPUT_EVENTS.TEXT, value: 'n'},
    {type: INPUT_EVENTS.TEXT, value: 'e'},
    {type: INPUT_EVENTS.TEXT, value: 'x'},
    {type: INPUT_EVENTS.TEXT, value: 't'}
  ]);

  const cursorPrefix = `\x1b[${'1'.repeat(61)};2`;
  assert.deepEqual(parser.parse(cursorPrefix), []);
  assert.deepEqual(parser.parse('Rdone'), [
    {type: INPUT_EVENTS.TEXT, value: 'd'},
    {type: INPUT_EVENTS.TEXT, value: 'o'},
    {type: INPUT_EVENTS.TEXT, value: 'n'},
    {type: INPUT_EVENTS.TEXT, value: 'e'}
  ]);
});
