const test = require('node:test');
const assert = require('node:assert/strict');

const { createComposer } = require('../../src/input/composer');
const { createTuiTheme } = require('../../src/config/theme-config');
const { ECHO_SPINNER_ACTIVE_FRAME_COUNT, ECHO_SPINNER_FRAME_INTERVAL_MS, getEchoSpinnerFrameIndex } = require('../../src/render/echo-spinner');
const { renderDiffSurface } = require('../../src/render/footer/diff-surface');
const { createFooterRenderer, renderFooterLayout: renderRuntimeFooterLayout } = require('../../src/render/footer');
const { humanizeTokens } = require('../../src/render/footer/usage-surface');
const { renderStatusSurface: renderRuntimeStatusSurface } = require('../../src/render/footer/status-surface');
const { displayWidth, safeRenderWidth, stripAnsi } = require('../../src/render/layout');
const ansi = require('../../src/terminal/ansi');

const DEFAULT_STATUS_LINE = {
  projectName: 'echo_tui',
  model: {kind: 'default', label: 'GPT-4o'},
  mode: 'idle'
};

function completeCommandSurfaceFixture(surface) {
  if (!surface) {
    return surface;
  }

  switch (surface.kind) {
    case 'info':
      return {title: 'Info', lines: [], dismissHint: 'Esc 关闭', ...surface};
    case 'select':
      return {title: 'Select', options: [], selectedIndex: 0, dismissHint: 'Enter 确认 · Esc 关闭', ...surface};
    case 'resume':
      return {focus: 'list', title: '/resume', sessions: [], selectedIndex: 0, previewScroll: 0, previewRecords: [], emptyPreviewHint: '没有可预览消息', dismissHint: 'Esc 关闭', ...surface};
    case 'skills':
      return {title: 'SKILLS', skills: [], selectedIndex: 0, emptyLines: [], dismissHint: 'Esc 关闭', ...surface};
    case 'mcp':
      return {title: 'MCP', servers: [], selectedIndex: 0, emptyLines: [], dismissHint: 'Esc 关闭', ...surface};
    case 'memory':
      return {title: 'MEMORY', dismissHint: 'Esc 关闭', ...surface};
    case 'hooks':
      return {title: 'HOOKS', dismissHint: 'Esc 关闭', ...surface};
    case 'scale':
      return {title: '刻度', leftLabel: '', rightLabel: '', options: [], selectedIndex: 0, dismissHint: 'Esc 关闭', ...surface};
    case 'choice':
      return {title: '选择', optionsTitle: '操作', options: [], focusedIndex: 0, dismissHint: 'Enter 确认 · Esc 关闭', ...surface};
    case 'confirm':
      return {title: '确认', bodyLines: [], confirmLabel: '确认', cancelLabel: '取消', ...surface};
    case 'config':
      return surface;
    case 'context':
      return {title: '上下文', dismissHint: '上下文占用详情 · 按任意键关闭', ...surface};
    case 'usage':
      return {title: 'Token 用量', offset: 0, dismissHint: 'Esc 关闭', ...surface};
    case 'status':
      return {title: 'Status', dismissHint: 'Esc 关闭', ...surface};
    case 'copy':
      return {title: '/copy', focus: 'list', previewScroll: 0, dismissHint: 'Esc 关闭', ...surface};
    case 'file_picker':
      return {title: '文件', dismissHint: 'Esc 关闭', ...surface};
    case 'diff':
      return {title: '/diff', selectedIndex: 0, detailScroll: 0, ...surface};
    default:
      return surface;
  }
}

function renderFooterLayout(options) {
  return renderRuntimeFooterLayout({
    ...options,
    commandSurface: completeCommandSurfaceFixture(options.commandSurface)
  });
}

function renderStatusSurface(surface, ...args) {
  return renderRuntimeStatusSurface(completeCommandSurfaceFixture(surface), ...args);
}

const CUSTOM_THEME = createTuiTheme({
  footer: {
    colors: {
      accent: [4, 5, 6],
      accentDeep: [10, 11, 12],
      accentStrong: [1, 2, 3],
      usageInput: [1, 2, 3],
      usageCached: [10, 11, 12],
      usageOutput: [7, 8, 9],
      danger: [20, 21, 22],
      diffAddedBackground: {ansi256: 40},
      diffRemovedBackground: {ansi256: 41},
      diffText: {ansi256: 250},
      frame: [30, 31, 32],
      plan: [40, 41, 42],
      selectionBackground: {ansi256: 99},
      success: [7, 8, 9],
      warning: [13, 14, 15]
    }
  }
});

function elapsedInSecondForSpinnerFrame(totalSeconds, frameIndex) {
  const startMs = totalSeconds * 1000;

  for (let elapsedMs = startMs; elapsedMs < startMs + 1000; elapsedMs += 1) {
    if (getEchoSpinnerFrameIndex(elapsedMs) === frameIndex) {
      return elapsedMs;
    }
  }

  throw new Error(`No elapsedMs in second ${totalSeconds} for spinner frame ${frameIndex}`);
}

function assertActiveBackgroundReachesRightPadding(line) {
  const resetIndex = line.lastIndexOf('\x1b[49m');

  assert.notEqual(resetIndex, -1);
  assert.equal(stripAnsi(line.slice(resetIndex + '\x1b[49m'.length)), ' │');
}

test('createFooterRenderer writes each complete redraw as one frame and preserves cleanup and cursor state', () => {
  const output = {
    writes: [],
    write(chunk) {
      this.writes.push(String(chunk));
    }
  };
  const renderer = createFooterRenderer(output);
  const baseState = {
    composer: createComposer('draft'),
    commandSurface: null,
    pending: null,
    working: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 80
  };
  const tallState = {
    ...baseState,
    pending: {kind: 'streaming', text: Array.from({length: 8}, (_value, index) => `line ${index + 1}`).join('\n')}
  };
  const tallLayout = renderFooterLayout(tallState);

  renderer.render(baseState);
  assert.equal(output.writes.length, 1);

  renderer.render(tallState);
  assert.equal(output.writes.length, 2);

  const shortLayout = renderFooterLayout(baseState);
  renderer.render(baseState);
  assert.equal(output.writes.length, 3);
  assert.equal((output.writes[2].match(/\x1b\[2K/g) || []).length, tallLayout.lines.length);
  assert.ok(stripAnsi(output.writes[2]).includes('draft'));
  assert.ok(output.writes[2].endsWith(
    `${ansi.cursorUp(shortLayout.lines.length - 1 - shortLayout.cursorRow)}${ansi.carriageReturn()}${ansi.cursorForward(shortLayout.cursorColumn)}${ansi.showCursor()}`
  ));

  const commandState = {
    ...baseState,
    commandSurface: {kind: 'info', title: 'Info', lines: ['details'], dismissHint: 'Esc 关闭'}
  };
  const commandLayout = renderFooterLayout(commandState);
  renderer.render(commandState);
  assert.equal(output.writes.length, 4);
  assert.equal(output.writes[3].includes(ansi.showCursor()), false);

  renderer.clear();
  assert.equal(output.writes.length, 5);
  assert.equal((output.writes[4].match(/\x1b\[2K/g) || []).length, commandLayout.lines.length);
  assert.ok(output.writes[4].endsWith(ansi.showCursor()));

  renderer.clear();
  assert.equal(output.writes.length, 5);
});

test('renderFooterLayout renders boxed composer and idle segmented status line', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const statusLine = plainLines.at(-1);
  const renderedStatusLine = layout.lines.at(-1);

  assert.equal(plainLines[0], '');
  assert.equal(displayWidth(layout.lines[1]), safeRenderWidth(80));
  assert.equal(displayWidth(layout.lines[2]), safeRenderWidth(80));
  assert.equal(displayWidth(layout.lines[3]), safeRenderWidth(80));
  assert.ok(plainLines[1].startsWith('╭'));
  assert.ok(plainLines[2].includes('> hello'));
  assert.ok(plainLines[3].startsWith('╰'));
  assert.ok(!plainLines.some((line) => line.includes('Message')));
  assert.ok(statusLine.startsWith('GPT-4o'));
  assert.ok(statusLine.includes('echo_tui'));
  assert.ok(statusLine.includes('ready'));
  assert.ok(!statusLine.includes('/ 命令'));
  assert.ok(!statusLine.includes('Ctrl+J 换行'));
  assert.ok(!statusLine.includes('main'));
  assert.ok(renderedStatusLine.includes('\x1b[38;2;90;230;245m'));
  assert.ok(renderedStatusLine.includes('\x1b[1m'));
  assert.ok(renderedStatusLine.includes('\x1b[2m'));
});

test('renderFooterLayout renders empty composer placeholder without changing cursor position', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('> / 命令 · @ 路径 · TAB mode · Ctrl+T 模型 · Shift+Tab 授权 · Ctrl+J 换行')));
  assert.equal(plainLines.some((line) => line.includes('Enter 发送')), false);
  assert.equal(layout.cursorRow, 2);
  assert.equal(layout.cursorColumn, 4);
});

test('renderFooterLayout renders a compact conversation reference above editable composer', () => {
  const composer = createComposer('continue with this');
  const layout = renderFooterLayout({
    composer,
    conversationReference: {projectionMode: 'summary', title: 'MCP 权限分级设计'},
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('引用对话 · 总结')));
  assert.ok(plainLines.some((line) => line.includes('MCP 权限分级设计')));
  assert.ok(plainLines.some((line) => line.includes('Esc 移除')));
  assert.ok(plainLines.some((line) => line.startsWith('↳ 引用对话 · 总结')));
  assert.ok(plainLines.some((line) => line.includes('> continue with this')));
  assert.equal(plainLines.some((line) => line.includes('session-')), false);
  assert.equal(composer.chars.join(''), 'continue with this');
  assert.equal(layout.cursorRow, 4);
});

test('renderFooterLayout changes the reference hint while deferred summary is running', () => {
  const layout = renderFooterLayout({
    composer: createComposer('continue'),
    conversationReference: {preparing: true, projectionMode: 'summary', title: 'Long history'},
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('Esc 取消总结')));
  assert.equal(plainLines.some((line) => line.includes('Esc 移除')), false);
});

test('renderFooterLayout replaces the empty composer placeholder while model tuning', () => {
  const normal = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });
  const tuning = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      model: {
        kind: 'tuning',
        label: 'gpt-deep',
        activeField: 'model',
        effort: 'medium'
      }
    },
    width: 100
  });
  const plainLines = tuning.lines.map((line) => stripAnsi(line));

  assert.equal(tuning.lines.length, normal.lines.length);
  assert.ok(plainLines.some((line) => line.includes('> Tab 切换字段 · ←/→ 调整 · Enter 应用 · Esc 取消')));
  assert.equal(plainLines.some((line) => line.includes('/ 命令 · @ 路径')), false);
  assert.ok(plainLines.at(-1).includes('‹gpt-deep›'));
  assert.ok(plainLines.at(-1).includes('effort medium'));
  assert.equal(plainLines.at(-1).includes('● effort'), false);
  assert.equal(tuning.showCursor, false);
});

test('renderFooterLayout keeps typed composer text and focuses the tuning effort only in status line', () => {
  const layout = renderFooterLayout({
    composer: createComposer('keep this draft'),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      model: {
        kind: 'tuning',
        label: 'gpt-deep',
        activeField: 'effort',
        effort: 'high'
      }
    },
    width: 100
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('> keep this draft')));
  assert.equal(plainLines.some((line) => line.includes('Tab 切换字段 · ←/→ 调整')), false);
  assert.ok(plainLines.at(-1).includes('gpt-deep'));
  assert.ok(plainLines.at(-1).includes('effort ‹high›'));
  assert.equal(layout.showCursor, false);
});

test('renderFooterLayout renders tuning errors safely and restores mode placeholders after exit', () => {
  const tuning = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'plan',
      model: {
        kind: 'tuning',
        label: 'very-long-model-name',
        activeField: 'model',
        effort: 'low',
        error: '无法保存'
      }
    },
    width: 42
  });
  const resized = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'plan',
      model: {
        kind: 'tuning',
        label: 'very-long-model-name',
        activeField: 'model',
        effort: 'low',
        error: '无法保存'
      }
    },
    width: 100
  });
  const restored = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'plan'},
    width: 80
  });

  assert.ok(tuning.lines.every((line) => displayWidth(line) <= safeRenderWidth(42)));
  assert.ok(stripAnsi(tuning.lines.at(-1)).includes('very-long-model-name'));
  assert.ok(stripAnsi(resized.lines.at(-1)).includes('保存失败 无法保存'));
  assert.ok(stripAnsi(resized.lines.at(-1)).includes('‹very-long-model-name›'));
  assert.equal(resized.showCursor, false);
  assert.ok(stripAnsi(restored.lines[2]).includes('? 计划问题'));
  assert.equal(restored.showCursor, true);
});

