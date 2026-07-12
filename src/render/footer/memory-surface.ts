import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {activeBackground, renderFocusBar, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {createSelectedWindowRows} from './window';

import type {MemoryCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const MEMORY_MAX_VISIBLE = 7;
const EDIT_CONTENT_COLUMN_OFFSET = 2;

type BodyRenderResult = {
  rows: string[];
  cursorRow: number;
  cursorColumn: number;
  showCursor: boolean;
};

type EditProjection = {
  lines: string[];
  cursorRow: number;
  cursorColumn: number;
};

/**
 * 渲染 memory 管理卡片；编辑草稿和确认状态只来自 command session，渲染层不持有业务状态。
 */
function renderMemorySurface(surface: MemoryCommandSurface, width: number, theme: FooterTheme): FooterLayout {
  const boxWidth = Math.max(1, Math.min(safeRenderWidth(width), 88));
  const contentWidth = Math.max(1, boxWidth - 4);
  const body = renderBody(surface, contentWidth, theme);
  const lines = [
    topLine(boxWidth, surface.title || 'MEMORY', theme),
    line('', contentWidth, theme),
    ...body.rows,
    ...(surface.error ? [line(tokenText(theme, 'danger', clampPlainText(surface.error, contentWidth)), contentWidth, theme)] : []),
    line('', contentWidth, theme),
    line(ansi.dim(clampPlainText(surface.dismissHint || 'Esc 关闭', contentWidth)), contentWidth, theme),
    bottomLine(boxWidth, theme)
  ];

  return body.showCursor
    ? {lines, cursorRow: 2 + body.cursorRow, cursorColumn: body.cursorColumn, showCursor: true}
    : {lines, cursorRow: lines.length - 1, cursorColumn: 0, showCursor: false};
}

function renderBody(surface: MemoryCommandSurface, contentWidth: number, theme: FooterTheme): BodyRenderResult {
  if (surface.mode === 'deleteConfirm') {
    const selected = surface.memories[surface.selectedIndex];
    return withoutCursor([
      line(tokenText(theme, 'warning', '确认删除当前 memory？'), contentWidth, theme),
      line(ansi.dim(clampPlainText(selected ? previewMemory(selected.content) : 'memory 不存在', contentWidth)), contentWidth, theme)
    ]);
  }

  const rows = renderListBody(surface, contentWidth, theme);

  if (surface.mode !== 'edit') {
    return withoutCursor(rows);
  }

  const edit = renderEditBody(surface, contentWidth, theme);
  return {
    rows: [...rows, line('', contentWidth, theme), ...edit.rows],
    cursorRow: rows.length + 1 + edit.cursorRow,
    cursorColumn: edit.cursorColumn,
    showCursor: true
  };
}

function renderListBody(surface: MemoryCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  if (surface.memories.length === 0) {
    return [line(ansi.dim('当前没有 memory。按 a 新增。'), contentWidth, theme)];
  }

  const rows: string[] = [];
  for (const row of createSelectedWindowRows(surface.memories, surface.selectedIndex, MEMORY_MAX_VISIBLE)) {
    if (row.kind === 'more') {
      rows.push(line(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), contentWidth, theme));
      continue;
    }

    const text = `${renderToggle(row.item.enabled, theme)}  ${previewMemory(row.item.content)}`;
    rows.push(row.index === surface.selectedIndex ? selectedLine(text, contentWidth, theme) : line(`  ${clampPlainText(text, Math.max(1, contentWidth - 2))}`, contentWidth, theme));
  }
  return rows;
}

/**
 * 渲染编辑区并返回真实终端光标位置；光标不再写入文本，避免行尾输入时被假字符状态影响。
 */
function renderEditBody(surface: MemoryCommandSurface, contentWidth: number, theme: FooterTheme): BodyRenderResult {
  const projection = projectEditText(surface.editText || '', surface.editCursor || 0);
  const window = createCursorLineWindow(projection.lines, projection.cursorRow, MEMORY_MAX_VISIBLE);
  const rows = [line(tokenText(theme, 'accentStrong', ansi.bold('输入 memory')), contentWidth, theme)];

  if (window.start > 0) {
    rows.push(line(ansi.dim(`↑ ${window.start} 行`), contentWidth, theme));
  }

  for (const value of window.lines) {
    rows.push(line(clampPlainText(value, contentWidth), contentWidth, theme));
  }

  return {
    rows,
    cursorRow: 1 + (window.start > 0 ? 1 : 0) + (projection.cursorRow - window.start),
    cursorColumn: EDIT_CONTENT_COLUMN_OFFSET + Math.min(projection.cursorColumn, Math.max(0, contentWidth - 1)),
    showCursor: true
  };
}

/**
 * 从原始编辑文本投影逻辑行和光标行列；行列按终端可见宽度计算，供 footer 重绘后恢复真实光标。
 */
function projectEditText(text: string, cursor: number): EditProjection {
  const chars = Array.from(text);
  const index = Math.min(Math.max(0, cursor), chars.length);
  const lines = [''];
  let row = 0;
  let cursorRow = 0;
  let cursorColumn = 0;

  for (let offset = 0; offset <= chars.length; offset += 1) {
    if (offset === index) {
      cursorRow = row;
      cursorColumn = displayWidth(lines[row] || '');
    }

    if (offset === chars.length) {
      break;
    }

    const char = chars[offset];
    if (char === '\n') {
      row += 1;
      lines[row] = '';
      continue;
    }

    lines[row] += char;
  }

  return {lines, cursorRow, cursorColumn};
}

/**
 * 让编辑区窗口始终包含当前光标行；长内容优先把光标行放在可见窗口底部，保持输入连续性。
 */
function createCursorLineWindow(lines: string[], cursorRow: number, maxLines: number): {lines: string[]; start: number} {
  const limit = Math.max(1, maxLines);
  if (lines.length <= limit) {
    return {lines, start: 0};
  }

  const start = Math.min(Math.max(0, cursorRow - limit + 1), lines.length - limit);
  return {lines: lines.slice(start, start + limit), start};
}

function withoutCursor(rows: string[]): BodyRenderResult {
  return {rows, cursorRow: rows.length - 1, cursorColumn: 0, showCursor: false};
}

function previewMemory(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function renderToggle(enabled: boolean, theme: FooterTheme): string {
  return enabled ? tokenText(theme, 'success', '● on') : tokenText(theme, 'off', '○ off');
}

function selectedLine(text: string, contentWidth: number, theme: FooterTheme): string {
  const rowWidth = Math.max(1, contentWidth - 1);
  const body = padVisibleText(` ${tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(text, Math.max(1, rowWidth - 1))))}`, rowWidth);
  return line(`${renderFocusBar(theme)}${activeBackground(theme, body)}`, contentWidth, theme);
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

export {renderMemorySurface};
