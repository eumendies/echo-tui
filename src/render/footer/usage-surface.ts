import * as ansi from '../../terminal/ansi';
import {colorText, tokenText, type FooterTheme} from '../colors';
import {displayWidth, safeRenderWidth, stripAnsi} from '../layout';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail} from './window';

import type {UsageCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';
import type {UsageDailyAggregate, UsageModelAggregate} from '../../types/usage';

const FILL = '█';
const TRACK = '░';
const DOT = '●';
const LEFT_MORE = '◂';
const RIGHT_MORE = '▸';
const MIN_CARD_WIDTH = 54;
const MAX_CARD_WIDTH = 112;

type UsageColumn = {
  align: 'left' | 'right';
  color?: 'usageInput' | 'usageOutput' | 'usageCached' | 'text' | 'muted';
  key: string;
  label: string;
  width: number;
};

type UsageListLayout<T> = {
  cardWidth: number; // 当前内容与终端宽度共同决定的卡片总宽度。
  inner: number; // 去除边框与左右留白后的可渲染内容宽度。
  maxOffset: number; // 当前可滚动列表允许的最大起始索引。
  offset: number; // 已钳制到当前列表边界内的可见窗口起始索引。
  visibleEntries: T[]; // 由 offset 和窗口大小裁出的当前可见聚合项。
};

/**
 * 渲染 `/usage` token 用量面板；根据视图投影可选择的日期列表或当日模型明细，且不修改滚动状态。
 */
function renderUsageSurface(surface: UsageCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  return surface.view === 'dayModels'
    ? renderModelUsageSurface(surface, width, maxLines, theme)
    : renderDailyUsageSurface(surface, width, maxLines, theme);
}

/**
 * 投影带选择状态的按日列表，供用户进入选中日期的模型用量明细。
 */
function renderDailyUsageSurface(surface: UsageCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const days = surface.dailyUsage;
  const layout = resolveUsageListLayout(days, surface.offset, safeWidth, maxLines, surface.title, (visibleDays, offset, pannable, title) => (
    preferredUsageInner(days, visibleDays, offset, pannable, title)
  ));
  const {cardWidth, inner, maxOffset, offset, visibleEntries: visibleDays} = layout;
  const lines = [
    topLine(cardWidth, surface.title, theme),
    rowLine(cardWidth, headerLineForTotals(sumTokenEntries(days), inner, theme), theme),
    rowLine(cardWidth, renderWindowSpanLine(days.length, visibleDays.length, offset, formatVisibleDayRange(visibleDays), inner, theme), theme),
    dividerLine(cardWidth, theme)
  ];

  if (visibleDays.length === 0) {
    lines.push(rowLine(cardWidth, ansi.dim('暂无用量记录'), theme));
  } else {
    for (const line of tableLines(visibleDays, offset, surface.selectedIndex, inner, theme)) {
      lines.push(rowLine(cardWidth, line, theme));
    }
  }

  lines.push(dividerLine(cardWidth, theme));
  lines.push(rowLine(cardWidth, dailyFooterLine(surface, maxOffset > 0, inner), theme));
  lines.push(bottomLine(cardWidth, theme));

  return constrainLayoutTail({
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  }, maxLines);
}

/**
 * 用相同的宽度收敛规则计算日期或模型列表布局；调用方提供各自的内容宽度估算，避免两种视图漂移。
 */
function resolveUsageListLayout<T>(
  entries: T[],
  requestedOffset: number,
  safeWidth: number,
  maxLines: number | undefined,
  title: string,
  preferredInnerForWindow: (visibleEntries: T[], offset: number, pannable: boolean, title: string) => number
): UsageListLayout<T> {
  const maxCardWidth = Math.min(clamp(safeWidth - 2, MIN_CARD_WIDTH, MAX_CARD_WIDTH), Math.max(1, safeWidth - 1));
  let cardWidth = maxCardWidth;
  let inner = Math.max(1, cardWidth - 4);
  let maxOffset = 0;
  let offset = 0;
  let visibleEntries: T[] = [];

  for (let index = 0; index < 2; index += 1) {
    const windowSize = resolveWindowSize(entries.length, safeWidth, maxLines);
    maxOffset = Math.max(0, entries.length - windowSize);
    offset = clamp(requestedOffset, 0, maxOffset);
    visibleEntries = entries.slice(offset, offset + windowSize);
    const preferredInner = preferredInnerForWindow(visibleEntries, offset, maxOffset > 0, title);
    const nextCardWidth = Math.min(maxCardWidth, Math.max(Math.min(MIN_CARD_WIDTH, maxCardWidth), preferredInner + 4));

    if (nextCardWidth === cardWidth) {
      break;
    }

    cardWidth = nextCardWidth;
    inner = Math.max(1, cardWidth - 4);
  }

  return {cardWidth, inner, maxOffset, offset, visibleEntries};
}

/**
 * 按当前终端视口计算日期选择或当日模型窗口的滚动边界和页大小，供 command handler 与渲染层共享。
 */
function calculateUsageNavigation(surface: UsageCommandSurface, width: number, maxLines: number | undefined): {maxOffset: number; windowSize: number} {
  if (surface.view === 'dayModels') {
    const models = surface.modelUsage;
    const layout = resolveUsageListLayout(models, surface.offset, safeRenderWidth(width), maxLines, surface.title, (visibleModels, offset, pannable, title) => (
      preferredModelUsageInner(models, visibleModels, offset, pannable, title)
    ));
    return {maxOffset: layout.maxOffset, windowSize: layout.visibleEntries.length};
  }

  const days = surface.dailyUsage;
  const layout = resolveUsageListLayout(days, surface.offset, safeRenderWidth(width), maxLines, surface.title, (visibleDays, offset, pannable, title) => (
    preferredUsageInner(days, visibleDays, offset, pannable, title)
  ));
  return {maxOffset: layout.maxOffset, windowSize: layout.visibleEntries.length};
}

/**
 * 渲染选中日期内按 provider/模型组合汇总的列表，并在有限行数内保留当前窗口。
 */
function renderModelUsageSurface(surface: UsageCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const models = surface.modelUsage;
  const layout = resolveUsageListLayout(models, surface.offset, safeWidth, maxLines, surface.title, (visibleModels, offset, pannable, title) => (
    preferredModelUsageInner(models, visibleModels, offset, pannable, title)
  ));
  const {cardWidth, inner, maxOffset, offset, visibleEntries: visibleModels} = layout;
  const totals = sumTokenEntries(models);
  const lines = [
    topLine(cardWidth, surface.title, theme),
    rowLine(cardWidth, headerLineForTotals(totals, inner, theme), theme),
    rowLine(cardWidth, renderWindowSpanLine(models.length, visibleModels.length, offset, '按总 token', inner, theme), theme),
    dividerLine(cardWidth, theme)
  ];

  if (visibleModels.length === 0) {
    lines.push(rowLine(cardWidth, ansi.dim('暂无模型用量记录'), theme));
  } else {
    for (const line of modelTableLines(visibleModels, inner, theme)) {
      lines.push(rowLine(cardWidth, line, theme));
    }
  }

  lines.push(dividerLine(cardWidth, theme));
  lines.push(rowLine(cardWidth, modelFooterLine(surface, maxOffset > 0, inner), theme));
  lines.push(bottomLine(cardWidth, theme));

  return constrainLayoutTail({
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  }, maxLines);
}

/**
 * 估算模型总览完整信息在宽终端中的理想内宽，窄终端由列投影负责裁剪。
 */
function preferredModelUsageInner(models: UsageModelAggregate[], visibleModels: UsageModelAggregate[], offset: number, pannable: boolean, title: string): number {
  const table = visibleModels.length > 0 ? tableWidth(resolveModelTableColumns(visibleModels, MAX_CARD_WIDTH - 4)) : displayWidth('暂无模型用量记录');
  return Math.max(
    displayWidth(title) + 6,
    preferredHeaderWidthFromTotals(sumTokenEntries(models)),
    preferredWindowSpanWidth(models.length, visibleModels.length, offset, '按总 token'),
    table,
    displayWidth(pannable ? '↑/↓ 滚动 · PgUp/PgDn 翻页 · Home/End 跳转 · Esc/Backspace 返回日期 · q 关闭' : 'Esc/Backspace 返回日期 · q 关闭')
  );
}

/**
 * 估算按日列表在当前日期窗口与键位提示下的理想内宽。
 */
function preferredUsageInner(days: UsageDailyAggregate[], visibleDays: UsageDailyAggregate[], offset: number, pannable: boolean, title: string): number {
  const table = visibleDays.length > 0 ? tableWidth(resolveTableColumns(visibleDays, MAX_CARD_WIDTH - 4)) : displayWidth('暂无用量记录');
  return Math.max(
    displayWidth(title) + 6,
    preferredHeaderWidthFromTotals(sumTokenEntries(days)),
    preferredWindowSpanWidth(days.length, visibleDays.length, offset, formatVisibleDayRange(visibleDays)),
    table,
    displayWidth(pannable ? '↑/↓ 选择 · PgUp/PgDn 翻页 · Home/End 跳转 · Enter 查看模型 · Esc/q 关闭' : '↑/↓ 选择 · Enter 查看模型 · Esc/q 关闭')
  );
}

/**
 * 根据已聚合的 token 总计估算共用统计头所需宽度。
 */
function preferredHeaderWidthFromTotals(totals: UsageDailyAggregate): number {
  const left = `↑ ${humanizeTokens(totals.inputTokens)}   ↓ ${humanizeTokens(totals.outputTokens)}   ${DOT} ${humanizeTokens(totals.cacheReadInputTokens)} · ${(totals.hitRate * 100).toFixed(0)}% 缓存命中`;
  const right = `${humanizeTokens(totals.totalTokens)} 合计`;
  return displayWidth(left) + 2 + displayWidth(right);
}

/**
 * 将任意按日或按模型汇总投影为带主题色的累计 token 头部行。
 */
function headerLineForTotals(totals: UsageDailyAggregate, inner: number, theme: FooterTheme): string {
  const input = `${tokenText(theme, 'usageInput', '↑')} ${tokenText(theme, 'text', ansi.bold(humanizeTokens(totals.inputTokens)))}`;
  const output = `${tokenText(theme, 'usageOutput', '↓')} ${tokenText(theme, 'text', ansi.bold(humanizeTokens(totals.outputTokens)))}`;
  const cached = `${tokenText(theme, 'usageCached', DOT)} ${tokenText(theme, 'text', humanizeTokens(totals.cacheReadInputTokens))} ${ansi.dim(`· ${(totals.hitRate * 100).toFixed(0)}% 缓存命中`)}`;
  const left = `${input}   ${output}   ${cached}`;
  const right = `${tokenText(theme, 'usageInput', ansi.bold(humanizeTokens(totals.totalTokens)))} ${ansi.dim('合计')}`;
  const gap = inner - displayWidth(left) - displayWidth(right);

  return gap >= 2 ? `${left}${' '.repeat(gap)}${right}` : clampStyledLine(left, inner);
}

/**
 * 估算日期或模型窗口范围文本的内宽；无可见项时保留统一的空数据提示。
 */
function preferredWindowSpanWidth(totalCount: number, visibleCount: number, offset: number, detail: string): number {
  if (visibleCount === 0) {
    return displayWidth('暂无数据');
  }

  const left = formatWindowSpanLabel(visibleCount, totalCount, detail);
  const {hiddenLeft, hiddenRight} = resolveWindowHidden(totalCount, visibleCount, offset);
  const right = hiddenLeft > 0 || hiddenRight > 0 ? `${LEFT_MORE}${hiddenLeft} ${hiddenRight}${RIGHT_MORE}` : '';
  return displayWidth(left) + (right ? 1 + displayWidth(right) : 0);
}

/**
 * 渲染日期或模型列表的可见范围及两端隐藏项数量，保持两种视图的滚动提示一致。
 */
function renderWindowSpanLine(totalCount: number, visibleCount: number, offset: number, detail: string, inner: number, theme: FooterTheme): string {
  if (visibleCount === 0) {
    return ansi.dim('暂无数据');
  }

  const left = ansi.dim(formatWindowSpanLabel(visibleCount, totalCount, detail));
  const {hiddenLeft, hiddenRight} = resolveWindowHidden(totalCount, visibleCount, offset);
  const right = hiddenLeft > 0 || hiddenRight > 0
    ? `${hiddenLeft > 0 ? tokenText(theme, 'accentStrong', `${LEFT_MORE}${hiddenLeft}`) : ansi.dim(`${LEFT_MORE}0`)} ${hiddenRight > 0 ? tokenText(theme, 'accentStrong', `${hiddenRight}${RIGHT_MORE}`) : ansi.dim(`0${RIGHT_MORE}`)}`
    : '';
  const gap = inner - displayWidth(left) - displayWidth(right);

  return right && gap >= 1 ? `${left}${' '.repeat(gap)}${right}` : clampStyledLine(left, inner);
}

/**
 * 生成日期或模型窗口共同使用的左侧范围标签。
 */
function formatWindowSpanLabel(visibleCount: number, totalCount: number, detail: string): string {
  return `显示 ${visibleCount}/${totalCount} · ${detail}`;
}

/**
 * 计算当前窗口左右两侧被隐藏的聚合项数量。
 */
function resolveWindowHidden(totalCount: number, visibleCount: number, offset: number): {hiddenLeft: number; hiddenRight: number} {
  return {
    hiddenLeft: offset,
    hiddenRight: Math.max(0, totalCount - offset - visibleCount)
  };
}

/**
 * 把当前可见日期投影为范围文案，供日期窗口的宽度估算和实际渲染共享。
 */
function formatVisibleDayRange(visibleDays: UsageDailyAggregate[]): string {
  if (visibleDays.length === 0) {
    return '暂无数据';
  }

  const first = formatDayLabel(visibleDays[0].localDay);
  const last = formatDayLabel(visibleDays[visibleDays.length - 1].localDay);
  return first === last ? first : `${first} - ${last}`;
}

function tableLines(visibleDays: UsageDailyAggregate[], offset: number, selectedIndex: number, inner: number, theme: FooterTheme): string[] {
  const peak = Math.max(1, ...visibleDays.map((day) => day.totalTokens));
  const columns = resolveTableColumns(visibleDays, inner);
  const showTrend = columns.some((column) => column.key === 'trend');
  const trendWidth = showTrend ? columns.find((column) => column.key === 'trend')?.width || 0 : 0;
  const lines = [
    tableHeaderLine(columns)
  ];

  for (const [index, day] of visibleDays.entries()) {
    const values = new Map<string, string>([
      ['date', `${offset + index === selectedIndex ? '›' : ' '} ${formatDayLabel(day.localDay)}`],
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

/**
 * 把选中日期内的可见模型聚合项渲染为表头和数据行。
 */
function modelTableLines(visibleModels: UsageModelAggregate[], inner: number, theme: FooterTheme): string[] {
  const peak = Math.max(1, ...visibleModels.map((model) => model.totalTokens));
  const columns = resolveModelTableColumns(visibleModels, inner);
  const showTrend = columns.some((column) => column.key === 'trend');
  const trendWidth = showTrend ? columns.find((column) => column.key === 'trend')?.width || 0 : 0;
  const lines = [tableHeaderLine(columns)];

  for (const model of visibleModels) {
    const values = new Map<string, string>([
      ['model', formatModelLabel(model)],
      ['input', humanizeTokens(model.inputTokens)],
      ['output', humanizeTokens(model.outputTokens)],
      ['cached', humanizeTokens(model.cacheReadInputTokens)],
      ['hit', `${Math.round(model.hitRate * 100)}%`],
      ['total', humanizeTokens(model.totalTokens)],
      ['events', humanizeTokens(model.eventCount)],
      ['share', `${Math.round(model.share * 100)}%`],
      ['trend', showTrend ? trendBar(model.totalTokens, peak, trendWidth, theme) : '']
    ]);
    lines.push(joinCells(columns.map((column) => renderCell(values.get(column.key) || '', column, theme))));
  }

  return lines;
}

function resolveTableColumns(days: UsageDailyAggregate[], inner: number): UsageColumn[] {
  const base: UsageColumn[] = [
    {key: 'date', label: '日期', width: 7, align: 'left', color: 'muted'},
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

/**
 * 按终端内宽逐级投影模型列；宽终端会按实际身份标签扩展模型列，最高使用 112 列卡片上限。
 */
function resolveModelTableColumns(models: UsageModelAggregate[], inner: number): UsageColumn[] {
  const input: UsageColumn = {key: 'input', label: '输入', width: maxTokenWidth(models, 'inputTokens', 4), align: 'right', color: 'usageInput'};
  const output: UsageColumn = {key: 'output', label: '输出', width: maxTokenWidth(models, 'outputTokens', 4), align: 'right', color: 'usageOutput'};
  const total: UsageColumn = {key: 'total', label: '合计', width: maxTokenWidth(models, 'totalTokens', 4), align: 'right', color: 'text'};
  const columns: UsageColumn[] = [input, output, total];

  if (inner >= 50) {
    columns.splice(2, 0,
      {key: 'cached', label: '缓存', width: maxTokenWidth(models, 'cacheReadInputTokens', 4), align: 'right', color: 'usageCached'},
      {key: 'hit', label: '命中', width: Math.max(4, ...models.map((model) => displayWidth(`${Math.round(model.hitRate * 100)}%`))), align: 'right', color: 'text'}
    );
  }

  if (inner >= 62) {
    columns.push(
      {key: 'events', label: '调用', width: Math.max(4, ...models.map((model) => displayWidth(humanizeTokens(model.eventCount)))), align: 'right', color: 'muted'},
      {key: 'share', label: '占比', width: Math.max(4, ...models.map((model) => displayWidth(`${Math.round(model.share * 100)}%`))), align: 'right', color: 'text'}
    );
  }

  if (inner >= 68) {
    columns.push({key: 'trend', label: '趋势', width: 6, align: 'left'});
  }

  const fixedWidth = tableWidth(columns) + 1;
  const widestModelLabel = Math.max(28, ...models.map((model) => displayWidth(formatModelLabel(model))));
  const modelWidth = clamp(widestModelLabel, 8, inner - fixedWidth);
  return [{key: 'model', label: '模型', width: modelWidth, align: 'left', color: 'text'}, ...columns];
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

/**
 * 从按日或按模型聚合项中取 token 数显示宽度，保证数值列在同一表内右对齐。
 */
function maxTokenWidth(entries: Array<UsageDailyAggregate | UsageModelAggregate>, key: 'inputTokens' | 'outputTokens' | 'cacheReadInputTokens' | 'totalTokens', minimum: number): number {
  return Math.max(minimum, ...entries.map((entry) => displayWidth(humanizeTokens(entry[key]))));
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

/**
 * 按日视图根据窗口是否可滚动拼接当前视图的键位提示，并裁剪到 footer 内宽。
 */
function dailyFooterLine(surface: UsageCommandSurface, pannable: boolean, inner: number): string {
  const navigation = pannable
    ? '↑/↓ 选择 · PgUp/PgDn 翻页 · Home/End 跳转 · '
    : '↑/↓ 选择 · ';
  const hint = ansi.dim(`${navigation}${surface.dismissHint}`);
  return clampStyledLine(hint, inner);
}

/**
 * 渲染当日模型明细的滚动、返回和关闭提示；过窄时由调用方统一裁剪。
 */
function modelFooterLine(surface: UsageCommandSurface, pannable: boolean, inner: number): string {
  const navigation = pannable ? '↑/↓ 滚动 · PgUp/PgDn 翻页 · Home/End 跳转 · ' : '';
  return clampStyledLine(ansi.dim(`${navigation}${surface.dismissHint}`), inner);
}

/**
 * 汇总按日或按模型聚合项的共同 token 字段，以复用统计头投影；localDay 为空表示非日期实体。
 */
function sumTokenEntries(entries: Array<UsageDailyAggregate | UsageModelAggregate>): UsageDailyAggregate {
  const totals = entries.reduce<UsageDailyAggregate>((sum, entry) => ({
    localDay: '',
    inputTokens: sum.inputTokens + entry.inputTokens,
    cacheReadInputTokens: sum.cacheReadInputTokens + entry.cacheReadInputTokens,
    cacheCreationInputTokens: sum.cacheCreationInputTokens + entry.cacheCreationInputTokens,
    uncachedInputTokens: sum.uncachedInputTokens + entry.uncachedInputTokens,
    outputTokens: sum.outputTokens + entry.outputTokens,
    totalTokens: sum.totalTokens + entry.totalTokens,
    hitRate: 0,
    eventCount: sum.eventCount + entry.eventCount
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

/**
 * 为模型行构造 provider 配置 ID 与原始模型标识均可见的短标签，避免跨配置歧义。
 */
function formatModelLabel(model: UsageModelAggregate): string {
  return `${model.providerId}/${model.model}`;
}

/**
 * 渲染卡片上边框并在模型名称很长时截断标题，避免标题穿透终端安全宽度。
 */
function topLine(width: number, title: string, theme: FooterTheme): string {
  const titleWidth = Math.max(1, width - 2);
  const tag = tokenText(theme, 'usageInput', ansi.bold(clampPlainText(` ${title} `, titleWidth + 1)));
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