test('renderFooterLayout keeps boxed composer borders aligned for tab-indented text', () => {
  const width = 24;
  const composer = createComposer('\tat stack');
  const layout = renderFooterLayout({
    composer,
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const composerLine = plainLines.find((line) => line.includes('at stack'));

  assert.equal(composer.chars.includes('\t'), true);
  assert.ok(composerLine);
  assert.equal(composerLine.includes('\t'), false);
  assert.equal(composerLine.startsWith('│ '), true);
  assert.equal(composerLine.endsWith(' │'), true);
  assert.equal(displayWidth(composerLine), safeRenderWidth(width));
});

test('renderFooterLayout hides empty composer placeholder when terminal is too narrow', () => {
  const width = 34;
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(width)));
  assert.ok(plainLines.some((line) => line.includes('>')));
  assert.ok(!plainLines.some((line) => line.includes('/ 命令') || line.includes('Ctrl+J 换行')));
  assert.equal(layout.cursorRow, 2);
  assert.equal(layout.cursorColumn, 4);
});

test('renderFooterLayout renders effort as a compact separate colored segment', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      model: {kind: 'default', label: 'GPT-5.5', effort: 'high'}
    },
    width: 80
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.startsWith('GPT-5.5'));
  assert.ok(plainStatusLine.includes('effort high'));
  assert.equal(plainStatusLine.includes('● effort'), false);
  assert.ok(!plainStatusLine.includes('GPT-5.5 · effort high'));
  assert.ok(layout.lines.at(-1).includes('\x1b[38;2;0;200;220mhigh'));
});

test('renderFooterLayout renders skill model override as part of the model label', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: {kind: 'thinking', elapsedMs: 0},
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      model: {kind: 'default', label: 'claude-sonnet-4-6', skillOverride: true},
      mode: 'thinking'
    },
    width: 100
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.startsWith('claude-sonnet-4-6 (SKILL override)'));
  assert.ok(plainStatusLine.includes('dir echo_tui'));
  assert.ok(!plainStatusLine.includes('│ SKILL override'));
});

test('renderFooterLayout renders allow-all tools status as warning segment', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      allowAllTools: true
    },
    theme: CUSTOM_THEME,
    width: 100
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.includes('TOOLS all'));
  assert.ok(plainStatusLine.indexOf('GPT-4o') < plainStatusLine.indexOf('TOOLS all'));
  assert.ok(plainStatusLine.indexOf('TOOLS all') < plainStatusLine.indexOf('dir echo_tui'));
  assert.ok(layout.lines.at(-1).includes('\x1b[38;2;13;14;15m'));
});

test('renderFooterLayout applies custom theme to composer status and active suggestions', () => {
  const layout = renderFooterLayout({
    composer: createComposer('/'),
    commandSurface: null,
    pending: null,
    slashSuggestions: {
      selectedIndex: 0,
      options: [
        {label: '/help', description: '帮助'}
      ]
    },
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    width: 80
  });
  const joined = layout.lines.join('\n');

  assert.ok(joined.includes('\x1b[38;2;1;2;3m'));
  assert.ok(joined.includes('\x1b[48;5;99m'));
  assert.ok(joined.includes('\x1b[38;2;30;31;32m'));
});

test('renderFooterLayout renders provider context usage in status line', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      contextUsage: {
        usedTokens: 18200,
        contextWindow: 128000,
        source: 'provider'
      }
    },
    width: 100
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.includes('ctx 18.2k/128k'));
  assert.ok(plainStatusLine.indexOf('echo_tui') < plainStatusLine.indexOf('ctx'));
});

test('renderFooterLayout renders small context usage tokens without k suffix', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      contextUsage: {
        usedTokens: 999,
        contextWindow: 8192,
        source: 'provider'
      }
    },
    width: 100
  });

  assert.ok(stripAnsi(layout.lines.at(-1)).includes('ctx 999/8.2k'));
});

test('renderFooterLayout keeps detailed context breakdown out of status line', () => {
  const layout = renderFooterLayout({
    composer: createComposer('hello'),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      contextUsage: {
        usedTokens: 18200,
        contextWindow: 128000,
        source: 'provider',
        segments: [
          {category: 'system', tokens: 1200}
        ]
      }
    },
    width: 100
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.includes('ctx 18.2k/128k'));
  assert.equal(plainStatusLine.includes('System prompt'), false);
});

test('renderFooterLayout renders context usage command surface', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'context',
      title: 'Context',
      usage: {
        usedTokens: 1000,
        contextWindow: 4000,
        source: 'provider',
        segments: [
          {category: 'system', tokens: 200},
          {category: 'skills', tokens: 100},
          {category: 'tools', tokens: 300},
          {category: 'messages', tokens: 400}
        ]
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 90
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('Context')));
  assert.ok(plainLines.some((line) => line.includes('1K')));
  assert.ok(plainLines.some((line) => line.includes('4K tokens')));
  assert.ok(plainLines.some((line) => line.includes('系统提示词')));
  assert.ok(plainLines.some((line) => line.includes('Skills')));
  assert.ok(plainLines.some((line) => line.includes('工具')));
  assert.ok(plainLines.some((line) => line.includes('消息')));
  assert.ok(plainLines.some((line) => line.includes('上下文占用详情 · 按任意键关闭')));
  assert.equal(layout.showCursor, false);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(90)));

  const cardLines = layout.lines.filter((line) => stripAnsi(line).startsWith('╭') || stripAnsi(line).startsWith('│') || stripAnsi(line).startsWith('╰'));
  const cardWidth = displayWidth(cardLines[0]);

  assert.ok(cardLines.length > 0);
  assert.ok(cardLines.every((line) => displayWidth(line) === cardWidth));
});

test('renderFooterLayout keeps context card columns stable with styled usage details', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'context',
      title: 'Context',
      usage: {
        usedTokens: 56800,
        contextWindow: 270000,
        source: 'provider',
        segments: [
          {category: 'tools', tokens: 21000},
          {category: 'reasoning', tokens: 6000},
          {category: 'system', tokens: 9800},
          {category: 'memory', tokens: 2500},
          {category: 'messages', tokens: 14500},
          {category: 'skills', tokens: 3000}
        ]
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 120
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const cardLines = layout.lines.filter((line) => stripAnsi(line).startsWith('╭') || stripAnsi(line).startsWith('│') || stripAnsi(line).startsWith('╰'));
  const cardWidth = displayWidth(cardLines[0]);

  assert.ok(cardLines.length > 0);
  assert.ok(cardLines.every((line) => displayWidth(line) === cardWidth));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(120)));
  const systemIndex = plainLines.findIndex((line) => line.includes('系统提示词'));
  const memoryIndex = plainLines.findIndex((line) => line.includes('Memory'));
  const skillsIndex = plainLines.findIndex((line) => line.includes('Skills'));
  const toolsIndex = plainLines.findIndex((line) => line.includes('工具'));

  assert.ok(plainLines.some((line) => line.includes('56.8K / 270K tokens') && line.includes('21% 已用')));
  assert.ok(plainLines.some((line) => line.includes('工具') && line.includes('21K') && line.includes('37%')));
  assert.ok(plainLines.some((line) => line.includes('消息') && line.includes('14.5K') && line.includes('26%')));
  assert.ok(plainLines.some((line) => line.includes('系统提示词') && line.includes('15.3K') && line.includes('27%')));
  assert.ok(plainLines.some((line) => line.includes('推理') && line.includes('6K') && line.includes('11%')));
  assert.ok(plainLines[memoryIndex].includes('├─') && plainLines[memoryIndex].includes('2.5K'));
  assert.ok(plainLines[skillsIndex].includes('└─') && plainLines[skillsIndex].includes('3K'));
  assert.equal(plainLines[memoryIndex].includes('%'), false);
  assert.equal(plainLines[skillsIndex].includes('%'), false);
  assert.ok(systemIndex < memoryIndex && memoryIndex < skillsIndex && skillsIndex < toolsIndex);
  assert.equal(plainLines.some((line) => line.includes('…')), false);
});

test('renderFooterLayout groups Memory and Skills into the System prompt composition segment', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'context',
      usage: {
        usedTokens: 1000,
        contextWindow: 2000,
        source: 'provider',
        segments: [
          {category: 'system', tokens: 200},
          {category: 'memory', tokens: 200},
          {category: 'skills', tokens: 100},
          {category: 'tools', tokens: 200},
          {category: 'messages', tokens: 200},
          {category: 'reasoning', tokens: 100}
        ]
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    rows: 24,
    width: 90
  });
  const compositionLine = layout.lines.find((line) => {
    const plain = stripAnsi(line);
    return plain.includes('█') && !plain.includes('░');
  });

  assert.ok(compositionLine);
  assert.ok(compositionLine.includes('\x1b[38;2;4;5;6m'));
  assert.ok(compositionLine.includes('\x1b[38;2;7;8;9m'));
  assert.ok(compositionLine.includes('\x1b[38;2;1;2;3m'));
  assert.equal(compositionLine.includes('\x1b[38;2;40;41;42m'), false);
});

test('renderFooterLayout applies custom theme to scale and context surfaces', () => {
  const scale = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'scale',
      title: '推理强度',
      options: [
        {label: 'low', description: 'LOW'},
        {label: 'high', description: 'HIGH'}
      ],
      selectedIndex: 1
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    width: 90
  }).lines.join('\n');
  const context = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'context',
      usage: {
        usedTokens: 900,
        contextWindow: 1000,
        source: 'provider',
        segments: [
          {category: 'tools', tokens: 900}
        ]
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    rows: 24,
    width: 90
  }).lines.join('\n');

  assert.ok(scale.includes('\x1b[38;2;1;2;3m'));
  assert.ok(scale.includes('\x1b[38;2;10;11;12m'));
  assert.ok(context.includes('\x1b[38;2;20;21;22m'));
  assert.ok(context.includes('\x1b[38;2;7;8;9m'));
  assert.ok(context.includes('\x1b[38;2;30;31;32m'));
  assert.equal(context.includes('\x1b[38;2;10;11;12m─'), false);
});

test('renderFooterLayout renders runtime status and Codex usage progress bars', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'status',
      title: 'Status',
      snapshot: {
        agentInstructionFileName: 'AGENTS.md',
        cwd: '/work/echo-tui',
        sessionId: 'session-123',
        model: {agentType: 'codex', model: 'gpt-codex', provider: 'codex-main'},
        agentInstructions: [
          {sourceKind: 'global', label: 'AGENTS.md', filePath: '/home/user/.echo/AGENTS.md'},
          {sourceKind: 'project', label: 'AGENTS.md', filePath: '/work/echo-tui/AGENTS.md'}
        ],
        userMemoryCount: 2,
        agentMemoryCatalogs: [{scope: 'project', name: 'runtime'}],
        diagnostics: []
      },
      usage: {
        status: 'available',
        primary: {usedPercent: 25, resetAt: Date.parse('2030-01-02T03:04:00.000Z')},
        secondary: {usedPercent: 80.5, resetAt: Date.parse('2030-02-03T04:05:00.000Z')}
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    rows: 30,
    width: 90
  });
  const plain = layout.lines.map((line) => stripAnsi(line)).join('\n');

  assert.match(plain, /Status/);
  assert.doesNotMatch(plain, /Runtime Status/);
  assert.match(plain, /目录\s+\/work\/echo-tui/);
  assert.match(plain, /模型\s+gpt-codex/);
  assert.match(plain, /Provider\s+codex-main \(codex\)/);
  assert.match(plain, /Session\s+session-123/);
  assert.match(plain, /Instructions\s+AGENTS\.md · global:AGENTS\.md, project:AGENTS\.md/);
  assert.match(plain, /Memory\s+user:2 · catalogs:project:runtime/);
  assert.match(plain, /5 小时.*25%.*2030-01-02 03:04/);
  assert.match(plain, /每周.*80\.5%.*2030-02-03 04:05/);
  assert.match(plain, /█+░+/);
  assert.equal(/context|ctx|上下文/i.test(plain), false);
  assert.equal(layout.showCursor, false);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(90)));
  assert.ok(layout.lines.join('\n').includes('\x1b[38;2;1;2;3m'));
  assert.ok(layout.lines.join('\n').includes('\x1b[38;2;13;14;15m'));
});

test('renderStatusSurface handles loading, unavailable, not-applicable, and empty state', () => {
  const snapshot = {
    agentInstructionFileName: 'CLAUDE.md',
    cwd: '/tmp/project',
    sessionId: null,
    model: null,
    agentInstructions: [],
    userMemoryCount: 0,
    agentMemoryCatalogs: [],
    diagnostics: ['无法读取 memory']
  };
  const states = [
    [{status: 'loading'}, /正在查询/],
    [{status: 'unavailable', error: '网络不可用'}, /不可用.*网络不可用/]
  ];

  for (const [usage, expected] of states) {
    const layout = renderStatusSurface({kind: 'status', snapshot, usage}, 70, 20, CUSTOM_THEME.footer);
    const plain = layout.lines.map((line) => stripAnsi(line)).join('\n');
    assert.match(plain, /Session\s+未创建/);
    assert.match(plain, /Instructions\s+CLAUDE\.md · 无/);
    assert.match(plain, /Memory\s+user:0 · catalogs:无/);
    assert.match(plain, expected);
    assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(70)));
  }

  const notApplicable = renderStatusSurface({kind: 'status', snapshot, usage: {status: 'not_applicable'}}, 70, 20, CUSTOM_THEME.footer);
  const notApplicablePlain = notApplicable.lines.map((line) => stripAnsi(line)).join('\n');
  assert.doesNotMatch(notApplicablePlain, /Codex/);
  assert.doesNotMatch(notApplicablePlain, /5 小时|每周/);
});

