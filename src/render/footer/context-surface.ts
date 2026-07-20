import * as ansi from '../../terminal/ansi';
import {displayWidth, safeRenderWidth, splitGraphemes} from '../layout';
import {colorText, tokenText, type FooterTheme} from '../colors';
import {clampPlainText, padVisibleText} from './text';

import type {ContextUsage, ContextUsageSegment, ContextUsageSegmentCategory} from '../../types/agent';
import type {ContextUsageCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const SEGMENT_LABELS: Record<ContextUsageSegmentCategory, string> = {
  system: '系统提示词',
  memory: 'Memory',
  skills: 'Skills',
  tools: '工具',
  messages: '消息',
  reasoning: '推理'
};

const FILL = '█';
const TRACK = '░';
const DOT = '●';
const ANSI_SEQUENCE_PATTERN = /^\x1b\[[0-9;?]*[A-Za-z]/;
const TOP_LEVEL_CATEGORIES: ContextUsageSegmentCategory[] = ['system', 'tools', 'messages', 'reasoning'];
const SYSTEM_PROMPT_CHILD_CATEGORIES: ContextUsageSegmentCategory[] = ['memory', 'skills'];

type ContextSurfaceProjection = {
  topLevelSegments: ContextUsageSegment[];
  systemPromptChildren: ContextUsageSegment[];
};

type ContextBreakdownRow =
  | {kind: 'topLevel'; segment: ContextUsageSegment}
  | {kind: 'systemPromptChild'; isLast: boolean; segment: ContextUsageSegment};

/**
 * 渲染 /context 详情卡片，将内部互斥 segment 投影为 system prompt 包含 memory、skills 的层级结构。
 * 在终端行数不足时优先保留 usage 总览和顶层分类，再省略 system prompt 子项。
 */
function renderContextSurface(surface: ContextUsageCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const cardWidth = Math.min(clamp(safeWidth - 2, 50, 78), Math.max(1, safeWidth - 1));
  const contentWidth = rowContentWidth(cardWidth);
  const usage = surface.usage;
  const projection = createContextSurfaceProjection(usage);
  const breakdownRows = createContextBreakdownRows(projection);
  const overviewLines = [
    topLine(cardWidth, surface.title, theme),
    rowLine(cardWidth, headerLine(usage, contentWidth, theme), theme),
    rowLine(cardWidth, windowGaugeLine(usage, contentWidth, theme), theme),
    rowLine(cardWidth, '', theme),
    rowLine(cardWidth, compositionBarLine(projection.topLevelSegments, usage.usedTokens, contentWidth, theme), theme),
    rowLine(cardWidth, '', theme)
  ];
  const renderedBreakdownRows = breakdownRows.map((row) => rowLine(cardWidth, row.kind === 'topLevel'
    ? breakdownLine(row.segment.category, row.segment.tokens, usage.usedTokens, contentWidth, theme)
    : childBreakdownLine(row.segment.category, row.segment.tokens, contentWidth, row.isLast, theme), theme));
  const fullLines = [
    ...overviewLines,
    ...renderedBreakdownRows,
    dividerLine(cardWidth, theme),
    rowLine(cardWidth, ansi.dim(clampPlainText(surface.dismissHint, contentWidth)), theme),
    bottomLine(cardWidth, theme)
  ];
  const lines = selectVisibleContextLines({
    fullLines,
    compactOverviewLines: [overviewLines[0], overviewLines[1], overviewLines[2], overviewLines[4]],
    renderedBreakdownRows,
    breakdownRows,
    divider: dividerLine(cardWidth, theme),
    dismiss: rowLine(cardWidth, ansi.dim(clampPlainText(surface.dismissHint, contentWidth)), theme),
    maxLines,
    bottom: bottomLine(cardWidth, theme)
  });

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 将校准后的互斥 segment 转为 surface 使用的层级数据；聚合值只存在于渲染投影中，不回写 usage。
 */
function createContextSurfaceProjection(usage: ContextUsage): ContextSurfaceProjection {
  const tokensByCategory = new Map<ContextUsageSegmentCategory, number>();

  for (const segment of usage.segments || []) {
    tokensByCategory.set(segment.category, (tokensByCategory.get(segment.category) || 0) + Math.max(0, segment.tokens));
  }

  const tokenCount = (category: ContextUsageSegmentCategory): number => tokensByCategory.get(category) || 0;
  const systemPromptTokens = tokenCount('system') + tokenCount('memory') + tokenCount('skills');
  const systemPromptSegment: ContextUsageSegment = {category: 'system', tokens: systemPromptTokens};
  const topLevelSegments = [
    systemPromptSegment,
    ...TOP_LEVEL_CATEGORIES.slice(1).map((category): ContextUsageSegment => ({category, tokens: tokenCount(category)}))
  ].filter((segment) => segment.tokens > 0);
  const systemPromptChildren = SYSTEM_PROMPT_CHILD_CATEGORIES
    .map((category): ContextUsageSegment => ({category, tokens: tokenCount(category)}))
    .filter((segment) => segment.tokens > 0);

  return {topLevelSegments, systemPromptChildren};
}

/**
 * 按固定语义顺序组织分类行，使 system prompt 子项紧随父项且不会作为独立顶层分类出现。
 */
function createContextBreakdownRows(projection: ContextSurfaceProjection): ContextBreakdownRow[] {
  const rows: ContextBreakdownRow[] = [];

  for (const segment of projection.topLevelSegments) {
    rows.push({kind: 'topLevel', segment});

    if (segment.category !== 'system') {
      continue;
    }

    projection.systemPromptChildren.forEach((child, index) => {
      rows.push({
        kind: 'systemPromptChild',
        segment: child,
        isLast: index === projection.systemPromptChildren.length - 1
      });
    });
  }

  return rows;
}

/**
 * 根据 footer 行预算裁剪 context card：子项最先省略，随后才减少顶层明细；极小终端保留 card 总览。
 */
function selectVisibleContextLines(options: {
  fullLines: string[];
  compactOverviewLines: string[];
  renderedBreakdownRows: string[];
  breakdownRows: ContextBreakdownRow[];
  divider: string;
  dismiss: string;
  maxLines: number | undefined;
  bottom: string;
}): string[] {
  if (!Number.isFinite(options.maxLines) || options.fullLines.length <= Number(options.maxLines)) {
    return options.fullLines;
  }

  const lineBudget = Math.max(1, Math.floor(Number(options.maxLines)));
  const coreLines = options.compactOverviewLines;

  if (lineBudget < coreLines.length + 1) {
    return coreLines.slice(0, lineBudget);
  }

  const detailBudget = lineBudget - coreLines.length - 1;
  const topLevelIndexes = options.breakdownRows
    .map((row, index) => row.kind === 'topLevel' ? index : -1)
    .filter((index) => index >= 0);
  const visibleDetailIndexes = detailBudget >= options.renderedBreakdownRows.length
    ? options.renderedBreakdownRows.map((_line, index) => index)
    : topLevelIndexes.slice(0, detailBudget);
  const detailLines = visibleDetailIndexes.map((index) => options.renderedBreakdownRows[index]);
  const trailingBudget = lineBudget - coreLines.length - detailLines.length - 1;
  const trailingLines = trailingBudget >= 2
    ? [options.divider, options.dismiss]
    : trailingBudget === 1 ? [options.dismiss] : [];

  return [...coreLines, ...detailLines, ...trailingLines, options.bottom];
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

/**
 * 渲染 system prompt 的子项明细；子项只标示自身 token，避免与父项全局占比产生可相加的错觉。
 */
function childBreakdownLine(category: ContextUsageSegmentCategory, tokens: number, inner: number, isLast: boolean, theme: FooterTheme): string {
  const color = segmentColor(category, theme);
  const branch = ansi.dim(`  ${isLast ? '└─' : '├─'} `);
  const swatch = colorText(color, DOT);
  const name = tokenText(theme, 'text', SEGMENT_LABELS[category]);
  const stat = colorText(color, humanizeTokens(tokens));
  const gap = Math.max(1, inner - displayWidth(branch) - 2 - displayWidth(name) - displayWidth(stat));

  return `${branch}${swatch} ${name}${' '.repeat(gap)}${stat}`;
}

function topLine(width: number, title: string, theme: FooterTheme): string {
  const inner = Math.max(0, width - 2);
  const titleText = title && inner > 2 ? clampPlainText(title, inner - 2) : '';
  const tag = titleText ? tokenText(theme, 'accentStrong', ansi.bold(` ${titleText} `)) : '';
  const rail = frameLine(Math.max(0, inner - displayWidth(tag)), theme);
  return `${tokenText(theme, 'frame', '╭')}${tag}${rail}${tokenText(theme, 'frame', '╮')}`;
}

function bottomLine(width: number, theme: FooterTheme): string {
  return `${tokenText(theme, 'frame', '╰')}${frameLine(Math.max(0, width - 2), theme)}${tokenText(theme, 'frame', '╯')}`;
}

function dividerLine(width: number, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  return `${bar}${tokenText(theme, 'frame', ansi.dim('─'.repeat(Math.max(0, width - 2))))}${bar}`;
}

function rowLine(width: number, content: string, theme: FooterTheme): string {
  const bar = tokenText(theme, 'frame', '│');
  const contentWidth = rowContentWidth(width);
  return `${bar} ${padVisibleText(clampStyledText(content, contentWidth), contentWidth)} ${bar}`;
}

function rowContentWidth(width: number): number {
  return Math.max(1, width - 4);
}

/**
 * 对已带 ANSI 样式的单行内容做宽度兜底，避免截断控制序列导致颜色和列宽外溢。
 */
function clampStyledText(text: string, width: number): string {
  const safeWidth = Math.max(1, width);

  if (displayWidth(text) <= safeWidth) {
    return text;
  }

  const ellipsis = '…';
  const contentWidth = Math.max(0, safeWidth - displayWidth(ellipsis));
  let result = '';
  let column = 0;
  let index = 0;

  while (index < text.length) {
    const sequence = matchAnsiSequence(text, index);

    if (sequence) {
      result += sequence;
      index += sequence.length;
      continue;
    }

    const char = splitGraphemes(text.slice(index))[0] || '';
    const nextColumn = column + displayWidth(char);

    if (nextColumn > contentWidth) {
      return `${result}${ellipsis}${ansi.reset()}`;
    }

    result += char;
    column = nextColumn;
    index += char.length;
  }

  return result;
}

function matchAnsiSequence(text: string, index: number): string | null {
  const match = text.slice(index).match(ANSI_SEQUENCE_PATTERN);
  return match ? match[0] : null;
}

function frameLine(width: number, theme: FooterTheme): string {
  return tokenText(theme, 'frame', '─'.repeat(Math.max(0, width)));
}

function segmentColor(category: ContextUsageSegmentCategory, theme: FooterTheme) {
  if (category === 'system') {
    return theme.colors.accent;
  }

  if (category === 'memory') {
    return theme.colors.warning;
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
