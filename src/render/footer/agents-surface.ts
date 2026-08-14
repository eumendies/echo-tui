import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {clampIndex, createSelectedWindowRows, normalizeLineLimit} from './window';

import type {AgentsCommandRow, AgentsCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const AGENTS_SURFACE_HORIZONTAL_MARGIN = 4;
const AGENTS_DEFAULT_BODY_ROWS = 9;
const CONTENT_COLUMN_OFFSET = 2;
const LEFT_COLUMN_MAX_RATIO = 0.45;
const SPLIT_COLUMN_GAP = 2;

type AgentsBodyLayout = {
  cursorColumn: number; // 真实终端光标相对整行左侧的可见列。
  cursorRow: number; // 光标在 body rows 内的相对行。
  rows: string[]; // 已包含卡片左右边框的主体行。
  showCursor: boolean; // 文本编辑态才显示真实终端光标。
};

type EditorProjection = {
  cursorColumn: number; // 投影文本内的可见光标列。
  text: string; // 围绕光标裁剪后的单行文本。
};

/**
 * 渲染 `/agents` 管理卡片；所有业务状态来自 command session，renderer 只负责窗口、样式和真实光标投影。
 */
export function renderAgentsSurface(
  surface: AgentsCommandSurface,
  width: number,
  maxLines?: number,
  theme: FooterTheme = resolveFooterTheme(undefined)
): FooterLayout {
  const boxWidth = calculateBoxWidth(width);
  const contentWidth = Math.max(1, boxWidth - 4);
  const showTabs = surface.mode === 'list';
  const messageCount = Number(Boolean(surface.error)) + Number(Boolean(surface.feedback));
  const fixedRows = 3 + Number(showTabs) + messageCount;
  const lineLimit = normalizeLineLimit(maxLines, 1);
  const minimumBodyRows = surface.mode === 'confirm' ? 2 : 1;
  const bodyBudget = Number.isFinite(lineLimit)
    ? Math.max(minimumBodyRows, lineLimit - fixedRows)
    : AGENTS_DEFAULT_BODY_ROWS;
  const body = renderBody(surface, contentWidth, bodyBudget, theme);
  const lines = [
    renderTop(boxWidth, normalizeSingleLineText(surface.title), theme),
    ...(showTabs ? [renderTabs(surface, contentWidth, theme)] : []),
    ...body.rows,
    ...(surface.error ? [renderMessage(normalizeSingleLineText(surface.error), 'danger', contentWidth, theme)] : []),
    ...(surface.feedback ? [renderMessage(normalizeSingleLineText(surface.feedback), 'success', contentWidth, theme)] : []),
    renderLine(ansi.dim(clampPlainText(normalizeSingleLineText(surface.dismissHint), contentWidth)), contentWidth, theme),
    renderBottom(boxWidth, theme)
  ];

  if (!body.showCursor) {
    return {lines, cursorRow: lines.length - 1, cursorColumn: 0, showCursor: false};
  }

  return {
    lines,
    cursorColumn: body.cursorColumn,
    cursorRow: 1 + Number(showTabs) + body.cursorRow,
    showCursor: true
  };
}

/** 宽终端沿用 File Picker 的四列外边距，避免管理表单被不必要地压缩。 */
function calculateBoxWidth(width: number): number {
  const safeWidth = Math.max(1, safeRenderWidth(width));
  if (safeWidth >= 64) {
    return Math.max(4, safeWidth - AGENTS_SURFACE_HORIZONTAL_MARGIN);
  }
  return Math.max(4, safeWidth);
}

function renderBody(surface: AgentsCommandSurface, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const editText = surface.editText === undefined ? undefined : normalizeEditorText(surface.editText);
  if (surface.mode === 'instructions' && surface.editText !== undefined) {
    return renderInstructionsEditor(surface, editText || '', contentWidth, bodyBudget, theme);
  }

  if (surface.rows.length === 0) {
    return withoutCursor([renderLine(ansi.dim('当前范围没有 Agent。'), contentWidth, theme)]);
  }

  const selectedIndex = clampIndex(surface.selectedIndex, surface.rows.length);
  const rows: string[] = [];
  let cursorRow = 0;
  let cursorColumn = 0;
  let showCursor = false;
  const visibleRows = createSelectedWindowRows(surface.rows, selectedIndex, Math.max(1, bodyBudget));

  for (const windowRow of visibleRows) {
    if (windowRow.kind === 'more') {
      rows.push(renderLine(ansi.dim(`  ${windowRow.direction === 'up' ? '↑' : '↓'} ${windowRow.count} 更多`), contentWidth, theme));
      continue;
    }

    const active = windowRow.index === selectedIndex;
    if (active && editText !== undefined && surface.editField && windowRow.item.id === surface.editField) {
      const editing = renderEditingField(normalizeRow(windowRow.item), editText, surface.editCursor || 0, contentWidth, theme);
      cursorRow = rows.length;
      cursorColumn = editing.cursorColumn;
      showCursor = true;
      rows.push(editing.row);
      continue;
    }
    rows.push(renderRow(normalizeRow(windowRow.item), active, contentWidth, theme));
  }

  return {rows, cursorColumn, cursorRow, showCursor};
}

function renderTabs(surface: AgentsCommandSurface, contentWidth: number, theme: FooterTheme): string {
  const labels = surface.tabs.map((tab) => {
    const label = normalizeSingleLineText(tab.label);
    const text = tab.id === surface.activeTab ? `[${label}]` : label;
    return tab.id === surface.activeTab
      ? tokenText(theme, 'accentStrong', ansi.bold(text))
      : tokenText(theme, 'muted', text);
  });
  return renderLine(clampStyledParts(labels, '  ', contentWidth), contentWidth, theme);
}

function renderRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  if (row.kind === 'agent') {
    return renderAgentRow(row, active, contentWidth, theme);
  }
  if (row.kind === 'action') {
    return renderSelectable(row.label, row.description, active, contentWidth, theme, 'accent');
  }
  if (row.kind === 'confirm') {
    const destructive = row.id === 'confirm:execute';
    return renderSelectable(row.label, row.description, active, contentWidth, theme, destructive ? 'danger' : 'accent');
  }
  if (row.kind === 'tool') {
    return renderToolRow(row, active, contentWidth, theme);
  }
  return renderFieldRow(row, active, contentWidth, theme);
}