test('renderStatusSurface preserves both quota labels, bars, and percentages in narrow terminal', () => {
  const layout = renderStatusSurface({
    kind: 'status',
    snapshot: {
      agentInstructionFileName: 'AGENTS.md',
      cwd: '/a/very/long/project/path/that/will/be/clamped',
      sessionId: null,
      model: {agentType: 'codex', model: 'gpt-codex', provider: 'codex'},
      agentInstructions: [],
      userMemoryCount: 0,
      agentMemoryCatalogs: [],
      diagnostics: []
    },
    usage: {
      status: 'available',
      primary: {usedPercent: 12, resetAt: Date.parse('2030-01-02T03:04:00.000Z')},
      secondary: {usedPercent: 67, resetAt: Date.parse('2030-02-03T04:05:00.000Z')}
    }
  }, 32, 10, CUSTOM_THEME.footer);
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const plain = plainLines.join('\n');

  assert.match(plain, /5 小时.*12%/);
  assert.match(plain, /每周.*67%/);
  assert.equal(plainLines.filter((line) => /[█░]+/.test(line)).length, 2);
  assert.ok(layout.lines.length <= 10);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(32)));
});

test('renderStatusSurface keeps primary progress when Codex omits weekly window', () => {
  const layout = renderStatusSurface({
    kind: 'status',
    snapshot: {
      agentInstructionFileName: 'AGENTS.md',
      cwd: '/tmp/project',
      sessionId: null,
      model: {agentType: 'codex', model: 'gpt-codex', provider: 'codex'},
      agentInstructions: [],
      userMemoryCount: 0,
      agentMemoryCatalogs: [],
      diagnostics: []
    },
    usage: {
      status: 'available',
      primary: {usedPercent: 12, resetAt: Date.parse('2030-01-02T03:04:00.000Z')}
    }
  }, 70, 20, CUSTOM_THEME.footer);
  const plain = layout.lines.map((line) => stripAnsi(line)).join('\n');

  assert.match(plain, /5 小时.*12%/);
  assert.match(plain, /每周\s+暂无数据/);
});

test('renderFooterLayout renders usage surface with totals, hidden days, and daily rows', () => {
  const dailyUsage = Array.from({length: 16}, (_value, index) => ({
    localDay: `2026-06-${String(index + 1).padStart(2, '0')}`,
    inputTokens: 1000 + index * 100,
    cacheReadInputTokens: 250,
    cacheCreationInputTokens: 50,
    uncachedInputTokens: 750 + index * 100,
    outputTokens: 500 + index * 50,
    totalTokens: 1500 + index * 150,
    hitRate: 250 / (1000 + index * 100),
    eventCount: 1
  }));
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'usage',
      title: 'Token Usage',
      dailyUsage,
      offset: 1
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 100
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.includes('Token Usage')));
  assert.ok(plainLines.some((line) => line.includes('28K')));
  assert.ok(plainLines.some((line) => line.includes('14K')));
  assert.ok(plainLines.some((line) => line.includes('显示 ') && line.includes('/16 · 06/02 - ')));
  assert.ok(plainLines.some((line) => line.includes('◂1') && line.includes('▸')));
  assert.ok(plainLines.some((line) => line.includes('日期') && line.includes('输入') && line.includes('输出') && line.includes('缓存') && line.includes('命中') && line.includes('趋势')));
  assert.ok(plainLines.some((line) => line.includes('06/02') && line.includes('1.1K') && line.includes('550') && line.includes('250') && line.includes('23%')));
  assert.ok(plainLines.some((line) => line.includes('↑/↓ 滚动') && line.includes('PgUp/PgDn 翻页') && line.includes('Home/End 跳转')));
  assert.ok(!plainLines.some((line) => line.includes('双轴') || line.includes('newest at bottom')));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(100)));
  assert.ok(layout.lines.some((line) => displayWidth(line) < 70));
});

test('renderFooterLayout applies custom theme colors to usage token categories', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'usage',
      dailyUsage: [{
        localDay: '2026-06-30',
        inputTokens: 1000,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 100,
        uncachedInputTokens: 700,
        outputTokens: 500,
        totalTokens: 1500,
        hitRate: 0.3,
        eventCount: 2
      }],
      offset: 0
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    rows: 24,
    width: 80
  });
  const rendered = layout.lines.join('\n');

  assert.ok(rendered.includes('\x1b[38;2;1;2;3m'));
  assert.ok(rendered.includes('\x1b[38;2;10;11;12m'));
  assert.ok(rendered.includes('\x1b[38;2;7;8;9m'));
});

test('renderFooterLayout renders usage rows with optional trend scale', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'usage',
      dailyUsage: [{
        localDay: '2026-06-30',
        inputTokens: 200000,
        cacheReadInputTokens: 50000,
        cacheCreationInputTokens: 0,
        uncachedInputTokens: 150000,
        outputTokens: 100,
        totalTokens: 200100,
        hitRate: 0.25,
        eventCount: 1
      }],
      offset: 0
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    rows: 24,
    width: 80
  });
  const rendered = layout.lines.join('\n');
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(rendered.includes('\x1b[38;2;1;2;3m█'));
  assert.ok(plainLines.some((line) => line.includes('200K') && line.includes('100')));
  assert.ok(plainLines.some((line) => line.includes('06/30') && line.includes('50K') && line.includes('25%')));
  assert.ok(plainLines.some((line) => line.includes('趋势')));
  assert.ok(!plainLines.some((line) => line.includes('双轴')));
});

test('renderFooterLayout constrains usage surface in small terminals', () => {
  const dailyUsage = Array.from({length: 9}, (_value, index) => ({
    localDay: `2026-06-${String(index + 1).padStart(2, '0')}`,
    inputTokens: 1000,
    cacheReadInputTokens: 300,
    cacheCreationInputTokens: 100,
    uncachedInputTokens: 700,
    outputTokens: 250,
    totalTokens: 1250,
    hitRate: 0.3,
    eventCount: 1
  }));
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'usage',
      dailyUsage,
      offset: 0
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 8,
    width: 34
  });

  assert.ok(layout.lines.length <= 6);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(34)));
  assert.ok(!layout.lines.map((line) => stripAnsi(line)).some((line) => line.includes('趋势') || line.includes('newest at bottom')));
});

test('humanizeTokens formats usage tokens compactly', () => {
  assert.equal(humanizeTokens(999), '999');
  assert.equal(humanizeTokens(1200), '1.2K');
  assert.equal(humanizeTokens(100000), '100K');
  assert.equal(humanizeTokens(2500000), '2.5M');
});

test('renderFooterLayout constrains context surface in small terminals', () => {
  const compact = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'context',
      usage: {
        usedTokens: 1000,
        contextWindow: 4000,
        source: 'provider',
        segments: [
          {category: 'system', tokens: 100},
          {category: 'memory', tokens: 100},
          {category: 'skills', tokens: 100},
          {category: 'tools', tokens: 300},
          {category: 'messages', tokens: 300},
          {category: 'reasoning', tokens: 100}
        ]
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 12,
    width: 40
  });
  const compactPlainLines = compact.lines.map((line) => stripAnsi(line));

  assert.ok(compact.lines.length <= 10);
  assert.ok(compact.lines.every((line) => displayWidth(line) <= safeRenderWidth(40)));
  assert.ok(compactPlainLines.some((line) => line.includes('系统提示词')));
  assert.ok(compactPlainLines.some((line) => line.includes('工具')));
  assert.ok(compactPlainLines.some((line) => line.includes('消息')));
  assert.ok(compactPlainLines.some((line) => line.includes('推理')));
  assert.equal(compactPlainLines.some((line) => line.includes('Memory') || line.includes('Skills')), false);

  const narrow = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'context',
      usage: {
        usedTokens: 1000,
        contextWindow: 4000,
        source: 'provider',
        segments: [
          {category: 'system', tokens: 200},
          {category: 'messages', tokens: 800}
        ]
      }
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 8,
    width: 20
  });

  assert.ok(narrow.lines.every((line) => displayWidth(line) <= safeRenderWidth(20)));
});

test('renderFooterLayout restores boxed composer cursor for multiline and wrapped input', () => {
  const multiline = renderFooterLayout({
    composer: createComposer('first\nsecond'),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });
  const wrappedComposer = createComposer('abcdefghi');
  const wrapped = renderFooterLayout({
    composer: wrappedComposer,
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 10
  });
  const wrappedPlainLines = wrapped.lines.map((line) => stripAnsi(line));

  assert.equal(multiline.cursorRow, 3);
  assert.equal(multiline.cursorColumn, 10);
  assert.ok(wrappedPlainLines.some((line) => line.includes('> abc')));
  assert.ok(wrappedPlainLines.some((line) => line.includes('  def')));
  assert.equal(wrapped.cursorRow, 4);
  assert.equal(wrapped.cursorColumn, 7);
});

test('renderFooterLayout clamps long status line to safe width', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {
      projectName: 'very-long-project-name',
      model: {kind: 'default', label: 'very-long-model-name'},
      mode: 'idle'
    },
    width: 30
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.startsWith('very-long-model-name'));
  assert.ok(displayWidth(layout.lines.at(-1)) <= safeRenderWidth(30));
});

test('renderFooterLayout renders plan mode without exit hint', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'plan'
    },
    width: 80
  });

  const plainStatusLine = stripAnsi(layout.lines.at(-1));

  assert.ok(plainStatusLine.includes('PLAN'));
  assert.equal(plainStatusLine.includes('/plan off'), false);
});

test('renderFooterLayout uses mode-specific composer prefix and border color', () => {
  const normal = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });
  const plan = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'plan'},
    width: 80
  });
  const shell = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell'},
    width: 80
  });
  const localShell = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell-local'},
    width: 80
  });

  assert.ok(stripAnsi(normal.lines[2]).includes('> / 命令 · @ 路径 · TAB mode · Ctrl+T 模型'));
  assert.ok(stripAnsi(normal.lines[2]).includes('Shift+Tab 授权'));
  assert.ok(stripAnsi(plan.lines[2]).includes('? 计划问题 · @ 路径 · TAB 切换 mode · Ctrl+T 模型'));
  assert.equal(stripAnsi(plan.lines[2]).includes('Shift+Tab 工具授权'), false);
  assert.equal(stripAnsi(plan.lines[2]).includes('Enter 发送'), false);
  assert.ok(stripAnsi(shell.lines[2]).includes('$ bash 命令 · TAB 切换 mode · 结果进上下文'));
  assert.ok(stripAnsi(localShell.lines[2]).includes('$ bash 命令 · TAB 切换 mode · 仅本地显示'));
  assert.match(normal.lines[1], /\x1b\[38;2;0;200;220m/);
  assert.match(plan.lines[1], /\x1b\[38;2;170;150;245m/);
  assert.match(shell.lines[1], /\x1b\[38;2;96;210;165m/);
});

test('renderFooterLayout keeps plan and shell prefixes for typed composer text', () => {
  const plan = renderFooterLayout({
    composer: createComposer('draft'),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'plan'},
    width: 80
  });
  const shell = renderFooterLayout({
    composer: createComposer('pwd'),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell'},
    width: 80
  });

  assert.ok(stripAnsi(plan.lines[2]).includes('? draft'));
  assert.ok(stripAnsi(shell.lines[2]).includes('$ pwd'));
});

test('renderFooterLayout shows shell mode status label and working activity', () => {
  const shell = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell'},
    width: 80
  });
  const localShell = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell-local'},
    width: 80
  });
  const working = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell', activity: {kind: 'working', elapsedMs: 1000}},
    width: 80
  });

  assert.ok(stripAnsi(shell.lines.at(-1)).includes('SHELL ctx'));
  assert.ok(stripAnsi(localShell.lines.at(-1)).includes('SHELL local'));
  assert.ok(stripAnsi(working.lines.at(-1)).includes('working 00:01'));
});

test('renderFooterLayout renders MCP initialization spinner', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: null,
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'mcp', activity: {kind: 'working', elapsedMs: 1000}},
    width: 100
  });

  assert.ok(stripAnsi(layout.lines.at(-1)).includes('initializing MCP 00:01'));
});

