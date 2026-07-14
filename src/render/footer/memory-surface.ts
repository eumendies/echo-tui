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
    const selected = surface.section === 'catalogs' ? surface.catalogs?.[surface.selectedIndex] : surface.section === 'items' ? surface.agentItems?.[surface.selectedIndex] : surface.memories[surface.selectedIndex];
    const preview = selected && 'content' in selected ? selected.content : selected && 'name' in selected ? `${selected.name}: ${selected.description}` : 'memory 不存在';
    return withoutCursor([
      line(tokenText(theme, 'warning', '确认删除当前 memory？'), contentWidth, theme),
      line(ansi.dim(clampPlainText(previewMemory(preview), contentWidth)), contentWidth, theme)
    ]);
  }

  if (surface.mode === 'edit' && surface.catalogForm) {
    return renderCatalogForm(surface.catalogForm, contentWidth, theme);
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

/** 渲染当前 memory 层级的管理列表，并保留 disabled 数据供用户重新启用。 */
function renderListBody(surface: MemoryCommandSurface, contentWidth: number, theme: FooterTheme): string[] {
  if (surface.section === 'types') {
    const counts = surface.itemCounts || {user: 0, global: 0, project: 0};
    return renderPlainOptions([
      `User memories · ${counts.user} items`,
      `Agent memories · global · ${counts.global} items`,
      `Agent memories · project · ${counts.project} items`
    ], surface.selectedIndex, contentWidth, theme);
  }

  if (surface.section === 'catalogs') {
    const catalogs = surface.catalogs || [];
    if (catalogs.length === 0) return [line(ansi.dim(`当前没有 ${surface.scope || 'agent'} catalog。按 a 新增。`), contentWidth, theme)];
    return renderPlainOptions(catalogs.map((catalog) => `${renderToggle(catalog.enabled, theme)}  ${catalog.name} — ${catalog.description}`), surface.selectedIndex, contentWidth, theme);
  }

  if (surface.section === 'items') {
    const items = surface.agentItems || [];
    if (items.length === 0) return [line(ansi.dim('当前没有 item。按 a 新增。'), contentWidth, theme)];
    return renderPlainOptions(items.map((item) => `${renderToggle(item.enabled, theme)}  ${previewMemory(item.content)}`), surface.selectedIndex, contentWidth, theme);
  }

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

function renderCatalogForm(form: NonNullable<MemoryCommandSurface['catalogForm']>, contentWidth: number, theme: FooterTheme): BodyRenderResult {
  const rows: string[] = [];
  let cursorRow = 0;
  let cursorColumn = EDIT_CONTENT_COLUMN_OFFSET;
  const maxLabelWidth = Math.max(...form.fields.map((field) => displayWidth(field.label)), 1);
  const labelWidth = Math.min(maxLabelWidth + 2, Math.max(4, Math.floor(contentWidth / 3)));
  const rowPrefixWidth = 2 + labelWidth + 3;
  const valueWidth = Math.max(1, contentWidth - rowPrefixWidth);

  form.fields.forEach((field, index) => {
    const active = index === form.selectedIndex;
    const projected = projectInlineField(field.text, field.cursor, valueWidth);
    const marker = active ? renderFocusBar(theme) : ' ';
    const label = padVisibleText(clampPlainText(field.label, labelWidth), labelWidth);
    const value = padVisibleText(projected.text, valueWidth);
    const body = `${marker} ${tokenText(theme, active ? 'accentStrong' : 'muted', label)} │ ${value}`;
    rows.push(line(active ? activeBackground(theme, body) : body, contentWidth, theme));

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

function renderPlainOptions(options: string[], selectedIndex: number, contentWidth: number, theme: FooterTheme): string[] {
  const rows: string[] = [];
  for (const row of createSelectedWindowRows(options, selectedIndex, MEMORY_MAX_VISIBLE)) {
    if (row.kind === 'more') {
      rows.push(line(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), contentWidth, theme));
    } else {
      rows.push(row.index === selectedIndex ? selectedLine(row.item, contentWidth, theme) : line(`  ${clampPlainText(row.item, Math.max(1, contentWidth - 2))}`, contentWidth, theme));
    }
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
