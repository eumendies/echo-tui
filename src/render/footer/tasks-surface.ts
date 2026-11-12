import * as ansi from '../../terminal/ansi';
import {sanitizeTerminalText} from '../../terminal/control-chars';
import {displayWidth, safeRenderWidth, wrapText} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {clampIndex, createSelectedWindowRows} from './window';

import type {TasksCommandSurface} from '../../types/command';
import type {BackgroundTaskView} from '../../types/background-task';
import type {FooterLayout} from '../../types/render';

const TASKS_SURFACE_MAX_WIDTH = 110;
const TASKS_LIST_MAX_VISIBLE = 8;
const TASKS_LOG_MAX_LINES = 12;
const TASKS_COMMAND_MAX_LINES = 8;
// 与 /agents 同口径:正文够宽时切左右主从,否则退回单栏。
const TASKS_WIDE_CONTENT_MIN_WIDTH = 87;
const TASKS_SUMMARY_COMMAND_LINES = 3;
const TASKS_SUMMARY_LOG_LINES = 4;
// 每行固定 2 列前缀(焦点条位 + 空格):切换焦点时内容列不会左右跳动。
const TASKS_ROW_PREFIX_WIDTH = 2;

/**
 * 渲染后台任务面板；renderer 只投影命令会话快照，不读取管理器、不探测进程。
 */
function renderTasksSurface(surface: TasksCommandSurface, width: number, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const boxWidth = Math.max(1, Math.min(safeRenderWidth(width), TASKS_SURFACE_MAX_WIDTH));
  const contentWidth = Math.max(1, boxWidth - 4);
  // 只有列表层走列表投影;详情与停止确认共用详情正文。
  const body = surface.mode === 'list'
    ? renderList(surface, contentWidth, theme)
    : renderDetail(surface, contentWidth, theme);
  const lines = [
    topLine(boxWidth, surface.title, theme),
    line('', contentWidth, theme),
    ...body,
    ...(surface.error ? [line(tokenText(theme, 'danger', clampPlainText(toSingleLine(surface.error), contentWidth)), contentWidth, theme)] : []),
    line('', contentWidth, theme),
    line(ansi.dim(clampPlainText(surface.dismissHint, contentWidth)), contentWidth, theme),
    bottomLine(boxWidth, theme)
  ];

  return {lines, cursorRow: lines.length - 1, cursorColumn: 0, showCursor: false};
}

function renderList(surface: TasksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  if (surface.tasks.length === 0) {
    return [contentRow(' ', ansi.dim('当前会话没有后台任务。'), contentWidth, theme)];
  }

  if (contentWidth >= TASKS_WIDE_CONTENT_MIN_WIDTH) {
    return renderWideList(surface, contentWidth, theme);
  }

  const selectedIndex = clampIndex(surface.selectedIndex, surface.tasks.length);
  const rows = createSelectedWindowRows(surface.tasks, selectedIndex, TASKS_LIST_MAX_VISIBLE);

  return rows.map((row) => {
    if (row.kind === 'more') {
      const moreText = `… 另有 ${row.count} 个任务`;
      return contentRow(' ', ansi.dim(moreText), contentWidth, theme);
    }

    const selected = row.index === selectedIndex;
    const marker = selected ? renderFocusBar(theme) : ' ';
    const body = clampPlainText(formatTaskRow(row.item), contentWidth - TASKS_ROW_PREFIX_WIDTH);

    return selected
      ? line(activeBackground(theme, `${marker} ${body}`), contentWidth, theme)
      : line(`${marker} ${body}`, contentWidth, theme);
  });
}

/**
 * 宽终端主从布局:左侧任务列表,右侧选中任务的命令、状态与日志预览。
 * 两栏按同一高度合并,切换选中项时右侧信息位置保持稳定。
 */
function renderWideList(surface: TasksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const selectedIndex = clampIndex(surface.selectedIndex, surface.tasks.length);
  const divider = ansi.dim(' │ ');
  const dividerWidth = displayWidth(divider);
  const leftWidth = Math.min(40, Math.max(26, Math.floor((contentWidth - dividerWidth) * 0.38)));
  const rightWidth = Math.max(1, contentWidth - leftWidth - dividerWidth);
  const listCells = createSelectedWindowRows(surface.tasks, selectedIndex, TASKS_LIST_MAX_VISIBLE)
    .map((row) => renderWideListCell(row, selectedIndex, leftWidth, theme));
  const summaryCells = renderSummaryCells(surface.tasks[selectedIndex], surface.logLines, rightWidth, theme);
  const rowCount = Math.max(listCells.length, summaryCells.length);
  const rows: string[] = [];

  for (let index = 0; index < rowCount; index += 1) {
    rows.push(line(
      `${padVisibleText(listCells[index] || '', leftWidth)}${divider}${padVisibleText(summaryCells[index] || '', rightWidth)}`,
      contentWidth,
      theme
    ));
  }

  return rows;
}