test('renderFooterLayout renders thinking spinner in status line mode segment', () => {
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    commandSurface: null,
    pending: { kind: 'thinking', elapsedMs: 0 },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'thinking',
      keyHint: 'Esc 中断'
    },
    width: 100
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const plainStatusLine = plainLines.at(-1);

  assert.equal(plainLines[0], '');
  assert.ok(plainStatusLine.includes('   ▒█▒    thinking'));
  assert.ok(!plainStatusLine.includes('ready'));
  assert.ok(!plainStatusLine.includes('PLAN'));
  assert.ok(plainStatusLine.includes('Esc 中断'));
  assert.match(layout.lines.at(-1), /\x1b\[38;2;/);
  assert.match(layout.lines.at(-1), /\x1b\[38;2;130;150;168mt\x1b\[39m/);
  assert.match(layout.lines.at(-1), /\x1b\[38;2;235;245;248mi\x1b\[39m/);
  assert.match(layout.lines.at(-1), /\x1b\[1m\x1b\[38;2;235;245;248mn\x1b\[39m\x1b\[22m\x1b\[1m\x1b\[38;2;235;245;248mk\x1b\[39m\x1b\[22m/);
});

test('renderFooterLayout expands thinking shimmer from center outward', () => {
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    commandSurface: null,
    pending: { kind: 'thinking', elapsedMs: ECHO_SPINNER_FRAME_INTERVAL_MS },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'thinking',
      keyHint: 'Esc 中断'
    },
    width: 100
  });

  assert.match(layout.lines.at(-1), /\x1b\[1m\x1b\[38;2;235;245;248mi\x1b\[39m\x1b\[22m\x1b\[38;2;235;245;248mn\x1b\[39m\x1b\[38;2;235;245;248mk\x1b\[39m\x1b\[1m\x1b\[38;2;235;245;248mi\x1b\[39m\x1b\[22m/);
});

test('renderFooterLayout pauses activity shimmer during spinner blank frames', () => {
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    commandSurface: null,
    pending: { kind: 'thinking', elapsedMs: ECHO_SPINNER_FRAME_INTERVAL_MS * ECHO_SPINNER_ACTIVE_FRAME_COUNT },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'thinking',
      keyHint: 'Esc 中断'
    },
    width: 100
  });
  const statusLine = layout.lines.at(-1);

  assert.ok(stripAnsi(statusLine).includes('         thinking'));
  assert.match(statusLine, /\x1b\[38;2;130;150;168mt\x1b\[39m\x1b\[38;2;130;150;168mh\x1b\[39m\x1b\[38;2;130;150;168mi\x1b\[39m/);
  assert.doesNotMatch(statusLine, /\x1b\[1m\x1b\[37m[thinking]/);
});

test('renderFooterLayout renders select command surfaces by kind instead of command-specific overlay data', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'select',
      title: '/local options',
      options: [
        { label: 'alpha', description: '第一个选项' },
        { label: 'beta', description: '第二个选项' }
      ],
      selectedIndex: 1,
      dismissHint: 'Esc 关闭本地命令'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.includes('/local options')));
  assert.ok(plainLines.some((line) => line === '  alpha — 第一个选项'));
  assert.ok(plainLines.some((line) => line.trimEnd() === '▌ beta — 第二个选项'));
  assert.ok(!plainLines.some((line) => line.includes('● beta') || line.includes('○ alpha')));
  assert.ok(!plainLines.some((line) => line === '    第一个选项'));
  assert.ok(!plainLines.some((line) => line === '    第二个选项'));
  assert.ok(!plainLines.some((line) => line.includes('›')));
  assert.ok(plainLines.some((line) => line.includes('Esc 关闭本地命令')));
  assert.ok(!plainLines.some((line) => line === '> ignored'));
});

test('renderFooterLayout renders resume command surfaces with two columns and preview', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'resume',
      title: '/resume 恢复会话 (7)',
      sessions: [
        { label: '2026-05-19 10:00 · 4 条消息' },
        { label: '2026-05-18 09:00 · 1 条消息' }
      ],
      hiddenSessionCountAbove: 2,
      hiddenSessionCountBelow: 3,
      focus: 'list',
      selectedIndex: 0,
      previewScroll: 0,
      previewRecords: [
        { role: 'user', text: 'resume me' },
        { role: 'tool_result', text: 'found resume result' },
        { role: 'assistant', text: 'restored reply' },
        { role: 'local_notice', text: 'response interrupted' },
        { role: 'error', text: 'failed locally' }
      ],
      dismissHint: '↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 恢复 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.startsWith('╭')));
  assert.ok(plainLines.some((line) => line.startsWith('╰')));
  assert.ok(plainLines.some((line) => line.includes('/resume 恢复会话 (7)')));
  assert.ok(plainLines.some((line) => line.includes('▌ 会话') && line.includes('预览')));
  const headerIndex = plainLines.findIndex((line) => line.includes('▌ 会话') && line.includes('预览'));
  assert.ok(plainLines[headerIndex + 1].includes('────'));
  assert.ok(plainLines.some((line) => line.includes('▌ 2026-05-19')));
  assert.ok(plainLines.some((line) => line.includes('↑ 2 更多')));
  assert.ok(plainLines.some((line) => line.includes('↓ 3 更多')));
  assert.ok(!plainLines.some((line) => line.includes('● 2026-05-19') || line.includes('○ 2026-05-18')));
  assert.ok(!plainLines.some((line) => line.includes('2026-05-19') && line.includes('restored reply')));
  assert.ok(plainLines.some((line) => line.includes('USER resume me')));
  assert.ok(plainLines.some((line) => line.includes('RESULT found resume result')));
  assert.ok(plainLines.some((line) => line.includes('ASSISTANT restored reply')));
  assert.ok(plainLines.some((line) => line.includes('NOTICE response interrupted')));
  assert.ok(plainLines.some((line) => line.includes('ERROR failed locally')));
  assert.ok(plainLines.some((line) => line.includes('Enter 恢复')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('▌')));

  const resumeFrameColor = '\x1b[38;2;40;110;125m';
  const topLine = layout.lines[plainLines.findIndex((line) => line.startsWith('╭'))];
  const titleLine = layout.lines[plainLines.findIndex((line) => line.includes('/resume 恢复会话 (7)'))];
  const bottomLine = layout.lines[plainLines.findIndex((line) => line.startsWith('╰'))];
  assert.ok(topLine.startsWith(`${resumeFrameColor}╭─`));
  assert.ok(titleLine.startsWith(`${resumeFrameColor}│`));
  assert.ok(bottomLine.startsWith(`${resumeFrameColor}╰─`));
});

test('renderFooterLayout renders diff surface with side-by-side details on very wide width', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'diff',
      title: '/diff',
      source: {kind: 'git', label: 'Git workspace'},
      focus: 'detail',
      selectedIndex: 0,
      detailScroll: 0,
      notices: [],
      files: [{
        path: 'src/file.ts',
        kind: 'modified',
        added: 1,
        removed: 1,
        hunks: [{
          oldStart: 1,
          newStart: 1,
          lines: [
            {kind: 'context', text: 'const value = 1;', oldLine: 1, newLine: 1},
            {kind: 'removed', text: 'const name = "old";', oldLine: 2, newLine: null},
            {kind: 'added', text: 'const name = "new";', oldLine: null, newLine: 2}
          ]
        }]
      }]
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 190
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('/diff')));
  assert.ok(plainLines.some((line) => line.includes('Git workspace')));
  assert.ok(plainLines.some((line) => line.includes('src/file.ts')));
  assert.ok(plainLines.some((line) => line.includes('const name = "old";') && line.includes('const name = "new";')));
  assert.ok(!plainLines.some((line) => line.includes('●') || line.includes('○')));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(190)));
  assert.equal(layout.showCursor, false);
});

test('renderDiffSurface default height is finite without maxLines', () => {
  const layout = renderDiffSurface({
    kind: 'diff',
    source: {kind: 'git', label: 'Git workspace'},
    focus: 'list',
    files: [],
    notices: []
  }, 80);

  assert.equal(layout.lines.length, 22);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
});

test('renderDiffSurface applies custom theme to diff row backgrounds', () => {
  const layout = renderDiffSurface({
    kind: 'diff',
    source: {kind: 'git', label: 'Git workspace'},
    focus: 'detail',
    selectedIndex: 0,
    files: [{
      path: 'src/file.ts',
      kind: 'modified',
      added: 1,
      removed: 1,
      hunks: [{
        oldStart: 1,
        newStart: 1,
        lines: [
          {kind: 'removed', text: 'old', oldLine: 1, newLine: null},
          {kind: 'added', text: 'new', oldLine: null, newLine: 1}
        ]
      }]
    }],
    notices: []
  }, 90, Number.POSITIVE_INFINITY, CUSTOM_THEME.footer);
  const rendered = layout.lines.join('\n');

  assert.ok(rendered.includes('\x1b[38;5;250m\x1b[48;5;41m'));
  assert.ok(rendered.includes('\x1b[38;5;250m\x1b[48;5;40m'));
});

test('renderFooterLayout keeps diff details unified on medium width', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'diff',
      title: '/diff',
      source: {kind: 'git', label: 'Git workspace'},
      focus: 'detail',
      selectedIndex: 0,
      detailScroll: 0,
      notices: [],
      files: [{
        path: 'src/file.ts',
        kind: 'modified',
        added: 1,
        removed: 1,
        hunks: [{
          oldStart: 1,
          newStart: 1,
          lines: [
            {kind: 'removed', text: 'const name = "old";', oldLine: 1, newLine: null},
            {kind: 'added', text: 'const name = "new";', oldLine: null, newLine: 1}
          ]
        }]
      }]
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 120
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('- const name = "old";')));
  assert.ok(plainLines.some((line) => line.includes('+ const name = "new";')));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(120)));
});

test('renderFooterLayout wraps unified diff lines without repeating line numbers', () => {
  const longLine = `const message = "${'0123456789'.repeat(8)}";`;
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'diff',
      title: '/diff',
      source: {kind: 'git', label: 'Git workspace'},
      focus: 'detail',
      selectedIndex: 0,
      detailScroll: 0,
      notices: [],
      files: [{
        path: 'src/long.ts',
        kind: 'modified',
        added: 1,
        removed: 1,
        hunks: [{
          oldStart: 123,
          newStart: 124,
          lines: [
            {kind: 'removed', text: longLine, oldLine: 123, newLine: null},
            {kind: 'added', text: longLine.replace('message', 'result'), oldLine: null, newLine: 124}
          ]
        }]
      }]
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('123 │ - const message')));
  assert.ok(plainLines.some((line) => line.includes('    │ 890123')));
  assert.ok(plainLines.some((line) => line.includes('124 │ + const result')));
  assert.ok(!plainLines.some((line) => line.includes('123     │') || line.includes('    124 │')));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
});

test('renderFooterLayout lets diff surface use tall terminal height budget', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'diff',
      title: '/diff',
      source: {kind: 'git', label: 'Git workspace'},
      focus: 'detail',
      selectedIndex: 0,
      detailScroll: 0,
      notices: [],
      files: [{
        path: 'src/long.ts',
        kind: 'modified',
        added: 20,
        removed: 20,
        hunks: [{
          oldStart: 1,
          newStart: 1,
          lines: Array.from({length: 40}, (_value, index) => index % 2 === 0
            ? {kind: 'removed', text: `old ${index}`, oldLine: index + 1, newLine: null}
            : {kind: 'added', text: `new ${index}`, oldLine: null, newLine: index + 1})
        }]
      }]
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 40,
    width: 100
  });

  assert.equal(layout.lines.length, 38);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(100)));
});

test('renderFooterLayout renders diff surface unified fallback on narrow width', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: {
      kind: 'diff',
      title: '/diff',
      source: {kind: 'history', label: 'controlled file edit history'},
      focus: 'list',
      selectedIndex: 0,
      detailScroll: 0,
      notices: [
        '非 Git 工作区：当前 diff 基于受控文件编辑历史拼接，可能不包含手动编辑或 shell 写入。',
        '已遇到不可追踪写入边界：写入型 bash 不可追踪；仅展示边界之后的 apply_patch 记录。'
      ],
      files: [{
        path: 'file.txt',
        kind: 'modified',
        added: 1,
        removed: 1,
        hunks: [{
          oldStart: 1,
          newStart: 1,
          lines: [
            {kind: 'removed', text: 'before', oldLine: 1, newLine: null},
            {kind: 'added', text: 'after', oldLine: null, newLine: 1}
          ]
        }]
      }]
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 18,
    width: 52
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('- before')));
  assert.ok(plainLines.some((line) => line.includes('+ after')));
  assert.ok(plainLines.some((line) => line.includes('非 Git 工作区') && line.includes('受控文件编辑')));
  assert.ok(layout.lines.length <= 16);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(52)));
});

test('renderFooterLayout clamps resume surface on narrow width and renders empty preview', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'resume',
      title: '/resume 恢复会话 (1)',
      sessions: [
        { label: '2026-05-19 10:00 · 0 条消息' }
      ],
      hiddenSessionCountAbove: 0,
      hiddenSessionCountBelow: 0,
      focus: 'list',
      selectedIndex: 0,
      previewScroll: 0,
      previewRecords: [],
      emptyPreviewHint: '没有可预览消息',
      dismissHint: 'Enter 恢复 · Up/Down 选择 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 42
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('没有可预览')));
  for (const line of layout.lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(42));
  }
});

test('renderFooterLayout renders scrolled single-line resume preview with preview focus', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'resume',
      title: '/resume 恢复会话 (1)',
      sessions: [
        { label: '2026-05-19 10:00 · 12 条消息' }
      ],
      hiddenSessionCountAbove: 0,
      hiddenSessionCountBelow: 0,
      focus: 'preview',
      selectedIndex: 0,
      previewScroll: 3,
      previewRecords: Array.from({length: 12}, (_value, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        text: `preview-line-${index} ` + 'single-line-content '.repeat(4)
      })),
      emptyPreviewHint: '没有可预览消息',
      dismissHint: '↑↓ 选择/滚动 · →/Tab 预览 · ← 列表 · Enter 恢复 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 78
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('会话') && line.includes('▌ 预览')));
  assert.ok(plainLines.some((line) => line.includes('↑ 3 更多')));
  assert.ok(plainLines.some((line) => line.includes('↓')));
  assert.ok(plainLines.some((line) => line.includes('preview-line-4')));
  assert.ok(!plainLines.some((line) => line.includes('single-line-content single-line-content single-line-content single-line-content')));
  assert.ok(!plainLines.some((line) => line.includes('preview-line-0')));

  for (const line of layout.lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(78));
  }
});

