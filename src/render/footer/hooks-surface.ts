import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth, splitGraphemes} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {clampIndex, createSelectedWindowRows} from './window';

import type {HooksCommandSurface} from '../../types/command';
import type {LifecycleHookDraftEntry} from '../../types/hooks';
import type {FooterLayout} from '../../types/render';

const HOOKS_SURFACE_MIN_WIDTH = 56;
const HOOKS_SURFACE_MAX_WIDTH = 110;
const HOOKS_MAX_VISIBLE = 8;
const HOOKS_BODY_INDENT = '  ';

/**
 * 渲染 lifecycle hooks 管理面板；renderer 只展示 command session 快照，不读写配置或执行命令。
 */
export function renderHooksSurface(commandSurface: HooksCommandSurface, width: number, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const boxWidth = calculateHooksBoxWidth(width);
  const contentWidth = Math.max(1, boxWidth - 4);
  const content = renderHooksContent(commandSurface, contentWidth, theme);
  const bottomMessages = renderBottomMessageRows(commandSurface, contentWidth, theme);
  const lines = [
    renderTop(boxWidth, commandSurface.title, theme),
    renderLine('', contentWidth, theme),
    ...content,
    renderLine('', contentWidth, theme),
    ...bottomMessages,
    ...(bottomMessages.length > 0 ? [renderLine('', contentWidth, theme)] : []),
    renderIndentedLine(ansi.dim(clampPlainText(commandSurface.dismissHint, getIndentedContentWidth(contentWidth))), contentWidth, theme),
    renderBottom(boxWidth, theme)
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

function calculateHooksBoxWidth(width: number): number {
  const safeWidth = safeRenderWidth(width);
  const targetWidth = Math.max(HOOKS_SURFACE_MIN_WIDTH, Math.min(HOOKS_SURFACE_MAX_WIDTH, safeWidth - 4));
  return Math.max(1, Math.min(safeWidth, targetWidth));
}

function renderHooksContent(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const rows: string[] = [];

  if (commandSurface.mode === 'events') {
    rows.push(...renderEventRows(commandSurface, contentWidth, theme));
  } else if (commandSurface.mode === 'entryDetail') {
    rows.push(...renderEntryDetailRows(commandSurface, contentWidth, theme));
  } else {
    rows.push(...renderEntryRows(commandSurface, contentWidth, theme));
  }

  if (commandSurface.diagnostics && commandSurface.diagnostics.length > 0) {
    rows.push(renderLine(tokenText(theme, 'warning', clampPlainText(`诊断 ${commandSurface.diagnostics[0]}`, contentWidth)), contentWidth, theme));

    if (commandSurface.diagnostics.length > 1) {
      rows.push(renderLine(ansi.dim(`  +${commandSurface.diagnostics.length - 1} 条诊断`), contentWidth, theme));
    }
  }

  return rows;
}

/**
 * 渲染底部反馈区；错误和 synthetic test 结果都保持短提示，避免挤占表单主体。
 */
function renderBottomMessageRows(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const rows: string[] = [];

  if (commandSurface.error) {
    rows.push(renderFeedbackLine(commandSurface.error, 'danger', contentWidth, theme));
  }

  const testMessage = createTestStatusMessage(commandSurface);
  if (testMessage) {
    rows.push(renderFeedbackLine(testMessage.text, testMessage.token, contentWidth, theme));
  }

  return rows;
}

/**
 * 渲染 event 总览行；右侧只展示配置 entry 总数，避免重新引入 event 级启停汇总。
 */
function renderEventRows(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const selectedIndex = clampIndex(commandSurface.eventIndex, commandSurface.events.length);
  const rows: string[] = [];

  for (const row of createSelectedWindowRows(commandSurface.events, selectedIndex, HOOKS_MAX_VISIBLE)) {
    if (row.kind === 'more') {
      rows.push(renderLine(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), contentWidth, theme));
      continue;
    }

    rows.push(renderSelectableRow(row.item.event, `${row.item.count} 个 Hook`, row.index === selectedIndex, contentWidth, theme));
  }

  return rows;
}

function renderEntryRows(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const rows = [renderLine(tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(commandSurface.selectedEvent, contentWidth))), contentWidth, theme)];
  const entries = commandSurface.entries || [];
  const rowItems = [
    ...entries.map((entry, index) => ({entry, entryIndex: index, kind: 'entry' as const})),
    {kind: 'add' as const},
    {kind: 'save' as const}
  ];
  const selectedIndex = clampIndex(commandSurface.entryIndex, rowItems.length);

  if (entries.length === 0) {
    rows.push(renderLine(ansi.dim('当前事件没有 Hook 配置。'), contentWidth, theme));
  }

  for (const row of createSelectedWindowRows(rowItems, selectedIndex, HOOKS_MAX_VISIBLE)) {
    if (row.kind === 'more') {
      rows.push(renderLine(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), contentWidth, theme));
      continue;
    }

    if (row.item.kind === 'add') {
      rows.push(renderActionRow('添加 Hook', '新建配置草稿', row.index === selectedIndex, false, contentWidth, theme));
    } else if (row.item.kind === 'save') {
      rows.push(renderActionRow('保存更改', '写入 ~/.echo/config.json', row.index === selectedIndex, false, contentWidth, theme));
    } else {
      rows.push(renderEntryRow(row.item.entry, row.item.entryIndex, row.index === selectedIndex, contentWidth, theme));
    }
  }

  return rows;
}

