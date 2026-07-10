import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
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
    renderTop(boxWidth, commandSurface.title || 'HOOKS', theme),
    renderLine('', contentWidth, theme),
    ...content,
    renderLine('', contentWidth, theme),
    ...bottomMessages,
    ...(bottomMessages.length > 0 ? [renderLine('', contentWidth, theme)] : []),
    renderIndentedLine(ansi.dim(clampPlainText(commandSurface.dismissHint || 'Enter 保存 · Esc 取消', getIndentedContentWidth(contentWidth))), contentWidth, theme),
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

    rows.push(renderSelectableRow(row.item.event, `${row.item.count} hooks`, row.index === selectedIndex, contentWidth, theme));
  }

  return rows;
}

function renderEntryRows(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const rows = [renderLine(tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(commandSurface.selectedEvent, contentWidth))), contentWidth, theme)];
  const entries = commandSurface.entries || [];
  const selectedIndex = clampIndex(commandSurface.entryIndex, entries.length);

  if (entries.length === 0) {
    rows.push(renderLine(ansi.dim('当前 event 没有 hook entry。'), contentWidth, theme));
    return rows;
  }

  for (const row of createSelectedWindowRows(entries, selectedIndex, HOOKS_MAX_VISIBLE)) {
    if (row.kind === 'more') {
      rows.push(renderLine(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), contentWidth, theme));
      continue;
    }

    rows.push(renderEntryRow(row.item, row.index, row.index === selectedIndex, contentWidth, theme));
  }

  return rows;
}

function renderEntryDetailRows(commandSurface: HooksCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  const rows = [renderLine(tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(commandSurface.selectedEvent, contentWidth))), contentWidth, theme)];
  const entries = commandSurface.entries || [];
  const selectedIndex = clampIndex(commandSurface.entryIndex, entries.length);
  const entry = entries[selectedIndex];
  const detailIndex = clampIndex(commandSurface.detailIndex, 5);

  if (!entry) {
    rows.push(renderLine(ansi.dim('当前 event 没有 hook entry。'), contentWidth, theme));
    return rows;
  }

  const commandValue = commandSurface.editTarget === 'command'
    ? `${commandSurface.editBuffer || ''}█`
    : entry.command || '<empty command>';
  const timeoutValue = commandSurface.editTarget === 'timeoutMs'
    ? `${commandSurface.editBuffer || ''}█`
    : `${entry.timeoutMs}ms`;
  const enabledValue = entry.enabled ? 'on' : 'off';

  rows.push(renderLine(ansi.dim(`#${selectedIndex + 1}`), contentWidth, theme));
  rows.push(renderDetailRow('Command', commandValue, detailIndex === 0, contentWidth, theme));
  rows.push(renderDetailRow('Timeout', timeoutValue, detailIndex === 1, contentWidth, theme));
  rows.push(renderDetailRow('Enabled', enabledValue, detailIndex === 2, contentWidth, theme));
  rows.push(renderSeparatorRow(contentWidth, theme));
  rows.push(renderActionRow('Run synthetic test', 'display only', detailIndex === 3, false, contentWidth, theme));
  rows.push(renderActionRow('Delete entry', 'remove from draft', detailIndex === 4, true, contentWidth, theme));
  return rows;
}

function renderEntryRow(entry: LifecycleHookDraftEntry, index: number, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const pill = entry.enabled ? tokenText(theme, 'success', '● on') : tokenText(theme, 'off', '○ off');
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
    return {text: 'synthetic test: running…', token: 'warning'};
  }

  const result = test.result;
  if (result?.ok) {
    return {text: 'synthetic test: ok', token: 'success'};
  }

  if (result?.timedOut) {
    return {text: 'synthetic test: timeout', token: 'danger'};
  }

  return {text: 'synthetic test: failed', token: 'danger'};
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
