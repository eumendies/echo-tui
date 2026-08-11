import * as ansi from '../terminal/ansi';
import {DEFAULT_TUI_THEME, type ThemeColor, type TuiTheme} from '../config/theme-config';
import {blockBackground, blockText, colorText} from './colors';
import { charWidth, displayWidth, safeRenderWidth, splitGraphemes, tabWidthAt } from './layout';
import { getCommittableMarkdownText, renderMarkdownLinesWithOptions } from './markdown';
import { renderToolCallPreviewLines } from './tool-message-renderer';
import type { BannerContext, PendingState, TerminalSize } from '../types/render';

type BannerRenderContext = Partial<Omit<BannerContext, 'terminalSize'>> & {
  terminalSize?: TerminalSize;
};

type TextStyle = (text: string) => string;

type SymbolMessageOptions = {
  text: string;
  width: number;
  prefix: string;
  colorizePrefix?: TextStyle;
  colorizeLine?: TextStyle;
  repeatPrefixEveryLine?: boolean;
};

// const TITLE_ART = [
//   ' ______ _____ _    _  ____  ',
//   '|  ____/ ____| |  | |/ __ \\ ',
//   '| |__ | |    | |__| | |  | |',
//   '|  __|| |    |  __  | |  | |',
//   '| |___| |____| |  | | |__| |',
//   '|______\\_____|_|  |_|\\____/'
// ];
const TITLE_ART = ['███████╗ ██████╗██╗  ██╗ ██████╗',  
                   '██╔════╝██╔════╝██║  ██║██╔═══██╗',  
                   '█████╗  ██║     ███████║██║   ██║',  
                   '██╔══╝  ██║     ██╔══██║██║   ██║',
                   '███████╗╚██████╗██║  ██║╚██████╔╝',  
                   '╚══════╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝'];
                                     
const TITLE_ART_WIDTH = TITLE_ART.reduce((maxWidth, line) => Math.max(maxWidth, displayWidth(line)), 0);
const USER_MESSAGE_PREFIX = '▌ ';

// 这些函数只负责把状态投影为可见行；resize 时可以用新宽度重新调用。
/**
 * 渲染顶部 banner，展示启动时真正对用户有用的最小上下文。
 *
 * 当前 banner 有三档：
 * 1. 宽终端：使用大字 ASCII Art 标题，强调启动瞬间的识别度。
 * 2. 中等终端：回退到带边框的紧凑 banner，保留 cwd 和 Node 版本。
 * 3. 极窄终端：只保留最小可读标题和 cwd，优先避免横向撑爆。
 *
 */
export function renderBanner(context: BannerRenderContext = {}, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  const cwd = shortenPath(context.cwd || process.cwd(), 56);
  const nodeVersion = context.nodeVersion || process.version;
  const terminalSize = context.terminalSize || { columns: 80, rows: 24 };
  const width = safeRenderWidth(terminalSize.columns);
  const runtimeInfo = `node ${nodeVersion}`;

  if (context.variant === 'btw') {
    return renderBtwBanner(width, context.parentActivity || 'MAIN idle', theme);
  }

  // 宽度足够时优先显示大字标题，让启动 banner 具备类似 Spring Boot 的 splash 感。
  if (width >= TITLE_ART_WIDTH + 4) {
    const accentWidth = Math.min(width, TITLE_ART_WIDTH + 8);

    return [
      '',
        ...TITLE_ART.map((line) => ansi.bold(blockText(theme, 'bannerAccent', centerToDisplayWidth(padToDisplayWidth(line, TITLE_ART_WIDTH), width)))),
        blockText(theme, 'bannerMuted', centerToDisplayWidth('─'.repeat(accentWidth), width)),
        ansi.dim(blockText(theme, 'bannerMuted', centerToDisplayWidth(clampToDisplayWidth(`cwd  ${cwd}`, width), width))),
        ansi.dim(blockText(theme, 'bannerMuted', centerToDisplayWidth(clampToDisplayWidth(runtimeInfo, width), width))),
      ''
    ].join('\n');
  }

  // 宽度极小时退回最小版本，避免边框和多行元信息把内容横向挤爆。
  if (width < 12) {
    return [
      '',
      ansi.inverse(ansi.bold(padToDisplayWidth(clampToDisplayWidth(' echo_tui ', width), width))),
        blockText(theme, 'bannerMuted', padToDisplayWidth(clampToDisplayWidth(` cwd  ${cwd}`, width), width)),
      ''
    ].join('\n');
  }

  // 中等宽度使用盒子 banner，既保留强调感，也给 cwd / runtime 信息留出稳定容器。
  const innerWidth = width - 2;
  const border = ansi.bold(blockText(theme, 'bannerAccent', `╭${'─'.repeat(innerWidth)}╮`));
  const footerBorder = ansi.bold(blockText(theme, 'bannerAccent', `╰${'─'.repeat(innerWidth)}╯`));

  return [
    '',
    border,
      renderBannerBoxLine(' echo_tui', innerWidth, (text) => ansi.inverse(ansi.bold(text)), theme),
      renderBannerBoxLine(` cwd  ${cwd}`, innerWidth, (text) => blockText(theme, 'bannerMuted', text), theme),
      renderBannerBoxLine(` ${runtimeInfo}`, innerWidth, (text) => ansi.dim(blockText(theme, 'bannerMuted', text)), theme),
    footerBorder,
    ''
  ].join('\n');
}