test('renderFooterLayout renders compact file picker without overflowing terminal width', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@src'),
    commandSurface: {
      kind: 'file_picker',
      title: 'Files',
      currentDir: '/Users/example/projects/echo_tui/src',
      query: 'app',
      focus: 'list',
      selectedIndex: 1,
      selectedPaths: ['src/app/main.ts', 'docs/my note.md'],
      entries: [
        {kind: 'directory', name: 'app', path: 'src/app', selectable: false, selected: false},
        {kind: 'text', name: 'main.ts', path: 'src/app/main.ts', selectable: true, selected: true},
        {kind: 'unsupported', name: 'archive.zip', path: 'archive.zip', selectable: false, selected: false}
      ],
      previewLines: ['main.ts', 'text · scroll with preview focus', '1 import app from ./app'],
      dismissHint: '↑↓ move · tab preview · space mark · enter insert · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 18,
    width: 42
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.includes('Files')));
  assert.ok(plainLines.some((line) => line.includes('cwd')));
  assert.ok(!plainLines.some((line) => line.includes('cwd .')));
  assert.ok(plainLines.some((line) => line.includes('● 2')));
  assert.ok(plainLines.some((line) => line.includes('@ app┃')));
  assert.ok(plainLines.some((line) => line.includes('main.ts')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;90;230;245m') && line.includes('\x1b[1m') && stripAnsi(line).includes('main.ts')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;130;150;168m') && stripAnsi(line).includes('text ·')));
  assert.ok(plainLines.some((line) => line.includes('─') && line.includes('│')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('▌')));
  assert.ok(plainLines.some((line) => /│ 1 import/.test(line)));
  assert.ok(!plainLines.some((line) => /\d+(B|KB|MB|GB)/.test(line)));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(42)));
});

test('renderFooterLayout uses one color for file picker frame lines', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'preview',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [
        {kind: 'image', name: 'shot.png', path: 'shot.png', selectable: true, selected: false}
      ],
      previewLines: ['shot.png', '图片无法在终端内预览', '将作为图片输入发送给模型'],
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 16,
    width: 80
  });
  const frameLines = layout.lines.filter((line) => /^[╭╰]/.test(stripAnsi(line)) || /^│─+│$/.test(stripAnsi(line)));

  assert.ok(frameLines.length >= 3);
  assert.ok(frameLines.every((line) => line.includes('\x1b[38;2;0;120;150m')));
  assert.ok(frameLines.every((line) => !line.includes('\x1b[90m')));
  assert.ok(frameLines.every((line) => !stripAnsi(line).includes('┼')));
  assert.ok(frameLines.every((line) => !stripAnsi(line).includes('┬')));
  assert.ok(frameLines.some((line) => /^│─+│$/.test(stripAnsi(line))));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
});

test('renderFooterLayout renders file picker empty notice without overflowing', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/empty-project',
      query: '',
      focus: 'list',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [],
      notice: '当前目录没有可显示文件',
      previewLines: ['无可预览内容'],
      dismissHint: '↑↓ 移动 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 14,
    width: 50
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plainLines.some((line) => line.includes('当前目录没有可显示文件')));
  assert.ok(plainLines.some((line) => line.includes('无可预览内容')));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(50)));
});

test('renderFooterLayout wraps long file picker preview lines', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'preview',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [
        {kind: 'text', name: 'long.ts', path: 'long.ts', selectable: true, selected: false}
      ],
      previewLines: [
        'long.ts',
        'text · 1 lines',
        '1 const message = alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu;'
      ],
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 18,
    width: 60
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const firstPreviewLine = plainLines.find((line) => line.includes('1 const message = alpha'));
  const continuationLine = plainLines.find((line) => line.includes('epsilon zeta'));

  assert.ok(firstPreviewLine);
  assert.ok(continuationLine);
  assert.ok(!continuationLine.includes('1 epsilon'));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(60)));
});

test('renderFooterLayout highlights file picker code preview', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'preview',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [
        {kind: 'text', name: 'main.ts', path: 'main.ts', selectable: true, selected: false}
      ],
      previewLines: [
        'main.ts',
        'text · 2 lines',
        '1 const value = call("x", 42);',
        '2 // comment'
      ],
      previewMode: 'code',
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 18,
    width: 80
  });

    assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;170;0;170mconst')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;5;208mcall')));
    assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;0;170;0m"x"')));
    assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;85;85;85m// comment')));
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(80)));
});

test('renderFooterLayout sizes file picker from terminal width and height budgets', () => {
  const createSurface = () => ({
    kind: 'file_picker',
    currentDir: '/tmp/project',
    query: '',
    focus: 'list',
    selectedIndex: 0,
    selectedPaths: [],
    entries: Array.from({length: 32}, (_value, index) => ({
      kind: 'text',
      name: `very-long-source-file-name-${String(index + 1).padStart(2, '0')}.ts`,
      path: `src/very-long-source-file-name-${String(index + 1).padStart(2, '0')}.ts`,
      selectable: true,
      selected: false
    })),
    previewLines: ['long.ts', 'text · 1 lines', '1 const value = 1;'],
    dismissHint: '↑↓ move · ←/→ focus · esc'
  });
  const compact = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: createSurface(),
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 24,
    width: 100
  });
  const spacious = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: createSurface(),
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 40,
    width: 180
  });

  assert.ok(Math.max(...spacious.lines.map(displayWidth)) > Math.max(...compact.lines.map(displayWidth)));
  assert.ok(spacious.lines.length > compact.lines.length);
  const selectedBodyLine = spacious.lines.map((line) => stripAnsi(line)).find((line) => line.includes('very-long-source-file-name-01.ts'));
  assert.ok(selectedBodyLine);
  const bodyCells = selectedBodyLine.split('│');
  assert.ok(displayWidth(bodyCells[2]) > displayWidth(bodyCells[1]));
  assert.ok(spacious.lines.every((line) => displayWidth(line) <= safeRenderWidth(180)));
});

test('renderFooterLayout shrinks file picker list column to item content', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'list',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [
        {kind: 'text', name: 'a.ts', path: 'a.ts', selectable: true, selected: false},
        {kind: 'text', name: 'b.ts', path: 'b.ts', selectable: true, selected: false}
      ],
      previewLines: ['a.ts', 'text · 1 lines', '1 const value = 1;'],
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 28,
    width: 180
  });
  const selectedBodyLine = layout.lines.map((line) => stripAnsi(line)).find((line) => line.includes('a.ts'));
  assert.ok(selectedBodyLine);
  const bodyCells = selectedBodyLine.split('│');

  assert.ok(displayWidth(bodyCells[1]) < 24);
  assert.ok(displayWidth(bodyCells[2]) > 120);
  assert.ok(layout.lines.every((line) => displayWidth(line) <= safeRenderWidth(180)));
});

test('renderFooterLayout highlights preview focus row without prefix bar', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'preview',
      selectedIndex: 3,
      selectedPaths: [],
      entries: [
        {kind: 'text', name: 'main.ts', path: 'main.ts', selectable: true, selected: false},
        {kind: 'text', name: 'other.ts', path: 'other.ts', selectable: true, selected: false},
        {kind: 'text', name: 'more.ts', path: 'more.ts', selectable: true, selected: false},
        {kind: 'text', name: 'target.ts', path: 'target.ts', selectable: true, selected: false}
      ],
      previewLines: ['target.ts', 'text · 1 lines', '1 const value = 1;'],
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 16,
    width: 80
  });
  const previewLine = layout.lines.find((line) => stripAnsi(line).includes('1 const value = 1;'));
  const selectedListLine = layout.lines.find((line) => stripAnsi(line).includes('○ target.ts'));

  assert.ok(previewLine);
  assert.ok(selectedListLine);
  assert.ok(previewLine.includes('\x1b[48;5;23m'));
  assert.ok(!stripAnsi(previewLine).includes('▌'));
  assert.ok(stripAnsi(selectedListLine).includes('│   ○ target.ts'));
  assert.equal(layout.lines.filter((line) => line.includes('\x1b[48;5;23m')).length, 1);
});

test('renderFooterLayout keeps preview highlight on content for first file', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'preview',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [
        {kind: 'text', name: 'first.ts', path: 'first.ts', selectable: true, selected: false},
        {kind: 'text', name: 'second.ts', path: 'second.ts', selectable: true, selected: false}
      ],
      previewLines: ['first.ts', 'text · 1 lines', '1 const value = 1;'],
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 16,
    width: 80
  });
  const titleLine = layout.lines.find((line) => stripAnsi(line).includes('first.ts'));
  const contentLine = layout.lines.find((line) => stripAnsi(line).includes('1 const value = 1;'));

  assert.ok(titleLine);
  assert.ok(contentLine);
  assert.ok(!titleLine.includes('\x1b[48;5;23m'));
  assert.ok(contentLine.includes('\x1b[48;5;23m'));
});

test('renderFooterLayout keeps focused file list marker aligned', () => {
  const layout = renderFooterLayout({
    composer: createComposer('@'),
    commandSurface: {
      kind: 'file_picker',
      currentDir: '/tmp/project',
      query: '',
      focus: 'list',
      selectedIndex: 0,
      selectedPaths: [],
      entries: [
        {kind: 'text', name: 'first.ts', path: 'first.ts', selectable: true, selected: false},
        {kind: 'text', name: 'second.ts', path: 'second.ts', selectable: true, selected: false}
      ],
      previewLines: ['first.ts', 'text · 1 lines', '1 const value = 1;'],
      dismissHint: '↑↓ move · ←/→ focus · esc'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 16,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const activeLine = plainLines.find((line) => line.includes('first.ts'));
  const inactiveLine = plainLines.find((line) => line.includes('second.ts'));

  assert.ok(activeLine.includes('▌ ○'));
  assert.equal(activeLine.indexOf('○'), inactiveLine.indexOf('○'));
});

test('renderFooterLayout renders scale command surfaces', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'scale',
      title: '/effort · LLMBox GPT5.5',
      leftLabel: 'fast',
      rightLabel: 'deep',
      options: [
        { label: 'none', description: 'NONE' },
        { label: 'minimal', description: 'MIN' },
        { label: 'low', description: 'LOW' },
        { label: 'medium', description: 'MED' },
        { label: 'high', description: 'HIGH' },
        { label: 'xhigh', description: 'XHIGH' }
      ],
      selectedIndex: 3,
      dismissHint: 'Enter 选择 · ←/→ 移动 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.startsWith('╭')));
  assert.ok(plainLines.some((line) => line.startsWith('╰')));
  assert.ok(plainLines.some((line) => line.includes('/effort · LLMBox GPT5.5')));
  assert.ok(plainLines.some((line) => line.includes('[实时]')));
  assert.ok(plainLines.some((line) => line.includes('◂')));
  assert.ok(plainLines.some((line) => line.includes('▸')));
  assert.ok(plainLines.some((line) => line.includes('●')));
  assert.ok(plainLines.some((line) => line.includes('◉')));
  assert.ok(plainLines.some((line) => line.includes('NONE')));
  assert.ok(plainLines.some((line) => line.includes('MED')));
  assert.ok(plainLines.some((line) => line.includes('XHIGH')));
  assert.ok(plainLines.some((line) => line.includes('medium')));
  assert.ok(plainLines.some((line) => line.includes('█')));
  assert.ok(plainLines.some((line) => line.includes('░')));
  assert.ok(plainLines.some((line) => line.includes('已选择')));
  assert.ok(plainLines.some((line) => line.includes('Enter 选择')));
  assert.ok(plainLines.some((line) => line.includes('←/→ 移动')));
  assert.ok(!plainLines.some((line) => line.includes('Balanced reasoning')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;') && stripAnsi(line).includes('◉')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;') && stripAnsi(line).includes('MED')));
});

test('renderFooterLayout renders skills command surface as cyan card', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      activeField: 'effort',
      kind: 'skills',
      title: 'SKILLS',
      skills: [
        { name: 'code-review', description: 'Review code changes', sourceKind: 'project', sourcePath: '/skills/code-review/SKILL.md', enabled: true, modelLabel: '当前模型' },
        { name: 'unit-test', description: 'Generate tests', sourceKind: 'user', sourcePath: '/skills/unit-test/SKILL.md', enabled: false, modelProfileId: 'fast', modelLabel: 'fast', reasoningEffortOverride: 'high' }
      ],
      selectedIndex: 1,
      emptyLines: [],
      dismissHint: '当前字段 effort · Tab 切换 · ←/→ 调整 (仅限slash调用) · Space 启停 · Enter 保存 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.startsWith('╭') && line.includes('SKILLS') && line.includes('1/2 启用')));
  const currentModelLine = plainLines.find((line) => line.includes('● 启用') && line.includes('code-review'));
  const fixedModelLine = plainLines.find((line) => line.includes('▌') && line.includes('○ 停用') && line.includes('unit-test'));
  assert.ok(currentModelLine.includes('当前模型') && currentModelLine.includes('模型默认') && currentModelLine.includes('project · Review code'));
  assert.ok(currentModelLine.indexOf('● 启用') < currentModelLine.indexOf('当前模型'));
  assert.ok(currentModelLine.indexOf('当前模型') < currentModelLine.indexOf('code-review'));
  assert.ok(!currentModelLine.includes('模型:'));
  assert.ok(fixedModelLine.includes('fast') && fixedModelLine.includes('‹high›'));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[1m‹high›')));
  assert.ok(fixedModelLine.indexOf('○ 停用') < fixedModelLine.indexOf('fast'));
  assert.ok(fixedModelLine.indexOf('fast') < fixedModelLine.indexOf('unit-test'));
  assert.ok(!fixedModelLine.includes('模型:'));
  assert.ok(plainLines.some((line) => line.includes('当前字段 effort') && line.includes('Tab 切换') && line.includes('←/→ 调整')));
  assert.ok(!plainLines.some((line) => line.includes('/ search') || line.includes('search skills')));
  assert.ok(!plainLines.some((line) => line.includes('a all') || line.includes('n none') || line.includes('j/k')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;') && stripAnsi(line).includes('SKILLS')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('unit-test')));
});

test('renderFooterLayout renders skills surface overflow and empty state', () => {
  const skills = Array.from({ length: 10 }, (_value, index) => ({
    name: `skill-${index + 1}`,
    description: `Description ${index + 1}`,
    sourceKind: index % 2 === 0 ? 'project' : 'user',
    sourcePath: `/skills/skill-${index + 1}/SKILL.md`,
    enabled: index % 3 === 0,
    modelLabel: index % 2 === 0 ? '当前模型' : 'fast'
  }));
  const overflow = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      activeField: 'effort',
      kind: 'skills',
      title: 'SKILLS',
      skills,
      selectedIndex: 8,
      dismissHint: 'Space 切换 · Enter 保存 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 64
  });
  const overflowLines = overflow.lines.map((line) => stripAnsi(line));

  assert.ok(overflowLines.some((line) => line.includes('↑ 2 更多')));
  assert.ok(overflowLines.some((line) => line.includes('skill-9')));
  assert.ok(!overflowLines.some((line) => /skill-1(?!0)/u.test(line)));

  const empty = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'skills',
      title: 'SKILLS',
      skills: [],
      emptyLines: ['当前没有发现可用 skill。'],
      dismissHint: 'Esc 关闭'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 64
  });
  const emptyLines = empty.lines.map((line) => stripAnsi(line));

  assert.ok(emptyLines.some((line) => line.includes('当前没有发现可用 skill')));
  assert.ok(emptyLines.some((line) => line.includes('Esc 关闭')));
});