/** 工具多选沿用 Skills surface 的实心/空心圆点，不使用复选框字形。 */
function renderToolRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const detail = row.description || '';
  const naturalLabelWidth = displayWidth(`● ${row.label}`);
  const detailWidth = calculateRightColumnWidth(displayWidth(detail), naturalLabelWidth, rowWidth, displayWidth(prefix));
  const labelWidth = Math.max(0, rowWidth - detailWidth);
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), detailWidth);
  const contentBudget = Math.max(0, labelWidth - displayWidth(prefix) - gapWidth);
  const marker = contentBudget > 0
    ? tokenText(theme, row.selected ? 'success' : 'off', row.selected ? ansi.bold('●') : '○')
    : '';
  const separator = contentBudget > 1 ? ' ' : '';
  const visibleLabel = clampCellText(row.label, Math.max(0, contentBudget - displayWidth(marker) - displayWidth(separator)));
  const labelToken = row.status === 'invalid' ? 'warning' : active ? 'accentStrong' : 'accent';
  const label = tokenText(theme, labelToken, active ? ansi.bold(visibleLabel) : visibleLabel);
  const detailText = detailWidth > 0 ? ansi.dim(clampCellText(detail, detailWidth)) : '';
  const body = `${padVisibleText(`${prefix}${marker}${separator}${label}`, labelWidth)}${padLeftVisibleText(detailText, detailWidth)}`;
  return renderFocusableBody(body, active, contentWidth, theme);
}

