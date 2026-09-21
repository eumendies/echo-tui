import * as ansi from '../../terminal/ansi';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {displayWidth, safeRenderWidth} from '../layout';
import {tokenText, type FooterTheme} from '../colors';
import {renderMarkdownLinesWithOptions} from '../markdown';
import {renderStyledLine} from '../markdown/styled-line';
import {clampPlainText, padVisibleText} from './text';
import {constrainLayoutTail} from './window';

import type {CommandCodexUsageWindow, CommandDeepseekBalanceInfo, CommandOpencodeUsageWindow, CommandStatusSandboxState, StatusCommandPage, StatusCommandSurface} from '../../types/command';
import type {FooterLayout} from '../../types/render';

const FILL = '█';
const TRACK = '░';
const OVERVIEW_LABEL_DEFAULT_WIDTH = 12;
const OVERVIEW_LABEL_GAP_WIDTH = 2;
const OVERVIEW_VALUE_MIN_WIDTH = 10;

type DetailLayoutFrame = {
  footerLines: string[]; // 正文之后固定保留的分隔、操作提示和底部边框。
  headerLines: string[]; // 正文之前固定保留的标题、页签和按高度降级后的元信息。
};

type DetailProjection = {
  bodyHeight: number; // 当前行预算下正文窗口可显示的视觉行数。
  bodyLines: string[]; // 已按卡片宽度投影完成的完整正文视觉行。
  cardWidth: number; // 包含边框的 status 卡片可见宽度。
  footerLines: string[]; // 正文窗口后的固定卡片行。
  headerLines: string[]; // 正文窗口前的固定卡片行。
  showPosition: boolean; // 是否有空间显示正文当前位置提示。
};

/**
 * 渲染 `/status` 只读卡片；概览保留运行和账户状态，两个详情页以视觉行窗口展示 session 快照。
 */
function renderStatusSurface(surface: StatusCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme, tuiTheme: TuiTheme = DEFAULT_TUI_THEME): FooterLayout {
  const page = surface.page;
  if (page === 'compaction' || page === 'todos') {
    return renderDetailPage(surface, page, width, maxLines, theme, tuiTheme);
  }

  return renderOverviewPage(surface, width, maxLines, theme);
}

/**
 * 计算当前详情页正文的有效滚动范围，供 command handler 在输入时与 renderer 使用同一行数口径。
 */
function calculateStatusNavigation(surface: StatusCommandSurface, width: number, maxLines: number | undefined): {maxScroll: number; windowSize: number} {
  const page = surface.page;
  if (page === 'overview') {
    return {maxScroll: 0, windowSize: 1};
  }

  const {bodyLines, bodyHeight} = createDetailProjection(surface, page, width, maxLines, DEFAULT_TUI_THEME.footer, DEFAULT_TUI_THEME);
  return {
    maxScroll: Math.max(0, bodyLines.length - bodyHeight),
    windowSize: Math.max(1, bodyHeight)
  };
}

/**
 * 渲染概览页，继续展示现有运行状态与账户用量，并将长会话状态收敛为两条摘要。
 */