test('renderFooterLayout keeps skill state, name, and model policy on narrow terminals', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      activeField: 'effort',
      kind: 'skills',
      title: 'SKILLS',
      skills: [{
        name: 'review',
        description: 'A secondary description that should be truncated first',
        sourceKind: 'project',
        sourcePath: '/skills/review/SKILL.md',
        enabled: false,
        modelProfileId: 'fast',
        modelLabel: 'fast',
        reasoningEffortOverride: 'high'
      }],
      selectedIndex: 0,
      dismissHint: '←/→ 模型 · Space 启停 · Enter 保存 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 44
  });
  const skillLine = layout.lines.map((line) => stripAnsi(line)).find((line) => line.includes('review'));

  assert.ok(skillLine.includes('○ 停用'));
  assert.ok(skillLine.includes('fast'));
  assert.ok(skillLine.includes('‹high›'));
  assert.ok(skillLine.indexOf('○ 停用') < skillLine.indexOf('fast'));
  assert.ok(skillLine.indexOf('fast') < skillLine.indexOf('review'));
  assert.ok(!skillLine.includes('模型:'));
  assert.ok(!skillLine.includes('secondary description'));
});

test('renderFooterLayout expands skills surface with the terminal width budget', () => {
  const createLayout = (width) => renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      activeField: 'model',
      kind: 'skills',
      title: 'SKILLS',
      skills: [{
        name: 'review',
        description: 'Review code changes with a description that benefits from a wide terminal',
        sourceKind: 'project',
        sourcePath: '/skills/review/SKILL.md',
        enabled: true,
        modelProfileId: 'anthropic-claude-sonnet-4-6',
        modelLabel: 'anthropic-claude-sonnet-4-6'
      }],
      selectedIndex: 0,
      dismissHint: '←/→ 模型 (仅限slash调用) · Space 启停 · Enter 保存 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width
  });
  const medium = createLayout(64);
  const wide = createLayout(120);
  const mediumTop = medium.lines.find((line) => stripAnsi(line).includes('SKILLS'));
  const wideTop = wide.lines.find((line) => stripAnsi(line).includes('SKILLS'));

  assert.equal(displayWidth(mediumTop), safeRenderWidth(64));
  assert.equal(displayWidth(wideTop), safeRenderWidth(120) - 4);
  assert.ok(displayWidth(wideTop) > 84);
  assert.ok(wide.lines.map((line) => stripAnsi(line)).some((line) => line.includes('anthropic-claude-sonnet-4-6')));
  assert.ok(wide.lines.map((line) => stripAnsi(line)).some((line) => line.includes('Review code changes with a description')));
});

test('renderFooterLayout renders /model info through the generic info surface', () => {
  const layout = renderFooterLayout({
    composer: createComposer('/model'),
    commandSurface: {
      kind: 'info',
      title: '/model',
      lines: [
        '当前未读取到模型配置。',
        'LLM 配置缺少 models'
      ],
      dismissHint: 'Esc 关闭'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.includes('/model')));
  assert.ok(plainLines.some((line) => line.includes('当前未读取到模型配置。')));
  assert.ok(plainLines.some((line) => line.includes('LLM 配置缺少 models')));
  assert.ok(plainLines.some((line) => line.includes('Esc 关闭')));
  assert.ok(!plainLines.some((line) => line === '> /model'));
});

test('renderFooterLayout renders choice surfaces as bordered focused choices', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: '⚠ apply_patch',
      optionsTitle: 'action',
      options: [
        { label: 'Allow once' },
        { label: 'Deny' }
      ],
      focusedIndex: 0,
      dismissHint: 'Enter 确认 · Up/Down 选择 · Esc 拒绝'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.equal(layout.cursorColumn, 0);
  assert.ok(plainLines.some((line) => line.startsWith('╭ ⚠ apply_patch')));
  assert.ok(plainLines.some((line) => line.startsWith('╰')));
  assert.ok(plainLines.some((line) => line.includes('── action')));
  assert.ok(plainLines.some((line) => line.includes('▌ ● Allow once')));
  assert.ok(plainLines.some((line) => line.includes('○ Deny')));
  assert.ok(plainLines.some((line) => line.includes('Esc 拒绝')));
  assert.ok(!plainLines.some((line) => line.includes(' — ')));
  assert.ok(!plainLines.some((line) => line.trim() === '> ignored'));
  const topBorder = layout.lines.find((line) => stripAnsi(line).startsWith('╭ ⚠ apply_patch'));
  const activeLine = layout.lines.find((line) => stripAnsi(line).includes('▌ ● Allow once'));
  assert.ok(topBorder);
  assert.ok(activeLine);
  assert.ok(displayWidth(topBorder) < safeRenderWidth(100));
  assertActiveBackgroundReachesRightPadding(activeLine);
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('Allow once')));
});

test('renderFooterLayout applies custom theme to choice active row', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: '选择操作',
      options: [
        {label: '继续'},
        {label: '取消'}
      ],
      focusedIndex: 0
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    theme: CUSTOM_THEME,
    width: 80
  });
  const rendered = layout.lines.join('\n');

  assert.ok(rendered.includes('\x1b[38;2;30;31;32m'));
  assert.ok(rendered.includes('\x1b[48;5;99m'));
  assert.ok(rendered.includes('\x1b[38;2;1;2;3m'));
});

test('renderFooterLayout renders configured Chinese choice sections', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: '选择',
      message: '请选择下一步',
      messageTitle: '消息',
      optionsTitle: '操作',
      options: [{label: '继续'}],
      focusedIndex: 0,
      dismissHint: 'Enter 确认 · Esc 关闭'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });
  const text = layout.lines.map((line) => stripAnsi(line)).join('\n');

  assert.match(text, /消息/);
  assert.match(text, /操作/);
  assert.doesNotMatch(text, /── message|── action/);
});

test('renderFooterLayout renders permission choice as command and action card', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'PERMISSION',
      message: 'rm -rf dist',
      messageTitle: 'command',
      messageStyle: 'code',
      optionsTitle: 'action',
      options: [
        { label: 'Allow once' },
        { label: 'Deny' }
      ],
      focusedIndex: 0,
      dismissHint: '↑/↓ move · enter confirm · esc cancel'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.startsWith('╭ PERMISSION')));
  assert.ok(plainLines.some((line) => line.includes('── command')));
  assert.ok(plainLines.some((line) => line.includes('rm -rf dist')));
  assert.ok(plainLines.some((line) => line.includes('── action')));
  assert.ok(plainLines.some((line) => line.includes('▌ ● Allow once')));
  assert.ok(plainLines.some((line) => line.includes('○ Deny')));
  assert.ok(!plainLines.some((line) => line.includes('1. Allow once') || line.includes('2. Deny')));
  assert.ok(plainLines.some((line) => line.includes('enter confirm')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;236m') && stripAnsi(line).includes('rm -rf dist')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('Allow once')));
  assertActiveBackgroundReachesRightPadding(layout.lines[plainLines.findIndex((line) => line.includes('▌ ● Allow once'))]);
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;90;230;245m') && stripAnsi(line).includes('Allow once')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;235;245;248m') && stripAnsi(line).includes('Deny')));
  assert.ok(!layout.lines.find((line) => stripAnsi(line).includes('── command')).includes('\x1b[2m'));
  assert.ok(!plainLines.some((line) => line.includes('Reasons')));
});

test('renderFooterLayout keeps permission inline feedback cursor visible', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'PERMISSION',
      message: 'rm -rf dist',
      messageTitle: 'command',
      messageStyle: 'code',
      optionsTitle: 'action',
      options: [
        { label: 'Allow once' },
        { label: 'Deny' },
        { label: 'Tell model what to do', inlineInput: { placeholder: 'Type instruction...', text: '', cursor: 0 } }
      ],
      focusedIndex: 2,
      dismissHint: '↑/↓ move · enter confirm · esc cancel'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const inputLineIndex = plainLines.findIndex((line) => line.includes('Tell model what to do'));
  const inputLine = layout.lines[inputLineIndex];

  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow, inputLineIndex);
  assert.ok(plainLines[inputLineIndex].includes('Type instruction...'));
  assert.equal(layout.cursorColumn, plainLines[inputLineIndex].indexOf('Type instruction...'));
  assert.ok(inputLine.includes('\x1b[48;5;23m'));
  assert.ok(inputLine.lastIndexOf('\x1b[49m') < inputLine.indexOf('Type instruction...'));
});

test('renderFooterLayout separates choice focus from multi-select checked state', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Question',
      message: 'Pick any?',
      messageTitle: 'question',
      optionsTitle: 'answer',
      selectionMode: 'multiple',
      options: [
        {label: 'A', checked: true},
        {label: 'B', checked: false},
        {label: 'C', checked: true},
        {label: 'Other', checked: true, inlineInput: {placeholder: 'Type answer...', text: 'custom answer', cursor: 6}}
      ],
      focusedIndex: 1,
      dismissHint: 'Space 选择/取消 · Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const checkedLine = layout.lines[plainLines.findIndex((line) => line.includes('● A'))];
  const focusedLine = layout.lines[plainLines.findIndex((line) => line.includes('▌ ○ B'))];
  const otherLine = layout.lines[plainLines.findIndex((line) => line.includes('● Other custom answer'))];

  assert.equal(layout.showCursor, false);
  assert.ok(plainLines.some((line) => line.includes('  ● A')));
  assert.ok(plainLines.some((line) => line.includes('▌ ○ B')));
  assert.ok(plainLines.some((line) => line.includes('  ● C')));
  assert.ok(plainLines.some((line) => line.includes('  ● Other custom answer')));
  assert.ok(!stripAnsi(checkedLine).includes('▌'));
  assert.ok(!checkedLine.includes('\x1b[48;5;23m'));
  assert.ok(focusedLine.includes('\x1b[48;5;23m'));
  assertActiveBackgroundReachesRightPadding(focusedLine);
  assert.ok(!otherLine.includes('\x1b[48;5;23m'));
});

test('renderFooterLayout renders choice tabs and separates single selected state from focus', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Question 2/2',
      tabs: [
        {label: 'Q1', status: 'complete'},
        {label: 'Q2', status: 'missing'},
        {label: '提交', status: 'blocked'}
      ],
      activeTabIndex: 1,
      optionsTitle: '答案（单选）',
      options: [
        {label: 'A', selected: true},
        {label: 'B', selected: false}
      ],
      focusedIndex: 1,
      dismissHint: '←/→ 切换问题 · Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 12,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const selectedLine = layout.lines[plainLines.findIndex((line) => line.includes('● A'))];
  const focusedLine = layout.lines[plainLines.findIndex((line) => line.includes('▌ ○ B'))];

  assert.ok(plainLines.some((line) => line.includes('[✓ Q1]') && line.includes('[! Q2]') && line.includes('[! 提交]')));
  assert.ok(plainLines.some((line) => line.includes('  ● A')));
  assert.ok(plainLines.some((line) => line.includes('▌ ○ B')));
  assert.ok(!selectedLine.includes('\x1b[48;5;23m'));
  assert.ok(focusedLine.includes('\x1b[48;5;23m'));
  assert.ok(plainLines.some((line) => line.includes('←/→ 切换问题')));
});