/** Agent 身份固定在左侧，运行策略作为右侧摘要统一贴齐卡片右边。 */
function renderAgentRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const source = (row.sourceKind || 'unknown').toUpperCase();
  const status = row.status || 'unknown';
  const policy = row.capability
    ? `${row.capability} · ${row.model || 'parent model'} · ${row.effort || 'inherit'} · ${row.toolCount || 0} tools · MCP ${row.mcp ? 'on' : 'off'}`
    : row.description || '定义无效';
  const label = `${row.label}  ${source} · ${status}`;
  const detail = row.capability && row.description ? `${policy} · ${row.description}` : policy;
  return renderSelectable(label, detail, active, contentWidth, theme, row.status === 'invalid' || row.status === 'reserved' ? 'warning' : 'accent');
}

/** 字段值使用动态右列；短值贴右展示，长值只在右列预算内按 grapheme 截断。 */
function renderFieldRow(row: AgentsCommandRow, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const value = row.description || '';
  const valueWidth = calculateRightColumnWidth(displayWidth(value), displayWidth(row.label), rowWidth, displayWidth(prefix));
  const labelWidth = Math.max(0, rowWidth - valueWidth);
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), valueWidth);
  const labelText = clampCellText(row.label, Math.max(0, labelWidth - displayWidth(prefix) - gapWidth));
  const label = tokenText(theme, active ? 'accentStrong' : row.readonly ? 'muted' : 'accent', active ? ansi.bold(labelText) : labelText);
  const valueText = valueWidth > 0 ? ansi.dim(clampCellText(value, valueWidth)) : '';
  const body = `${padVisibleText(`${prefix}${label}`, labelWidth)}${padLeftVisibleText(valueText, valueWidth)}`;
  return renderFocusableBody(body, active, contentWidth, theme);
}

/** 编辑态保持右列对齐，并额外为行尾光标保留一列，防止光标落到卡片边框上。 */
function renderEditingField(row: AgentsCommandRow, text: string, cursor: number, contentWidth: number, theme: FooterTheme): {cursorColumn: number; row: string} {
  const rowWidth = Math.max(1, contentWidth - 1);
  const desiredValueWidth = Math.max(1, displayWidth(text.replace(/\n/gu, ' ')) + 1);
  const calculatedValueWidth = calculateRightColumnWidth(desiredValueWidth, displayWidth(row.label), rowWidth, 1);
  const valueWidth = Math.max(1, calculatedValueWidth);
  const labelWidth = Math.max(0, rowWidth - valueWidth);
  const prefix = labelWidth > 0 ? ' ' : '';
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), valueWidth);
  const projected = projectSingleLineEditor(text, cursor, valueWidth);
  const label = tokenText(theme, 'accentStrong', ansi.bold(clampCellText(row.label, Math.max(0, labelWidth - displayWidth(prefix) - gapWidth))));
  const body = `${padVisibleText(`${prefix}${label}`, labelWidth)}${padVisibleText(projected.text, valueWidth)}`;
  return {
    cursorColumn: CONTENT_COLUMN_OFFSET + 1 + labelWidth + projected.cursorColumn,
    row: renderLine(`${renderFocusBar(theme)}${activeBackground(theme, body)}`, contentWidth, theme)
  };
}

function renderInstructionsEditor(surface: AgentsCommandSurface, text: string, contentWidth: number, bodyBudget: number, theme: FooterTheme): AgentsBodyLayout {
  const clusters = splitEditorText(text);
  const cursor = Math.min(Math.max(0, surface.editCursor || 0), clusters.length);
  const logical = createLogicalLines(clusters, cursor);
  const visibleCount = Math.max(1, bodyBudget);
  const start = Math.min(Math.max(0, logical.cursorRow - visibleCount + 1), Math.max(0, logical.lines.length - visibleCount));
  const visible = logical.lines.slice(start, start + visibleCount);
  const rows = visible.map((line, index) => {
    const absoluteRow = start + index;
    const projected = absoluteRow === logical.cursorRow
      ? projectSingleLineEditor(line, logical.cursorColumn, contentWidth)
      : {text: clampPlainText(line, contentWidth), cursorColumn: 0};
    return renderLine(projected.text, contentWidth, theme);
  });
  const activeLine = logical.lines[logical.cursorRow] || '';
  const activeProjection = projectSingleLineEditor(activeLine, logical.cursorColumn, contentWidth);
  if (start > 0 && rows.length > 0) {
    rows[0] = renderLine(ansi.dim(`↑ ${start} 行 `) + clampPlainText(visible[0] || '', Math.max(1, contentWidth - 6)), contentWidth, theme);
  }
  return {
    cursorColumn: CONTENT_COLUMN_OFFSET + activeProjection.cursorColumn,
    cursorRow: logical.cursorRow - start,
    rows,
    showCursor: true
  };
}

