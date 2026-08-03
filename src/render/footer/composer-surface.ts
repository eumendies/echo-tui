import * as ansi from '../../terminal/ansi';
import { ECHO_SPINNER_ACTIVE_FRAME_COUNT, getEchoSpinnerFrame, getEchoSpinnerFrameIndex, renderEchoSpinnerFrame } from '../echo-spinner';
import { displayWidth, renderComposer, safeRenderWidth } from '../layout';
import { activeBackground, renderFocusBar, resolveFooterTheme, tokenText, type FooterTheme, type TuiTheme } from '../colors';
import { clampPlainText, formatSelectOptionText, padVisibleText } from './text';
import { clampIndex, normalizeLineLimit } from './window';
import type { ComposerState } from '../../types/composer';
import type { FooterLayout, RenderState, SlashSuggestionState, StatusLineState } from '../../types/render';

const COMPOSER_PLACEHOLDER = '/ 命令 · @ 路径 · TAB mode · Ctrl+T 模型 · Shift+Tab 授权 · Ctrl+J 换行';
const PLAN_COMPOSER_PLACEHOLDER = '计划问题 · @ 路径 · TAB 切换 mode · Ctrl+T 模型 · Ctrl+J 换行';
const SHELL_CONTEXT_COMPOSER_PLACEHOLDER = 'bash 命令 · TAB 切换 mode · 结果进上下文 · Enter 执行';
const SHELL_LOCAL_COMPOSER_PLACEHOLDER = 'bash 命令 · TAB 切换 mode · 仅本地显示 · Enter 执行';
const MODEL_TUNING_PLACEHOLDER = 'Tab 切换字段 · ←/→ 调整 · Enter 应用 · Esc 取消';
const BTW_COMPOSER_PLACEHOLDER = '临时只读旁路问题 · Ctrl+J 换行 · Esc 返回主会话';
const COMPOSER_MAX_VISIBLE_LINES = 8;
const STATUS_SEPARATOR = '│';
const COMPOSER_BOX_SIDE_BORDER = '│';
const COMPOSER_BOX_SIDE_PADDING = ' ';
const COMPOSER_BOX_CONTENT_OFFSET = displayWidth(`${COMPOSER_BOX_SIDE_BORDER}${COMPOSER_BOX_SIDE_PADDING}`);

type ComposerTheme = {
  border: (text: string) => string;
  placeholder: string;
  prefix: string;
};

type StatusSegment = {
  plain: string;
  rendered: string;
};

type SlashSuggestionRow =
  | {kind: 'item'; index: number; item: SlashSuggestionState['options'][number]}
  | {count: number; direction: 'up' | 'down'; kind: 'more'};

/**
 * 渲染普通输入态 surface：composer、可选 slash suggestion 和固定 status line。
 */
export function renderComposerSurface(
  composer: ComposerState,
  statusLine: StatusLineState | undefined,
  width: number,
  slashSuggestions: SlashSuggestionState | null,
  maxLines = Number.POSITIVE_INFINITY,
  tuiTheme?: TuiTheme,
  slashSuggestionMaxVisible = Number.POSITIVE_INFINITY,
  conversationReference: RenderState['conversationReference'] = null,
  pendingMessage: RenderState['pendingMessage'] = null
): FooterLayout {
  const theme = resolveFooterTheme(tuiTheme);
  const normalizedMaxLines = normalizeLineLimit(maxLines);
  const statusLineText = renderStatusLineText(statusLine, width, theme);
  const attachmentBudget = Math.max(0, normalizedMaxLines - 2);
  const pendingMessageLines = renderPendingMessageLines(pendingMessage, width, theme, Math.min(2, attachmentBudget));
  const referenceBudget = Math.max(0, attachmentBudget - pendingMessageLines.length);
  const referenceLines = renderConversationReferenceLines(conversationReference, width, theme).slice(0, referenceBudget);
  const contentBudget = Math.max(1, normalizedMaxLines - 1 - referenceLines.length - pendingMessageLines.length);
  const suggestionItemBudget = slashSuggestions ? Math.min(slashSuggestions.options.length, slashSuggestionMaxVisible, Math.max(0, contentBudget - 3)) : 0;
  const suggestionLines = slashSuggestions && suggestionItemBudget > 0
    ? renderSlashSuggestionLines(slashSuggestions, width, suggestionItemBudget, Math.max(0, contentBudget - 3), theme)
    : [];
  const composerBudget = Math.min(COMPOSER_MAX_VISIBLE_LINES, Math.max(1, contentBudget - suggestionLines.length));
  const composerTheme = resolveComposerTheme(statusLine, theme);
  const composerLayout = renderBoxedComposer(
    composer,
    width,
    composerBudget,
    statusLine?.model.kind === 'tuning' ? {...composerTheme, placeholder: MODEL_TUNING_PLACEHOLDER} : composerTheme
  );

  return {
    lines: [...referenceLines, ...pendingMessageLines, ...composerLayout.lines, ...suggestionLines, statusLineText],
    cursorRow: referenceLines.length + pendingMessageLines.length + composerLayout.cursorRow,
    cursorColumn: composerLayout.cursorColumn,
    showCursor: statusLine?.model.kind !== 'tuning'
  };
}