test('renderFooterLayout preserves active choice tab in a constrained footer', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: '提交答案',
      tabs: [{label: 'Q1', status: 'complete'}, {label: '提交', status: 'ready'}],
      activeTabIndex: 1,
      options: [{label: '提交答案'}],
      focusedIndex: 0,
      dismissHint: '←/→ 切换问题 · Enter 提交'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 7,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.length <= 5);
  assert.ok(plainLines.some((line) => line.includes('[✓ Q1]') && line.includes('[提交]')));
});

test('renderFooterLayout keeps focused multi-select inline input text outside active background', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Question',
      optionsTitle: 'answer',
      selectionMode: 'multiple',
      options: [
        {label: 'A', checked: true},
        {label: 'Other', checked: true, inlineInput: {placeholder: 'Type answer...', text: 'custom answer', cursor: 6}}
      ],
      focusedIndex: 1,
      dismissHint: 'Space 选择/取消 · Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const inputLineIndex = plainLines.findIndex((line) => line.includes('▌ ● Other custom answer'));
  const inputLine = layout.lines[inputLineIndex];

  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow, inputLineIndex);
  assert.equal(layout.cursorColumn, plainLines[inputLineIndex].indexOf('custom answer') + 'custom'.length);
  assert.ok(inputLine.includes('\x1b[48;5;23m'));
  assert.ok(inputLine.lastIndexOf('\x1b[49m') < inputLine.indexOf('custom answer'));
});

test('renderFooterLayout renders choice descriptions on dim following lines', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: '选择处理方式',
      optionsTitle: 'answer',
      options: [
        { label: '自动修复', description: '让模型直接修改代码并运行验证' },
        { label: '只生成方案', description: '不改代码，只输出设计和步骤' }
      ],
      focusedIndex: 1,
      dismissHint: 'Enter 确认 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 60
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const firstLabelIndex = plainLines.findIndex((line) => line.includes('自动修复'));
  const secondLabelIndex = plainLines.findIndex((line) => line.includes('只生成方案'));

  assert.ok(firstLabelIndex >= 0);
  assert.ok(secondLabelIndex >= 0);
  assert.ok(plainLines[firstLabelIndex].includes('○ 自动修复'));
  assert.ok(plainLines[secondLabelIndex].includes('▌ ● 只生成方案'));
  assert.ok(plainLines.slice(firstLabelIndex + 1, secondLabelIndex).some((line) => line.includes('让模型直接修改代码')));
  assert.ok(plainLines.slice(secondLabelIndex + 1).some((line) => line.includes('不改代码')));
  assert.ok(!plainLines.some((line) => line.includes('自动修复 —')));
  assert.ok(!plainLines.some((line) => line.includes('只生成方案 —')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;130;150;168m') && stripAnsi(line).includes('让模型直接修改代码')));
});

test('renderFooterLayout renders inline choice input placeholder and cursor', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Approval',
      optionsTitle: 'action',
      options: [
        { label: 'Allow once' },
        { label: 'Deny' },
        {
          label: 'Tell model what to do',
          inlineInput: {
            placeholder: 'Type instruction...',
            text: '',
            cursor: 0
          }
        }
      ],
      focusedIndex: 2,
      dismissHint: 'Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const inputLineIndex = plainLines.findIndex((line) => line.includes('Tell model what to do'));

  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow, inputLineIndex);
  assert.ok(plainLines[inputLineIndex].includes('▌ ● Tell model what to do Type instruction...'));
  assert.ok(layout.lines[inputLineIndex].includes('\x1b[38;2;130;150;168m'));
  assert.equal(layout.cursorColumn, plainLines[inputLineIndex].indexOf('Type instruction...'));
});

test('renderFooterLayout preserves approval choice option order', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Approval',
      optionsTitle: 'action',
      options: [
        { label: 'Allow once' },
        { label: 'Allow apply_patch for this session' },
        { label: 'Allow all tools for this session' },
        { label: 'Deny' },
        {
          label: 'Tell model what to do',
          inlineInput: {
            placeholder: 'Type instruction...',
            text: '',
            cursor: 0
          }
        }
      ],
      focusedIndex: 4,
      dismissHint: 'Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 100
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const optionLines = plainLines.filter((line) => line.includes('Allow') || line.includes('Deny') || line.includes('Tell model what to do'));

  assert.ok(optionLines[0].includes('Allow once'));
  assert.ok(optionLines[1].includes('Allow apply_patch for this session'));
  assert.ok(optionLines[2].includes('Allow all tools for this session'));
  assert.ok(optionLines[3].includes('Deny'));
  assert.ok(optionLines[4].includes('Tell model what to do'));
  assert.equal(layout.showCursor, true);
});

test('renderFooterLayout renders inline choice input text and cursor offset', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Question',
      message: 'Pick one?',
      messageTitle: 'question',
      optionsTitle: 'answer',
      options: [
        { label: 'A' },
        {
          label: 'Other',
          inlineInput: {
            placeholder: 'Type answer...',
            text: 'custom answer',
            cursor: 6
          }
        }
      ],
      focusedIndex: 1,
      dismissHint: 'Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const inputLineIndex = plainLines.findIndex((line) => line.includes('Other custom answer'));

  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow, inputLineIndex);
  assert.equal(layout.cursorColumn, plainLines[inputLineIndex].indexOf('custom answer') + 'custom'.length);
  assert.ok(!layout.lines[inputLineIndex].includes('\x1b[90m'));
  assert.ok(layout.lines[inputLineIndex].lastIndexOf('\x1b[49m') < layout.lines[inputLineIndex].indexOf('custom answer'));
});

test('renderFooterLayout keeps inline choice input cursor-visible for long text', () => {
  const longText = 'please do not run this command before showing me the exact diff first';
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Approval',
      optionsTitle: 'action',
      options: [
        {
          label: 'Tell model what to do',
          inlineInput: {
            placeholder: 'Type instruction...',
            text: longText,
            cursor: longText.length
          }
        }
      ],
      focusedIndex: 0,
      dismissHint: 'Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 56
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const inputLineIndex = plainLines.findIndex((line) => line.includes('Tell model what to do'));
  const inputLine = plainLines[inputLineIndex];

  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow, inputLineIndex);
  assert.ok(inputLine.includes('…'));
  assert.ok(inputLine.includes('exact diff first'));
  assert.ok(!inputLine.includes('please do not run'));
  assert.ok(inputLine.slice(0, layout.cursorColumn).endsWith('exact diff first'));
});

test('renderFooterLayout keeps both sides visible when inline input cursor is in the middle', () => {
  const longText = 'please do not run this command before showing me the exact diff first';
  const cursor = longText.indexOf('before');
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Approval',
      optionsTitle: 'action',
      options: [
        {
          label: 'Tell model what to do',
          inlineInput: {
            placeholder: 'Type instruction...',
            text: longText,
            cursor
          }
        }
      ],
      focusedIndex: 0,
      dismissHint: 'Enter 确认'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 64
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const inputLineIndex = plainLines.findIndex((line) => line.includes('Tell model what to do'));
  const inputLine = plainLines[inputLineIndex];

  assert.equal(layout.showCursor, true);
  assert.ok(inputLine.includes('…'));
  assert.ok(inputLine.includes('command before showing'));
  assert.ok(inputLine.includes('before showing …'));
  assert.equal(inputLine[layout.cursorColumn], 'b');
});

test('renderFooterLayout renders slash suggestions below composer while keeping cursor visible', () => {
  const layout = renderFooterLayout({
    composer: createComposer('/'),
    commandSurface: null,
    slashSuggestions: {
      options: [
        { label: '/help', description: '查看帮助' },
        { label: '/model', description: '切换模型' }
      ],
      selectedIndex: 1
    },
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'command',
      keyHint: 'Tab 补全 · Enter 执行 · ↑/↓ 选择'
    },
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorColumn, 5);
  assert.ok(plainLines.some((line) => line.includes('> /')));
  assert.ok(plainLines.some((line) => line.trimEnd() === '  /help — 查看帮助'));
  assert.ok(plainLines.some((line) => line.trimEnd() === '▌ /model — 切换模型'));
  assert.ok(plainLines.some((line) => line.includes('command')));
  assert.ok(plainLines.at(-1).includes('Tab 补全'));
  assert.ok(plainLines.some((line) => line.includes('GPT-4o')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('▌ /model')));
});

test('renderFooterLayout applies the configured slash suggestion visible limit without truncating state', () => {
  const options = Array.from({length: 10}, (_value, index) => ({label: `/command-${index}`, description: `item ${index}`}));
  const slashSuggestions = {options, selectedIndex: 7};
  const layout = renderFooterLayout({
    composer: createComposer('/command'),
    slashSuggestions,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 3},
    rows: 30,
    width: 80
  });
  const plain = layout.lines.map((line) => stripAnsi(line));

  assert.ok(plain.filter((line) => /command-\d/.test(line)).length <= 3);
  assert.equal(plain.some((line) => line.includes('command-7')), true);
  assert.equal(slashSuggestions.options.length, 10);
});

test('renderFooterLayout does not count slash suggestion more hints against the configured limit', () => {
  const options = Array.from({length: 12}, (_value, index) => ({label: `/command-${index + 1}`, description: `item ${index + 1}`}));
  const layout = renderFooterLayout({
    composer: createComposer('/command'),
    slashSuggestions: {options, selectedIndex: 6},
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    renderPreferences: {showReasoningSummary: true, slashSuggestionMaxVisible: 10},
    rows: 40,
    width: 80
  });
  const plain = layout.lines.map((line) => stripAnsi(line));

  assert.equal(plain.filter((line) => /command-\d/.test(line)).length, 10);
  assert.equal(plain.some((line) => line.includes('↑ 1 更多')), true);
  assert.equal(plain.some((line) => line.includes('↓ 1 更多')), true);
});

test('renderFooterLayout clamps long slash suggestions and budgets pending preview height', () => {
  const streamingText = Array.from({ length: 20 }, (_value, index) => `line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer('/very'),
    commandSurface: null,
    slashSuggestions: {
      options: [
        { label: '/very-long-command', description: '这是一个很长很长的命令说明，用来验证单行截断' }
      ],
      selectedIndex: 0
    },
    pending: { kind: 'streaming', text: streamingText },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'streaming',
      keyHint: 'Esc 中断'
    },
    rows: 10,
    width: 34
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const suggestionLine = plainLines.find((line) => line.startsWith('▌ /very-long-command'));

  assert.equal(plainLines[0], '◇ …已生成 20 行，显示最新 1 行');
  assert.equal(layout.lines.length, 8);
  assert.ok(suggestionLine.trimEnd().endsWith('…'));
  assert.ok(!plainLines.some((line) => line.includes('验证单行截断')));
});

test('renderFooterLayout renders confirm command surfaces by kind', () => {
  const layout = renderFooterLayout({
    composer: createComposer('/clear'),
    commandSurface: {
      kind: 'confirm',
      title: '/clear 清空 transcript',
      bodyLines: [
        '这会清空当前 transcript 记录。',
        '输入历史会保留，之后仍可用 Up/Down 回溯。'
      ],
      confirmLabel: '清空',
      cancelLabel: '取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    width: 80
  });

  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.showCursor, false);
  assert.equal(layout.cursorColumn, 0);
  assert.ok(plainLines.some((line) => line.includes('/clear 清空 transcript')));
  assert.ok(plainLines.some((line) => line.includes('这会清空当前 transcript 记录。')));
  assert.ok(plainLines.some((line) => line.includes('输入历史会保留')));
  assert.ok(plainLines.some((line) => line.includes('Enter 清空')));
  assert.ok(plainLines.some((line) => line.includes('Esc 取消')));
  assert.ok(layout.lines.some((line) => line.includes('\x1b[48;5;23m') && stripAnsi(line).includes('Enter 清空')));
  assert.ok(!plainLines.some((line) => line === '> /clear'));
});

test('renderFooterLayout keeps long streaming pending preview bounded above composer', () => {
  const streamingText = Array.from({ length: 20 }, (_value, index) => `line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    pending: { kind: 'streaming', text: streamingText },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'streaming',
      keyHint: 'Esc 中断'
    },
    rows: 14,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[0], '◇ …已生成 20 行，显示最新 6 行');
  assert.equal(layout.lines.length, 12);
  assert.ok(plainLines.some((line) => line.includes('line 20')));
  assert.ok(!plainLines.includes('◇ line 1'));
  assert.ok(!plainLines.includes('  line 1'));
  assert.ok(plainLines.some((line) => line.includes('> draft input')));
  assert.ok(plainLines.some((line) => line.includes('streaming')));
});