function renderEntryDetailRows(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const rows = [renderLine(tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(commandSurface.selectedEvent, contentWidth))), contentWidth, theme)];
  const entries = commandSurface.entries || [];
  const selectedIndex = clampIndex(commandSurface.entryIndex, entries.length);
  const entry = entries[selectedIndex];
  const detailIndex = clampIndex(commandSurface.detailIndex, 6);

  if (!entry) {
    rows.push(renderLine(ansi.dim('当前事件没有 Hook 配置。'), contentWidth, theme));
    return rows;
  }

  const commandValue = commandSurface.editTarget === 'command'
    ? createEditingCommandValue(commandSurface.editBuffer || '', commandSurface.editCursor, contentWidth)
    : createScrollableCommandValue(entry.command || '<空命令>', commandSurface.commandScroll || 0, contentWidth);
  const timeoutValue = commandSurface.editTarget === 'timeoutMs'
    ? `${commandSurface.editBuffer || ''}█`
    : `${entry.timeoutMs}ms`;
  const enabledValue = entry.enabled ? '已启用' : '已禁用';

  rows.push(renderLine(ansi.dim(`#${selectedIndex + 1}`), contentWidth, theme));
  rows.push(renderDetailRow('命令', commandValue, detailIndex === 0, contentWidth, theme));
  rows.push(renderDetailRow('超时时间', timeoutValue, detailIndex === 1, contentWidth, theme));
  rows.push(renderDetailRow('启用状态', enabledValue, detailIndex === 2, contentWidth, theme));
  rows.push(renderSeparatorRow(contentWidth, theme));
  rows.push(renderActionRow('运行模拟测试', '仅展示结果', detailIndex === 3, false, contentWidth, theme));
  rows.push(renderActionRow('删除 Hook', '从草稿移除', detailIndex === 4, true, contentWidth, theme));
  rows.push(renderActionRow('保存更改', '写入 ~/.echo/config.json', detailIndex === 5, false, contentWidth, theme));
  return rows;
}

function renderEntryRow(entry: LifecycleHookDraftEntry, index: number, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const pill = entry.enabled ? tokenText(theme, 'success', '● 启用') : tokenText(theme, 'off', '○ 禁用');
  const label = `#${index + 1} ${pill} ${entry.timeoutMs}ms`;
  const commandWidth = Math.max(1, contentWidth - displayWidth(stripAnsiForWidth(label)) - 6);
  const description = clampPlainText(entry.command || '<empty command>', commandWidth);
  return renderSelectableRow(label, description, active, contentWidth, theme);
}

/**
 * 生成 synthetic test 的短状态文案；详细 stdout/stderr 只保留在命令结果数据里，不进入主面板。
 */
function createTestStatusMessage(commandSurface: HooksCommandSurface): {text: string; token: 'success' | 'warning' | 'danger'} | null {
  const test = commandSurface.test;

  if (!test) {
    return null;
  }

  if (test.status === 'running') {
    return {text: '模拟测试：运行中…', token: 'warning'};
  }

  const result = test.result;
  if (result?.ok) {
    return {text: '模拟测试：成功', token: 'success'};
  }

  if (result?.timedOut) {
    return {text: '模拟测试：超时', token: 'danger'};
  }

  return {text: '模拟测试：失败', token: 'danger'};
}

function renderSelectableRow(label: string, description: string, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowContentWidth = Math.max(1, contentWidth - 1);
  const labelText = active ? tokenText(theme, 'accentStrong', ansi.bold(label)) : label;
  const prefix = ` ${labelText}  `;
  const descriptionWidth = Math.max(1, rowContentWidth - displayWidth(prefix));
  const body = padVisibleText(`${prefix}${ansi.dim(clampPlainText(description, descriptionWidth))}`, rowContentWidth);

  if (!active) {
    return renderLine(` ${body}`, contentWidth, theme);
  }

  return renderLine(`${renderFocusBar(theme)}${activeBackground(theme, body)}`, contentWidth, theme);
}

