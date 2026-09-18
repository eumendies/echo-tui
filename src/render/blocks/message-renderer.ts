/**
 * 各 role 的消息行与 block 渲染：user/reference/assistant/error/compaction/local notice/reasoning，
 * 以及被运行期投影复用的 shell 消息行与 block。
 */
import * as ansi from '../../terminal/ansi';
import {blockBackground, blockText, colorText} from '../colors';
import {DEFAULT_TUI_THEME, type ThemeColor, type TuiTheme} from '../../config/theme-config';
import {safeRenderWidth} from '../layout';
import {renderMarkdownLinesWithOptions} from '../markdown';
import {clampToDisplayWidth, padToDisplayWidth, renderSymbolMessage} from './symbol-message-renderer';

const USER_MESSAGE_PREFIX = '▌ ';

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
 * 渲染 shell execution 消息块的完整行数组（前导空行 + 消息行 + 尾部空行）。
 * 供 shell 运行期投影重建已确定前缀复用；字符串拼接结果与 renderShellBlock 一致。
 */
export function renderShellBlockLines(text: string, width = 80, theme: TuiTheme): string[] {
  return ['', ...renderShellMessageLines(text, width, theme), '', ''];
}

export function renderShellBlock(text: string, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return renderShellBlockLines(text, width, theme).join('\n');
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

/** 把 shell 消息文本投影为逐行字符串；运行期投影与 record block 共用同一渲染口径。 */
export function renderShellMessageLines(text: string, width = 80, theme: TuiTheme): string[] {
  return renderSymbolMessage({
    text,
    width,
    prefix: '',
    colorizeLine: (line) => blockText(theme, 'shell', line)
  });
}

export function withMarkdownRoleColor(theme: TuiTheme, foreground: ThemeColor): TuiTheme {
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