/**
 * 渲染固定高度的待发送卡片；紧张空间退化为单行，正文永不按自然换行扩张。
 */
function renderPendingMessageLines(message: RenderState['pendingMessage'], width: number, theme: FooterTheme, maxLines: number): string[] {
  if (!message || maxLines <= 0) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  const preview = message.preview;
  if (maxLines === 1) {
    return [tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(`↳ 待发送 · ${preview} · Esc 移除`, safeWidth)))];
  }

  return [
    tokenText(theme, 'accentStrong', ansi.bold(clampPlainText('↳ 待发送消息 · 当前回答结束后发送', safeWidth))),
    tokenText(theme, 'muted', clampPlainText(`  ${preview} · Esc 移除`, safeWidth))
  ];
}

/**
 * 在 composer 上方渲染轻量引用卡片，只展示标题和投影模式，不泄露内部 session metadata。
 */
function renderConversationReferenceLines(reference: RenderState['conversationReference'], width: number, theme: FooterTheme): string[] {
  if (!reference) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  const mode = reference.projectionMode === 'summary' ? '总结' : '全文';
  const hint = reference.preparing ? 'Esc 取消总结' : 'Esc 移除';
  const title = clampPlainText(`${reference.title} · ${hint}`, Math.max(1, safeWidth - 2));

  return [
    tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(`↳ 引用对话 · ${mode}`, safeWidth))),
    tokenText(theme, 'muted', clampPlainText(`  ${title}`, safeWidth))
  ];
}

/**
 * 把 composer 编辑模型投影为 cyan 边框输入框；placeholder 只存在于渲染层。
 */
function renderBoxedComposer(composer: ComposerState, width: number, maxLines = Number.POSITIVE_INFINITY, theme = resolveComposerTheme(undefined, resolveFooterTheme(undefined))): FooterLayout {
  const boxWidth = Math.max(4, safeRenderWidth(width));
  const contentWidth = Math.max(1, boxWidth - 4);
  const composerLayout = renderComposer(composer, contentWidth + 1, `${theme.prefix} `, {highlightFileMentions: true, startColumn: COMPOSER_BOX_CONTENT_OFFSET});
  const visibleLines = composer.chars.length === 0
    ? [renderEmptyComposerLine(theme, contentWidth)]
    : composerLayout.lines;
  const lines = [
    renderComposerBoxTop(boxWidth, theme.border),
    ...visibleLines.map((line) => renderComposerBoxLine(line, contentWidth, theme.border)),
    renderComposerBoxBottom(boxWidth, theme.border)
  ];
  const fullLayout = {
    lines,
    cursorRow: composerLayout.cursorRow + 1,
    cursorColumn: composerLayout.cursorColumn + 2,
    showCursor: true
  };

  if (lines.length <= maxLines) {
    return fullLayout;
  }

  return cropBoxedComposerToCursor(fullLayout, composerLayout.cursorRow, contentWidth, maxLines, theme.border);
}

/**
 * 空 composer 只在宽度足够时展示 placeholder；空间不足时保留 prompt，避免右框线被挤换行。
 */
function renderEmptyComposerLine(theme: ComposerTheme, contentWidth: number): string {
  const prompt = `${theme.prefix} `;
  const placeholderLine = `${prompt}${ansi.dim(theme.placeholder)}`;

  return displayWidth(placeholderLine) <= contentWidth ? placeholderLine : prompt;
}

