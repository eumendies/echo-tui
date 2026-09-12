const test = require('node:test');
const assert = require('node:assert/strict');

const { createTuiTheme } = require('../../src/config/theme-config');
const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const { getCommittableReasoningText, getCommittableStreamingText, renderAssistantMessageLines, renderBanner, renderPendingAssistantLines, renderReasoningSummaryLines, renderShellBlock, renderStreamingCommitLines, renderSubagentViewIndex, renderUserBlock, renderUserMessageLines, renderErrorMessageLines } = require('../../src/render/blocks');
const {getCommittableMarkdownText} = require('../../src/render/markdown');

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

test('renderPendingAssistantLines leaves thinking to the status line', () => {
  const lines = renderPendingAssistantLines({ kind: 'thinking', elapsedMs: 0 }, 80);

  assert.deepEqual(lines, []);
});

test('renderPendingAssistantLines groups multiple tools into compact ordered rows', () => {
  const pending = {
    kind: 'tool_calls',
    calls: [
      {callId: 'grep-1', toolName: 'grep', argumentsText: '{"pattern":"needle","paths":["src"]}'},
      {callId: 'glob-1', toolName: 'glob', argumentsText: '{"pattern":"**/*.ts","paths":["test"]}'},
      {callId: 'fetch-1', toolName: 'web_fetch', argumentsText: '{"url":"https://example.com/docs"}'}
    ]
  };
  const lines = renderPendingAssistantLines(pending, 80, 10).map(stripAnsi);

  assert.deepEqual(lines, [
    '◆ 3 tools · running',
    '  ├─ Grep · “needle” · in src',
    '  ├─ Glob · “**/*.ts” · in test',
    '  └─ Web fetch · example.com/docs'
  ]);
  assert.equal(lines.some((line) => /searching|fetching/u.test(line)), false);
});

test('renderPendingAssistantLines bounds compact tools by hidden call count and safe width', () => {
  const pending = {
    kind: 'tool_calls',
    calls: [
      {callId: 'grep-1', toolName: 'grep', argumentsText: JSON.stringify({pattern: 'needle'.repeat(20), paths: ['src']})},
      {callId: 'glob-1', toolName: 'glob', argumentsText: '{"pattern":"**/*.ts"}'},
      {callId: 'read-1', toolName: 'read_files', argumentsText: '{"files":[{"path":"src/a.ts"}]}'},
      {callId: 'search-1', toolName: 'web_search', argumentsText: '{"query":"Echo TUI"}'}
    ]
  };
  const constrained = renderPendingAssistantLines(pending, 32, 3).map(stripAnsi);
  const titleOnly = renderPendingAssistantLines(pending, 32, 1).map(stripAnsi);
  const extremelyNarrow = renderPendingAssistantLines(pending, 4, 3);

  assert.deepEqual(constrained.slice(0, 1), ['◆ 4 tools · running']);
  assert.ok(constrained[1].startsWith('  ├─ Grep · “needle'));
  assert.equal(constrained[2], '  └─ … +3 more');
  assert.deepEqual(titleOnly, ['◆ 4 tools · running']);
  assert.ok(constrained.every((line) => displayWidth(line) <= safeRenderWidth(32)));
  assert.ok(extremelyNarrow.every((line) => displayWidth(line) <= safeRenderWidth(4)));
});

test('renderPendingAssistantLines groups parallel subagents into compact ordered rows', () => {
  const pending = {
    kind: 'subagents',
    runs: [
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 14100, phase: 'tool', runId: 'r1', task: 'first investigation', toolName: 'grep'},
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 9800, phase: 'waiting_approval', runId: 'r2', task: 'second investigation'}
    ]
  };
  const lines = renderPendingAssistantLines(pending, 120, 10).map(stripAnsi);

  assert.deepEqual(lines, [
    '◆ 2 agents · 14.1s · ctrl+o 详情',
    '  ├─ explorer · first investigation · tool · grep · 14.1s',
    '  └─ explorer · second investigation · waiting approval · 9.8s'
  ]);
});

