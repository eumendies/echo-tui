import * as ansi from '../../terminal/ansi';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {displayWidth, safeRenderWidth, stripAnsi} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {createSelectedWindowRows, normalizeLineLimit} from './window';
import {renderStyledLine} from '../markdown/styled-line';
import {highlightCodeBlock} from '../markdown/syntax-highlight';

import type {FilePickerCommandSurface, FilePickerSurfaceEntry} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const BODY_OUTER_DECORATION_WIDTH = 7;
const BODY_INNER_DECORATION_WIDTH = 5;
const DEFAULT_FILE_PICKER_MAX_LINES = 24;
const WIDE_BOX_HORIZONTAL_MARGIN = 4;
const LIST_WIDTH_RATIO = 0.34;
const MIN_LIST_WIDTH = 12;
const MIN_PREVIEW_WIDTH = 12;

/**
 * 渲染 @ 文件选择器，两栏展示文件列表和当前项 preview。
 */
function renderFilePickerSurface(
  surface: FilePickerCommandSurface,
  width: number,
  maxLines = Number.POSITIVE_INFINITY,
  tuiTheme: TuiTheme = DEFAULT_TUI_THEME
): FooterLayout {
  const theme = resolveFooterTheme(tuiTheme);
  const safeWidth = Math.max(1, safeRenderWidth(width));
  const boxWidth = calculateBoxWidth(safeWidth);
  const innerWidth = contentWidth(boxWidth);
  const queryLineCount = surface.query ? 1 : 0;
  const bodyHeight = calculateBodyHeight(maxLines, queryLineCount);
  const splitWidth = Math.max(2, boxWidth - BODY_OUTER_DECORATION_WIDTH);
  const leftWidth = calculateListWidth(surface.entries, splitWidth);
  const rightWidth = Math.max(1, splitWidth - leftWidth);
  const rows = createSelectedWindowRows(surface.entries, surface.selectedIndex, bodyHeight);
    const previewRows = createPreviewRows(surface.previewLines, bodyHeight, rightWidth, surface.previewMode, tuiTheme, theme);
  const previewFocusIndex = getPreviewFocusIndex(surface.previewLines, bodyHeight);
  const bodyRows = rows.map((row) => row.kind === 'more'
    ? {entry: null, index: -1, more: `${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`}
    : {entry: row.item, index: row.index, more: ''});

  while (bodyRows.length < bodyHeight) {
    bodyRows.push({entry: null, index: -1, more: ''});
  }

  const lines = [
    renderTop(boxWidth, surface.title || '文件', theme),
    renderLine(renderPathLine(surface, innerWidth, theme), boxWidth, theme),
    ...(surface.query ? [renderLine(renderQueryLine(surface, innerWidth, theme), boxWidth, theme)] : []),
    renderDivider(leftWidth, rightWidth, theme),
    ...bodyRows.slice(0, bodyHeight).map((row, visualIndex) => renderBodyLine(surface, row.entry, row.index, row.more, previewRows[visualIndex] || '', leftWidth, rightWidth, visualIndex === previewFocusIndex, theme)),
    renderDivider(leftWidth, rightWidth, theme),
    renderLine(ansi.dim(clampPlainText(surface.notice || surface.dismissHint || '', innerWidth)), boxWidth, theme),
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

/**
 * 高度优先使用 footer 传入的终端预算；无预算的直接调用走有限兜底，避免生成无限行。
 */
function calculateBodyHeight(maxLines: number, queryLineCount: number): number {
  const max = Number.isFinite(maxLines) ? normalizeLineLimit(maxLines) : DEFAULT_FILE_PICKER_MAX_LINES;
  return Math.max(1, max - 6 - queryLineCount);
}

function calculateListWidth(entries: FilePickerSurfaceEntry[], splitWidth: number): number {
  const contentWidth = calculateListContentWidth(entries);
  const proportionalWidth = Math.max(MIN_LIST_WIDTH, Math.floor(splitWidth * LIST_WIDTH_RATIO));
  return Math.min(contentWidth, proportionalWidth, Math.max(1, splitWidth - MIN_PREVIEW_WIDTH));
}

/**
 * 按当前文件列表内容估算左栏宽度；短文件名目录不占用无意义的 preview 空间。
 */
function calculateListContentWidth(entries: FilePickerSurfaceEntry[]): number {
  const itemWidth = entries.reduce((max, entry) => {
    const name = entry.kind === 'directory' ? `${entry.name}/` : entry.name;
    return Math.max(max, displayWidth(`  ○ ${name}`));
  }, MIN_LIST_WIDTH);
  const moreWidth = displayWidth(`  ↓ ${entries.length} 更多`);
  return Math.max(MIN_LIST_WIDTH, itemWidth, moreWidth);
}

function renderPathLine(surface: FilePickerCommandSurface, width: number, theme: FooterTheme): string {
  const selected = renderSelectedSummary(surface, Math.max(1, Math.floor(width * 0.38)), theme);
  const prefix = ansi.dim('cwd ');
  const pathBudget = Math.max(1, width - displayWidth(prefix) - displayWidth(selected) - 1);
  const currentDir = tokenText(theme, 'accent', clampPlainText(surface.currentDir, pathBudget));
  const gap = ' '.repeat(Math.max(1, width - displayWidth(`${prefix}${currentDir}${selected}`)));

  return `${prefix}${currentDir}${gap}${selected}`;
}

function renderQueryLine(surface: FilePickerCommandSurface, width: number, theme: FooterTheme): string {
  const prefix = tokenText(theme, 'accent', '@');
  const query = surface.query ? clampPlainText(surface.query, width - 3) : ansi.dim('输入以过滤');

  return `${prefix} ${query}${tokenText(theme, 'accentStrong', '┃')}`;
}

function renderSelectedSummary(surface: FilePickerCommandSurface, width: number, theme: FooterTheme): string {
  if (surface.selectedPaths.length === 0) {
    return ansi.dim('○ 无');
  }

  const prefix = `● ${surface.selectedPaths.length} `;
  const names: string[] = [];
  let remaining = 0;

  for (const selected of surface.selectedPaths) {
    const candidate = [...names, selected].join(' · ');

    if (displayWidth(`${prefix}${candidate}`) > width - 4) {
      remaining += 1;
      continue;
    }

    names.push(selected);
  }

  const suffix = remaining > 0 ? ` +${remaining}` : '';
  return `${tokenText(theme, 'accent', prefix)}${tokenText(theme, 'accent', clampPlainText(names.join(' · '), Math.max(1, width - displayWidth(prefix) - displayWidth(suffix))))}${ansi.dim(suffix)}`;
}

function createPreviewRows(previewLines: string[], height: number, width: number, mode: FilePickerCommandSurface['previewMode'], tuiTheme: TuiTheme, theme: FooterTheme): string[] {
  const rows: string[] = [];

  if (previewLines[0]) {
    rows.push(tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(previewLines[0], width))));
  }

  if (previewLines[1]) {
    rows.push(tokenText(theme, 'muted', clampPlainText(previewLines[1], width)));
  }

  if (previewLines.length > 2) {
    rows.push(ansi.dim(frame('─'.repeat(width), theme)));
    rows.push(...createPreviewBodyRows(previewLines.slice(2), width, mode, tuiTheme));
  }

  while (rows.length < height) {
    rows.push('');
  }

  return rows.slice(0, height);
}

