import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail} from './window';

import type {CommandCodexUsageWindow, StatusCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const FILL = '█';
const TRACK = '░';

/**
 * 渲染 `/status` 只读卡片；低行数时从头部裁剪，优先保留底部的 Codex 配额进度。
 */
function renderStatusSurface(surface: StatusCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const cardWidth = Math.min(82, Math.max(1, safeWidth - 1));
  const inner = Math.max(1, cardWidth - 4);
  const snapshot = surface.snapshot;
  const model = snapshot.model;
  const instructionLabels = snapshot.agentInstructions.map((source) => `${source.sourceKind}:${source.label}`);
  const catalogLabels = snapshot.agentMemoryCatalogs.map((catalog) => `${catalog.scope}:${catalog.name}`);
  const lines = [
    topLine(cardWidth, surface.title, theme),
    plainRow(cardWidth, `目录  ${snapshot.cwd}`, theme),
    plainRow(cardWidth, `模型  ${model?.model || '不可用'}`, theme),
    plainRow(cardWidth, `Provider  ${model ? `${model.provider} (${model.agentType})` : '不可用'}`, theme),
    plainRow(cardWidth, `Session  ${snapshot.sessionId || '未创建'}`, theme),
    plainRow(cardWidth, `Instructions  ${snapshot.agentInstructionFileName} · ${instructionLabels.length > 0 ? instructionLabels.join(', ') : '无'}`, theme),
    plainRow(cardWidth, `Memory  user:${snapshot.userMemoryCount} · catalogs:${catalogLabels.length > 0 ? catalogLabels.join(', ') : '无'}`, theme)
  ];

  if (snapshot.diagnostics.length > 0) {
    lines.push(plainRow(cardWidth, `状态提示  ${snapshot.diagnostics.join(' · ')}`, theme, 'warning'));
  }

  if (surface.usage.status !== 'not_applicable') {
    lines.push(dividerLine(cardWidth, theme));
    lines.push(plainRow(cardWidth, 'Codex 用量', theme, 'accentStrong', true));

    if (surface.usage.status === 'available') {
      lines.push(...usageWindowLines('5 小时', surface.usage.primary, cardWidth, inner, theme));
      if (surface.usage.secondary) {
        lines.push(...usageWindowLines('每周', surface.usage.secondary, cardWidth, inner, theme));
      } else {
        lines.push(plainRow(cardWidth, '每周  暂无数据', theme, 'muted'));
      }
    } else if (surface.usage.status === 'loading') {
      lines.push(plainRow(cardWidth, '正在查询…', theme, 'accent'));
    } else {
      lines.push(plainRow(cardWidth, `不可用  ${surface.usage.error}`, theme, 'warning'));
    }
  }

  lines.push(dividerLine(cardWidth, theme));
  lines.push(plainRow(cardWidth, surface.dismissHint, theme, 'muted'));
  lines.push(bottomLine(cardWidth, theme));

  return constrainLayoutTail({
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  }, maxLines);
}

function usageWindowLines(label: string, usage: CommandCodexUsageWindow, cardWidth: number, inner: number, theme: FooterTheme): string[] {
  const percent = Math.min(100, Math.max(0, usage.usedPercent));
  const percentText = `${formatPercent(percent)}%`;
  const resetText = `重置 ${formatResetAt(usage.resetAt)}`;
  const fullStat = `${percentText} · ${resetText}`;
  const stat = displayWidth(label) + 1 + displayWidth(fullStat) <= inner ? fullStat : percentText;
  const gap = Math.max(1, inner - displayWidth(label) - displayWidth(stat));
  const header = `${label}${' '.repeat(gap)}${stat}`;
  const filled = Math.round(percent / 100 * inner);
  const token = percent >= 90 ? 'danger' : percent >= 75 ? 'warning' : 'accent';
  const gauge = `${tokenText(theme, token, FILL.repeat(filled))}${tokenText(theme, 'rail', TRACK.repeat(inner - filled))}`;

  return [plainRow(cardWidth, header, theme), styledRow(cardWidth, gauge, theme)];
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatResetAt(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : '未知';
}

function topLine(width: number, title: string, theme: FooterTheme): string {
  const inner = Math.max(0, width - 2);
  const titleText = inner > 2 ? clampPlainText(title, inner - 2) : '';
  const tag = titleText ? tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `)) : '';
  return `${tokenText(theme, 'frame', '╭')}${tag}${tokenText(theme, 'frame', '─'.repeat(Math.max(0, inner - displayWidth(tag))))}${tokenText(theme, 'frame', '╮')}`;
}

function bottomLine(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'frame', '╰')}${tokenText(theme, 'frame', '─'.repeat(Math.max(0, width - 2)))}${tokenText(theme, 'frame', '╯')}`;
}

function dividerLine(width: number, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  return `${bar}${tokenText(theme, 'frame', ansi.dim('─'.repeat(Math.max(0, width - 2))))}${bar}`;
}

function plainRow(width: number, content: string, theme: FooterTheme, token: keyof FooterTheme['colors'] = 'text', bold = false): string {
  const inner = Math.max(1, width - 4);
  // clampPlainText 会为物理终端保留最后一列；卡片自身已预留边框，因此补回这一列预算。
  const text = clampPlainText(content, inner + 1);
  const styled = tokenText(theme, token, bold ? ansi.bold(text) : text);
  return styledRow(width, styled, theme);
}

function styledRow(width: number, content: string, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  const inner = Math.max(1, width - 4);
  return `${bar} ${padVisibleText(content, inner)} ${bar}`;
}

export {
  formatResetAt,
  renderStatusSurface
};