/**
 * 渲染 BTW 临时工作区的紧凑标题，避免模式切换时重复主界面大字 banner。
 */
function renderBtwBanner(width: number, parentActivity: string, theme: TuiTheme): string {
  if (width < 12) {
    return ['', ansi.bold(blockText(theme, 'bannerAccent', 'BTW')), ansi.dim(clampToDisplayWidth(parentActivity, width)), ''].join('\n');
  }

  const innerWidth = width - 2;
  const border = ansi.bold(blockText(theme, 'bannerAccent', `╭${'─'.repeat(innerWidth)}╮`));
  const footerBorder = ansi.bold(blockText(theme, 'bannerAccent', `╰${'─'.repeat(innerWidth)}╯`));
  return [
    '',
    border,
    renderBannerBoxLine(' BTW · 临时只读会话 · Esc 返回主会话', innerWidth, (text) => ansi.bold(text), theme),
    renderBannerBoxLine(` ${parentActivity}`, innerWidth, (text) => ansi.dim(text), theme),
    footerBorder,
    ''
  ].join('\n');
}

/**
 * 渲染 banner 的单行盒子内容，左右保留强调边框。
 *
 */
function renderBannerBoxLine(content: string, innerWidth: number, styleContent: TextStyle, theme: TuiTheme): string {
  const fitted = padToDisplayWidth(clampToDisplayWidth(content, innerWidth), innerWidth);
  return `${ansi.bold(blockText(theme, 'bannerAccent', '│'))}${styleContent(fitted)}${ansi.bold(blockText(theme, 'bannerAccent', '│'))}`;
}

/**
 * 把文本居中到目标显示宽度，给启动 banner 的标题和元信息建立更稳定的视觉中心。
 *
 */
function centerToDisplayWidth(text: string, width: number): string {
  const normalizedWidth = Math.max(0, width);
  const textWidth = displayWidth(text);

  if (textWidth >= normalizedWidth) {
    return text;
  }

  const remaining = normalizedWidth - textWidth;
  const leftPadding = Math.floor(remaining / 2);
  const rightPadding = remaining - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

/**
 * 在超长 cwd 场景下截断路径，优先保留尾部信息。
 *
 */
function shortenPath(value: string, maxWidth: number): string {
  if (value.length <= maxWidth) {
    return value;
  }

  return `...${value.slice(-(maxWidth - 3))}`;
}

/**
 * 按显示宽度截断文本，并在需要时追加省略号。
 *
 */
function clampToDisplayWidth(text: string, width: number): string {
  const normalizedWidth = Math.max(0, width);

  if (displayWidth(text) <= normalizedWidth) {
    return text;
  }

  if (normalizedWidth <= 3) {
    return '.'.repeat(normalizedWidth);
  }

  let result = '';
  let currentWidth = 0;

  for (const char of splitGraphemes(text)) {
    const widthOfChar = charWidth(char);

    if (currentWidth + widthOfChar > normalizedWidth - 3) {
      break;
    }

    result += char;
    currentWidth += widthOfChar;
  }

  return `${result}...`;
}

/**
 * 渲染完整的用户消息块，并在灰底内外附加呼吸空间。
 * interactionMode 来自消息提交时的 transcript metadata，确保历史 plan 消息重绘时颜色稳定。
 *
 */
export function renderUserBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME, interactionMode?: string): string {
  // 用户提交后保留块级呼吸空间，并在灰底内部增加上下留白，让消息块更饱满。
    const paddingLine = renderUserPaddingLine(width, theme, interactionMode);
    return ['', paddingLine, ...renderUserMessageLines(text, width, theme, interactionMode), paddingLine, '', ''].join('\n');
}