/** 将外部文本中的终端控制字符替换为空格，业务行保持单行且不允许注入 ANSI/OSC。 */
function normalizeSingleLineText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
}

/** 编辑器只保留换行语义，其余终端控制字符按单个空格投影以维持光标索引。 */
function normalizeEditorText(value: string): string {
  return value.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu, ' ');
}

function normalizeRow(row: AgentsCommandRow): AgentsCommandRow {
  return {
    ...row,
    ...(row.description === undefined ? {} : {description: normalizeSingleLineText(row.description)}),
    label: normalizeSingleLineText(row.label)
  };
}

/** 可聚焦选项采用左标签、右说明布局；两列分别裁剪，避免 ANSI 样式参与宽度计算。 */
function renderSelectable(label: string, description: string | undefined, active: boolean, contentWidth: number, theme: FooterTheme, token: 'accent' | 'danger' | 'warning'): string {
  const rowWidth = Math.max(1, contentWidth - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const detail = description || '';
  const detailWidth = calculateRightColumnWidth(displayWidth(detail), displayWidth(label), rowWidth, displayWidth(prefix));
  const labelWidth = Math.max(0, rowWidth - detailWidth);
  const gapWidth = calculateColumnGap(labelWidth, displayWidth(prefix), detailWidth);
  const visibleLabel = clampCellText(label, Math.max(0, labelWidth - displayWidth(prefix) - gapWidth));
  const labelText = tokenText(theme, active ? 'accentStrong' : token, active ? ansi.bold(visibleLabel) : visibleLabel);
  const detailText = detailWidth > 0 ? ansi.dim(clampCellText(detail, detailWidth)) : '';
  const body = `${padVisibleText(`${prefix}${labelText}`, labelWidth)}${padLeftVisibleText(detailText, detailWidth)}`;
  return renderFocusableBody(body, active, contentWidth, theme);
}

/**
 * 计算贴右内容列宽；优先保留完整短标签，长标签最多占可用正文的一定比例，其余空间全部交给右列。
 */
function calculateRightColumnWidth(naturalWidth: number, labelNaturalWidth: number, rowWidth: number, prefixWidth: number): number {
  if (naturalWidth <= 0) return 0;
  const available = Math.max(0, rowWidth - prefixWidth - SPLIT_COLUMN_GAP);
  const labelLimit = Math.max(1, Math.floor(available * LEFT_COLUMN_MAX_RATIO));
  const reservedLabelWidth = Math.min(Math.max(1, labelNaturalWidth), labelLimit);
  return Math.min(naturalWidth, Math.max(0, available - reservedLabelWidth));
}

/** 右列存在时从左列预算中保留固定间隔；极窄布局按实际剩余列收缩。 */
function calculateColumnGap(leftWidth: number, prefixWidth: number, rightWidth: number): number {
  if (rightWidth <= 0) return 0;
  return Math.min(SPLIT_COLUMN_GAP, Math.max(0, leftWidth - prefixWidth));
}

/** 在固定右列内左侧补空格，让宽字符截断后不足一列的内容仍贴齐右边。 */
function padLeftVisibleText(text: string, width: number): string {
  const padding = Math.max(0, width - displayWidth(text));
  return `${' '.repeat(padding)}${text}`;
}

function renderFocusableBody(body: string, active: boolean, contentWidth: number, theme: FooterTheme): string {
  if (!active) {
    return renderLine(padVisibleText(body, contentWidth), contentWidth, theme);
  }
  const rowWidth = Math.max(1, contentWidth - 1);
  return renderLine(`${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(body, rowWidth))}`, contentWidth, theme);
}

/** 把单行编辑内容裁剪到光标附近，并保持 grapheme 与终端列宽边界。 */
function projectSingleLineEditor(text: string, cursor: number, width: number): EditorProjection {
  const chars = splitEditorText(text.replace(/\n/gu, ' '));
  const cursorIndex = Math.min(Math.max(0, cursor), chars.length);
  let start = cursorIndex;
  while (start > 0) {
    const candidate = chars.slice(start - 1, cursorIndex).join('');
    const markerWidth = start - 1 > 0 ? 1 : 0;
    if (displayWidth(candidate) + markerWidth > Math.max(0, width - 1)) break;
    start -= 1;
  }
  const leftMarker = start > 0 ? '…' : '';
  const before = chars.slice(start, cursorIndex).join('');
  let end = cursorIndex;
  while (end < chars.length) {
    const candidate = chars.slice(start, end + 1).join('');
    const rightMarkerWidth = end + 1 < chars.length ? 1 : 0;
    if (displayWidth(leftMarker) + displayWidth(candidate) + rightMarkerWidth > width) break;
    end += 1;
  }
  const rightMarker = end < chars.length ? '…' : '';
  return {
    cursorColumn: displayWidth(leftMarker) + displayWidth(before),
    text: `${leftMarker}${chars.slice(start, end).join('')}${rightMarker}`
  };
}

function createLogicalLines(chars: string[], cursor: number): {cursorColumn: number; cursorRow: number; lines: string[]} {
  const lines = [''];
  let row = 0;
  let cursorRow = 0;
  let cursorColumn = 0;
  for (let index = 0; index <= chars.length; index += 1) {
    if (index === cursor) {
      cursorRow = row;
      cursorColumn = splitEditorText(lines[row]).length;
    }
    if (index === chars.length) break;
    if (chars[index] === '\n') {
      row += 1;
      lines[row] = '';
    } else {
      lines[row] += chars[index];
    }
  }
  return {cursorColumn, cursorRow, lines};
}

function splitEditorText(text: string): string[] {
  return Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text), (entry) => entry.segment);
}

