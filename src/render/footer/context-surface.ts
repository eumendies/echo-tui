import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth} from '../layout';
import {colorText, colorToRgb, mixRgb, tokenText, type FooterTheme, type RgbColor} from '../colors';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail} from './window';

import type {ContextUsage, ContextUsageSegmentCategory} from '../../types/agent';
import type {ContextUsageCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const SEGMENT_LABELS: Record<ContextUsageSegmentCategory, string> = {
  system: '系统提示词',
  skills: 'Skills',
  tools: '工具',
  messages: '消息',
  reasoning: '推理'
};

const FILL = '█';
const TRACK = '░';
const DOT = '●';

/**
 * 渲染 /context 详情卡片，展示最近一次 provider usage 的窗口占用与分类构成。
 */
function renderContextSurface(surface: ContextUsageCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const cardWidth = Math.min(clamp(safeWidth - 2, 50, 78), Math.max(1, safeWidth - 1));
  const inner = Math.max(1, cardWidth - 3);
  const usage = surface.usage;
  const segments = (usage.segments || []).filter((segment) => segment.tokens > 0);
  const lines = [
    topLine(cardWidth, surface.title || '上下文', theme),
    rowLine(cardWidth, headerLine(usage, inner, theme), theme),
    rowLine(cardWidth, windowGaugeLine(usage, inner, theme), theme),
    rowLine(cardWidth, '', theme),
    rowLine(cardWidth, compositionBarLine(segments, usage.usedTokens, inner, theme), theme),
    rowLine(cardWidth, '', theme)
  ];

  for (const segment of [...segments].sort((left, right) => right.tokens - left.tokens)) {
    lines.push(rowLine(cardWidth, breakdownLine(segment.category, segment.tokens, usage.usedTokens, inner, theme), theme));
  }

  lines.push(dividerLine(cardWidth, theme));
  lines.push(rowLine(cardWidth, ansi.dim(clampPlainText(surface.dismissHint || '上下文占用详情 · 按任意键关闭', inner)), theme));
  lines.push(bottomLine(cardWidth, theme));

  return constrainLayoutTail({
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  }, maxLines);
}

function headerLine(usage: ContextUsage, inner: number, theme: FooterTheme): string {
  const pct = usage.contextWindow > 0 ? usage.usedTokens / usage.contextWindow * 100 : 0;
  const left = `${tokenText(theme, 'text', ansi.bold(humanizeTokens(usage.usedTokens)))} ${ansi.dim(`/ ${humanizeTokens(usage.contextWindow)} tokens`)}`;
  const token = pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : 'accentStrong';
  const right = `${tokenText(theme, token, ansi.bold(`${pct.toFixed(0)}%`))} ${ansi.dim('已用')}`;
  const gap = Math.max(1, inner - displayWidth(left) - displayWidth(right));

  return `${left}${' '.repeat(gap)}${right}`;
}

function windowGaugeLine(usage: ContextUsage, inner: number, theme: FooterTheme): string {
  const frac = usage.contextWindow > 0 ? Math.min(1, usage.usedTokens / usage.contextWindow) : 0;
  const filled = Math.round(frac * inner);
  const token = frac >= 0.9 ? 'danger' : frac >= 0.75 ? 'warning' : 'accent';

  return `${tokenText(theme, token, FILL.repeat(filled))}${tokenText(theme, 'rail', TRACK.repeat(inner - filled))}`;
}

function compositionBarLine(segments: NonNullable<ContextUsage['segments']>, usedTokens: number, inner: number, theme: FooterTheme): string {
  if (usedTokens <= 0 || segments.length === 0) {
    return tokenText(theme, 'rail', TRACK.repeat(inner));
  }

  const raw = segments.map((segment) => ({segment, value: segment.tokens / usedTokens * inner}));
  const counts = raw.map((item) => Math.floor(item.value));
  const leftover = inner - counts.reduce((sum, count) => sum + count, 0);

  for (const index of raw
    .map((item, index) => ({index, remainder: item.value - Math.floor(item.value)}))
    .sort((left, right) => right.remainder - left.remainder)
    .slice(0, leftover)
    .map((item) => item.index)) {
    counts[index] += 1;
  }

  return raw.map((item, index) => {
    const count = counts[index];
    return count > 0 ? colorText(segmentColor(item.segment.category, theme), FILL.repeat(count)) : '';
  }).join('');
}

function breakdownLine(category: ContextUsageSegmentCategory, tokens: number, usedTokens: number, inner: number, theme: FooterTheme): string {
  const share = usedTokens > 0 ? tokens / usedTokens * 100 : 0;
  const color = segmentColor(category, theme);
  const swatch = colorText(color, DOT);
  const name = tokenText(theme, 'text', SEGMENT_LABELS[category]);
  const stat = `${colorText(color, humanizeTokens(tokens))} ${ansi.dim(`${share.toFixed(0)}%`)}`;
  const gap = Math.max(1, inner - 2 - displayWidth(name) - displayWidth(stat));

  return `${swatch} ${name}${' '.repeat(gap)}${stat}`;
}

function topLine(width: number, title: string, theme: FooterTheme): string {
  const tag = title ? tokenText(theme, 'accentStrong', ansi.bold(` ${title} `)) : '';
  const rail = gradientLine(Math.max(0, width - 1 - displayWidth(tag)), theme);
  return `${tokenText(theme, 'accentDeep', '╭')}${tag}${rail}${tokenText(theme, 'accentDeep', '╮')}`;
}

function bottomLine(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'accentDeep', '╰')}${gradientLine(width - 1, theme)}${tokenText(theme, 'accentDeep', '╯')}`;
}

function dividerLine(width: number, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  return `${bar}${tokenText(theme, 'frame', ansi.dim('─'.repeat(Math.max(0, width - 1))))}${bar}`;
}

function rowLine(width: number, content: string, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  const contentWidth = Math.max(1, width - 4);
  return `${bar} ${padVisibleText(clampPlainText(content, contentWidth), contentWidth)} ${bar}`;
}

function gradientLine(width: number, theme: FooterTheme): string {
  const out: string[] = [];
  const start = colorToRgb(theme.colors.accentDeep);
  const end = colorToRgb(theme.colors.accentStrong);

  for (let index = 0; index < Math.max(0, width); index += 1) {
    const t = index / Math.max(1, width - 1);
    const peak = 1 - Math.abs(2 * t - 1);
    out.push(colorText({kind: 'rgb', value: mixRgb(start, end, peak)}, '─'));
  }

  return out.join('');
}

function segmentColor(category: ContextUsageSegmentCategory, theme: FooterTheme) {
  if (category === 'system') {
    return theme.colors.accent;
  }

  if (category === 'skills') {
    return theme.colors.plan;
  }

  if (category === 'tools') {
    return theme.colors.success;
  }

  if (category === 'messages') {
    return theme.colors.accentStrong;
  }

  return theme.colors.warning;
}

function humanizeTokens(tokens: number): string {
  const value = Math.max(0, Math.round(Number.isFinite(tokens) ? tokens : 0));

  if (value < 1000) {
    return String(value);
  }

  if (value < 1_000_000) {
    const compact = value / 1000;
    return compact >= 100 || Number.isInteger(compact) ? `${compact.toFixed(0)}K` : `${compact.toFixed(1)}K`;
  }

  const compact = value / 1_000_000;
  return Number.isInteger(compact) ? `${compact.toFixed(0)}M` : `${compact.toFixed(1)}M`;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

export {
  humanizeTokens,
  renderContextSurface
};