test('renderFooterLayout keeps shell live output bounded and status in shell working mode', () => {
  const output = Array.from({ length: 20 }, (_value, index) => `line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer(''),
    commandSurface: null,
    pending: { kind: 'shell_output', command: 'npm test', output },
    working: { elapsedMs: 1000 },
    statusLine: {...DEFAULT_STATUS_LINE, mode: 'shell-local'},
    rows: 14,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line).trimEnd());

  assert.equal(plainLines[0], '…已生成 22 行，显示最新 6 行');
  assert.equal(layout.lines.length, 12);
  assert.ok(!plainLines.includes('$ npm test'));
  assert.ok(!plainLines.includes('line 1'));
  assert.ok(plainLines.some((line) => line.includes('line 20')));
  assert.ok(plainLines.at(-1).includes('SHELL local'));
  assert.ok(plainLines.at(-1).includes('working 00:01'));
});

test('renderFooterLayout expands streaming pending preview from terminal rows without a fixed cap', () => {
  const streamingText = Array.from({ length: 20 }, (_value, index) => `line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    pending: { kind: 'streaming', text: streamingText },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'streaming',
      keyHint: 'Esc 中断'
    },
    rows: 24,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[0], '◇ …已生成 20 行，显示最新 16 行');
  assert.equal(layout.lines.length, 22);
  assert.ok(!plainLines.includes('◇ line 1'));
  assert.ok(plainLines.some((line) => line.includes('line 5')));
  assert.ok(plainLines.some((line) => line.includes('line 20')));
});

test('renderFooterLayout keeps markdown streaming preview bounded by terminal rows', () => {
  const streamingText = ['# Plan', '- alpha', '- beta', '- gamma', '```ts', 'const value = 1;', '```'].join('\n');
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    pending: { kind: 'streaming', text: streamingText },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'streaming',
      keyHint: 'Esc 中断'
    },
    rows: 9,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[0], '◇ …已生成 5 行，显示最新 1 行');
  assert.ok(!plainLines.some((line) => line === '◇ Plan'));
  assert.ok(!plainLines.some((line) => line === '  • alpha'));
  assert.ok(!plainLines.some((line) => line === '  • beta'));
  assert.ok(!plainLines.some((line) => line === '  • gamma'));
  assert.ok(plainLines.some((line) => line === '  const value = 1;'));
  assert.ok(plainLines.some((line) => line.includes('> draft input')));
    assert.ok(layout.lines.some((line) => line.includes('\x1b[38;2;255;255;255m')));
});

test('renderFooterLayout keeps markdown table streaming preview bounded by terminal rows', () => {
  const streamingText = [
    '| Index | Description |',
    '| ---: | --- |',
    '| 1 | alpha row with a long description |',
    '| 2 | beta row with a long description |',
    '| 3 | gamma row with a long description |',
    '| 4 | delta row with a long description |'
  ].join('\n');
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    pending: { kind: 'streaming', text: streamingText },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'streaming',
      keyHint: 'Esc 中断'
    },
    rows: 9,
    width: 42
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[0].startsWith('◇ …已生成 '), true);
  assert.ok(plainLines.some((line) => line.includes('│')));
  assert.ok(!plainLines.some((line) => line.includes('| Index |')));
  assert.ok(plainLines.some((line) => line.includes('> draft input')));
  assert.ok(displayWidth(layout.lines.at(-1)) <= safeRenderWidth(42));
});

test('renderFooterLayout renders working spinner in status line mode segment', () => {
  const elapsedMs = elapsedInSecondForSpinnerFrame(65, 4);
  const layout = renderFooterLayout({
    composer: createComposer('draft input'),
    pending: { kind: 'streaming', text: 'streaming draft' },
    working: { elapsedMs },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'streaming',
      keyHint: 'Esc 中断'
    },
    rows: 12,
    width: 100
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const spacerIndex = plainLines.findIndex((line) => line === '');
  const plainStatusLine = plainLines.at(-1);

  assert.ok(spacerIndex > 0);
  assert.ok(plainStatusLine.includes('▒█░   ░█▒ working 01:05'));
  assert.ok(plainStatusLine.includes('Esc 中断'));
  assert.match(layout.lines.at(-1), /\x1b\[38;2;/);
  assert.match(layout.lines.at(-1), /\x1b\[38;2;130;150;168mw\x1b\[39m/);
  assert.match(layout.lines.at(-1), /\x1b\[38;2;235;245;248mr\x1b\[39m/);
  assert.match(layout.lines.at(-1), /\x1b\[1m\x1b\[38;2;235;245;248mk\x1b\[39m\x1b\[22m/);
  assert.ok(!plainLines[spacerIndex - 1].includes('working'));
  assert.ok(plainLines.slice(0, spacerIndex).some((line) => line.includes('streaming draft')));
  assert.equal(layout.cursorRow, spacerIndex + 2);
});

test('renderFooterLayout renders tool call pending preview in footer', () => {
  const layout = renderFooterLayout({
    composer: createComposer(''),
    pending: {
      kind: 'tool_call',
      toolName: 'run_bash_command',
      argumentsText: '{"command":"pwd"}'
    },
    working: { elapsedMs: 0 },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'tool',
      detail: 'run_bash_command',
      keyHint: 'Esc 中断'
    },
    rows: 12,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(plainLines[0], '◆ ▌ Bash · running');
  assert.equal(plainLines[1], '  ▌ pwd');
  assert.ok(plainLines.at(-1).includes('   ▒█▒    working 00:00'));
  assert.match(layout.lines.at(-1), /\x1b\[38;2;/);
});

test('renderFooterLayout keeps multiline bash inline-script pending preview line safe', () => {
  const width = 140;
  const command = [
    'echo before',
    'node -e "console.log(\'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz\');"',
    'echo after'
  ].join('\n');
  const layout = renderFooterLayout({
    composer: createComposer(''),
    pending: {
      kind: 'tool_call',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({ command })
    },
    working: { elapsedMs: 0 },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'tool',
      detail: 'run_bash_command',
      keyHint: 'Esc 中断'
    },
    rows: 12,
    width
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  for (const line of layout.lines) {
    const plainLine = stripAnsi(line);

    assert.equal(plainLine.includes('\n'), false);
    assert.equal(plainLine.includes('\r'), false);
    assert.ok(displayWidth(line) <= safeRenderWidth(width), `line exceeds safe width: ${JSON.stringify(plainLine)}`);
  }
  assert.ok(plainLines.includes('  ▌ echo before'));
  assert.ok(plainLines.includes('  ▌ node -e "console.log(\'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz\');"'));
  assert.ok(plainLines.includes('  ▌ echo after'));
  assert.equal(plainLines.includes('node -e "…"'), false);
});

test('renderFooterLayout bounds long bash approval footer to rows minus top padding', () => {
  const longCommand = `rm -rf ${Array.from({ length: 40 }, (_value, index) => `very-long-path-${index}`).join('/')}`;
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'PERMISSION',
      message: longCommand,
      messageTitle: 'command',
      messageStyle: 'code',
      optionsTitle: 'action',
      options: [
        { label: 'Allow once' },
        { label: 'Allow this command for this session' },
        { label: 'Allow all tools for this session' },
        { label: 'Deny' },
        { label: 'Tell model what to do', inlineInput: { placeholder: 'Type instruction...', text: '', cursor: 0 } }
      ],
      focusedIndex: 0,
      dismissHint: '↑/↓ move · enter confirm · esc cancel'
    },
    pending: {
      kind: 'tool_call',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({ command: longCommand })
    },
    working: { elapsedMs: 1000 },
    statusLine: DEFAULT_STATUS_LINE,
    rows: 14,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.length <= 12);
  assert.ok(plainLines.some((line) => line.includes('PERMISSION')));
  assert.ok(plainLines.some((line) => line.includes('（已截断）')));
  assert.ok(plainLines.some((line) => line.includes('rm -rf')));
  assert.ok(plainLines.some((line) => line.includes('action')));
  assert.ok(plainLines.some((line) => line.includes('Allow once')));
  assert.ok(plainLines.some((line) => line.includes('Allow this command')));
  assert.ok(plainLines.some((line) => line.includes('Allow all tools')));
  assert.ok(plainLines.some((line) => line.includes('Deny')));
  assert.ok(plainLines.some((line) => line.includes('Tell model what to do')));
  assert.ok(!plainLines.some((line) => line.includes('Reasons')));
  assert.ok(!plainLines.some((line) => line.includes('（已截断）') && line.includes('enter confirm')));
  assert.equal(layout.cursorRow >= 0 && layout.cursorRow < layout.lines.length, true);
});

test('renderFooterLayout keeps long tool call pending within footer budget', () => {
  const longCommand = `printf '${'x'.repeat(360)}'`;
  const layout = renderFooterLayout({
    composer: createComposer(''),
    pending: {
      kind: 'tool_call',
      toolName: 'run_bash_command',
      argumentsText: JSON.stringify({ command: longCommand })
    },
    working: { elapsedMs: 0 },
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'tool',
      detail: 'run_bash_command',
      keyHint: 'Esc 中断'
    },
    rows: 9,
    width: 42
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.length <= 7);
  assert.ok(plainLines.some((line) => line.includes('Bash')));
  assert.ok(plainLines.some((line) => line === ''));
});

test('renderFooterLayout windows tall composer around cursor without ellipsis', () => {
  const text = Array.from({ length: 10 }, (_value, index) => `line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer(text),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 8,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.length <= 6);
  assert.ok(plainLines.some((line) => line.includes('line 10')));
  assert.ok(!plainLines.some((line) => /line 1(?:\D|$)/u.test(line)));
  assert.ok(!plainLines.some((line) => line.includes('...') || line.includes('…')));
  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow >= 0 && layout.cursorRow < layout.lines.length, true);
});

test('renderFooterLayout caps composer height below available footer rows', () => {
  const text = Array.from({ length: 30 }, (_value, index) => `line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer(text),
    commandSurface: null,
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 30,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.equal(layout.lines.length, 10);
  assert.ok(plainLines.some((line) => line.includes('line 30')));
  assert.ok(!plainLines.some((line) => /line 1(?:\D|$)/u.test(line)));
  assert.ok(!plainLines.some((line) => line.includes('...') || line.includes('…')));
  assert.equal(layout.cursorRow >= 0 && layout.cursorRow < layout.lines.length, true);
});

test('renderFooterLayout windows slash suggestions around selected item', () => {
  const options = Array.from({ length: 8 }, (_value, index) => ({ label: `/cmd-${index + 1}`, description: `command ${index + 1}` }));
  const layout = renderFooterLayout({
    composer: createComposer('/'),
    commandSurface: null,
    slashSuggestions: {
      options,
      selectedIndex: 6
    },
    pending: null,
    statusLine: {
      ...DEFAULT_STATUS_LINE,
      mode: 'command',
      keyHint: 'Tab 补全 · Enter 执行 · ↑/↓ 选择'
    },
    rows: 10,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));
  const suggestionLines = plainLines.filter((line) => line.startsWith('▌ /cmd-'));

  assert.ok(layout.lines.length <= 8);
  assert.equal(suggestionLines.length, 1);
  assert.ok(plainLines.some((line) => line.includes('↑ 6 更多')));
  assert.ok(plainLines.some((line) => line.includes('↓ 1 更多')));
  assert.ok(suggestionLines.some((line) => line.startsWith('▌ /cmd-7')));
  assert.ok(!suggestionLines.some((line) => line.startsWith('/cmd-1')));
});

test('renderFooterLayout windows select options around selected item', () => {
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'select',
      title: '/model 选择模型 (10)',
      options: Array.from({ length: 10 }, (_value, index) => ({ label: `model-${index + 1}`, description: `provider-${index + 1}` })),
      selectedIndex: 7,
      dismissHint: 'Enter 选择 · Up/Down 移动 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 8,
    width: 80
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.length <= 6);
  assert.ok(plainLines.some((line) => line.includes('↑ 7 更多')));
  assert.ok(plainLines.some((line) => line.includes('↓ 2 更多')));
  assert.ok(plainLines.some((line) => line.includes('▌ model-8')));
  assert.ok(!plainLines.some((line) => line.includes('model-1')));
});

test('renderFooterLayout constrains choice message and keeps inline input cursor visible', () => {
  const longMessage = Array.from({ length: 12 }, (_value, index) => `message line ${index + 1}`).join('\n');
  const layout = renderFooterLayout({
    composer: createComposer('ignored'),
    commandSurface: {
      kind: 'choice',
      title: 'Question',
      message: longMessage,
      messageTitle: 'question',
      optionsTitle: 'answer',
      options: [
        { label: 'Option 1' },
        { label: 'Option 2' },
        { label: 'Option 3' },
        { label: 'Other', inlineInput: { placeholder: 'Type answer...', text: 'custom answer', cursor: 6 } }
      ],
      focusedIndex: 3,
      dismissHint: 'Enter 确认 · Esc 取消'
    },
    pending: null,
    statusLine: DEFAULT_STATUS_LINE,
    rows: 12,
    width: 70
  });
  const plainLines = layout.lines.map((line) => stripAnsi(line));

  assert.ok(layout.lines.length <= 10);
  assert.equal(layout.showCursor, true);
  assert.equal(layout.cursorRow >= 0 && layout.cursorRow < layout.lines.length, true);
  assert.ok(plainLines.some((line) => line.includes('（已截断）')));
  assert.ok(plainLines.some((line) => line.includes('answer')));
  assert.ok(plainLines.some((line) => line.includes('Option 1')));
  assert.ok(plainLines.some((line) => line.includes('Option 2')));
  assert.ok(plainLines.some((line) => line.includes('Option 3')));
  assert.ok(plainLines.some((line) => line.includes('Other custom answer')));
  for (const line of layout.lines) {
    assert.ok(displayWidth(line) <= safeRenderWidth(70));
  }
});