test('renderPendingAssistantLines bounds parallel subagent rows by budget and safe width', () => {
  const runs = Array.from({length: 5}, (_, index) => ({
    kind: 'subagent', agentName: 'explorer', elapsedMs: (index + 1) * 1000, phase: 'thinking', runId: `r${index}`, task: `task ${index}`
  }));
  const constrained = renderPendingAssistantLines({kind: 'subagents', runs}, 60, 3).map(stripAnsi);
  const titleOnly = renderPendingAssistantLines({kind: 'subagents', runs}, 60, 1).map(stripAnsi);

  assert.deepEqual(constrained.slice(0, 1), ['◆ 5 agents · 5.0s · ctrl+o 详情']);
  assert.equal(constrained[1], '  ├─ explorer · task 0 · thinking · 1.0s');
  assert.equal(constrained[2], '  └─ … +4 more');
  assert.deepEqual(titleOnly, ['◆ 5 agents · 5.0s · ctrl+o 详情']);
  assert.ok(constrained.every((line) => displayWidth(line) <= safeRenderWidth(60)));
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

test('renderShellBlock safely displays an offloading marker and tail preview', () => {
  const marker = '[tool result truncated: /tmp/tool-results/result.txt]';
  const plain = stripAnsi(renderShellBlock(`$ command\n\n${marker}\n\ntail output`, 80));

  assert.match(plain, /\[tool result truncated: \/tmp\/tool-results\/result\.txt\]/);
  assert.match(plain, /tail output/);
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

test('getCommittableMarkdownText keeps unstable tail, table candidates, and unclosed fences pending', () => {
  assert.equal(getCommittableMarkdownText('first\n\nsecond'), 'first\n');
  assert.equal(getCommittableStreamingText('| Name | Count |'), '');
  assert.equal(getCommittableStreamingText('| Name | Count |\n| ---'), '');
  assert.equal(getCommittableStreamingText('| Name | Count |\n| --- | --- |\n| a | b |\n'), '');
  assert.match(getCommittableStreamingText('| Name | Count |\n| --- | --- |\n| a | b |\n\nafter'), /\| a \| b \|/);
  assert.equal(getCommittableStreamingText('before\n\n```ts\nconst value = 1;'), 'before\n');
  assert.equal(getCommittableStreamingText('```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```'), '');
  assert.match(getCommittableStreamingText('```md\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```\n\nafter'), /```md/);
});

test('renderStreamingCommitLines equals the stable prefix of the final assistant projection', () => {
  const first = getCommittableStreamingText('alpha\n\nbeta');
  const second = getCommittableStreamingText('alpha\n\nbeta\n\ngamma');
  const firstLines = renderStreamingCommitLines('assistant', first, '', 30);
  const secondLines = renderStreamingCommitLines('assistant', second, first, 30);
  assert.deepEqual([...firstLines, ...secondLines], renderAssistantMessageLines(second, 30));
});

test('renderPendingAssistantLines removes committed projection without repeating the role prefix', () => {
  const text = 'alpha\n\nbeta';
  const historyText = getCommittableStreamingText(text);
  const lines = renderPendingAssistantLines({kind: 'streaming', text, historyText}, 80).map((line) => stripAnsi(line));
  assert.ok(lines.some((line) => line.includes('beta')));
  assert.equal(lines.some((line) => line.startsWith('◇ ')), false);
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


test('renderPendingAssistantLines renders reasoning streaming preview', () => {
  const lines = renderPendingAssistantLines({ kind: 'reasoning_streaming', text: 'thinking\nmore' }, 80).map((line) => stripAnsi(line).trimEnd());

  assert.deepEqual(lines, ['◇ thinking', '  more']);
});

test('getCommittableReasoningText commits complete visual lines before provider done', () => {
  const text = `${'a'.repeat(90)} tail`;
  const committed = getCommittableReasoningText(text, 40);

  assert.ok(committed.length > 0);
  assert.ok(committed.length < text.length);
  const lines = renderPendingAssistantLines({kind: 'reasoning_streaming', text, historyText: committed}, 40);
  assert.ok(lines.length >= 1);
  assert.ok(lines.length < renderReasoningSummaryLines(text, 40).length);
});

test('renderPendingAssistantLines bounds reasoning streaming preview', () => {
  const reasoningText = Array.from({ length: 6 }, (_value, index) => `thought ${index + 1}`).join('\n');
  const lines = renderPendingAssistantLines({ kind: 'reasoning_streaming', text: reasoningText }, 80, 5).map((line) => stripAnsi(line).trimEnd());

  assert.equal(lines.length, 5);
  assert.equal(lines[0], '◇ …已生成 6 行 reasoning，显示最新 4 行');
  assert.ok(lines.some((line) => line.includes('thought 6')));
  assert.ok(!lines.some((line) => line.includes('thought 1')));
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

test('message blocks pad and wrap composite emoji at grapheme width', () => {
  // 家庭 emoji 整体 2 列；宽度统计与 padding 必须与 displayWidth 一致。
  const family = '👨‍👩‍👧‍👦';
  const lines = renderUserMessageLines(`${family}${family}${family}`, 6).map((line) => stripAnsi(line));

  for (const line of lines) {
    assert.ok(displayWidth(line) <= 5, `line width ${displayWidth(line)} exceeds safe width`);
    // 家族 emoji 自身含 ZWJ；行首/行尾不应出现悬挂的 ZWJ 或半个 emoji。
    const plain = line.trim();
    assert.ok(!plain.startsWith('\u200d') && !plain.endsWith('\u200d'), 'dangling ZWJ at line boundary');
  }

  // 组合字符序列（e + 组合音标）不撑大行宽，padding 后总宽等于 safe width。
  const composed = 'e\u0301';
  const padded = renderUserMessageLines(`${composed}a`, 10).map((line) => stripAnsi(line))[0];
  assert.equal(displayWidth(padded), 9);
});

test('renderPendingAssistantLines collapses multi-line subagent tasks into physical single rows', () => {
  const pending = {
    kind: 'subagents',
    runs: [
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 1200, phase: 'thinking', runId: 'r1', task: '第一行任务\n请回答：echo-tui.ts 与 compaction'},
      {kind: 'subagent', agentName: 'explorer', elapsedMs: 2400, phase: 'tool', runId: 'r2', task: '第二个\n任务', toolName: 'grep'}
    ]
  };
  const lines = renderPendingAssistantLines(pending, 80, 10);

  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => !line.includes('\n')));
  assert.ok(lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
  assert.match(stripAnsi(lines[1]), /第一行任务 请回答：echo-tui\.ts 与 compaction · thinking/u);
});

test('renderSubagentViewIndex lists all runs with totals and highlights the watched run', () => {
  const entries = [
    {runId: 'r1', agentName: 'explorer', task: '第一行\n第二行', statusText: '已结束 · 12.0s', active: false},
    {runId: 'r2', agentName: 'explorer', task: '调查任务', statusText: 'thinking · 57.5s', active: true},
    {runId: 'r3', agentName: 'worker', task: '另一任务', statusText: 'tool · grep · 3.0s', active: true}
  ];

  const lines = renderSubagentViewIndex(entries, 'r2', 80).map(stripAnsi);

  assert.equal(lines.length, 4);
  assert.match(lines[0], /◆ subagent 会话 · 运行中 2 · 共 3 个 · ↑\/↓ 切换/u);
  assert.match(lines[1], /1\. explorer · 第一行 第二行 · 已结束 · 12\.0s/u);
  assert.match(lines[2], /▸ 2\. explorer · 调查任务 · thinking · 57\.5s/u);
  assert.match(lines[3], /3\. worker · 另一任务 · tool · grep · 3\.0s/u);
  assert.ok(lines.every((line) => !line.includes('\n')));
  assert.ok(lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
});

test('renderSubagentViewIndex folds long run lists around the watched run', () => {
  const entries = Array.from({length: 12}, (_, index) => ({
    runId: `r${index}`, agentName: 'explorer', task: `任务 ${index}`, statusText: '已结束', active: false
  }));

  const lines = renderSubagentViewIndex(entries, 'r5', 80).map(stripAnsi);

  assert.match(lines[0], /共 12 个/u);
  assert.ok(lines.length <= 9);
  assert.ok(lines.some((line) => /▸ 6\. /u.test(line)));
  assert.ok(lines.some((line) => /↑ 上方/u.test(line)));
  assert.ok(lines.some((line) => /↓ 下方/u.test(line)));
});