/**
 * 渲染已提交用户消息前的会话引用卡片；完整正文仅保存在 transcript text 中，不在终端展开。
 */
export function renderConversationReferenceBlock(title: string, projectionMode: 'full' | 'summary', width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  const safeWidth = safeRenderWidth(width);
  const mode = projectionMode === 'summary' ? '总结' : '全文';
  const header = clampToDisplayWidth(`↳ 引用对话 · ${mode}`, safeWidth);
  const body = clampToDisplayWidth(String(title || '未命名对话'), safeWidth);

  return [
    '',
    ansi.bold(blockText(theme, 'bannerAccent', header)),
    ansi.dim(blockText(theme, 'bannerMuted', body)),
    ''
  ].join('\n');
}

/**
 * 渲染完整的 assistant 消息块。
 *
 */
export function renderAssistantBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return [...renderAssistantMessageLines(text, width, theme), '', ''].join('\n');
}

/**
 * 渲染完整的本地错误消息块。
 *
 */
export function renderErrorBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return [...renderErrorMessageLines(text, width, theme), '', ''].join('\n');
}

/**
 * 渲染上下文压缩提示块，使用克制的灰色样式区别于 user/assistant/error。
 *
 */
export function renderCompactionNoticeBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return [...renderCompactionNoticeLines(text, width, theme), '', ''].join('\n');
}

/**
 * 渲染本地中断提示块，复用低强调层级但保留独立语义入口。
 *
 */
export function renderLocalNoticeBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return [...renderLocalNoticeLines(text, width, theme), '', ''].join('\n');
}

/**
 * 渲染 shell execution 消息块，模拟用户在终端中执行一条命令后的可见输出。
 */
export function renderShellBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return ['', ...renderShellMessageLines(text, width, theme), '', ''].join('\n');
}

/**
 * 渲染 reasoning summary 消息块；它是模型摘要而非最终 assistant 回复，视觉上保持低强调。
 *
 */
export function renderReasoningSummaryBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return [...renderReasoningSummaryLines(text, width, theme), '', ''].join('\n');
}

/**
 * 把用户消息投影为逐行字符串，并对整行应用灰底背景。
 * plan mode 历史消息只覆盖竖条前缀，正文和背景继续使用 user block 主题 token。
 *
 */
export function renderUserMessageLines(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME, interactionMode?: string): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: USER_MESSAGE_PREFIX,
      colorizeLine: (line) => renderUserMessageLine(line, theme, interactionMode),
    repeatPrefixEveryLine: true
  });
}

function renderUserPaddingLine(width: number, theme: TuiTheme, interactionMode: string | undefined): string {
  return renderUserMessageLine(padToDisplayWidth(USER_MESSAGE_PREFIX, safeRenderWidth(width)), theme, interactionMode);
}

function renderUserMessageLine(line: string, theme: TuiTheme, interactionMode: string | undefined): string {
  const body = line.slice(USER_MESSAGE_PREFIX.length);
  const prefix = interactionMode === 'plan'
    ? colorText(theme.footer.colors.plan, USER_MESSAGE_PREFIX)
    : blockText(theme, 'userPrefix', USER_MESSAGE_PREFIX);
  return blockBackground(theme, 'userBackground', `${prefix}${blockText(theme, 'userText', body)}`);
}

/**
 * 把 assistant 正式消息投影为逐行字符串。
 *
 */
export function renderAssistantMessageLines(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderMarkdownLinesWithOptions(text, { width, prefix: '◆ ', theme: withMarkdownRoleColor(theme, theme.blocks.colors.assistantPrefix) });
}

/**
 * 把本地错误消息投影为逐行字符串。
 *
 */
export function renderErrorMessageLines(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: '✕ ',
    colorizePrefix: (prefix) => blockText(theme, 'error', prefix)
  });
}

/**
 * 把上下文压缩提示投影为逐行字符串；整体使用 dim 灰色，弱化为系统提示。
 *
 */