/**
 * composer 超高时只显示包含光标的窗口；不增加省略提示，保持输入区像 viewport 一样滚动。
 */
function cropBoxedComposerToCursor(layout: FooterLayout, cursorContentRow: number, contentWidth: number, maxLines: number, styleBorder: (text: string) => string = defaultBorder): FooterLayout {
  const normalizedMaxLines = normalizeLineLimit(maxLines);

  if (normalizedMaxLines === 1) {
    return {
      ...layout,
      lines: [layout.lines[layout.cursorRow] || renderComposerBoxLine('', contentWidth, styleBorder)],
      cursorRow: 0
    };
  }

  if (normalizedMaxLines === 2) {
    return {
      ...layout,
      lines: [layout.lines[layout.cursorRow] || renderComposerBoxLine('', contentWidth, styleBorder), renderComposerBoxBottom(contentWidth + 4, styleBorder)],
      cursorRow: 0
    };
  }

  const contentLines = layout.lines.slice(1, -1);
  const visibleContentCount = Math.max(1, normalizedMaxLines - 2);
  const maxStart = Math.max(0, contentLines.length - visibleContentCount);
  const start = Math.min(Math.max(0, cursorContentRow - visibleContentCount + 1), maxStart);
  const visibleContentLines = contentLines.slice(start, start + visibleContentCount);

  return {
    ...layout,
    lines: [layout.lines[0], ...visibleContentLines, layout.lines[layout.lines.length - 1]],
    cursorRow: 1 + cursorContentRow - start
  };
}

function resolveComposerTheme(statusLine: StatusLineState | undefined, theme: FooterTheme): ComposerTheme {
  if (statusLine?.mode === 'btw') {
    return {border: (text) => tokenText(theme, 'btw', text), placeholder: BTW_COMPOSER_PLACEHOLDER, prefix: 'btw ›'};
  }

  if (statusLine?.mode === 'plan') {
    return {border: (text) => tokenText(theme, 'plan', text), placeholder: PLAN_COMPOSER_PLACEHOLDER, prefix: '?'};
  }

  if (statusLine?.mode === 'shell' || statusLine?.mode === 'shell-local') {
    const placeholder = statusLine.mode === 'shell-local'
      ? SHELL_LOCAL_COMPOSER_PLACEHOLDER
      : SHELL_CONTEXT_COMPOSER_PLACEHOLDER;
    return {border: (text) => tokenText(theme, 'success', text), placeholder, prefix: '$'};
  }

  return {border: (text) => tokenText(theme, 'accent', text), placeholder: COMPOSER_PLACEHOLDER, prefix: '>'};
}

/**
 * 将结构化状态栏压平成单行文本，并在加样式前按安全宽度裁剪。
 */
function renderStatusLineText(statusLine: StatusLineState | undefined, width: number, theme: FooterTheme): string {
  if (!statusLine) {
    return '';
  }

  const safeWidth = safeRenderWidth(width);
  const leftSegments = createLeftStatusSegments(statusLine, theme);
  const rightSegments = createRightStatusSegments(statusLine, theme);
  const left = joinStatusSegments(leftSegments, theme);
  const right = joinStatusSegments(rightSegments, theme);
  const leftWidth = displayWidth(left.rendered);
  const rightWidth = displayWidth(right.rendered);

  if (right.rendered && leftWidth + rightWidth + 1 <= safeWidth) {
    return `${left.rendered}${' '.repeat(safeWidth - leftWidth - rightWidth)}${right.rendered}`;
  }

  if (leftWidth <= safeWidth) {
    return left.rendered;
  }

  return tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(left.plain, width)));
}

function createLeftStatusSegments(statusLine: StatusLineState, theme: FooterTheme): StatusSegment[] {
  const segments = statusLine.model.kind === 'tuning'
    ? createModelTuningStatusSegments(statusLine.model, theme)
    : createDefaultModelStatusSegments(statusLine.model, theme);

  if (statusLine.allowAllTools) {
    segments.push({
      plain: 'TOOLS all',
      rendered: tokenText(theme, 'warning', ansi.bold('TOOLS all'))
    });
  }

  segments.push({
    plain: `dir ${statusLine.projectName}`,
    rendered: `${ansi.dim('dir')} ${tokenText(theme, 'accent', statusLine.projectName)}`
  });

  return segments;
}

/**
 * 投影普通或 skill override 的模型信息，保持既有 model/effort 分段语义。
 */
