import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail, createSelectedWindowRows} from './window';
import {actionRow, bottom, contentWidth, dimHint, editingText, line, moreRow, renderDot, top} from './config-panel-rows';

import type {McpCommandRow, McpCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const MCP_SURFACE_MIN_WIDTH = 44;
const MCP_SURFACE_MAX_WIDTH = 84;
const MCP_MAX_VISIBLE = 8;

/**
 * 渲染 /mcp 面板：与 /config 共用同一套边框、双列与选中态行原语，
 * 状态由 command handler 的行投影提供，渲染层不判断视图语义之外的业务。
 */
function renderMcpSurface(commandSurface: McpCommandSurface, width: number, theme: FooterTheme = resolveFooterTheme(undefined), maxLines?: number): FooterLayout {
  const boxWidth = calculateMcpBoxWidth(width);
  const right = commandSurface.dirty ? '未保存' : '';
  const lines = [
    top(boxWidth, ` ${commandSurface.title} `, 'accentStrong', theme, right),
    line(boxWidth, '', theme)
  ];

  if (commandSurface.rows.length === 0) {
    for (const text of commandSurface.emptyLines || ['当前没有配置 MCP server。']) {
      lines.push(line(boxWidth, `  ${ansi.dim(clampPlainText(text, Math.max(1, contentWidth(boxWidth) - 2)))}`, theme));
    }
  } else {
    const visibleRows = createSelectedWindowRows(commandSurface.rows, commandSurface.selectedIndex, MCP_MAX_VISIBLE);

    for (const entry of visibleRows) {
      if (entry.kind === 'more') {
        lines.push(moreRow(boxWidth, entry.direction, entry.count, theme));
        continue;
      }

      lines.push(...renderRow(entry.item, entry.index === commandSurface.selectedIndex, boxWidth, theme));
    }
  }

  if (commandSurface.feedback) {
    lines.push(line(boxWidth, `  ${tokenText(theme, 'success', clampPlainText(commandSurface.feedback, Math.max(1, contentWidth(boxWidth) - 2)))}`, theme));
  }

  if (commandSurface.error) {
    lines.push(line(boxWidth, `  ${tokenText(theme, 'warning', clampPlainText(commandSurface.error, Math.max(1, contentWidth(boxWidth) - 2)))}`, theme));
  }

  lines.push(line(boxWidth, '', theme));
  lines.push(line(boxWidth, ` ${dimHint(boxWidth, commandSurface.dismissHint)}`, theme));
  lines.push(bottom(boxWidth, theme));

  return constrainLayoutTail({
    lines,
    cursorRow: Math.max(0, lines.length - 1),
    cursorColumn: 0,
    showCursor: false
  }, maxLines);
}

/** 单行渲染：动作/清单/选项行用动作行，其余用双列行；带 detail 的普通行追加一行缩进备注。 */
function renderRow(row: McpCommandRow, active: boolean, width: number, theme: FooterTheme): string[] {
  const prefix = row.dot ? `${renderDot(row.dot === 'on', theme)} ` : '';

  if (row.kind === 'action' || row.kind === 'inventory' || row.kind === 'option') {
    return [actionRow(width, `${prefix}${row.label}`, row.detail || '', active, row.tone === 'warning', theme)];
  }

  if (row.input) {
    return [splitLikeRow(width, `${prefix}${row.label}`, editingText(row.input.text, row.masked === true), active, theme)];
  }

  const rendered = splitLikeRow(width, `${prefix}${row.label}`, row.value || '', active, theme);

  if (!row.detail) {
    return [rendered];
  }

  return [rendered, line(width, `    ${ansi.dim(clampPlainText(row.detail, Math.max(1, contentWidth(width) - 4)))}`, theme)];
}

/** 复刻双列布局公式，供本文件内部使用（rows.ts 的 kvRow 会把空值替换为"未设置"）。 */
function splitLikeRow(width: number, leftText: string, rightText: string, active: boolean, theme: FooterTheme): string {
  const inner = contentWidth(width);
  const bodyWidth = Math.max(0, inner - (active ? 1 : 0));
  const prefix = active ? ' ' : '  ';
  const leftNaturalWidth = Math.min(displayWidth(prefix) + displayWidth(leftText), bodyWidth);
  const columnGap = Math.min(2, Math.max(0, bodyWidth - leftNaturalWidth));
  const rightWidth = Math.min(displayWidth(rightText), Math.max(0, bodyWidth - leftNaturalWidth - columnGap));
  const leftWidth = Math.max(0, bodyWidth - rightWidth);
  const visibleLeftText = clampPlainText(leftText, Math.max(0, leftWidth - displayWidth(prefix)) + 1);
  const left = `${prefix}${tokenText(theme, active ? 'accentStrong' : 'accent', active ? ansi.bold(visibleLeftText) : visibleLeftText)}`;
  const right = tokenText(theme, active ? 'accentStrong' : 'accent', clampPlainText(rightText, rightWidth + 1));
  const body = `${padVisibleText(left, leftWidth)}${padVisibleText(right, rightWidth)}`;

  return line(width, active ? `${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(body, bodyWidth))}` : body, theme);
}

function calculateMcpBoxWidth(width: number): number {
  const safeWidth = safeRenderWidth(width);
  const targetWidth = Math.max(MCP_SURFACE_MIN_WIDTH, Math.min(MCP_SURFACE_MAX_WIDTH, safeWidth - 4));
  return Math.max(1, Math.min(safeWidth, targetWidth));
}

export {
  calculateMcpBoxWidth,
  renderMcpSurface,
  renderRow,
  splitLikeRow
};
