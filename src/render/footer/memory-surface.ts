import * as ansi from '../../terminal/ansi';
import {sanitizeTerminalText} from '../../terminal/control-chars';
import {displayWidth, wrapTextToWidth} from '../layout';
import {activeBackground, renderFocusBar, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {createSelectedWindowRows} from './window';
import {actionRow, bottom, boxWidth, contentWidth, dimHint, kvRow, line, moreRow, renderDot, splitRow, top} from './config-panel-rows';

import type {MemoryCommandRow, MemoryCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const MEMORY_MAX_VISIBLE = 8;
const MEMORY_DETAIL_MAX_LINES = 10;
const EDIT_CONTENT_COLUMN_OFFSET = 2;

type BodyRenderResult = {
  rows: string[]; // 正文渲染行，已含边框列。
  cursorRow: number; // 真实光标在正文行中的相对行号。
  cursorColumn: number; // 真实光标列号。
  showCursor: boolean; // 当前状态是否需要展示终端光标。
};

type EditProjection = {
  lines: string[]; // 按逻辑换行拆分的编辑行。
  cursorRow: number; // 光标所在逻辑行。
  cursorColumn: number; // 光标在该行的可见列号。
};

/**
 * 渲染 memory 管理卡片；行语义与编辑草稿全部来自 command session，渲染层只做投影。
 * 外框、双列、动作行与开关圆点复用 /config、/mcp 的共享行原语，避免面板间视觉漂移。
 */
function renderMemorySurface(surface: MemoryCommandSurface, width: number, theme: FooterTheme): FooterLayout {
  const box = boxWidth(width);
  const body = renderBody(surface, box, theme);
  const lines = [
    top(box, ` ${surface.title} `, 'accentStrong', theme),
    line(box, '', theme),
    ...body.rows,
    ...(surface.error ? [line(box, ` ${tokenText(theme, 'danger', clampPlainText(surface.error, Math.max(1, contentWidth(box) - 2)))}`, theme)] : []),
    line(box, '', theme),
    line(box, dimHint(box, surface.dismissHint), theme),
    bottom(box, theme)
  ];

  return body.showCursor
    ? {lines, cursorRow: 2 + body.cursorRow, cursorColumn: body.cursorColumn, showCursor: true}
    : {lines, cursorRow: lines.length - 1, cursorColumn: 0, showCursor: false};
}

function renderBody(surface: MemoryCommandSurface, box: number, theme: FooterTheme): BodyRenderResult {
  if (surface.mode === 'edit' && surface.catalogForm) {
    return renderCatalogForm(surface.catalogForm, box, theme);
  }

  const rows: string[] = [];

  if (surface.detailContent !== undefined) {
    rows.push(...renderDetailContent(surface.detailContent, box, theme), line(box, '', theme));
  }

  rows.push(...renderRows(surface.rows, surface.selectedIndex, box, theme));

  if (surface.mode !== 'edit') {
    return withoutCursor(rows);
  }

  const edit = renderEditBody(surface, box, theme);
  const editStart = rows.length + 1;
  rows.push(line(box, '', theme), ...edit.rows);

  return {
    rows,
    cursorRow: editStart + edit.cursorRow,
    cursorColumn: edit.cursorColumn,
    showCursor: true
  };
}

/** 详情正文按正文列宽折行并限高，保证尾部动作行始终可见。 */
function renderDetailContent(content: string, box: number, theme: FooterTheme): string[] {
  const lines = wrapTextToWidth(sanitizeTerminalText(content), contentWidth(box));
  const visible = lines.slice(0, MEMORY_DETAIL_MAX_LINES);
  const rows = visible.map((text) => line(box, tokenText(theme, 'accent', text), theme));

  if (lines.length > MEMORY_DETAIL_MAX_LINES) {
    rows.push(line(box, ansi.dim(`… 还有 ${lines.length - MEMORY_DETAIL_MAX_LINES} 行`), theme));
  }

  return rows;
}

/** 单行渲染：动作与确认选项走动作行，只读字段走双列，其余按条目处理。 */
function renderRows(rows: MemoryCommandRow[], selectedIndex: number, box: number, theme: FooterTheme): string[] {
  const rendered: string[] = [];

  for (const entry of createSelectedWindowRows(rows, selectedIndex, MEMORY_MAX_VISIBLE)) {
    if (entry.kind === 'more') {
      rendered.push(moreRow(box, entry.direction, entry.count, theme));
      continue;
    }

    rendered.push(renderRow(entry.item, entry.index === selectedIndex, box, theme));
  }

  return rendered;
}

function renderRow(row: MemoryCommandRow, active: boolean, box: number, theme: FooterTheme): string {
  const prefix = row.dot ? `${renderDot(row.dot === 'on', theme)} ` : '';

  if (row.kind === 'action' || row.kind === 'option') {
    return actionRow(box, `${prefix}${row.label}`, row.detail || '', active, row.tone === 'danger', theme);
  }

  if (row.kind === 'field') {
    return kvRow(box, row.label, row.value || '', active, theme);
  }

  return splitRow(box, `${prefix}${row.label}`, row.value || '', active, theme);
}

/**
 * catalog 表单以独立 composer 保存每个字段，光标落在当前字段的值区域。
 */
function renderCatalogForm(form: NonNullable<MemoryCommandSurface['catalogForm']>, box: number, theme: FooterTheme): BodyRenderResult {
  const inner = contentWidth(box);
  const rows: string[] = [];
  let cursorRow = 0;
  let cursorColumn = EDIT_CONTENT_COLUMN_OFFSET;
  const maxLabelWidth = Math.max(...form.fields.map((field) => displayWidth(field.label)), 1);
  const labelWidth = Math.min(maxLabelWidth + 2, Math.max(4, Math.floor(inner / 3)));
  const rowPrefixWidth = 2 + labelWidth + 3;
  const valueWidth = Math.max(1, inner - rowPrefixWidth);

  form.fields.forEach((field, index) => {
    const active = index === form.selectedIndex;
    const projected = projectInlineField(field.text, field.cursor, valueWidth);
    const marker = active ? renderFocusBar(theme) : ' ';
    const label = padVisibleText(clampPlainText(field.label, labelWidth), labelWidth);
    const value = padVisibleText(projected.text, valueWidth);
    const body = `${marker} ${tokenText(theme, active ? 'accentStrong' : 'muted', label)} │ ${value}`;
    rows.push(line(box, active ? activeBackground(theme, body) : body, theme));

    if (active) {
      cursorRow = index;
      // 外框和内边距占两列，rowPrefixWidth 包含 focus、标签和分隔符。
      cursorColumn = EDIT_CONTENT_COLUMN_OFFSET + rowPrefixWidth + projected.cursorColumn;
    }
  });

  return {rows, cursorRow, cursorColumn, showCursor: true};
}

/** 把多行字段压成单行窗口，并让真实终端光标始终落在可见值区域。 */
function projectInlineField(text: string, cursor: number, width: number): {text: string; cursorColumn: number} {
  const chars = Array.from(text).map((char) => char === '\n' ? ' ' : char);
  const cursorIndex = Math.min(Math.max(0, cursor), chars.length);
  let start = 0;

  // 光标前至少保留一列；发生左裁剪后还需为省略号预留一列。
  while (start < cursorIndex) {
    const leftMarkerWidth = start > 0 ? 1 : 0;
    const beforeCursorWidth = displayWidth(chars.slice(start, cursorIndex).join(''));
    if (leftMarkerWidth + beforeCursorWidth <= Math.max(0, width - 1)) {
      break;
    }
    start += 1;
  }

  const hasLeftOverflow = start > 0;
  const leftMarkerWidth = hasLeftOverflow ? 1 : 0;
  const availableContentWidth = Math.max(0, width - leftMarkerWidth);
  let end = cursorIndex;
  while (end < chars.length && displayWidth(chars.slice(start, end + 1).join('')) <= availableContentWidth) {
    end += 1;
  }

  const hasRightOverflow = end < chars.length;
  const visibleContentWidth = Math.max(0, availableContentWidth - (hasRightOverflow ? 1 : 0));
  while (end > cursorIndex && displayWidth(chars.slice(start, end).join('')) > visibleContentWidth) {
    end -= 1;
  }

  const leftMarker = hasLeftOverflow ? '…' : '';
  const rightMarker = hasRightOverflow ? '…' : '';

  return {
    text: `${leftMarker}${chars.slice(start, end).join('')}${rightMarker}`,
    cursorColumn: leftMarkerWidth + displayWidth(chars.slice(start, cursorIndex).join(''))
  };
}

/**
 * 渲染编辑区并返回真实终端光标位置；光标不写入文本，避免行尾输入时被假字符状态影响。
 */
function renderEditBody(surface: MemoryCommandSurface, box: number, theme: FooterTheme): BodyRenderResult {
  const inner = contentWidth(box);
  const projection = projectEditText(surface.editText || '', surface.editCursor || 0);
  const window = createCursorLineWindow(projection.lines, projection.cursorRow, MEMORY_MAX_VISIBLE);
  const rows = [line(box, tokenText(theme, 'accentStrong', ansi.bold('输入 memory')), theme)];

  if (window.start > 0) {
    rows.push(line(box, ansi.dim(`↑ ${window.start} 行`), theme));
  }

  for (const value of window.lines) {
    rows.push(line(box, clampPlainText(value, inner), theme));
  }

  return {
    rows,
    cursorRow: 1 + (window.start > 0 ? 1 : 0) + (projection.cursorRow - window.start),
    cursorColumn: EDIT_CONTENT_COLUMN_OFFSET + Math.min(projection.cursorColumn, Math.max(0, inner - 1)),
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

export {renderMemorySurface};