function createDefaultModelStatusSegments(model: Extract<StatusLineState['model'], {kind: 'default'}>, theme: FooterTheme): StatusSegment[] {
  const modelLabel = model.skillOverride
    ? `${model.label} (SKILL override)`
    : model.label;
  const segments: StatusSegment[] = [{
    plain: modelLabel,
    rendered: tokenText(theme, 'accentStrong', ansi.bold(modelLabel))
  }];

  if (model.effort) {
    segments.push({
      plain: `effort ${model.effort}`,
      rendered: `${ansi.dim('effort')} ${tokenText(theme, 'accent', model.effort)}`
    });
  }

  return segments;
}

/**
 * 将暂存 model/effort 投影为 status segments；活动字段用成对尖括号表达键盘焦点。
 */
function createModelTuningStatusSegments(model: Extract<StatusLineState['model'], {kind: 'tuning'}>, theme: FooterTheme): StatusSegment[] {
  const modelFocused = model.activeField === 'model';
  const effortFocused = model.activeField === 'effort';
  const modelText = modelFocused ? `‹${model.label}›` : model.label;
  const effortValue = effortFocused ? `‹${model.effort}›` : model.effort;

  return [
    {
      plain: modelText,
      rendered: tokenText(theme, modelFocused ? 'accentStrong' : 'accent', modelFocused ? ansi.bold(modelText) : modelText)
    },
    {
      plain: `effort ${effortValue}`,
      rendered: `${ansi.dim('effort')} ${tokenText(theme, effortFocused ? 'accentStrong' : 'accent', effortFocused ? ansi.bold(effortValue) : effortValue)}`
    }
  ];
}

function createRightStatusSegments(statusLine: StatusLineState, theme: FooterTheme): StatusSegment[] {
  const segments: StatusSegment[] = [];

  if (statusLine.model.kind === 'tuning' && statusLine.model.error) {
    segments.push({
      plain: `保存失败 ${statusLine.model.error}`,
      rendered: tokenText(theme, 'danger', `保存失败 ${statusLine.model.error}`)
    });
  }

  if (statusLine.contextUsage) {
    const text = `${formatTokenCount(statusLine.contextUsage.usedTokens)}/${formatTokenCount(statusLine.contextUsage.contextWindow)}`;
    segments.push({
      plain: `ctx ${text}`,
      rendered: `${ansi.dim('ctx')} ${tokenText(theme, 'muted', text)}`
    });
  }

  if (statusLine.mode === 'btw') {
    segments.push(createModeSegment({...statusLine, activity: undefined}, theme));
    if (statusLine.activity) segments.push(createActivitySegment(statusLine.activity, theme));
  } else if ((statusLine.mode === 'shell' || statusLine.mode === 'shell-local') && statusLine.activity) {
    segments.push(createShellModeSegment(statusLine, theme), createActivitySegment(statusLine.activity, theme));
  } else {
    segments.push(createModeSegment(statusLine, theme));
  }

  if (statusLine.keyHint) {
    segments.push({
      plain: statusLine.keyHint,
      rendered: ansi.dim(statusLine.keyHint)
    });
  }

  return segments;
}

/**
 * 生成状态栏 mode 段；响应中优先展示 echo spinner，空闲时保留 ready/PLAN。
 */
function createModeSegment(statusLine: StatusLineState, theme: FooterTheme): StatusSegment {
  if (statusLine.mode === 'mcp' && statusLine.activity) {
    return createMcpInitializationSegment(statusLine.activity, theme);
  }

  if (statusLine.activity) {
    return createActivitySegment(statusLine.activity, theme);
  }

  if (statusLine.mode === 'plan') {
    return {
      plain: 'PLAN',
      rendered: tokenText(theme, 'plan', ansi.bold('PLAN'))
    };
  }

  if (statusLine.mode === 'shell' || statusLine.mode === 'shell-local') {
    return createShellModeSegment(statusLine, theme);
  }

  const text = statusLine.mode === 'idle'
    ? 'ready'
    : statusLine.detail
      ? `${statusLine.mode} ${statusLine.detail}`
      : statusLine.mode;
  const token = statusLine.mode === 'idle' ? 'success' : 'warning';

  return {
    plain: `● ${text}`,
    rendered: `${tokenText(theme, token, '●')} ${tokenText(theme, token, text)}`
  };
}