function renderDetailRow(label: string, value: string, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowContentWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const rawValue = value || '未设置';
  const rightWidth = Math.min(displayWidth(rawValue), Math.max(0, Math.floor(rowContentWidth * 0.56)));
  const leftWidth = Math.max(1, rowContentWidth - rightWidth);
  const labelWidth = Math.max(1, leftWidth - displayWidth(prefix));
  const visibleLabel = clampCellText(label, labelWidth);
  const labelText = tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(visibleLabel) : visibleLabel);
  const valueText = rightWidth > 0 ? tokenText(theme, active ? 'accentStrong' : 'accent', clampCellText(rawValue, rightWidth)) : '';
  const body = `${padVisibleText(`${prefix}${labelText}`, leftWidth)}${padVisibleText(valueText, rightWidth)}`;

  if (!active) {
    return renderLine(body, contentWidth, theme);
  }

  return renderLine(`${renderFocusBar(theme)}${activeBackground(theme, body)}`, contentWidth, theme);
}

/**
 * 将 command 字段映射到单行可见窗口；省略号标记窗口左右仍有隐藏内容。
 */
function createScrollableCommandValue(command: string, scroll: number, contentWidth: number): string {
  const maxValueWidth = calculateCommandValueWidth(contentWidth);
  const projectedCommand = projectCommandText(command || '<空命令>');
  const chars = splitGraphemes(projectedCommand);
  const tailStart = findTailWindowStart(chars, Math.max(1, maxValueWidth - 1));
  const normalizedScroll = Math.min(Math.max(0, Math.floor(scroll)), tailStart);
  const visible = takeVisibleWindow(chars.slice(normalizedScroll), maxValueWidth);
  const hasLeft = normalizedScroll > 0;
  const hasRight = normalizedScroll + visible.count < chars.length;

  if (!hasLeft && !hasRight) {
    return projectedCommand;
  }

  const prefix = hasLeft ? '…' : '';
  const suffix = hasRight ? '…' : '';
  const bodyWidth = Math.max(1, maxValueWidth - displayWidth(prefix) - displayWidth(suffix));
  return `${prefix}${takeVisibleWindow(chars.slice(normalizedScroll), bodyWidth).text}${suffix}`;
}

/**
 * 编辑 command 时按光标位置生成可见窗口；左右省略号分别表达窗口两侧仍有隐藏内容。
 */
function createEditingCommandValue(text: string, cursor: number | undefined, contentWidth: number): string {
  const maxValueWidth = calculateCommandValueWidth(contentWidth);
  const cursorMarker = '█';
  const projection = projectCommandTextWithCursor(text, cursor);
  const chars = projection.chars;
  const normalizedCursor = projection.cursor;
  const fullText = `${chars.slice(0, normalizedCursor).join('')}${cursorMarker}${chars.slice(normalizedCursor).join('')}`;

  if (displayWidth(fullText) <= maxValueWidth) {
    return fullText;
  }

  if (maxValueWidth <= displayWidth(cursorMarker)) {
    return cursorMarker;
  }

  let start = normalizedCursor;
  let end = normalizedCursor;
  let leftWidth = 0;
  let rightWidth = 0;

  while (start > 0 || end < chars.length) {
    const canExpandLeft = start > 0 && displayWidth(formatEditingCommandWindow(chars, normalizedCursor, start - 1, end, cursorMarker)) <= maxValueWidth;
    const canExpandRight = end < chars.length && displayWidth(formatEditingCommandWindow(chars, normalizedCursor, start, end + 1, cursorMarker)) <= maxValueWidth;

    if (!canExpandLeft && !canExpandRight) {
      break;
    }

    if (canExpandLeft && (!canExpandRight || leftWidth <= rightWidth)) {
      start -= 1;
      leftWidth += displayWidth(chars[start]);
    } else {
      rightWidth += displayWidth(chars[end]);
      end += 1;
    }
  }

  return formatEditingCommandWindow(chars, normalizedCursor, start, end, cursorMarker);
}

function formatEditingCommandWindow(chars: string[], cursor: number, start: number, end: number, cursorMarker: string): string {
  const leading = start > 0 ? '…' : '';
  const trailing = end < chars.length ? '…' : '';
  return `${leading}${chars.slice(start, cursor).join('')}${cursorMarker}${chars.slice(cursor, end).join('')}${trailing}`;
}

function calculateCommandValueWidth(contentWidth: number): number {
  return Math.max(1, Math.floor(Math.max(1, contentWidth - 1) * 0.56));
}

function findTailWindowStart(chars: string[], width: number): number {
  let columns = 0;

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const nextColumns = columns + displayWidth(chars[index]);

    if (nextColumns > width) {
      return index + 1;
    }

    columns = nextColumns;
  }

  return 0;
}

function takeVisibleWindow(chars: string[], width: number): {count: number; text: string} {
  const safeWidth = Math.max(1, width);
  let result = '';
  let columns = 0;
  let count = 0;

  for (const char of chars) {
    const nextColumns = columns + displayWidth(char);

    if (nextColumns > safeWidth) {
      break;
    }

    result += char;
    columns = nextColumns;
    count += 1;
  }

  return {count, text: result};
}