/** 左侧单元格:焦点条位 + 状态符号 + 命令摘要,整体宽度固定。 */
function renderWideListCell(
  row: {count: number; direction: 'up' | 'down'; kind: 'more'} | {index: number; item: BackgroundTaskView; kind: 'item'},
  selectedIndex: number,
  width: number,
  theme: FooterTheme
): string {
  if (row.kind === 'more') {
    return padVisibleText(ansi.dim(clampPlainText(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`, width)), width);
  }

  const selected = row.index === selectedIndex;
  const marker = selected ? renderFocusBar(theme) : ' ';
  const glyph = formatTaskGlyph(row.item, theme);
  const name = clampPlainText(toSingleLine(row.item.command || '(未知命令)'), Math.max(1, width - 4));
  const body = padVisibleText(`${marker} ${glyph} ${name}`, width);
  return selected ? activeBackground(theme, body) : body;
}

/** 右侧摘要:命令、状态行与日志预览;每段都有固定上限,避免撑爆 footer。 */
function renderSummaryCells(task: BackgroundTaskView | undefined, logLines: string[] | undefined, width: number, theme: FooterTheme): string[] {
  if (!task) {
    return [ansi.dim('按 ↑↓ 选择任务')];
  }

  const rows: string[] = wrapText(sanitizeTerminalText(task.command || '(未知)'), width)
    .slice(0, TASKS_SUMMARY_COMMAND_LINES)
    .map((text) => clampPlainText(text, width));

  rows.push('');
  rows.push(ansi.dim(clampPlainText(
    `${formatTaskState(task)} · ${formatElapsed(task.elapsedMs)}`,
    width
  )));

  if (task.unreadable) {
    rows.push('');
    rows.push(tokenText(theme, 'warning', clampPlainText(task.unreadable, width)));
    return rows;
  }

  const tail = (logLines || []).slice(-TASKS_SUMMARY_LOG_LINES);

  if (tail.length === 0) {
    return rows;
  }

  rows.push('');
  for (const logLine of tail) {
    rows.push(ansi.dim(clampPlainText(toSingleLine(logLine), width)));
  }

  return rows;
}

/** 列表符号:一眼区分运行中、成功、失败与已停止。 */
function formatTaskGlyph(task: BackgroundTaskView, theme: FooterTheme): string {
  if (task.unreadable) {
    return tokenText(theme, 'warning', '?');
  }

  switch (task.state) {
    case 'running':
      return tokenText(theme, 'success', '●');
    case 'stopping':
      return tokenText(theme, 'warning', '◐');
    case 'exited':
      return task.exitCode === 0 ? tokenText(theme, 'success', '✓') : tokenText(theme, 'danger', '×');
    case 'failed':
      return tokenText(theme, 'danger', '×');
    default:
      return tokenText(theme, 'muted', '○');
  }
}

function renderDetail(surface: TasksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const task = surface.tasks[clampIndex(surface.selectedIndex, Math.max(1, surface.tasks.length))];

  if (!task) {
    return [line(ansi.dim('任务已不在当前快照中，按 r 刷新。'), contentWidth, theme)];
  }

  const rows = [
    contentRow(' ', project('状态', `${formatTaskState(task)}${task.managed ? '' : ' · 未托管'}`), contentWidth, theme),
    contentRow(' ', project('耗时', formatElapsed(task.elapsedMs)), contentWidth, theme),
    ...renderCommandRows(task.command, contentWidth, theme),
    contentRow(' ', ansi.dim(toSingleLine(`日志 ${task.reference.outputPath}`)), contentWidth, theme)
  ];

  if (surface.mode === 'confirmStop') {
    rows.push(line('', contentWidth, theme));
    rows.push(contentRow(' ', tokenText(theme, 'warning', '确认停止这个任务？'), contentWidth, theme));
    return rows;
  }

  if (surface.logUnavailable) {
    rows.push(contentRow(' ', tokenText(theme, 'warning', surface.logUnavailable), contentWidth, theme));
    return rows;
  }

  const logLines = surface.logLines ?? [];
  rows.push(line('', contentWidth, theme));

  if (logLines.length === 0) {
    rows.push(contentRow(' ', ansi.dim('(日志为空)'), contentWidth, theme));
    return rows;
  }

  for (const logLine of logLines) {
    // 日志来自子进程,必须在显示边界清掉控制序列,否则会破坏终端布局。
    rows.push(contentRow(' ', ansi.dim(toSingleLine(logLine)), contentWidth, theme));
  }

  if (surface.logTruncated) {
    rows.push(contentRow(' ', ansi.dim('… 仅显示日志尾部'), contentWidth, theme));
  }

  return rows;
}

/**
 * 命令按原始行展示并自动折行;命令是详情里最关键的信息,不能压成一行丢掉后半段。
 */
function renderCommandRows(command: string, contentWidth: number, theme: FooterTheme): string[] {
  const bodyWidth = Math.max(1, contentWidth - TASKS_ROW_PREFIX_WIDTH - 2);
  const bodyLines = wrapText(sanitizeTerminalText(command || '(未知)'), bodyWidth);
  const visible = bodyLines.slice(0, TASKS_COMMAND_MAX_LINES);
  const rows = [contentRow(' ', tokenText(theme, 'muted', '命令:'), contentWidth, theme)];

  for (const text of visible) {
    rows.push(contentRow(' ', ansi.dim(`  ${text}`), contentWidth, theme));
  }

  if (bodyLines.length > visible.length) {
    rows.push(contentRow(' ', ansi.dim(`  … 还有 ${bodyLines.length - visible.length} 行`), contentWidth, theme));
  }

  return rows;
}

/**
 * 单行内容行:固定 2 列前缀 + 按剩余宽度裁剪的正文。
 * 前缀长度恒定,因此焦点条出现或消失都不会让正文左移右移。
 */
function contentRow(marker: string, body: string, contentWidth: number, theme: FooterTheme): string {
  return line(`${marker} ${clampPlainText(body, contentWidth - TASKS_ROW_PREFIX_WIDTH)}`, contentWidth, theme);
}

/** 以命令识别任务，单行展示状态与快照耗时；内部编号不占用列表宽度。 */
function formatTaskRow(task: BackgroundTaskView): string {
  // 列表每行只占一个物理行:命令里的换行必须压平,否则会把 footer 的几何算错。
  const command = toSingleLine(task.command || '(未知命令)');
  return `${formatTaskState(task)} · ${command} · ${formatElapsed(task.elapsedMs)}`;
}

/**
 * 压成单物理行:清掉控制序列并把换行折成空格。
 * 单行 `line()` 的入参一旦含真实换行,终端会多吐一行,footer 的整帧定位随之错位。
 */
function toSingleLine(text: string): string {
  return sanitizeTerminalText(text).replace(/\s+/gu, ' ').trim();
}

function formatTaskState(task: BackgroundTaskView): string {
  if (task.unreadable) {
    return '[不可读取]';
  }

  switch (task.state) {
    case 'running':
      return task.managed ? '[running]' : '[未托管]';
    case 'stopping':
      return '[stopping]';
    case 'exited':
      return `[exited ${task.exitCode === null ? 'null' : task.exitCode}]`;
    case 'stopped':
      return `[stopped${task.reason ? ` ${task.reason}` : ''}]`;
    case 'failed':
      return `[failed${task.reason ? ` ${task.reason}` : ''}]`;
    default:
      return `[${task.state}]`;
  }
}

function formatElapsed(elapsedMs: number | null): string {
  if (elapsedMs === null || !Number.isFinite(elapsedMs)) {
    return '—';
  }

  const totalMs = Math.max(0, Math.floor(elapsedMs));

  if (totalMs < 1000) {
    return `${totalMs}ms`;
  }

  const totalSeconds = Math.floor(totalMs / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  // 长任务用「3m 12s」而不是「192s」,一眼能判断规模。
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function project(label: string, value: string): string {
  return `${label}: ${value}`;
}

function topLine(width: number, title: string, theme: FooterTheme): string {
  const titleText = clampPlainText(title, Math.max(1, width - 4));
  const tag = tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `));
  const railWidth = Math.max(0, width - 2 - displayWidth(tag));
  return `${tokenText(theme, 'accentDeep', '╭')}${tag}${tokenText(theme, 'accentDeep', '─'.repeat(railWidth))}${tokenText(theme, 'accentDeep', '╮')}`;
}

function bottomLine(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╯')}`;
}

function line(content: string, contentWidth: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, contentWidth)} ${tokenText(theme, 'accentDeep', '│')}`;
}

export {
  TASKS_LOG_MAX_LINES,
  renderTasksSurface
};