function renderOverviewPage(surface: StatusCommandSurface, width: number, maxLines: number | undefined, theme: FooterTheme): FooterLayout {
  const safeWidth = safeRenderWidth(width);
  const cardWidth = Math.min(82, Math.max(1, safeWidth - 1));
  const inner = Math.max(1, cardWidth - 4);
  const snapshot = surface.snapshot;
  const model = snapshot.model;
  const instructionLabels = snapshot.agentInstructions.map((source) => `${source.sourceKind}:${source.label}`);
  const catalogLabels = snapshot.agentMemoryCatalogs.map((catalog) => `${catalog.scope}:${catalog.name}`);
  const labelWidth = calculateOverviewLabelWidth(inner);
  const lines = [
    topLine(cardWidth, surface.title, theme),
    tabsLine(cardWidth, 'overview', snapshot, theme),
    dividerLine(cardWidth, theme),
    overviewKeyValueRow(cardWidth, labelWidth, '目录', snapshot.cwd, theme),
    overviewKeyValueRow(cardWidth, labelWidth, '模型', model?.model || '不可用', theme),
    overviewKeyValueRow(cardWidth, labelWidth, 'Provider', model ? `${model.provider} (${model.agentType})` : '不可用', theme),
    overviewKeyValueRow(cardWidth, labelWidth, 'Session', snapshot.sessionId || '未创建', theme),
    overviewKeyValueRow(cardWidth, labelWidth, 'Instructions', `${snapshot.agentInstructionFileName} · ${instructionLabels.length > 0 ? instructionLabels.join(', ') : '无'}`, theme),
    overviewKeyValueRow(cardWidth, labelWidth, 'Memory', `user:${snapshot.userMemoryCount} · catalogs:${catalogLabels.length > 0 ? catalogLabels.join(', ') : '无'}`, theme),
    overviewKeyValueRow(cardWidth, labelWidth, '沙箱', formatSandboxState(snapshot.sandbox), theme, snapshot.sandbox.available || snapshot.sandbox.mode === 'off' ? 'text' : 'warning'),
    overviewKeyValueRow(cardWidth, labelWidth, '压缩摘要', formatCompactionSummary(snapshot.compaction), theme, snapshot.compaction ? 'accent' : 'muted'),
    overviewKeyValueRow(cardWidth, labelWidth, 'Todo', formatTodoSummary(snapshot.todoState), theme, snapshot.todoState.items.length > 0 ? 'text' : 'muted')
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

  if (surface.deepseekBalance.status !== 'not_applicable') {
    lines.push(dividerLine(cardWidth, theme));
    lines.push(plainRow(cardWidth, 'DeepSeek 账户余额', theme, 'accentStrong', true));

    if (surface.deepseekBalance.status === 'available') {
      if (surface.deepseekBalance.balanceInfos.length === 0) {
        lines.push(plainRow(cardWidth, '暂无余额数据', theme, 'muted'));
      } else {
        for (const info of surface.deepseekBalance.balanceInfos) {
          lines.push(plainRow(cardWidth, balanceRowText(info), theme));
        }
      }

      if (!surface.deepseekBalance.isAvailable) {
        lines.push(plainRow(cardWidth, '账户不可用，请检查余额或充值', theme, 'warning'));
      }
    } else if (surface.deepseekBalance.status === 'loading') {
      lines.push(plainRow(cardWidth, '正在查询…', theme, 'accent'));
    } else {
      lines.push(plainRow(cardWidth, `不可用  ${surface.deepseekBalance.error}`, theme, 'warning'));
    }
  }

  if (surface.opencodeUsage.status !== 'not_applicable') {
    lines.push(dividerLine(cardWidth, theme));
    lines.push(plainRow(cardWidth, 'OpenCode Go 用量', theme, 'accentStrong', true));

    if (surface.opencodeUsage.status === 'available') {
      if (surface.opencodeUsage.windows.length === 0) {
        lines.push(plainRow(cardWidth, '暂无窗口数据', theme, 'muted'));
      } else {
        for (const window of surface.opencodeUsage.windows) {
          lines.push(...opencodeWindowLines(window, cardWidth, inner, theme));
        }
      }
    } else if (surface.opencodeUsage.status === 'loading') {
      lines.push(plainRow(cardWidth, '正在查询…', theme, 'accent'));
    } else {
      lines.push(plainRow(cardWidth, `不可用  ${surface.opencodeUsage.error}`, theme, 'warning'));
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

/**
 * 把概览运行信息投影为统一的单行 key/value 格式；标签以可见宽度补齐，value 保持既有裁剪与主题语义。
 */
function overviewKeyValueRow(cardWidth: number, labelWidth: number, label: string, value: string, theme: FooterTheme, token: keyof FooterTheme['colors'] = 'text'): string {
  const visibleLabel = clampPlainText(label, labelWidth + 1);
  const content = `${padVisibleText(visibleLabel, labelWidth)}${' '.repeat(OVERVIEW_LABEL_GAP_WIDTH)}${value}`;
  return plainRow(cardWidth, content, theme, token);
}

/**
 * 根据概览卡片内容宽度给标签列分配空间；正常宽度保持 12 列，窄终端优先为 value 留出最小阅读预算。
 */
function calculateOverviewLabelWidth(contentWidth: number): number {
  return Math.max(1, Math.min(
    OVERVIEW_LABEL_DEFAULT_WIDTH,
    contentWidth - OVERVIEW_LABEL_GAP_WIDTH - OVERVIEW_VALUE_MIN_WIDTH
  ));
}

/**
 * 渲染压缩摘要或 Todo 详情页：页签和元信息固定，正文按视觉行偏移窗口化。
 */
function renderDetailPage(surface: StatusCommandSurface, page: Exclude<StatusCommandPage, 'overview'>, width: number, maxLines: number | undefined, theme: FooterTheme, tuiTheme: TuiTheme): FooterLayout {
  const projection = createDetailProjection(surface, page, width, maxLines, theme, tuiTheme);
  const maxScroll = Math.max(0, projection.bodyLines.length - projection.bodyHeight);
  const requestedScroll = page === 'compaction' ? surface.compactionScroll : surface.todoScroll;
  const scroll = clampScroll(requestedScroll, maxScroll);
  const visibleBody = projection.bodyLines.slice(scroll, scroll + projection.bodyHeight);
  const position = formatScrollPosition(scroll, visibleBody.length, projection.bodyLines.length);
  const lines = [
    ...projection.headerLines,
    ...visibleBody,
    ...(projection.showPosition ? [plainRow(projection.cardWidth, position, theme, 'muted')] : []),
    ...projection.footerLines
  ];

  return {
    lines,
    cursorRow: lines.length - 1,
    cursorColumn: 0,
    showCursor: false
  };
}

/**
 * 构造详情页共享的几何、固定框架与正文视觉行；正文窗口与位置提示共用同一高度预算。
 */
function createDetailProjection(surface: StatusCommandSurface, page: Exclude<StatusCommandPage, 'overview'>, width: number, maxLines: number | undefined, theme: FooterTheme, tuiTheme: TuiTheme): DetailProjection {
  const safeWidth = safeRenderWidth(width);
  const cardWidth = Math.min(82, Math.max(1, safeWidth - 1));
  const contentWidth = Math.max(1, cardWidth - 4);
  const snapshot = surface.snapshot;
  const fullMetaLines = page === 'compaction'
    ? createCompactionMetaLines(snapshot, cardWidth, theme)
    : createTodoMetaLines(snapshot, cardWidth, theme);
  const compactMetaLines = page === 'compaction'
    ? createCompactCompactionMetaLines(snapshot, cardWidth, theme)
    : createCompactTodoMetaLines(snapshot, cardWidth, theme);
  const bodyLines = page === 'compaction'
    ? createCompactionBodyLines(snapshot, contentWidth, cardWidth, theme, tuiTheme)
    : createTodoBodyLines(snapshot, contentWidth, cardWidth, theme, tuiTheme);
  const frame = createDetailLayoutFrame(surface, page, maxLines, theme, fullMetaLines, compactMetaLines, cardWidth);
  const bodyCapacity = calculateDetailBodyHeight(maxLines, frame.headerLines.length + frame.footerLines.length, bodyLines.length);
  const showPosition = bodyLines.length > bodyCapacity && bodyCapacity > 1;
  const bodyHeight = calculateDetailBodyHeight(maxLines, frame.headerLines.length + frame.footerLines.length + (showPosition ? 1 : 0), bodyLines.length);

  return {
    cardWidth,
    headerLines: frame.headerLines,
    footerLines: frame.footerLines,
    bodyLines,
    bodyHeight,
    showPosition
  };
}

/**
 * 按有限高度生成详情页固定框架；空间不足时优先压缩元信息和分隔线，绝不从头部裁掉页签。
 */
function createDetailLayoutFrame(surface: StatusCommandSurface, page: Exclude<StatusCommandPage, 'overview'>, maxLines: number | undefined, theme: FooterTheme, fullMetaLines: string[], compactMetaLines: string[], cardWidth: number): DetailLayoutFrame {
  const limit = normalizeDetailLineLimit(maxLines);
  const top = topLine(cardWidth, surface.title, theme);
  const tabs = tabsLine(cardWidth, page, surface.snapshot, theme);
  const divider = dividerLine(cardWidth, theme);
  const dismiss = plainRow(cardWidth, surface.dismissHint, theme, 'muted');
  const bottom = bottomLine(cardWidth, theme);

  if (limit === null || limit >= fullMetaLines.length + 8) {
    return {
      headerLines: [top, tabs, divider, ...fullMetaLines, divider],
      footerLines: [divider, dismiss, bottom]
    };
  }

  if (limit >= 9) {
    return {
      headerLines: [top, tabs, divider, ...compactMetaLines, divider],
      footerLines: [divider, dismiss, bottom]
    };
  }

  if (limit >= 7) {
    return {
      headerLines: [top, tabs, divider, ...compactMetaLines],
      footerLines: [dismiss, bottom]
    };
  }

  if (limit >= 6) {
    return {
      headerLines: [top, tabs, ...compactMetaLines],
      footerLines: [dismiss, bottom]
    };
  }

  if (limit >= 5) {
    return {
      headerLines: [tabs, ...compactMetaLines],
      footerLines: [dismiss, bottom]
    };
  }

  if (limit >= 4) {
    return {
      headerLines: [tabs],
      footerLines: [dismiss, bottom]
    };
  }

  if (limit >= 3) {
    return {
      headerLines: [tabs],
      footerLines: [bottom]
    };
  }

  if (limit >= 2) {
    return {headerLines: [tabs], footerLines: []};
  }

  return {headerLines: [], footerLines: []};
}

/**
 * 将可用 footer 高度转换为正文窗口行数；无限高度时完整展示正文，受限高度至少保留一行供滚动到达。
 */
function calculateDetailBodyHeight(maxLines: number | undefined, fixedLines: number, bodyLineCount: number): number {
  if (!Number.isFinite(maxLines)) {
    return Math.max(1, bodyLineCount);
  }

  return Math.max(1, Math.floor(Number(maxLines)) - fixedLines);
}

/**
 * 归一化详情页的有限高度预算；无限预算交由完整框架和全文正文处理。
 */
function normalizeDetailLineLimit(maxLines: number | undefined): number | null {
  return Number.isFinite(maxLines) ? Math.max(1, Math.floor(Number(maxLines))) : null;
}

/**
 * 投影压缩摘要页的稳定元信息，不把 activeStartIndex 误述为压缩次数或对话轮数。
 */
function createCompactionMetaLines(snapshot: StatusCommandSurface['snapshot'], cardWidth: number, theme: FooterTheme): string[] {
  if (!snapshot.compaction) {
    return [plainRow(cardWidth, '当前会话尚未生成压缩摘要', theme, 'muted')];
  }

  return [
    plainRow(cardWidth, '当前生效的滚动摘要', theme, 'accentStrong', true),
    plainRow(cardWidth, `更新于 ${formatStatusTimestamp(snapshot.compaction.createdAt)}`, theme, 'muted'),
    plainRow(cardWidth, `已压缩前 ${snapshot.compaction.activeStartIndex} 条记录`, theme, 'muted')
  ];
}

/**
 * 在高度不足时将压缩状态压成单行，仍保留更新时间与压缩边界。
 */
function createCompactCompactionMetaLines(snapshot: StatusCommandSurface['snapshot'], cardWidth: number, theme: FooterTheme): string[] {
  if (!snapshot.compaction) {
    return [plainRow(cardWidth, '当前会话尚未生成压缩摘要', theme, 'muted')];
  }

  return [plainRow(cardWidth, `摘要 · ${formatStatusTimestamp(snapshot.compaction.createdAt)} · 边界前 ${snapshot.compaction.activeStartIndex} 条`, theme, 'muted')];
}

/**
 * 使用现有 Markdown 投影保留摘要的标题、列表和换行；无摘要时返回稳定的正文空状态。
 */
function createCompactionBodyLines(snapshot: StatusCommandSurface['snapshot'], contentWidth: number, cardWidth: number, theme: FooterTheme, tuiTheme: TuiTheme): string[] {
  if (!snapshot.compaction) {
    return [plainRow(cardWidth, '执行 /compact 或等待自动压缩后可在此查看。', theme, 'muted')];
  }

  const summaryText = snapshot.compaction.summaryText.trim();
  if (summaryText === '') {
    return [plainRow(cardWidth, '当前压缩摘要为空。', theme, 'muted')];
  }

  return renderMarkdownLinesWithOptions(summaryText, {width: contentWidth + 1, prefix: '', theme: tuiTheme})
    .map((line) => styledRow(cardWidth, line, theme));
}

/**
 * 投影 Todo 页的更新时间与计数，让正文在滚动时仍保留当前计划进度上下文。
 */
function createTodoMetaLines(snapshot: StatusCommandSurface['snapshot'], cardWidth: number, theme: FooterTheme): string[] {
  const {items, updatedAt} = snapshot.todoState;
  const completed = items.filter((item) => item.status === 'completed').length;
  const open = items.length - completed;
  return [
    plainRow(cardWidth, `${open} 项待办 · ${completed} 项完成 · 共 ${items.length} 项`, theme, 'accentStrong', true),
    plainRow(cardWidth, `更新于 ${updatedAt.trim() === '' ? '未更新' : formatStatusTimestamp(updatedAt)}`, theme, 'muted')
  ];
}

/**
 * 在高度不足时把 Todo 进度与更新时间压成一行，正文仍保留独立窗口。
 */
function createCompactTodoMetaLines(snapshot: StatusCommandSurface['snapshot'], cardWidth: number, theme: FooterTheme): string[] {
  const {items, updatedAt} = snapshot.todoState;
  const completed = items.filter((item) => item.status === 'completed').length;
  const open = items.length - completed;
  return [plainRow(cardWidth, `${open} 待办 · ${completed} 完成 · ${updatedAt.trim() === '' ? '未更新' : formatStatusTimestamp(updatedAt)}`, theme, 'muted')];
}

/**
 * 逐项生成 Todo 的悬挂缩进视觉行；状态同时以 ●/○ 文本符号和主题色表达，完成项不改变原始顺序。
 */
function createTodoBodyLines(snapshot: StatusCommandSurface['snapshot'], contentWidth: number, cardWidth: number, theme: FooterTheme, tuiTheme: TuiTheme): string[] {
  const items = snapshot.todoState.items;
  if (items.length === 0) {
    return [plainRow(cardWidth, '当前会话暂无待办。', theme, 'muted')];
  }

  return items.flatMap((item) => {
    const completed = item.status === 'completed';
    const marker = createTodoMarker(completed, contentWidth);
    const styledMarker = tokenText(theme, completed ? 'muted' : 'accent', marker);
    const continuationPrefix = ' '.repeat(displayWidth(marker));
    const sourceLines = (item.text || '（空任务）').split(/\r\n|[\r\n]/u);
    const rows = sourceLines.flatMap((text, index) => renderStyledLine({
      prefix: '',
      contentPrefix: index === 0 ? styledMarker : continuationPrefix,
      continuationPrefix,
      spans: [{text}],
      width: contentWidth + 1,
      theme: tuiTheme,
      ...(completed ? {lineStyle: (value: string) => tokenText(theme, 'muted', value)} : {})
    }));

    return rows.map((row) => styledRow(cardWidth, row, theme));
  });
}

/**
 * 为正文首行选择能留出至少一个宽字符预算的 Todo 状态标识，极窄时退化为单个符号或省略。
 */
function createTodoMarker(completed: boolean, contentWidth: number): string {
  const symbol = completed ? '●' : '○';
  if (contentWidth >= 12) {
    return completed ? '● 已完成  ' : '○ 待办    ';
  }

  if (contentWidth >= 4) {
    return `${symbol} `;
  }

  return contentWidth >= 3 ? symbol : '';
}

/**
 * 渲染三页固定页签，Todo 页在标签中带出待办/总数，活动页通过括号和主题强调而非仅颜色区分。
 */
function tabsLine(cardWidth: number, page: StatusCommandPage, snapshot: StatusCommandSurface['snapshot'], theme: FooterTheme): string {
  const items = snapshot.todoState.items;
  const open = items.filter((item) => item.status === 'open').length;
  const labels: Array<{page: StatusCommandPage; text: string}> = [
    {page: 'overview', text: '概览'},
    {page: 'compaction', text: '压缩摘要'},
    {page: 'todos', text: `Todo ${open}/${items.length}`}
  ];
  const content = labels.map((label) => label.page === page
    ? tokenText(theme, 'accentStrong', ansi.bold(`[${label.text}]`))
    : tokenText(theme, 'muted', label.text)).join('  ');
  const inner = Math.max(1, cardWidth - 4);
  if (displayWidth(content) <= inner) {
    return styledRow(cardWidth, content, theme);
  }

  const compactLabel = page === 'compaction' ? '摘要' : page === 'todos' ? 'Todo' : '概览';
  return plainRow(cardWidth, `← [${compactLabel}] →`, theme, 'accentStrong', true);
}

/**
 * 汇总是否存在当前生效压缩摘要，概览不展开正文，避免账户用量区域被长文本挤占。
 */
function formatCompactionSummary(compaction: StatusCommandSurface['snapshot']['compaction']): string {
  return compaction
    ? `已生成 · 更新于 ${formatStatusTimestamp(compaction.createdAt)}`
    : '未生成';
}

/**
 * 汇总 session todo 进度；仅使用结构化 TodoState，不读取历史工具消息。
 */
function formatTodoSummary(todoState: StatusCommandSurface['snapshot']['todoState']): string {
  const items = todoState.items;
  const completed = items.filter((item) => item.status === 'completed').length;
  return `${items.length - completed} 项待办 · ${completed} 项完成`;
}

/**
 * 将任意输入偏移钳制到当前正文可达的视觉行范围，避免刷新后内容缩短留下空白窗口。
 */
function clampScroll(value: number | undefined, maxScroll: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(Number(value)) : 0;
  return Math.max(0, Math.min(Math.max(0, maxScroll), normalized));
}

/**
 * 生成正文当前位置提示，告知用户长内容仍可通过滚动继续阅读。
 */
function formatScrollPosition(scroll: number, visibleCount: number, totalCount: number): string {
  const start = totalCount === 0 ? 0 : scroll + 1;
  return `${start}–${scroll + visibleCount} / ${totalCount} 行`;
}

/**
 * 将 ISO 时间或 journal 时间投影为稳定的 UTC 分钟文本；缺失或非法值明确显示未知。
 */
function formatStatusTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : '未知';
}

/**
 * 把沙箱快照投影为单行文案;关闭态不展开网络细节,不可用态保留降级原因。
 */
function formatSandboxState(state: CommandStatusSandboxState): string {
  if (state.mode === 'off') {
    return '关闭';
  }

  if (!state.available) {
    return `${state.mode} · 不可用(${state.unavailableReason || '未知原因'})`;
  }

  return `${state.mode} · 网络${state.network ? '开' : '关'} · ${state.provider}`;
}

function balanceRowText(info: CommandDeepseekBalanceInfo): string {
  return `${info.currency}  总额 ${info.totalBalance} · 充值 ${info.toppedUpBalance} · 赠送 ${info.grantedBalance}`;
}

function usageWindowLines(label: string, usage: CommandCodexUsageWindow, cardWidth: number, inner: number, theme: FooterTheme): string[] {
  const percent = Math.min(100, Math.max(0, usage.usedPercent));
  const fullStat = `${formatPercent(percent)}% · 重置 ${formatResetAt(usage.resetAt)}`;
  return usageWindowRowLines(label, fullStat, percent, cardWidth, inner, theme);
}

/**
 * OpenCode Go 窗口行:归一化为 {usedPercent, resetAt} 后与 Codex 用量行完全同构,标签按已知键翻译。
 */
function opencodeWindowLines(window: CommandOpencodeUsageWindow, cardWidth: number, inner: number, theme: FooterTheme): string[] {
  return usageWindowLines(formatOpencodeWindowLabel(window.name), {resetAt: window.resetsAtMs, usedPercent: window.percent}, cardWidth, inner, theme);
}

/**
 * 共享窗口行构造:头部宽度不足时把完整统计降级为纯百分比,进度条按 75/90 阈值分档着色。
 */
function usageWindowRowLines(label: string, fullStat: string, percent: number, cardWidth: number, inner: number, theme: FooterTheme): string[] {
  const percentText = `${formatPercent(percent)}%`;
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

/**
 * 窗口标签映射集中在渲染层:已知命名翻译为中文,未知名称原样展示,避免对上游枚举做硬假设。
 */
function formatOpencodeWindowLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === 'rolling') {
    return '5 小时';
  }
  if (normalized === 'weekly') {
    return '每周';
  }
  if (normalized === 'monthly') {
    return '每月';
  }
  return name;
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
  calculateStatusNavigation,
  formatResetAt,
  renderStatusSurface
};