export function renderCompactionNoticeLines(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: '◆ ',
    colorizeLine: (line) => ansi.dim(blockText(theme, 'notice', line))
  });
}

/**
 * 把本地中断提示投影为逐行字符串；视觉上弱化，避免被误认为 assistant 或 error。
 *
 */
export function renderLocalNoticeLines(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: '◇ ',
    colorizeLine: (line) => ansi.dim(blockText(theme, 'notice', line))
  });
}

/**
 * 把 reasoning summary 投影为弱化文本；避免和 assistant final answer 混淆。
 *
 */
export function renderReasoningSummaryLines(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: '◇ ',
    colorizeLine: (line) => ansi.dim(blockText(theme, 'reasoning', line))
  });
}

export type StreamingContentKind = 'assistant' | 'reasoning';

/**
 * 返回 assistant 正文中已经越过 Markdown 完整边界、可以移入终端历史区的文本。
 * Reasoning 使用纯文本换行规则，不经过此 Markdown 边界。
 */
export function getCommittableStreamingText(text: string): string {
  return getCommittableMarkdownText(text);
}

/**
 * 返回 reasoning 中除最后一个仍可能增长的视觉行外、可以移入终端历史区的文本。
 * 使用 UTF-16 字符串位置截取，后续仍可用完整文本按当前终端宽度重新渲染。
 */
export function getCommittableReasoningText(text: string, width = 80): string {
  const safeWidth = safeRenderWidth(width);
  const prefixWidth = displayWidth('◇ ');
  let column = prefixWidth;
  let textOffset = 0;
  let committableOffset = 0;

  for (const grapheme of splitGraphemes(text)) {
    if (grapheme === '\n') {
      committableOffset = textOffset;
      textOffset += grapheme.length;
      column = prefixWidth;
      continue;
    }

    let graphemeWidth = grapheme === '\t' ? tabWidthAt(column) : charWidth(grapheme);
    if (column + graphemeWidth > safeWidth && column > prefixWidth) {
      committableOffset = textOffset;
      column = prefixWidth;
      graphemeWidth = grapheme === '\t' ? tabWidthAt(column) : charWidth(grapheme);
    }

    textOffset += grapheme.length;
    column += graphemeWidth;
  }

  return text.slice(0, committableOffset);
}

/**
 * 比较新旧两段稳定文本，返回本次需要追加到终端历史区的完整行。
 */
export function renderStreamingCommitLines(
  kind: StreamingContentKind,
  text: string,
  previousText: string,
  width = 80,
  theme: TuiTheme = DEFAULT_TUI_THEME
): string[] {
  const render = kind === 'assistant' ? renderAssistantMessageLines : renderReasoningSummaryLines;
  const previousLines = previousText === '' ? [] : render(previousText, width, theme);
  const nextLines = text === '' ? [] : render(text, width, theme);
  return nextLines.slice(previousLines.length);
}

function renderShellMessageLines(text: string, width = 80, theme: TuiTheme): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: '',
    colorizeLine: (line) => blockText(theme, 'shell', line)
  });
}

/**
 * 把 pending assistant 状态投影为逐行字符串。
 * pending 包括 thinking、reasoning_streaming、streaming、tool_call、shell_output 状态
 * thinking状态：由 status line 展示，pending preview 不再占独立行
 * reasoning_streaming状态：展示有界的可读 reasoning preview
 * streaming状态：展示模型正文流式输出内容
 * tool_call状态：展示模型调用的工具
 *
 */