function clampStyledParts(parts: string[], separator: string, width: number): string {
  const result: string[] = [];
  let used = 0;
  for (const part of parts) {
    const prefix = result.length > 0 ? separator : '';
    const nextWidth = displayWidth(prefix) + displayWidth(part);
    if (used + nextWidth > width) break;
    result.push(`${prefix}${part}`);
    used += nextWidth;
  }
  return result.join('');
}

/** 在卡片内部单元格按精确列宽裁剪；不同于终端整行裁剪，不额外扣除最后一列。 */
function clampCellText(text: string, width: number): string {
  const safeWidth = Math.max(0, Math.floor(width));
  if (safeWidth === 0) {
    return '';
  }
  if (displayWidth(text) <= safeWidth) {
    return text;
  }
  const chars = splitEditorText(text);
  let result = '';
  for (const char of chars) {
    if (displayWidth(`${result}${char}…`) > safeWidth) {
      break;
    }
    result += char;
  }
  return `${result}…`;
}

function renderMessage(message: string, token: 'danger' | 'success', contentWidth: number, theme: FooterTheme): string {
  return renderLine(tokenText(theme, token, clampPlainText(message, contentWidth)), contentWidth, theme);
}

function renderTop(width: number, title: string, theme: FooterTheme): string {
  const titleText = clampPlainText(title, Math.max(1, width - 4));
  const tag = tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `));
  const rail = tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2 - displayWidth(tag))));
  return `${tokenText(theme, 'accentDeep', '╭')}${tag}${rail}${tokenText(theme, 'accentDeep', '╮')}`;
}

function renderBottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'accentDeep', '╯')}`;
}

function renderLine(content: string, contentWidth: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, contentWidth)} ${tokenText(theme, 'accentDeep', '│')}`;
}

function withoutCursor(rows: string[]): AgentsBodyLayout {
  return {cursorColumn: 0, cursorRow: Math.max(0, rows.length - 1), rows, showCursor: false};
}
