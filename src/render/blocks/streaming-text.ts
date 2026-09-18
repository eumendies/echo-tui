/**
 * streaming 稳定文本边界：可提交的 Markdown/视觉行前缀与 commit 行投影。
 */
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import { charWidth, displayWidth, safeRenderWidth, splitGraphemes, tabWidthAt } from '../layout';
import {getCommittableMarkdownText} from '../markdown';
import {renderAssistantMessageLines, renderReasoningSummaryLines} from './message-renderer';

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