/**
 * 将 preview 内容按可见宽度换行，保留首行行号前缀并让续行对齐正文。
 */
function wrapPreviewLine(line: string, width: number): string[] {
  const parsed = parsePreviewLine(line);
  return renderStyledLine({
    prefix: '',
    contentPrefix: parsed.firstPrefix,
    continuationPrefix: parsed.continuationPrefix,
    spans: [{text: parsed.body}],
    width: width + 1
  }).map((row) => fitCell(row, width));
}

function createPreviewBodyRows(lines: string[], width: number, mode: FilePickerCommandSurface['previewMode'], theme: TuiTheme): string[] {
  if (mode !== 'code') {
    return lines.flatMap((line) => wrapPreviewLine(line, width));
  }

  const parsed = lines.map(parsePreviewLine);
    const highlightedLines = highlightCodeBlock(parsed.map((line) => line.body), theme.syntax);
  return highlightedLines.flatMap((spans, index) => renderStyledLine({
    prefix: '',
    contentPrefix: parsed[index].firstPrefix,
    continuationPrefix: parsed[index].continuationPrefix,
      spans,
      theme,
    width: width + 1
  }).map((row) => fitCell(row, width)));
}

function parsePreviewLine(line: string): {body: string; continuationPrefix: string; firstPrefix: string} {
  const normalized = line.replace(/\t/g, '    ');
  const match = /^(\d+\s+)(.*)$/.exec(normalized);
  const firstPrefix = match ? match[1] : '';
  const continuationPrefix = match ? ' '.repeat(displayWidth(match[1])) : '';
  const body = match ? match[2] : normalized;
  return {body, continuationPrefix, firstPrefix};
}

function getPreviewFocusIndex(previewLines: string[], height: number): number {
  return Math.min(previewLines.length > 2 ? 3 : 0, Math.max(0, height - 1));
}

function renderBodyLine(surface: FilePickerCommandSurface, entry: FilePickerSurfaceEntry | null, index: number, more: string, preview: string, leftWidth: number, rightWidth: number, previewActive: boolean, theme: FooterTheme): string {
  const active = index === surface.selectedIndex && entry !== null;
  const left = more ? ansi.dim(more) : entry ? renderEntry(entry, active, theme) : '';
  const focusedLeft = active && surface.focus === 'list'
    ? `${renderFocusBar(theme)}${activeBackground(theme, fitCell(` ${left}`, leftWidth - 1))}`
    : fitCell(`  ${left}`, leftWidth);
  const right = surface.focus === 'preview' && previewActive
    ? activeBackground(theme, fitCell(preview, rightWidth))
    : fitCell(preview, rightWidth);

  return `${frame('│', theme)} ${focusedLeft} ${frame('│', theme)} ${right} ${frame('│', theme)}`;
}

function renderEntry(entry: FilePickerSurfaceEntry, active: boolean, theme: FooterTheme): string {
  const marker = entry.selected ? '●' : entry.selectable ? '○' : '-';
  const markerColor = entry.selected || active ? (text: string) => tokenText(theme, 'accentStrong', text) : (text: string) => tokenText(theme, 'muted', text);
  const name = entry.kind === 'directory' ? `${entry.name}/` : entry.name;
  const text = entry.selectable || entry.kind === 'directory'
    ? active ? tokenText(theme, 'accentStrong', ansi.bold(name)) : name
    : ansi.dim(name);
  return `${markerColor(marker)} ${text}`;
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

export {renderFilePickerSurface};
