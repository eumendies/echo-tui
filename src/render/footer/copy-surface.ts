import * as ansi from '../../terminal/ansi';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {displayWidth, safeRenderWidth, stripAnsi} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {createSelectedWindowRows, normalizeLineLimit} from './window';
import {renderStyledLine} from '../markdown/styled-line';

import type {CopyCommandSurface, CopySurfaceMessage} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const BODY_OUTER_DECORATION_WIDTH = 7;
const BODY_INNER_DECORATION_WIDTH = 5;
const DEFAULT_COPY_MAX_LINES = 24;
const WIDE_BOX_HORIZONTAL_MARGIN = 4;
const LIST_WIDTH_RATIO = 0.38;
const MIN_LIST_WIDTH = 18;
const MIN_PREVIEW_WIDTH = 12;

/**
 * 渲染 /copy 消息复制面板，两栏分别展示消息列表与当前消息原文预览。
 */
function renderCopySurface(
  surface: CopyCommandSurface,
  width: number,
  maxLines = Number.POSITIVE_INFINITY,
  tuiTheme: TuiTheme = DEFAULT_TUI_THEME
): FooterLayout {
  const theme = resolveFooterTheme(tuiTheme);
  const safeWidth = Math.max(1, safeRenderWidth(width));
  const boxWidth = calculateBoxWidth(safeWidth);
  const innerWidth = contentWidth(boxWidth);
  const bodyHeight = calculateBodyHeight(maxLines);
  const splitWidth = Math.max(2, boxWidth - BODY_OUTER_DECORATION_WIDTH);
  const leftWidth = calculateListWidth(surface.messages, splitWidth);
  const rightWidth = Math.max(1, splitWidth - leftWidth);
  const rows = createSelectedWindowRows(surface.messages, surface.selectedIndex, bodyHeight);
  const previewRows = createPreviewRows(surface.messages[surface.selectedIndex]?.text || '', bodyHeight, rightWidth, surface.previewScroll);
  const focus = surface.focus === 'preview' ? 'preview' : 'list';
  const bodyRows = rows.map((row) => row.kind === 'more'
    ? {entry: null, index: -1, more: `${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`}
    : {entry: row.item, index: row.index, more: ''});

  while (bodyRows.length < bodyHeight) {
    bodyRows.push({entry: null, index: -1, more: ''});
  }

  const lines = [
    renderTop(boxWidth, surface.title, theme),
    renderLine(renderSummaryLine(surface, innerWidth, theme), boxWidth, theme),
    renderDivider(leftWidth, rightWidth, theme),
    ...bodyRows.slice(0, bodyHeight).map((row, visualIndex) => renderBodyLine(surface, row.entry, row.index, row.more, previewRows[visualIndex] || '', leftWidth, rightWidth, focus, visualIndex === 0, theme)),
    renderDivider(leftWidth, rightWidth, theme),
    renderLine(ansi.dim(clampPlainText(surface.notice || surface.dismissHint, innerWidth)), boxWidth, theme),
    renderBottom(boxWidth, theme)
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

function calculateBoxWidth(safeWidth: number): number {
  if (safeWidth >= 64) {
    return Math.max(4, safeWidth - WIDE_BOX_HORIZONTAL_MARGIN);
  }

  return Math.max(4, safeWidth);
}

function calculateBodyHeight(maxLines: number): number {
  const max = Number.isFinite(maxLines) ? normalizeLineLimit(maxLines) : DEFAULT_COPY_MAX_LINES;
  return Math.max(1, max - 6);
}

function calculateListWidth(messages: CopySurfaceMessage[], splitWidth: number): number {
  const contentWidth = messages.reduce((max, message) => Math.max(max, displayWidth(`  ● ${formatPlainMessageLabel(message)}`)), MIN_LIST_WIDTH);
  const proportionalWidth = Math.max(MIN_LIST_WIDTH, Math.floor(splitWidth * LIST_WIDTH_RATIO));
  return Math.min(Math.max(MIN_LIST_WIDTH, contentWidth), proportionalWidth, Math.max(1, splitWidth - MIN_PREVIEW_WIDTH));
}

function renderSummaryLine(surface: CopyCommandSurface, width: number, theme: FooterTheme): string {
  const selected = surface.selectedIds.length === 0 ? ansi.dim('○ 未选择') : tokenText(theme, 'accent', `● 已选择 ${surface.selectedIds.length}`);
  const total = ansi.dim(`${surface.messages.length} 条可复制消息`);
  const gap = ' '.repeat(Math.max(1, width - displayWidth(selected) - displayWidth(total)));
  return `${selected}${gap}${total}`;
}

function createPreviewRows(text: string, height: number, width: number, scroll: number | undefined): string[] {
  const rows = text.split('\n').flatMap((line) => renderStyledLine({
    prefix: '',
    contentPrefix: '',
    continuationPrefix: '',
    spans: [{text: line || ' '}],
    width: width + 1
  }).map((row) => fitCell(row, width)));

  const maxScroll = Math.max(0, rows.length - height);
  const start = Math.min(Math.max(0, Number.isInteger(scroll) ? Number(scroll) : 0), maxScroll);
  const visibleRows = rows.slice(start, start + height);

  if (start > 0 && visibleRows.length > 0) {
    visibleRows[0] = ansi.dim(clampPlainText(`↑ ${start} 更多`, width));
  }

  if (start + height < rows.length && visibleRows.length > 0) {
    visibleRows[visibleRows.length - 1] = ansi.dim(clampPlainText(`↓ ${rows.length - start - height} 更多`, width));
  }

  while (visibleRows.length < height) {
    visibleRows.push('');
  }

  return visibleRows.slice(0, height);
}

function renderBodyLine(surface: CopyCommandSurface, entry: CopySurfaceMessage | null, index: number, more: string, preview: string, leftWidth: number, rightWidth: number, focus: 'list' | 'preview', previewActive: boolean, theme: FooterTheme): string {
  const active = index === surface.selectedIndex && entry !== null;
  const left = more ? ansi.dim(more) : entry ? renderEntry(entry, active, Math.max(1, leftWidth - 4), theme) : '';
  const focusedLeft = active && focus === 'list'
    ? `${renderFocusBar(theme)}${activeBackground(theme, fitCell(` ${left}`, leftWidth - 1))}`
    : fitCell(`  ${left}`, leftWidth);
  const right = focus === 'preview' && previewActive
    ? activeBackground(theme, fitCell(preview, rightWidth))
    : fitCell(preview, rightWidth);

  return `${frame('│', theme)} ${focusedLeft} ${frame('│', theme)} ${right} ${frame('│', theme)}`;
}

function renderEntry(entry: CopySurfaceMessage, active: boolean, labelWidth: number, theme: FooterTheme): string {
  const marker = entry.selected ? '●' : '○';
  const markerColor = entry.selected || active ? (text: string) => tokenText(theme, 'accentStrong', text) : (text: string) => tokenText(theme, 'muted', text);
  const text = formatMessageLabel(entry, labelWidth, active, theme);

  return `${markerColor(marker)} ${text}`;
}

function formatMessageLabel(message: CopySurfaceMessage, width: number, active: boolean, theme: FooterTheme): string {
  const role = message.role === 'user' ? 'User' : 'Assistant';
  const prefix = `${role} `;
  const preview = message.text.replace(/\s+/g, ' ').trim() || '空消息';
  const clippedPreview = clampPlainText(preview, Math.max(1, width - displayWidth(prefix)));
  const roleToken = message.role === 'user' ? 'accent' : 'success';
  const roleText = tokenText(theme, roleToken, active ? ansi.bold(prefix) : prefix);
  const messageText = active
    ? tokenText(theme, 'accentStrong', ansi.bold(clippedPreview))
    : tokenText(theme, 'text', clippedPreview);

  return `${roleText}${messageText}`;
}

function formatPlainMessageLabel(message: CopySurfaceMessage): string {
  const role = message.role === 'user' ? 'User' : 'Assistant';
  const preview = message.text.replace(/\s+/g, ' ').trim() || '空消息';
  return `${role} ${preview}`;
}

function renderTop(width: number, title: string, theme: FooterTheme): string {
  const contentWidth = Math.max(0, width - 2);
  const label = clampPlainText(` ${title} `, contentWidth);
  const rail = Math.max(0, contentWidth - displayWidth(label));
  return `${frame('╭', theme)}${ansi.bold(tokenText(theme, 'accentStrong', label))}${frame('─'.repeat(rail), theme)}${frame('╮', theme)}`;
}

function renderBottom(width: number, theme: FooterTheme): string {
  return `${frame('╰', theme)}${frame('─'.repeat(Math.max(0, width - 2)), theme)}${frame('╯', theme)}`;
}

function renderDivider(leftWidth: number, rightWidth: number, theme: FooterTheme): string {
  return `${frame('│', theme)}${frame('─'.repeat(leftWidth + rightWidth + BODY_INNER_DECORATION_WIDTH), theme)}${frame('│', theme)}`;
}

function renderLine(content: string, boxWidth: number, theme: FooterTheme): string {
  return `${frame('│', theme)} ${fitCell(content, contentWidth(boxWidth))} ${frame('│', theme)}`;
}

function fitCell(content: string, width: number): string {
  const safeWidth = Math.max(0, width);
  const clipped = displayWidth(content) > safeWidth ? clampPlainText(stripAnsi(content), safeWidth) : content;
  return padVisibleText(clipped, safeWidth);
}

function frame(text: string, theme: FooterTheme): string {
  return tokenText(theme, 'accentDeep', text);
}

function contentWidth(boxWidth: number): number {
  return Math.max(0, boxWidth - 4);
}

export {renderCopySurface};