function createMcpInitializationSegment(activity: NonNullable<StatusLineState['activity']>, theme: FooterTheme): StatusSegment {
  const elapsedMs = normalizeElapsedMs(activity.elapsedMs);
  const spinner = getEchoSpinnerFrame(elapsedMs);
  const renderedSpinner = renderEchoSpinnerFrame(elapsedMs, theme);
  const text = `initializing MCP ${formatElapsedTime(elapsedMs)}`;

  return {
    plain: `${spinner} ${text}`,
    rendered: `${renderedSpinner} ${renderActivityText(text, elapsedMs, theme)}`
  };
}

function createActivitySegment(activity: NonNullable<StatusLineState['activity']>, theme: FooterTheme): StatusSegment {
  const elapsedMs = normalizeElapsedMs(activity.elapsedMs);
  const spinner = getEchoSpinnerFrame(elapsedMs);
  const renderedSpinner = renderEchoSpinnerFrame(elapsedMs, theme);
  const text = activity.kind === 'working'
    ? `working ${formatElapsedTime(elapsedMs)}`
    : 'thinking';

  return {
    plain: `${spinner} ${text}`,
    rendered: `${renderedSpinner} ${renderActivityText(text, elapsedMs, theme)}`
  };
}

function createShellModeSegment(statusLine: StatusLineState, theme: FooterTheme): StatusSegment {
  const policy = statusLine.mode === 'shell-local' ? 'local' : 'ctx';
  const text = `SHELL ${policy}`;

  return {
    plain: text,
    rendered: tokenText(theme, 'success', ansi.bold(text))
  };
}

/**
 * 响应中状态文案用灰色底色承托白色扫光，方向从中心向两侧扩散以呼应 echo spinner。
 */
function renderActivityText(text: string, elapsedMs: number, theme: FooterTheme): string {
  const chars = Array.from(text);
  const center = (chars.length - 1) / 2;
  const maxRadius = Math.ceil(center);
  const radius = resolveActivityShimmerRadius(elapsedMs, maxRadius);

  return chars.map((char, index) => renderActivityTextChar(char, index, center, radius, theme)).join('');
}

/**
 * 文案扫光复用 spinner 的完整帧周期；spinner 空帧时文案也静默，避免两套节奏错位。
 */
function resolveActivityShimmerRadius(elapsedMs: number, maxRadius: number): number | null {
  const frameIndex = getEchoSpinnerFrameIndex(elapsedMs);

  if (frameIndex >= ECHO_SPINNER_ACTIVE_FRAME_COUNT) {
    return null;
  }

  return Math.round((frameIndex * maxRadius) / (ECHO_SPINNER_ACTIVE_FRAME_COUNT - 1));
}

/**
 * 按字符闭合 ANSI，避免状态栏裁剪或拼接时扫光样式污染后续 segment。
 */
function renderActivityTextChar(char: string, index: number, center: number, radius: number | null, theme: FooterTheme): string {
  const ring = Math.max(0, Math.ceil(Math.abs(index - center) - 0.5));

  if (radius !== null && ring === radius) {
    return ansi.bold(tokenText(theme, 'white', char));
  }

  if (radius !== null && Math.abs(ring - radius) === 1) {
    return tokenText(theme, 'white', char);
  }

  return tokenText(theme, 'muted', char);
}

/**
 * 归一化响应中耗时，避免 provider 异常值把状态栏帧选择带偏。
 */
function normalizeElapsedMs(elapsedMs: number): number {
  return Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
}

/**
 * 把本轮耗时格式化为紧凑的 mm:ss，用于 status line 的 working 状态段。
 */
