const test = require('node:test');
const assert = require('node:assert/strict');

const { createTuiTheme } = require('../../src/config/theme-config');
const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const { renderAssistantMessageLines, renderBanner, renderPendingAssistantLines, renderReasoningSummaryLines, renderShellBlock, renderUserBlock, renderUserMessageLines, renderErrorMessageLines } = require('../../src/render/blocks');

test('renderBanner returns a large startup header at wide widths', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    terminalSize: { columns: 80, rows: 24 },
    mode: 'current terminal'
  }).split('\n');

  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('███████╗ ██████╗██╗  ██╗ ██████╗')));
  assert.ok(plainLines.some((line) => line.includes('╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝')));
  assert.ok(plainLines.some((line) => line.includes('cwd  /tmp/echo_tui')));
  assert.ok(plainLines.some((line) => line.includes('node v20.0.0')));
  assert.equal(plainLines.some((line) => line.includes('terminal session')), false);
  assert.equal(plainLines.some((line) => line.includes('current terminal')), false);
  assert.equal(plainLines.some((line) => line.includes('tty')), false);
  assert.equal(plainLines.some((line) => line.includes('records append-only')), false);
});

test('renderBanner falls back to a compact boxed header on narrower terminals', () => {
  const lines = renderBanner({
    cwd: '/tmp/echo_tui',
    nodeVersion: 'v20.0.0',
    terminalSize: { columns: 20, rows: 24 },
    mode: 'current terminal'
  }).split('\n');

  const plainLines = lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('╭')));
  assert.ok(plainLines.some((line) => line.includes('echo_tui')));
  assert.ok(plainLines.some((line) => line.includes('node v20.0.0')));
  assert.equal(plainLines.some((line) => line.includes('session')), false);
  assert.equal(plainLines.some((line) => line.includes('tty')), false);
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

test('renderPendingAssistantLines leaves thinking to the status line', () => {
  const lines = renderPendingAssistantLines({ kind: 'thinking', elapsedMs: 0 }, 80);

  assert.deepEqual(lines, []);
});

test('renderPendingAssistantLines keeps streaming preview as plain text without thinking label', () => {
  const lines = renderPendingAssistantLines({ kind: 'streaming', text: 'draft output' }, 80).map((line) => stripAnsi(line));

  assert.deepEqual(lines, ['◇ draft output']);
});

test('renderPendingAssistantLines renders shell output as plain text without markdown', () => {
  const lines = renderPendingAssistantLines({
    kind: 'shell_output',
    command: 'printf markdown',
    output: '# title\n| a | b |\n```js\nconst x = 1;\n```\n'
  }, 80).map((line) => stripAnsi(line).trimEnd());

  assert.deepEqual(lines, [
    '$ printf markdown',
    '',
    '# title',
    '| a | b |',
    '```js',
    'const x = 1;',
    '```'
  ]);
});

test('renderAssistantMessageLines renders assistant markdown while user and error stay plain text', () => {
  const assistantLines = renderAssistantMessageLines(['# Title', '- item', '```js', 'const x = 1;', '```'].join('\n'), 80);
  const assistantPlain = assistantLines.map((line) => stripAnsi(line));
  const userPlain = renderUserMessageLines('# not heading', 80).map((line) => stripAnsi(line));
  const errorPlain = renderErrorMessageLines('**not bold**', 80).map((line) => stripAnsi(line));

  assert.deepEqual(assistantPlain, ['◆ Title', '  • item', '  const x = 1;']);
  assert.ok(assistantLines.some((line) => line.includes('\x1b[38;2;170;0;170mconst')));
  assert.ok(userPlain.some((line) => line.includes('▌ # not heading')));
  assert.ok(errorPlain.some((line) => line.includes('✕ **not bold**')));
});

