const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TUI_THEME, createTuiTheme } = require('../../src/config/theme-config');
const { highlightCodeBlock } = require('../../src/render/markdown/syntax-highlight');

function renderSpans(spansByLine) {
  return spansByLine.map((spans) => spans.map((span) => (span.style ? span.style(span.text) : span.text)).join(''));
}

function plainSpans(spansByLine) {
  return spansByLine.map((spans) => spans.map((span) => span.text).join(''));
}

test('highlightCodeBlock applies generic token styles to all languages', () => {
  const lines = renderSpans(highlightCodeBlock(['const value = call("x", 42); // comment']));

  assert.match(lines[0], /\x1b\[1m\x1b\[38;2;170;0;170mconst\x1b\[39m\x1b\[22m/);
  assert.match(lines[0], /\x1b\[38;2;0;170;170mvalue\x1b\[39m/);
  assert.match(lines[0], /\x1b\[1m\x1b\[38;5;208mcall\x1b\[39m\x1b\[22m/);
  assert.match(lines[0], /\x1b\[38;2;0;170;0m"x"\x1b\[39m/);
  assert.match(lines[0], /\x1b\[38;2;170;85;0m42\x1b\[39m/);
  assert.match(lines[0], /\x1b\[38;2;85;85;85m\/\/ comment\x1b\[39m/);
});

test('highlightCodeBlock keeps string state across lines', () => {
  const lines = renderSpans(highlightCodeBlock(['const text = "first', 'second";', 'return text;']));

  assert.match(lines[0], /\x1b\[38;2;0;170;0m"first\x1b\[39m/);
  assert.match(lines[1], /\x1b\[38;2;0;170;0msecond"\x1b\[39m/);
  assert.match(lines[2], /\x1b\[1m\x1b\[38;2;170;0;170mreturn\x1b\[39m\x1b\[22m/);
});

test('highlightCodeBlock keeps block comment state across lines', () => {
  const lines = renderSpans(highlightCodeBlock(['/* start', 'still comment */ const done = true;']));

  assert.match(lines[0], /\x1b\[38;2;85;85;85m\/\* start\x1b\[39m/);
  assert.match(lines[1], /\x1b\[38;2;85;85;85mstill comment \*\/\x1b\[39m/);
  assert.match(lines[1], /\x1b\[1m\x1b\[38;2;170;0;170mconst\x1b\[39m\x1b\[22m/);
});

test('highlightCodeBlock preserves text for partial tokens and empty lines', () => {
  const spans = highlightCodeBlock(['value = "unfinished', '', 'still string']);

  assert.deepEqual(plainSpans(spans), ['value = "unfinished', '', 'still string']);
  assert.doesNotThrow(() => renderSpans(spans));
});

test('highlightCodeBlock uses syntax styles from render theme', () => {
  const theme = createTuiTheme({
    syntax: {
      keyword: { foreground: '#010203', bold: true },
      function: { foreground: {ansi256: 208}, bold: true },
      variable: { foreground: '#040506' },
      string: { foreground: 'not-a-color' },
      unknown: { foreground: '#ffffff' }
    }
  });
  const rendered = renderSpans(highlightCodeBlock(['const text = call("x");'], theme.syntax))[0];

  assert.match(rendered, /\x1b\[1m\x1b\[38;2;1;2;3mconst\x1b\[39m\x1b\[22m/);
  assert.match(rendered, /\x1b\[38;2;4;5;6mtext\x1b\[39m/);
  assert.match(rendered, /\x1b\[1m\x1b\[38;5;208mcall\x1b\[39m\x1b\[22m/);
  assert.match(rendered, /\x1b\[38;2;0;170;0m"x"\x1b\[39m/);
  assert.deepEqual(DEFAULT_TUI_THEME.syntax.string, theme.syntax.string);
});