function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(normalizeElapsedMs(elapsedMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function joinStatusSegments(segments: StatusSegment[], theme: FooterTheme): StatusSegment {
  const separator = ` ${STATUS_SEPARATOR} `;
  const renderedSeparator = ` ${tokenText(theme, 'frame', STATUS_SEPARATOR)} `;

  return {
    plain: segments.map((segment) => segment.plain).join(separator),
    rendered: segments.map((segment) => segment.rendered).join(renderedSeparator)
  };
}

function formatTokenCount(value: number): string {
  const tokens = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

  if (tokens < 1000) {
    return String(tokens);
  }

  const compact = tokens / 1000;
  return `${Number.isInteger(compact) ? Math.round(compact) : compact.toFixed(1)}k`;
}

function renderComposerBoxTop(width: number, styleBorder = defaultBorder): string {
  return styleBorder(`╭${'─'.repeat(Math.max(0, width - 2))}╮`);
}

function renderComposerBoxBottom(width: number, styleBorder = defaultBorder): string {
  return styleBorder(`╰${'─'.repeat(Math.max(0, width - 2))}╯`);
}

function renderComposerBoxLine(content: string, width: number, styleBorder = defaultBorder): string {
  return `${styleBorder(COMPOSER_BOX_SIDE_BORDER)}${COMPOSER_BOX_SIDE_PADDING}${padVisibleText(content, width)}${COMPOSER_BOX_SIDE_PADDING}${styleBorder(COMPOSER_BOX_SIDE_BORDER)}`;
}

function defaultBorder(text: string): string {
  return tokenText(resolveFooterTheme(undefined), 'accent', text);
}

/**
 * 渲染 composer 编辑态下的 slash 命令提示，不接管 composer 光标。
 */
function renderSlashSuggestionLines(slashSuggestions: SlashSuggestionState, width: number, maxItems: number, maxRows: number, theme: FooterTheme): string[] {
  const rows = createSlashSuggestionRows(slashSuggestions.options, slashSuggestions.selectedIndex, maxItems, maxRows);

  return rows.map((row) => {
    if (row.kind === 'more') {
      return ansi.dim(clampPlainText(`${row.direction === 'up' ? '↑' : '↓'} ${row.count} 更多`, width));
    }

    const option = row.item;
    const optionText = formatSelectOptionText(option.label, option.description);
    if (row.index !== slashSuggestions.selectedIndex) {
      return `  ${clampPlainText(optionText, Math.max(1, width - 2))}`;
    }

    const rowWidth = Math.max(1, width - 1);
    const text = tokenText(theme, 'accentStrong', ansi.bold(clampPlainText(optionText, Math.max(1, rowWidth - 1))));
    return `${renderFocusBar(theme)}${activeBackground(theme, padVisibleText(` ${text}`, rowWidth))}`;
  });
}

/**
 * Slash suggestion 的配置值表示最多显示的候选项数量；more 提示是额外状态行，只在高度不足时回收候选项。
 */
function createSlashSuggestionRows(options: SlashSuggestionState['options'], selectedIndex: number, maxItems: number, maxRows: number): SlashSuggestionRow[] {
  const itemLimit = normalizeLineLimit(maxItems, 0);
  const rowLimit = normalizeLineLimit(maxRows, 0);

  if (itemLimit <= 0 || rowLimit <= 0) {
    return [];
  }

  const selected = clampIndex(selectedIndex, options.length);
  let itemSlots = Math.min(options.length, itemLimit);

  if (itemSlots <= 0) {
    return [];
  }

  let start = calculateSlashSuggestionStart(options.length, selected, itemSlots);
  let end = Math.min(options.length, start + itemSlots);
  let showTopHint = start > 0;
  let showBottomHint = end < options.length;

  while (itemSlots > 1 && itemSlots + (showTopHint ? 1 : 0) + (showBottomHint ? 1 : 0) > rowLimit) {
    itemSlots -= 1;
    start = calculateSlashSuggestionStart(options.length, selected, itemSlots);
    end = Math.min(options.length, start + itemSlots);
    showTopHint = start > 0;
    showBottomHint = end < options.length;
  }

  while (itemSlots + (showTopHint ? 1 : 0) + (showBottomHint ? 1 : 0) > rowLimit) {
    if (showBottomHint) {
      showBottomHint = false;
    } else if (showTopHint) {
      showTopHint = false;
    } else {
      break;
    }
  }

  const rows: SlashSuggestionRow[] = [];

  if (showTopHint) {
    rows.push({kind: 'more', direction: 'up', count: start});
  }

  rows.push(...options.slice(start, end).map((item, offset) => ({kind: 'item' as const, item, index: start + offset})));

  if (showBottomHint) {
    rows.push({kind: 'more', direction: 'down', count: options.length - end});
  }

  return rows;
}

function calculateSlashSuggestionStart(itemCount: number, selectedIndex: number, itemSlots: number): number {
  const half = Math.floor(itemSlots / 2);
  return Math.min(Math.max(0, selectedIndex - half), Math.max(0, itemCount - itemSlots));
}