export function renderPendingAssistantLines(
  pending: PendingState,
  width = 80,
  maxLines = Number.POSITIVE_INFINITY,
  theme: TuiTheme = DEFAULT_TUI_THEME
): string[] {
  const normalizedMaxLines = normalizePreviewMaxLines(maxLines);

  if (normalizedMaxLines === 0) {
    return [];
  }

  if (pending.kind === 'thinking') {
    return [];
  }

  if (pending.kind === 'tool_call') {
    return truncatePendingPreviewLines(renderToolCallPreviewLines(pending.toolName, pending.argumentsText, width, theme), width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'shell_output') {
    return renderShellOutputPendingLines(pending.command, pending.output, width, normalizedMaxLines, theme);
  }

  if (pending.kind === 'reasoning_streaming') {
    return renderReasoningPendingLines(pending.text, pending.historyText || '', width, normalizedMaxLines, theme);
  }

  return renderStreamingPendingLines(pending.text, pending.historyText || '', width, normalizedMaxLines, theme);
}

/**
 * 渲染 reasoning 流式预览；已经移入终端历史区的部分不再重复显示。
 */
function renderReasoningPendingLines(text: string, historyText: string, width: number, maxLines: number, theme: TuiTheme): string[] {
  const fullLines = renderReasoningSummaryLines(text, width, theme);
  const committedLineCount = historyText === '' ? 0 : renderReasoningSummaryLines(historyText, width, theme).length;
  const lines = fullLines.slice(committedLineCount);
  const normalizedMaxLines = normalizePreviewMaxLines(maxLines);

  if (normalizedMaxLines === 0) {
    return [];
  }

  if (lines.length <= normalizedMaxLines) {
    return lines;
  }

  const safeTextWidth = Math.max(1, safeRenderWidth(width) - displayWidth('◇ '));

  if (normalizedMaxLines === 1) {
    const summaryText = clampToDisplayWidth(`…已生成 ${lines.length} 行 reasoning`, safeTextWidth);
    return renderReasoningSummaryLines(summaryText, width, theme);
  }

  const tailLineCount = normalizedMaxLines - 1;
  const summaryText = clampToDisplayWidth(`…已生成 ${lines.length} 行 reasoning，显示最新 ${tailLineCount} 行`, safeTextWidth);
  return [renderReasoningSummaryLines(summaryText, width, theme)[0], ...lines.slice(-tailLineCount)];
}

/**
 * 渲染 shell mode 的运行中输出 preview；只做纯文本换行和尾部截断，不走 Markdown。
 */
function renderShellOutputPendingLines(command: string, output: string, width: number, maxLines: number, theme: TuiTheme): string[] {
  const text = output.trim() === '' ? `$ ${command}` : `$ ${command}\n\n${output.replace(/\n$/u, '')}`;
  const lines = renderShellMessageLines(text, width, theme);

  if (lines.length <= maxLines) {
    return lines;
  }

  if (maxLines <= 0) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  if (maxLines === 1) {
    const summary = clampToDisplayWidth(`…已生成 ${lines.length} 行`, safeWidth);
      return [blockText(theme, 'shell', padToDisplayWidth(summary, safeWidth))];
  }

  const tailLineCount = maxLines - 1;
  const summary = clampToDisplayWidth(`…已生成 ${lines.length} 行，显示最新 ${tailLineCount} 行`, safeWidth);
    return [blockText(theme, 'shell', padToDisplayWidth(summary, safeWidth)), ...lines.slice(-tailLineCount)];
}

/**
 * 渲染 streaming pending preview；长文本只保留尾部，避免 footer 高度无限增长。
 *
 */
function renderStreamingPendingLines(text: string, historyText: string, width: number, maxLines: number, theme: TuiTheme): string[] {
  const pendingTheme = withMarkdownRoleColor(theme, theme.blocks.colors.pendingPrefix);
  const fullLines = renderMarkdownLinesWithOptions(text, { width, prefix: '◇ ', theme: pendingTheme });
  const committedLineCount = historyText === ''
    ? 0
    : renderMarkdownLinesWithOptions(historyText, { width, prefix: '◇ ', theme: pendingTheme }).length;
  const lines = fullLines.slice(committedLineCount);
  const normalizedMaxLines = normalizePreviewMaxLines(maxLines);

  if (normalizedMaxLines === 0) {
    return [];
  }

  if (lines.length <= normalizedMaxLines) {
    return lines;
  }

  if (normalizedMaxLines === 1) {
    const summary = `…已生成 ${lines.length} 行`;
    const summaryText = clampToDisplayWidth(summary, Math.max(1, safeRenderWidth(width) - displayWidth('◇ ')));

    return renderSymbolMessage({
      text: summaryText,
      width,
      prefix: '◇ ',
        colorizePrefix: (prefix) => blockText(theme, 'pendingPrefix', prefix)
    });
  }

  const tailLineCount = normalizedMaxLines - 1;
  const summary = `…已生成 ${lines.length} 行，显示最新 ${tailLineCount} 行`;
  const summaryText = clampToDisplayWidth(summary, Math.max(1, safeRenderWidth(width) - displayWidth('◇ ')));
  const summaryLine = renderSymbolMessage({
    text: summaryText,
    width,
    prefix: '◇ ',
      colorizePrefix: (prefix) => blockText(theme, 'pendingPrefix', prefix)
  })[0];

  return [summaryLine, ...lines.slice(-tailLineCount)];
}

function normalizePreviewMaxLines(maxLines: number): number {
  return Number.isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : Number.POSITIVE_INFINITY;
}

function withMarkdownRoleColor(theme: TuiTheme, foreground: ThemeColor): TuiTheme {
  return {
    ...theme,
    markdown: {
      styles: {
        ...theme.markdown.styles,
        rolePrefix: {
          ...theme.markdown.styles.rolePrefix,
          foreground
        }
      }
    }
  };
}

function truncatePendingPreviewLines(lines: string[], width: number, maxLines: number, theme: TuiTheme): string[] {
  if (lines.length <= maxLines) {
    return lines;
  }

  if (maxLines <= 0) {
    return [];
  }

  if (maxLines === 1) {
    return [lines[0]];
  }

  const hiddenCount = lines.length - maxLines + 1;
  const summary = clampToDisplayWidth(`…隐藏 ${hiddenCount} 行 tool call preview`, safeRenderWidth(width));
    return [...lines.slice(0, maxLines - 1), ansi.dim(blockText(theme, 'muted', summary))];
}

/**
 * 通用符号消息 renderer：负责首行前缀、多行缩进和按当前宽度换行。
 *
 */
function renderSymbolMessage({ text, width, prefix, colorizePrefix, colorizeLine, repeatPrefixEveryLine = false }: SymbolMessageOptions): string[] {
  // 布局计算只使用未上色 prefix，避免 ANSI escape sequence 干扰显示宽度。
  const safeWidth = safeRenderWidth(width);
  const indent = ' '.repeat(displayWidth(prefix)); // 每行文本前面留出和 prefix 相同的宽度
  const renderedPrefix = colorizePrefix ? colorizePrefix(prefix) : prefix;
  const lines: string[] = [];
  let isFirstVisualLine = true;

  for (const sourceLine of text.split('\n')) {
    const wrapped = wrapContentLine(sourceLine, safeWidth, displayWidth(prefix));

    for (const contentLine of wrapped) {
      let rawLine: string;

      if (isFirstVisualLine || repeatPrefixEveryLine) {
        rawLine = `${prefix}${contentLine}`;
        isFirstVisualLine = false;
      } else {
        rawLine = `${indent}${contentLine}`;
      }

      lines.push(renderMessageLine(rawLine, safeWidth, renderedPrefix, prefix, colorizeLine));
    }
  }

  return lines.length > 0 ? lines : [renderMessageLine(prefix, safeWidth, renderedPrefix, prefix, colorizeLine)];
}

/**
 * 对单行消息应用前缀着色或整行背景着色。
 *
 */
function renderMessageLine(rawLine: string, width: number, renderedPrefix: string, rawPrefix: string, colorizeLine?: TextStyle): string {
  if (colorizeLine) {
    // 先补齐整行再上色，确保背景覆盖整条消息行。
    return colorizeLine(padToDisplayWidth(rawLine, width));
  }

  if (rawLine.startsWith(rawPrefix)) {
    return `${renderedPrefix}${rawLine.slice(rawPrefix.length)}`;
  }

  return rawLine;
}

/**
 * 把文本补齐到目标显示宽度，避免背景色在行尾提前结束。
 *
 */
function padToDisplayWidth(text: string, width: number): string {
  const currentWidth = displayWidth(text);

  if (currentWidth >= width) {
    return text;
  }

  return `${text}${' '.repeat(width - currentWidth)}`;
}

/**
 * 在扣除前缀宽度后对单个逻辑行做自动换行。
 *
 */
function wrapContentLine(text: string, width: number, prefixWidth: number): string[] {
  const lines = [''];
  let column = prefixWidth;

  for (const char of splitGraphemes(text)) {
    let widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);

    if (column + widthOfChar > width && column > prefixWidth) {
      lines.push('');
      column = prefixWidth;
      widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
    }

    lines[lines.length - 1] += char === '\t' ? ' '.repeat(widthOfChar) : char;
    column += widthOfChar;
  }

  return lines;
}