/** 将命令中的物理空白投影为安全单行文本，不改变实际配置草稿。 */
function projectCommandText(text: string): string {
  return splitGraphemes(text)
    .map((grapheme) => /[\t\r\n]/u.test(grapheme) ? ' ' : grapheme)
    .join('');
}

/** 将编辑光标从 code point 索引映射到单行 grapheme 投影。 */
function projectCommandTextWithCursor(text: string, cursor: number | undefined): {chars: string[]; cursor: number} {
  const codePoints = Array.from(text);
  const codePointCursor = Math.min(Math.max(0, Number.isInteger(cursor) ? Number(cursor) : codePoints.length), codePoints.length);
  const chars = splitGraphemes(projectCommandText(text));
  const projectedPrefix = projectCommandText(codePoints.slice(0, codePointCursor).join(''));
  return {
    chars,
    cursor: Math.min(splitGraphemes(projectedPrefix).length, chars.length)
  };
}

function renderActionRow(label: string, hint: string, active: boolean, danger: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowContentWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const hintWidth = Math.min(displayWidth(hint), Math.max(0, Math.floor(rowContentWidth * 0.44)));
  const labelWidth = Math.max(1, rowContentWidth - hintWidth);
  const token = danger ? 'danger' : active ? 'success' : 'accent';
  const visibleLabel = clampCellText(label, Math.max(1, labelWidth - displayWidth(prefix)));
  const labelText = tokenText(theme, token, active ? ansi.bold(visibleLabel) : visibleLabel);
  const hintText = hintWidth > 0 ? ansi.dim(clampCellText(hint, hintWidth)) : '';
  const body = `${padVisibleText(`${prefix}${labelText}`, labelWidth)}${padVisibleText(hintText, hintWidth)}`;

  if (!active) {
    return renderLine(body, contentWidth, theme);
  }

  return renderLine(`${renderFocusBar(theme)}${activeBackground(theme, body)}`, contentWidth, theme);
}

/**
 * 在 detail 字段和危险/执行动作之间画轻量分隔线；不参与键盘焦点行计数。
 */
function renderSeparatorRow(contentWidth: number, theme: FooterTheme): string {
  const prefix = contentWidth > 2 ? '  ' : '';
  const railWidth = Math.max(0, contentWidth - displayWidth(prefix));
  return renderLine(ansi.dim(`${prefix}${'─'.repeat(railWidth)}`), contentWidth, theme);
}

function clampCellText(text: string, width: number): string {
  return width <= 0 ? '' : clampPlainText(text, width + 1);
}

function renderTop(width: number, title: string, theme: FooterTheme): string {
  const titleText = clampPlainText(title, Math.max(1, width - 4));
  const titleTag = tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `));
  const railWidth = Math.max(0, width - 2 - displayWidth(titleTag));

  return `${tokenText(theme, 'accentDeep', '╭')}${titleTag}${renderRail(railWidth, theme)}${tokenText(theme, 'accentDeep', '╮')}`;
}

function renderBottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${renderRail(Math.max(0, width - 2), theme)}${tokenText(theme, 'accentDeep', '╯')}`;
}

function renderLine(content: string, width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, width)} ${tokenText(theme, 'accentDeep', '│')}`;
}

/**
 * 渲染与表单主体同列起始的底部行；用于反馈文案和快捷键提示，避免视觉上贴边。
 */
function renderIndentedLine(content: string, width: number, theme: FooterTheme): string {
  return renderLine(`${HOOKS_BODY_INDENT}${content}`, width, theme);
}

/**
 * 渲染左侧 gutter 状态线；竖线占用表单焦点条位置，正文与表单 label/hint 同列。
 */
function renderFeedbackLine(content: string, token: 'success' | 'warning' | 'danger', width: number, theme: FooterTheme): string {
  const markerText = Array.from(theme.focusBar)[0] || '▌';
  const markerWidth = displayWidth(markerText);
  const gapWidth = width > markerWidth ? 1 : 0;
  const marker = tokenText(theme, token, markerText);
  const messageWidth = Math.max(0, width - markerWidth - gapWidth);
  const gap = gapWidth > 0 ? ' ' : '';
  const message = messageWidth > 0 ? tokenText(theme, token, clampPlainText(content, messageWidth)) : '';
  return renderLine(`${marker}${gap}${message}`, width, theme);
}

/**
 * 计算缩进后剩余的可见宽度，保证长反馈文案裁剪时不会越过右边框。
 */
function getIndentedContentWidth(width: number): number {
  return Math.max(1, width - HOOKS_BODY_INDENT.length);
}

function renderRail(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width)));
}

function stripAnsiForWidth(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}
