import * as ansi from '../../terminal/ansi';
import {charWidth, displayWidth, safeRenderWidth, splitGraphemes, stripAnsi} from '../layout';
import {activeBackground, colorBackground, colorText, renderFocusBar, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {createSelectedWindowRows, normalizeLineLimit} from './window';
import {DEFAULT_TUI_THEME} from '../../config/theme-config';

import type {DiffCommandSurface} from '../../types/command';
import type {DiffFile, DiffHunk, DiffLine} from '../../types/diff';
import type {FooterLayout} from '../../types/render';

const MIN_SPLIT_CELL_WIDTH = 56;
const BODY_OUTER_DECORATION_WIDTH = 7;
const DEFAULT_DIFF_SURFACE_MAX_LINES = 22;
const NOTICE_SEPARATOR = ' · ';

type DetailRow = string;

type DiffSurfaceMetrics = {
  bodyHeight: number;
  boxWidth: number;
  detailRows: DetailRow[];
  detailWidth: number;
  hasNotice: boolean;
  listWidth: number;
  selectedIndex: number;
  splitWidth: number;
};

/**
 * 渲染 `/diff` 查看面板；左侧文件列表，右侧当前文件 diff 详情。
 */
function renderDiffSurface(surface: DiffCommandSurface, width: number, maxLines = Number.POSITIVE_INFINITY, theme: FooterTheme = DEFAULT_TUI_THEME.footer): FooterLayout {
  const metrics = createDiffSurfaceMetrics(surface, width, maxLines, theme);
  const detailWindow = createDetailWindow(metrics.detailRows, surface.detailScroll, metrics.bodyHeight, metrics.detailWidth);
  const listRows = metrics.listWidth > 0 ? createFileListRows(surface, metrics.selectedIndex, metrics.listWidth, metrics.bodyHeight, theme) : [];
  const lines = [
    renderTop(metrics.boxWidth, surface, theme),
    renderLine(renderSummary(surface, metrics.selectedIndex, metrics.boxWidth - 4, theme), metrics.boxWidth, theme),
    renderDivider(metrics.splitWidth, theme),
    ...Array.from({length: metrics.bodyHeight}, (_value, index) => renderBodyLine(listRows[index] || '', detailWindow[index] || '', metrics.listWidth, metrics.detailWidth, theme)),
    renderDivider(metrics.splitWidth, theme),
    ...(metrics.hasNotice ? [renderLine(ansi.dim(clampPlainText((surface.notices || []).join(NOTICE_SEPARATOR), metrics.boxWidth - 4)), metrics.boxWidth, theme)] : []),
    renderLine(ansi.dim(clampPlainText('↑↓ 选择/滚动 · ←→ 切换焦点 · Enter/Esc 关闭', metrics.boxWidth - 4)), metrics.boxWidth, theme),
    renderBottom(metrics.boxWidth, theme)
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 按 renderer 的实际宽高约束计算详情区域最大滚动位置，供命令状态提前截断。
 */
function calculateDiffDetailMaxScroll(surface: DiffCommandSurface, width: number, maxLines = Number.POSITIVE_INFINITY): number {
  const metrics = createDiffSurfaceMetrics(surface, width, maxLines, DEFAULT_TUI_THEME.footer);
  return Math.max(0, metrics.detailRows.length - metrics.bodyHeight);
}

/**
 * 汇总 `/diff` 面板的尺寸派生值，确保渲染和键盘滚动共用同一套高度计算。
 */
function createDiffSurfaceMetrics(surface: DiffCommandSurface, width: number, maxLines: number, theme: FooterTheme): DiffSurfaceMetrics {
  const safeWidth = Math.max(1, safeRenderWidth(width));
  const boxWidth = Math.max(4, safeWidth);
  const max = Number.isFinite(maxLines) ? normalizeLineLimit(maxLines) : DEFAULT_DIFF_SURFACE_MAX_LINES;
  const hasNotice = Boolean(surface.notices && surface.notices.length > 0);
  const bodyHeight = Math.max(1, max - (hasNotice ? 7 : 6));
  const splitWidth = Math.max(1, boxWidth - BODY_OUTER_DECORATION_WIDTH);
  const listWidth = calculateListWidth(surface.files, splitWidth);
  const detailWidth = Math.max(1, listWidth > 0 ? splitWidth - listWidth : boxWidth - 4);
  const selectedIndex = clampIndex(surface.selectedIndex, surface.files.length);
  const selectedFile = surface.files[selectedIndex];

  return {
    bodyHeight,
    boxWidth,
    detailRows: createDetailRows(selectedFile, detailWidth, theme),
    detailWidth,
    hasNotice,
    listWidth,
    selectedIndex,
    splitWidth
  };
}

function calculateListWidth(files: DiffFile[], splitWidth: number): number {
  if (files.length === 0 || splitWidth < 40) {
    return 0;
  }

  const longest = files.reduce((max, file) => Math.max(max, displayWidth(file.path)), 0);
  return Math.min(36, Math.max(16, longest + 8), Math.max(0, splitWidth - 24));
}

function renderTop(width: number, surface: DiffCommandSurface, theme: FooterTheme): string {
  const title = ` ${surface.title || '/diff'} `;
  const stats = ` ${surface.source.kind === 'git' ? 'Git' : 'History'} ${surface.files.length} files +${totalAdded(surface.files)} -${totalRemoved(surface.files)} `;
  const titleText = tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(title, Math.max(1, width - 2))));
  const statsText = tokenText(theme, surface.source.kind === 'git' ? 'success' : 'warning', clampPlainText(stats, Math.max(1, width - 2 - displayWidth(title))));
  const railWidth = Math.max(0, width - 2 - displayWidth(titleText) - displayWidth(statsText));

  return `${frame('╭', theme)}${titleText}${frame('─'.repeat(railWidth), theme)}${statsText}${frame('╮', theme)}`;
}

function renderSummary(surface: DiffCommandSurface, selectedIndex: number, width: number, theme: FooterTheme): string {
  const file = surface.files[selectedIndex];
  const focus = surface.focus === 'detail' ? '详情' : '文件';
  const source = `${surface.source.label}${surface.source.reason ? `：${surface.source.reason}` : ''}`;
  const selected = file ? `${file.path} +${file.added} -${file.removed}` : '无文件';
  const left = `${tokenText(theme, 'accent', `焦点 ${focus}`)}  ${ansi.dim(source)}`;
  const right = tokenText(theme, 'accentStrong', ansi.bold(selected));
  const gap = Math.max(1, width - displayWidth(left) - displayWidth(right));

  if (gap <= 1) {
    return clampPlainText(stripAnsi(`${focus} ${selected}`), width);
  }

  return `${left}${' '.repeat(gap)}${right}`;
}

function createFileListRows(surface: DiffCommandSurface, selectedIndex: number, width: number, height: number, theme: FooterTheme): string[] {
  const rows = createSelectedWindowRows(surface.files, selectedIndex, height);

  return rows.map((row) => {
    if (row.kind === 'more') {
      return fitCell(ansi.dim(`${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), width);
    }

    return renderFileRow(row.item, row.index === selectedIndex, surface.focus === 'list', width, theme);
  });
}

function renderFileRow(file: DiffFile, selected: boolean, focused: boolean, width: number, theme: FooterTheme): string {
  const stats = `${tokenText(theme, 'success', `+${file.added}`)} ${tokenText(theme, 'danger', `-${file.removed}`)}`;
  const statsWidth = displayWidth(`+${file.added} -${file.removed}`);
  const nameWidth = Math.max(1, width - statsWidth - 3);
  const name = clampPlainText(file.path, nameWidth);
  const row = `${selected ? tokenText(theme, 'accentStrong', ansi.bold(name)) : name} ${stats}`;

  if (selected && focused) {
    return `${renderFocusBar(theme)}${activeBackground(theme, fitCell(` ${row}`, width - 1))}`;
  }

  return fitCell(`  ${row}`, width);
}

function createDetailRows(file: DiffFile | undefined, width: number, theme: FooterTheme): DetailRow[] {
  if (!file) {
    return [ansi.dim(fitCell('没有可展示差异', width))];
  }

  const numberWidth = resolveNumberWidth(file);
  const split = shouldUseSplitLayout(width, numberWidth);
  const rows = [
    renderFileHeader(file, width, theme),
    ...file.hunks.flatMap((hunk) => [
      renderHunkHeader(hunk, width, theme),
      ...(split ? renderSplitHunk(hunk, width, numberWidth, theme) : renderUnifiedHunk(hunk, width, numberWidth, theme))
    ])
  ];

  return rows.length > 0 ? rows : [ansi.dim(fitCell('没有文本差异', width))];
}

function createDetailWindow(rows: DetailRow[], scroll: number | undefined, height: number, width: number): string[] {
  const maxScroll = Math.max(0, rows.length - height);
  const start = Math.min(Math.max(0, Number.isInteger(scroll) ? Number(scroll) : 0), maxScroll);
  const visible = rows.slice(start, start + height);

  while (visible.length < height) {
    visible.push('');
  }

  if (start > 0) {
    visible[0] = ansi.dim(fitCell(`↑ ${start} 更多`, width));
  }

  if (start + height < rows.length) {
    visible[Math.max(0, height - 1)] = ansi.dim(fitCell(`↓ ${rows.length - start - height} 更多`, width));
  }

  return visible;
}

function renderFileHeader(file: DiffFile, width: number, theme: FooterTheme): string {
  const kind = file.kind === 'modified' ? '' : `[${file.kind}] `;
  return fitCell(`${tokenText(theme, 'accentStrong', ansi.bold(`${kind}${file.path}`))}  ${tokenText(theme, 'success', `+${file.added}`)} ${tokenText(theme, 'danger', `-${file.removed}`)}`, width);
}

function renderHunkHeader(hunk: DiffHunk, width: number, theme: FooterTheme): string {
  const label = hunk.header ? `@@ ${hunk.header}` : `@@ -${hunk.oldStart} +${hunk.newStart}`;
  return tokenText(theme, 'accentDeep', ansi.dim(fitCell(label, width)));
}

function renderUnifiedHunk(hunk: DiffHunk, width: number, numberWidth: number, theme: FooterTheme): string[] {
  return hunk.lines.flatMap((line) => {
    const lineNo = formatNumber(resolveUnifiedLineNumber(line), numberWidth, theme);
    const gutter = `${lineNo} │ `;
    const continuationGutter = `${formatNumber(null, numberWidth, theme)} │ `;
    const bodyWidth = Math.max(1, width - displayWidth(gutter));
    const marker = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
    const wrapped = wrapPlainText(`${marker} ${line.text}`, bodyWidth);

    return wrapped.map((part, index) => {
      const physicalGutter = index === 0 ? gutter : continuationGutter;
      const row = `${physicalGutter}${padVisibleText(part, bodyWidth)}`;

      if (line.kind === 'added') {
        return diffBackground(theme, 'added', fitCell(row, width));
      }

      if (line.kind === 'removed') {
        return diffBackground(theme, 'removed', fitCell(row, width));
      }

      return tokenText(theme, 'muted', fitCell(row, width));
    });
  });
}

function resolveUnifiedLineNumber(line: DiffLine): number | null {
  if (line.kind === 'removed') {
    return line.oldLine;
  }

  return line.newLine ?? line.oldLine;
}

function renderSplitHunk(hunk: DiffHunk, width: number, numberWidth: number, theme: FooterTheme): string[] {
  const rows: string[] = [];
  const cellWidth = splitCellWidth(width, numberWidth);
  let index = 0;

  while (index < hunk.lines.length) {
    const line = hunk.lines[index];

    if (line.kind === 'context') {
      rows.push(renderSplitRow(line, line, width, numberWidth, cellWidth, theme));
      index += 1;
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];

    while (index < hunk.lines.length && hunk.lines[index].kind !== 'context') {
      const current = hunk.lines[index];

      if (current.kind === 'removed') {
        removed.push(current);
      } else {
        added.push(current);
      }
      index += 1;
    }

    for (let offset = 0; offset < Math.max(removed.length, added.length); offset += 1) {
      rows.push(renderSplitRow(removed[offset] || null, added[offset] || null, width, numberWidth, cellWidth, theme));
    }
  }

  return rows;
}

function renderSplitRow(leftLine: DiffLine | null, rightLine: DiffLine | null, width: number, numberWidth: number, cellWidth: number, theme: FooterTheme): string {
  const leftNo = formatNumber(leftLine?.oldLine || null, numberWidth, theme);
  const rightNo = formatNumber(rightLine?.newLine || null, numberWidth, theme);
  const divider = frame('│', theme);
  const leftText = formatSplitCell(leftLine, cellWidth, 'left', theme);
  const rightText = formatSplitCell(rightLine, cellWidth, 'right', theme);

  return fitCell(`${leftNo} ${leftText} ${divider} ${rightNo} ${rightText}`, width);
}

function formatSplitCell(line: DiffLine | null, width: number, side: 'left' | 'right', theme: FooterTheme): string {
  if (!line) {
    return ' '.repeat(width);
  }

  const text = fitPlain(line.text, width);

  if (line.kind === 'removed' && side === 'left') {
    return diffBackground(theme, 'removed', text);
  }

  if (line.kind === 'added' && side === 'right') {
    return diffBackground(theme, 'added', text);
  }

  return tokenText(theme, 'muted', text);
}

function shouldUseSplitLayout(width: number, numberWidth: number): boolean {
  return splitCellWidth(width, numberWidth) >= MIN_SPLIT_CELL_WIDTH;
}

function splitCellWidth(width: number, numberWidth: number): number {
  return Math.max(1, Math.floor((width - 2 * numberWidth - 5) / 2));
}

function resolveNumberWidth(file: DiffFile): number {
  const maxLine = file.hunks.reduce((max, hunk) => Math.max(
    max,
    ...hunk.lines.map((line) => Math.max(line.oldLine || 0, line.newLine || 0))
  ), 0);

  return Math.max(2, String(maxLine).length);
}

function formatNumber(value: number | null, width: number, theme: FooterTheme): string {
  return ansi.dim(tokenText(theme, 'muted', value === null ? ' '.repeat(width) : String(value).padStart(width)));
}

function renderBodyLine(left: string, right: string, leftWidth: number, rightWidth: number, theme: FooterTheme): string {
  if (leftWidth <= 0) {
    return `${frame('│', theme)} ${fitCell(right, rightWidth)} ${frame('│', theme)}`;
  }

  return `${frame('│', theme)} ${fitCell(left, leftWidth)} ${frame('│', theme)} ${fitCell(right, rightWidth)} ${frame('│', theme)}`;
}

function renderLine(content: string, boxWidth: number, theme: FooterTheme): string {
  return `${frame('│', theme)} ${fitCell(content, boxWidth - 4)} ${frame('│', theme)}`;
}

function renderDivider(width: number, theme: FooterTheme): string {
  return `${frame('│', theme)}${frame('─'.repeat(Math.max(0, width + 5)), theme)}${frame('│', theme)}`;
}

function renderBottom(width: number, theme: FooterTheme): string {
  return `${frame('╰', theme)}${frame('─'.repeat(Math.max(0, width - 2)), theme)}${frame('╯', theme)}`;
}

function fitPlain(text: string, width: number): string {
  return padVisibleText(clampPlainText(text.replace(/\t/g, '    '), width), Math.max(0, width));
}

function wrapPlainText(text: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const rows: string[] = [];
  let row = '';
  let column = 0;

  for (const char of splitGraphemes(text.replace(/\t/g, '    '))) {
    const nextColumn = column + charWidth(char);

    if (nextColumn > safeWidth && row !== '') {
      rows.push(row);
      row = '';
      column = 0;
    }

    row += char;
    column += charWidth(char);
  }

  rows.push(row);
  return rows;
}

function fitCell(content: string, width: number): string {
  const safeWidth = Math.max(0, width);
  const clipped = displayWidth(content) > safeWidth ? clampPlainText(stripAnsi(content), safeWidth) : content;

  return padVisibleText(clipped, safeWidth);
}

function clampIndex(index: number | undefined, count: number): number {
  if (count <= 0) {
    return 0;
  }

  return Math.min(Math.max(Number.isInteger(index) ? Number(index) : 0, 0), count - 1);
}

function totalAdded(files: DiffFile[]): number {
  return files.reduce((total, file) => total + file.added, 0);
}

function totalRemoved(files: DiffFile[]): number {
  return files.reduce((total, file) => total + file.removed, 0);
}

function frame(text: string, theme: FooterTheme): string {
  return tokenText(theme, 'frame', text);
}

function diffBackground(theme: FooterTheme, kind: 'added' | 'removed', text: string): string {
  const background = kind === 'added' ? theme.colors.diffAddedBackground : theme.colors.diffRemovedBackground;
  return colorText(theme.colors.diffText, colorBackground(background, text));
}

export {
  calculateDiffDetailMaxScroll,
  renderDiffSurface
};