test('renderReasoningSummaryLines renders low-emphasis plain text', () => {
  const lines = renderReasoningSummaryLines('**not final**', 80);
  const plain = lines.map((line) => stripAnsi(line).trimEnd());

  assert.deepEqual(plain, ['◇ **not final**']);
  assert.match(lines[0], /\x1b\[2m/);
});

test('renderShellBlock renders command output as green message text without tool labels', () => {
  const block = renderShellBlock('$ pwd\n\n/workspace\n\n[exit 1]', 80);
  const plain = stripAnsi(block);

  assert.ok(plain.includes('$ pwd'));
  assert.ok(plain.includes('/workspace'));
  assert.ok(plain.includes('[exit 1]'));
  assert.equal(plain.includes('tool_call'), false);
  assert.equal(plain.includes('tool_result'), false);
  assert.match(block, /\x1b\[38;2;0;170;0m/);
});

test('renderUserMessageLines uses explicit bright foreground on gray background', () => {
  const line = renderUserMessageLines('hello', 80)[0];

  assert.ok(stripAnsi(line).startsWith('▌ hello'));
  assert.match(line, /\x1b\[48;5;235m/);
  assert.match(line, /\x1b\[38;2;0;170;170m▌ /);
  assert.match(line, /\x1b\[38;2;255;255;255m/);
  assert.doesNotMatch(line, /\x1b\[30m/);
});

test('renderUserMessageLines expands tabs before padding user message rows', () => {
  const width = 24;
  const lines = renderUserMessageLines('\tat stack', width);
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.equal(plainLines.length, 1);
  assert.equal(plainLines[0].includes('\t'), false);
  assert.equal(plainLines[0].startsWith('▌       at stack'), true);
  assert.equal(displayWidth(plainLines[0]), safeRenderWidth(width));
});

test('renderUserMessageLines uses plan color only for plan user prefix', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        userBackground: {ansi256: 99},
        userPrefix: [4, 5, 6],
        userText: [7, 8, 9]
      }
    },
    footer: {
      colors: {
        plan: [170, 150, 245]
      }
    }
  });
  const line = renderUserMessageLines('hello', 80, theme, 'plan')[0];

  assert.ok(stripAnsi(line).startsWith('▌ hello'));
  assert.ok(line.includes('\x1b[48;5;99m'));
  assert.ok(line.includes('\x1b[38;2;170;150;245m▌ '));
  assert.ok(line.includes('\x1b[38;2;7;8;9mhello'));
  assert.equal(line.includes('\x1b[38;2;4;5;6m▌ '), false);
});

test('renderUserBlock keeps gray padding lines with quote prefix', () => {
  const lines = renderUserBlock('hello', 30).split('\n');
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[1].startsWith('▌ '), true);
  assert.equal(plainLines[2].startsWith('▌ hello'), true);
  assert.equal(plainLines[3].startsWith('▌ '), true);
  assert.match(lines[1], /\x1b\[48;5;235m/);
  assert.match(lines[3], /\x1b\[48;5;235m/);
});

test('block renderers apply custom blocks theme tokens', () => {
  const theme = createTuiTheme({
    blocks: {
      colors: {
        bannerAccent: [1, 2, 3],
        userBackground: {ansi256: 99},
        userPrefix: [4, 5, 6],
        userText: [7, 8, 9],
        assistantPrefix: [10, 11, 12],
        pendingPrefix: [13, 14, 15],
        error: [16, 17, 18],
        reasoning: [19, 20, 21],
        shell: [22, 23, 24]
      }
    },
    markdown: {
      styles: {
        rolePrefix: {foreground: [10, 11, 12]}
      }
    }
  });
  const banner = renderBanner({cwd: '/tmp/echo_tui', nodeVersion: 'v20.0.0', terminalSize: {columns: 20, rows: 24}, mode: 'current terminal'}, theme);
  const user = renderUserMessageLines('hello', 80, theme)[0];
  const assistant = renderAssistantMessageLines('hello', 80, theme)[0];
  const pending = renderPendingAssistantLines({kind: 'streaming', text: 'hello'}, 80, Number.POSITIVE_INFINITY, theme)[0];
  const error = renderErrorMessageLines('bad', 80, theme)[0];
  const reasoning = renderReasoningSummaryLines('thinking', 80, theme)[0];
  const shell = renderShellBlock('$ pwd', 80, theme);

  assert.ok(banner.includes('\x1b[38;2;1;2;3m'));
  assert.ok(user.includes('\x1b[48;5;99m'));
  assert.ok(user.includes('\x1b[38;2;4;5;6m▌ '));
  assert.ok(user.includes('\x1b[38;2;7;8;9mhello'));
  assert.ok(assistant.includes('\x1b[38;2;10;11;12m◆'));
  assert.ok(pending.includes('\x1b[38;2;13;14;15m◇'));
  assert.ok(error.includes('\x1b[38;2;16;17;18m✕'));
  assert.ok(reasoning.includes('\x1b[38;2;19;20;21m'));
  assert.ok(shell.includes('\x1b[38;2;22;23;24m'));
});

test('renderAssistantMessageLines renders assistant tables while user and error stay plain text', () => {
  const table = ['| Name | Count |', '| --- | ---: |', '| alpha | 12 |'].join('\n');
  const assistantPlain = renderAssistantMessageLines(table, 80).map((line) => stripAnsi(line));
  const userPlain = renderUserMessageLines(table, 80).map((line) => stripAnsi(line));
  const errorPlain = renderErrorMessageLines(table, 80).map((line) => stripAnsi(line));

  assert.ok(assistantPlain.some((line) => line.includes('│')));
  assert.ok(assistantPlain.some((line) => line.startsWith('◆ Name')));
  assert.ok(assistantPlain.some((line) => line.startsWith('  ─')));
  assert.ok(userPlain.some((line) => line.includes('▌ | Name | Count |')));
  assert.ok(errorPlain.some((line) => line.includes('✕ | Name | Count |')));
});

test('renderPendingAssistantLines renders streaming markdown before applying tail collapse', () => {
  const text = ['# Plan', '- first', '- second', '```', 'code', '```'].join('\n');
  const lines = renderPendingAssistantLines({ kind: 'streaming', text }, 80, 3).map((line) => stripAnsi(line));

  assert.equal(lines.length, 3);
  assert.equal(lines[0], '◇ …已生成 4 行，显示最新 2 行');
  assert.ok(lines.includes('  code'));
});

test('renderPendingAssistantLines renders streaming tables and tolerates partial tables', () => {
  const table = ['| Name | Count |', '| --- | ---: |', '| alpha | 12 |'].join('\n');
  const tableLines = renderPendingAssistantLines({ kind: 'streaming', text: table }, 80).map((line) => stripAnsi(line));
  const partialLines = renderPendingAssistantLines({ kind: 'streaming', text: '| Name | Count |' }, 80).map((line) => stripAnsi(line));

  assert.ok(tableLines.some((line) => line.includes('│')));
  assert.equal(tableLines[0].startsWith('◇ Name'), true);
  assert.deepEqual(partialLines, ['◇ | Name | Count |']);
});

test('renderPendingAssistantLines renders streaming code with cross-line syntax highlight', () => {
  const text = ['```js', 'const text = "first', 'second";', '```'].join('\n');
  const lines = renderPendingAssistantLines({ kind: 'streaming', text }, 80);
  const plainLines = lines.map((line) => stripAnsi(line));

  assert.deepEqual(plainLines, ['◇ const text = "first', '  second";']);
  assert.ok(lines[0].includes('\x1b[38;2;170;0;170mconst'));
  assert.ok(lines[0].includes('\x1b[38;2;0;170;0m"first\x1b[39m'));
  assert.ok(lines[1].includes('\x1b[38;2;0;170;0msecond"\x1b[39m'));
});

test('renderPendingAssistantLines collapses long streaming preview to a bounded tail', () => {
  const text = Array.from({ length: 14 }, (_value, index) => `line ${index + 1}`).join('\n');
  const lines = renderPendingAssistantLines({ kind: 'streaming', text }, 80, 9).map((line) => stripAnsi(line));

  assert.equal(lines.length, 9);
  assert.equal(lines[0], '◇ …已生成 14 行，显示最新 8 行');
  assert.ok(!lines.includes('◇ line 1'));
  assert.ok(!lines.includes('  line 1'));
  assert.ok(lines.some((line) => line.includes('line 7')));
  assert.ok(lines.some((line) => line.includes('line 14')));
});

test('renderPendingAssistantLines collapses long shell output preview to a bounded tail', () => {
  const output = Array.from({ length: 14 }, (_value, index) => `line ${index + 1}`).join('\n');
  const lines = renderPendingAssistantLines({ kind: 'shell_output', command: 'long', output }, 80, 5).map((line) => stripAnsi(line).trimEnd());

  assert.equal(lines.length, 5);
  assert.equal(lines[0], '…已生成 16 行，显示最新 4 行');
  assert.ok(!lines.includes('$ long'));
  assert.ok(!lines.includes('line 1'));
  assert.ok(lines.includes('line 11'));
  assert.ok(lines.includes('line 14'));
});
