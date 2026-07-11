import * as ansi from '../../terminal/ansi';
import {colorText, tokenText, type FooterTheme} from '../colors';
import {displayWidth, safeRenderWidth, stripAnsi} from '../layout';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail} from './window';

import type {UsageCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';
import type {UsageDailyAggregate} from '../../types/usage';

const FILL = '█';
const TRACK = '░';
const DOT = '●';
const LEFT_MORE = '◂';
const RIGHT_MORE = '▸';
const MIN_CARD_WIDTH = 54;
const MAX_CARD_WIDTH = 82;

type UsageColumn = {
  align: 'left' | 'right';
  color?: 'usageInput' | 'usageOutput' | 'usageCached' | 'text' | 'muted';
  key: string;
  label: string;
  width: number;
};

/**
 * 渲染 `/usage` 每日 token 用量面板；只读取 surface 快照，不修改滚动状态。
 */
function renderUsageSurface(surface: UsageCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const days = surface.dailyUsage || [];
  const layout = resolveUsageLayout(surface, days, safeWidth, maxLines);
  const {cardWidth, inner, maxOffset, offset, visibleDays} = layout;
  const lines = [
    topLine(cardWidth, surface.title || 'Token 用量', theme),
    rowLine(cardWidth, headerLine(days, inner, theme), theme),
    rowLine(cardWidth, spanLine(days, visibleDays, offset, inner, theme), theme),
    dividerLine(cardWidth, theme)
  ];

  if (visibleDays.length === 0) {
    lines.push(rowLine(cardWidth, ansi.dim('暂无用量记录'), theme));
  } else {
    for (const line of tableLines(visibleDays, inner, theme)) {
      lines.push(rowLine(cardWidth, line, theme));
    }
  }

  lines.push(dividerLine(cardWidth, theme));
  lines.push(rowLine(cardWidth, footerLine(maxOffset > 0, inner, theme), theme));
  lines.push(bottomLine(cardWidth, theme));

  return constrainLayoutTail({
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  }, maxLines);
}

function resolveUsageLayout(surface: UsageCommandSurface, days: UsageDailyAggregate[], safeWidth: number, maxLines: number | undefined): {
  cardWidth: number;
  inner: number;
  maxOffset: number;
  offset: number;
  visibleDays: UsageDailyAggregate[];
} {
  const maxCardWidth = Math.min(clamp(safeWidth - 2, MIN_CARD_WIDTH, MAX_CARD_WIDTH), Math.max(1, safeWidth - 1));
  let cardWidth = maxCardWidth;
  let inner = Math.max(1, cardWidth - 4);
  let maxOffset = 0;
  let offset = 0;
  let visibleDays: UsageDailyAggregate[] = [];

  for (let index = 0; index < 2; index += 1) {
    const windowSize = resolveWindowSize(days.length, safeWidth, maxLines);
    maxOffset = Math.max(0, days.length - windowSize);
    offset = clamp(Number.isInteger(surface.offset) ? Number(surface.offset) : maxOffset, 0, maxOffset);
    visibleDays = days.slice(offset, offset + windowSize);
    const preferredInner = preferredUsageInner(days, visibleDays, offset, maxOffset > 0, surface.title || 'Token 用量');
    const nextCardWidth = Math.min(maxCardWidth, Math.max(Math.min(MIN_CARD_WIDTH, maxCardWidth), preferredInner + 4));

    if (nextCardWidth === cardWidth) {
      break;
    }

    cardWidth = nextCardWidth;
    inner = Math.max(1, cardWidth - 4);
  }

  return {cardWidth, inner, maxOffset, offset, visibleDays};
}

/**
 * 按当前终端视口计算 usage 日期窗口的滚动边界和页大小，供 command handler 与渲染层共享。
 */
function calculateUsageNavigation(surface: UsageCommandSurface, width: number, maxLines: number | undefined): {maxOffset: number; windowSize: number} {
  const layout = resolveUsageLayout(surface, surface.dailyUsage || [], safeRenderWidth(width), maxLines);
  return {maxOffset: layout.maxOffset, windowSize: layout.visibleDays.length};
}

function preferredUsageInner(days: UsageDailyAggregate[], visibleDays: UsageDailyAggregate[], offset: number, pannable: boolean, title: string): number {
  const table = visibleDays.length > 0 ? tableWidth(resolveTableColumns(visibleDays, MAX_CARD_WIDTH - 4)) : displayWidth('暂无用量记录');
  return Math.max(
    displayWidth(title) + 6,
    preferredHeaderWidth(days),
    preferredSpanWidth(days, visibleDays, offset),
    table,
    displayWidth(pannable ? '↑/↓ 滚动 · PgUp/PgDn 翻页 · Home/End 跳转 · Enter/Esc/q 关闭' : 'Enter/Esc/q 关闭')
  );
}

function preferredHeaderWidth(days: UsageDailyAggregate[]): number {
  const totals = sumDays(days);
  const left = `↑ ${humanizeTokens(totals.inputTokens)}   ↓ ${humanizeTokens(totals.outputTokens)}   ${DOT} ${humanizeTokens(totals.cacheReadInputTokens)} · ${(totals.hitRate * 100).toFixed(0)}% 缓存命中`;
  const right = `${humanizeTokens(totals.totalTokens)} 合计`;
  return displayWidth(left) + 2 + displayWidth(right);
}

function preferredSpanWidth(days: UsageDailyAggregate[], visibleDays: UsageDailyAggregate[], offset: number): number {
  if (visibleDays.length === 0) {
    return displayWidth('暂无数据');
  }

  const first = formatDayLabel(visibleDays[0].localDay);
  const last = formatDayLabel(visibleDays[visibleDays.length - 1].localDay);
  const range = first === last ? first : `${first} - ${last}`;
  const left = `显示 ${visibleDays.length}/${days.length} · ${range}`;
  const hiddenLeft = offset;
  const hiddenRight = Math.max(0, days.length - offset - visibleDays.length);
  const right = hiddenLeft > 0 || hiddenRight > 0 ? `${LEFT_MORE}${hiddenLeft} ${hiddenRight}${RIGHT_MORE}` : '';

  return displayWidth(left) + (right ? 1 + displayWidth(right) : 0);
}

function headerLine(days: UsageDailyAggregate[], inner: number, theme: FooterTheme): string {
  const totals = sumDays(days);
  const input = `${tokenText(theme, 'usageInput', '↑')} ${tokenText(theme, 'text', ansi.bold(humanizeTokens(totals.inputTokens)))}`;
  const output = `${tokenText(theme, 'usageOutput', '↓')} ${tokenText(theme, 'text', ansi.bold(humanizeTokens(totals.outputTokens)))}`;
  const cached = `${tokenText(theme, 'usageCached', DOT)} ${tokenText(theme, 'text', humanizeTokens(totals.cacheReadInputTokens))} ${ansi.dim(`· ${(totals.hitRate * 100).toFixed(0)}% 缓存命中`)}`;
  const left = `${input}   ${output}   ${cached}`;
  const right = `${tokenText(theme, 'usageInput', ansi.bold(humanizeTokens(totals.totalTokens)))} ${ansi.dim('合计')}`;
  const gap = inner - displayWidth(left) - displayWidth(right);

  return gap >= 2 ? `${left}${' '.repeat(gap)}${right}` : clampStyledLine(left, inner);
}

function spanLine(days: UsageDailyAggregate[], visibleDays: UsageDailyAggregate[], offset: number, inner: number, theme: FooterTheme): string {
  if (visibleDays.length === 0) {
    return ansi.dim('暂无数据');
  }

  const first = formatDayLabel(visibleDays[0].localDay);
  const last = formatDayLabel(visibleDays[visibleDays.length - 1].localDay);
  const range = first === last ? first : `${first} - ${last}`;
  const left = ansi.dim(`显示 ${visibleDays.length}/${days.length} · ${range}`);
  const hiddenLeft = offset;
  const hiddenRight = Math.max(0, days.length - offset - visibleDays.length);
  const right = hiddenLeft > 0 || hiddenRight > 0
    ? `${hiddenLeft > 0 ? tokenText(theme, 'accentStrong', `${LEFT_MORE}${hiddenLeft}`) : ansi.dim(`${LEFT_MORE}0`)} ${hiddenRight > 0 ? tokenText(theme, 'accentStrong', `${hiddenRight}${RIGHT_MORE}`) : ansi.dim(`0${RIGHT_MORE}`)}`
    : '';
  const gap = inner - displayWidth(left) - displayWidth(right);

  return right && gap >= 1 ? `${left}${' '.repeat(gap)}${right}` : clampStyledLine(left, inner);
}

function tableLines(visibleDays: UsageDailyAggregate[], inner: number, theme: FooterTheme): string[] {
  const peak = Math.max(1, ...visibleDays.map((day) => day.totalTokens));
  const columns = resolveTableColumns(visibleDays, inner);
  const showTrend = columns.some((column) => column.key === 'trend');
  const trendWidth = showTrend ? columns.find((column) => column.key === 'trend')?.width || 0 : 0;
  const lines = [
    tableHeaderLine(columns)
  ];

  for (const day of visibleDays) {
    const values = new Map<string, string>([
      ['date', formatDayLabel(day.localDay)],
      ['input', humanizeTokens(day.inputTokens)],
      ['output', humanizeTokens(day.outputTokens)],
      ['cached', humanizeTokens(day.cacheReadInputTokens)],
      ['hit', `${Math.round(day.hitRate * 100)}%`],
      ['trend', showTrend ? trendBar(day.totalTokens, peak, trendWidth, theme) : '']
    ]);
    lines.push(joinCells(columns.map((column) => renderCell(values.get(column.key) || '', column, theme))));
  }

  return lines;
}

function resolveTableColumns(days: UsageDailyAggregate[], inner: number): UsageColumn[] {
  const base: UsageColumn[] = [
    {key: 'date', label: '日期', width: 5, align: 'left', color: 'muted'},
    {key: 'input', label: '输入', width: maxTokenWidth(days, 'inputTokens', 4), align: 'right', color: 'usageInput'},
    {key: 'output', label: '输出', width: maxTokenWidth(days, 'outputTokens', 4), align: 'right', color: 'usageOutput'},
    {key: 'cached', label: '缓存', width: maxTokenWidth(days, 'cacheReadInputTokens', 4), align: 'right', color: 'usageCached'},
    {key: 'hit', label: '命中', width: Math.max(4, ...days.map((day) => displayWidth(`${Math.round(day.hitRate * 100)}%`))), align: 'right', color: 'text'}
  ];
  const baseWidth = tableWidth(base);
  const trendWidth = clamp(inner - baseWidth - 1, 6, 14);

  if (inner >= baseWidth + 1 + 6) {
    return [...base, {key: 'trend', label: '趋势', width: trendWidth, align: 'left'}];
  }

  return base;
}

function tableHeaderLine(columns: UsageColumn[]): string {
  return ansi.dim(joinCells(columns.map((column) => alignCell(column.label, column.width, column.align))));
}

function renderCell(value: string, column: UsageColumn, theme: FooterTheme): string {
  if (column.key === 'trend') {
    return padVisibleText(clampStyledLine(value, column.width), column.width);
  }

  const text = alignCell(value, column.width, column.align);

  if (!column.color) {
    return text;
  }

  return tokenText(theme, column.color, text);
}

function joinCells(cells: string[]): string {
  return cells.join(' ');
}

function tableWidth(columns: UsageColumn[]): number {
  return columns.reduce((sum, column) => sum + column.width, 0) + Math.max(0, columns.length - 1);
}

function maxTokenWidth(days: UsageDailyAggregate[], key: 'inputTokens' | 'outputTokens' | 'cacheReadInputTokens', minimum: number): number {
  return Math.max(minimum, ...days.map((day) => displayWidth(humanizeTokens(day[key]))));
}

function alignCell(value: string, width: number, align: 'left' | 'right'): string {
  const plain = clampCellText(stripAnsi(value), width);
  const pad = Math.max(0, width - displayWidth(plain));
  return align === 'right' ? `${' '.repeat(pad)}${plain}` : `${plain}${' '.repeat(pad)}`;
}

function clampCellText(text: string, width: number): string {
  if (displayWidth(text) <= width) {
    return text;
  }

  return clampPlainText(text, width + 1);
}

function trendBar(tokens: number, peak: number, width: number, theme: FooterTheme): string {
  const filled = clamp(Math.round(tokens / Math.max(1, peak) * width), tokens > 0 ? 1 : 0, width);
  return `${tokenText(theme, 'usageInput', FILL.repeat(filled))}${tokenText(theme, 'rail', TRACK.repeat(width - filled))}`;
}

function footerLine(pannable: boolean, inner: number, theme: FooterTheme): string {
  const hint = ansi.dim(pannable ? '↑/↓ 滚动 · PgUp/PgDn 翻页 · Home/End 跳转 · Enter/Esc/q 关闭' : 'Enter/Esc/q 关闭');
  return clampStyledLine(hint, inner);
}

function sumDays(days: UsageDailyAggregate[]): UsageDailyAggregate {
  const totals = days.reduce((sum, day) => ({
    localDay: '',
    inputTokens: sum.inputTokens + day.inputTokens,
    cacheReadInputTokens: sum.cacheReadInputTokens + day.cacheReadInputTokens,
    cacheCreationInputTokens: sum.cacheCreationInputTokens + day.cacheCreationInputTokens,
    uncachedInputTokens: sum.uncachedInputTokens + day.uncachedInputTokens,
    outputTokens: sum.outputTokens + day.outputTokens,
    totalTokens: sum.totalTokens + day.totalTokens,
    hitRate: 0,
    eventCount: sum.eventCount + day.eventCount
  }), {
    localDay: '',
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    uncachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hitRate: 0,
    eventCount: 0
  });

  return {
    ...totals,
    hitRate: totals.inputTokens > 0 ? totals.cacheReadInputTokens / totals.inputTokens : 0
  };
}

function topLine(width: number, title: string, theme: FooterTheme): string {
  const tag = tokenText(theme, 'usageInput', ansi.bold(` ${title} `));
  const rail = gradientLine(Math.max(0, width - 2 - displayWidth(tag)), theme);
  return `${tokenText(theme, 'frame', '╭')}${tag}${rail}${tokenText(theme, 'frame', '╮')}`;
}

function bottomLine(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'frame', '╰')}${gradientLine(width - 2, theme)}${tokenText(theme, 'frame', '╯')}`;
}

function dividerLine(width: number, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  return `${bar}${tokenText(theme, 'frame', ansi.dim('─'.repeat(Math.max(0, width - 2))))}${bar}`;
}

function rowLine(width: number, content: string, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  const contentWidth = Math.max(1, width - 4);
  return `${bar} ${padVisibleText(clampStyledLine(content, contentWidth), contentWidth)} ${bar}`;
}

function clampStyledLine(content: string, width: number): string {
  if (displayWidth(content) <= width) {
    return content;
  }

  return clampPlainText(stripAnsi(content), width + 1);
}

function gradientLine(width: number, theme: FooterTheme): string {
  return colorText(theme.colors.frame, '─'.repeat(Math.max(0, width)));
}

function resolveWindowSize(dayCount: number, viewportWidth: number, maxLines: number | undefined): number {
  if (dayCount <= 0) {
    return 0;
  }

  // 日期窗口按终端可用宽度计算，避免内容较短时卡片收缩又反过来缩小可浏览的天数。
  const widthLimit = Math.floor(Math.max(9, viewportWidth - 4) / 5);
  const heightLimit = Number.isFinite(maxLines) ? Math.max(1, Math.floor(Number(maxLines)) - 8) : 14;
  const upper = Math.max(1, Math.min(14, dayCount, heightLimit));
  return clamp(widthLimit, Math.min(3, upper), upper);
}

function formatDayLabel(day: string): string {
  return `${day.slice(5, 7)}/${day.slice(8, 10)}`;
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
  calculateUsageNavigation,
  humanizeTokens,
  renderUsageSurface
};
