import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {clampIndex, createSelectedWindowRows} from './window';

import type {CommandMcpServerInfo, McpCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const MCP_SURFACE_MIN_WIDTH = 44;
const MCP_SURFACE_MAX_WIDTH = 84;
const MCP_MAX_VISIBLE = 8;

/**
 * 渲染 MCP 管理面板；保存和 reload 由 command handler 通过 CommandHost 完成。
 */
export function renderMcpSurface(commandSurface: McpCommandSurface, width: number, theme: FooterTheme = resolveFooterTheme(undefined)): FooterLayout {
  const servers = commandSurface.servers;
  const selectedIndex = clampIndex(commandSurface.selectedIndex, servers.length);
  const boxWidth = calculateMcpBoxWidth(width);
  const contentWidth = Math.max(1, boxWidth - 4);
  const lines = [
    renderTop(boxWidth, commandSurface.title, servers, theme),
    renderLine('', contentWidth, theme),
    ...renderMcpContent(commandSurface, selectedIndex, contentWidth, theme),
    renderLine('', contentWidth, theme),
    renderLine(ansi.dim(clampPlainText(commandSurface.dismissHint, contentWidth)), contentWidth, theme),
    renderBottom(boxWidth, theme)
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

function calculateMcpBoxWidth(width: number): number {
  const safeWidth = safeRenderWidth(width);
  const targetWidth = Math.max(MCP_SURFACE_MIN_WIDTH, Math.min(MCP_SURFACE_MAX_WIDTH, safeWidth - 4));
  return Math.max(1, Math.min(safeWidth, targetWidth));
}

function renderMcpContent(commandSurface: McpCommandSurface, selectedIndex: number, contentWidth: number, theme: FooterTheme): string[] {
  const servers = commandSurface.servers;

  if (servers.length === 0) {
    const lines = commandSurface.emptyLines && commandSurface.emptyLines.length > 0
      ? commandSurface.emptyLines
      : ['当前没有配置 MCP server。'];
    return lines.map((line) => renderLine(ansi.dim(clampPlainText(line, contentWidth)), contentWidth, theme));
  }

  const rows: string[] = [];

  for (const row of createSelectedWindowRows(servers, selectedIndex, MCP_MAX_VISIBLE)) {
    if (row.kind === 'more') {
      rows.push(renderLine(ansi.dim(`  ${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`), contentWidth, theme));
      continue;
    }

    rows.push(renderMcpRow(row.item, row.index === selectedIndex, contentWidth, theme));
  }

  return rows;
}

function renderMcpRow(server: CommandMcpServerInfo, active: boolean, contentWidth: number, theme: FooterTheme): string {
  const rowContentWidth = Math.max(1, contentWidth - 1);
  const pill = renderPill(server.enabled, theme);
  const nameToken = active ? 'accentStrong' : server.enabled ? 'accent' : 'muted';
  const nameBudget = Math.max(1, Math.min(24, rowContentWidth - displayWidth(` ${pill}    `) - 8));
  const nameText = clampPlainText(server.name, nameBudget);
  const name = tokenText(theme, nameToken, active ? ansi.bold(nameText) : nameText);
  const description = createDescription(server);
  const prefix = `${pill}  ${name}  `;
  const descriptionWidth = rowContentWidth - displayWidth(` ${prefix}`);
  const renderedDescription = descriptionWidth > 0 ? ansi.dim(clampPlainText(description, descriptionWidth)) : '';
  const body = padVisibleText(` ${prefix}${renderedDescription}`, rowContentWidth);

  if (!active) {
    return renderLine(` ${body}`, contentWidth, theme);
  }

  const accent = renderFocusBar(theme);
  const activeBody = activeBackground(theme, body);
  return renderLine(`${accent}${activeBody}`, contentWidth, theme);
}

function createDescription(server: CommandMcpServerInfo): string {
  if (server.kind === 'global') {
    return server.enabled ? '所有已配置 server 可运行' : '所有 MCP server 已禁用';
  }

  if (!server.valid) {
    return `无效 · ${server.diagnostic || server.summary}`;
  }

  const transport = server.transport || 'server';
  const toolText = typeof server.toolCount === 'number' ? ` · ${server.toolCount} tools` : '';
  const diagnosticText = server.diagnostic ? ` · ${server.diagnostic}` : '';
  return `${transport}${toolText}${diagnosticText} · ${server.summary}`;
}

function renderPill(enabled: boolean, theme: FooterTheme): string {
  if (enabled) {
    return tokenText(theme, 'success', `${ansi.bold('●')} 启用`);
  }

  return tokenText(theme, 'off', '○ 停用');
}

function renderTop(width: number, title: string, servers: CommandMcpServerInfo[], theme: FooterTheme): string {
  const serverRows = servers.filter((server) => server.kind === 'server');
  const enabledCount = serverRows.filter((server) => server.enabled).length;
  const globalDisabled = servers.some((server) => server.kind === 'global' && !server.enabled);
  const counter = serverRows.length > 0
    ? ` ${tokenText(theme, globalDisabled ? 'warning' : 'success', ansi.bold(String(enabledCount)))}${ansi.dim(`/${serverRows.length} 启用`)} `
    : '';
  const titleText = clampPlainText(title, Math.max(1, width - 2 - displayWidth(counter) - 2));
  const titleTag = tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `));
  const railWidth = Math.max(0, width - 2 - displayWidth(titleTag) - displayWidth(counter));

  return `${tokenText(theme, 'accentDeep', '╭')}${titleTag}${renderRail(railWidth, theme)}${counter}${tokenText(theme, 'accentDeep', '╮')}`;
}

function renderBottom(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${renderRail(Math.max(0, width - 2), theme)}${tokenText(theme, 'accentDeep', '╯')}`;
}

function renderLine(content: string, width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '│')} ${padVisibleText(content, width)} ${tokenText(theme, 'accentDeep', '│')}`;
}

function renderRail(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'accentDeep', '─'.repeat(Math.max(0, width)));
}
