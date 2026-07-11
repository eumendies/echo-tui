import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {markdownStyle} from '../colors';
import {charWidth, displayWidth, safeRenderWidth, splitGraphemes, stripAnsi} from '../layout';
import {mergeAdjacentSpans, type StyledSpan, type TextStyle} from './markdown-inline';

type RenderStyledLineOptions = {
  prefix: string;
  contentPrefix?: string;
  continuationPrefix?: string;
  spans: StyledSpan[];
  width: number;
  lineStyle?: TextStyle;
  theme?: TuiTheme;
};

/**
 * 对 styled spans 做可见宽度换行，再对输出片段应用 ANSI 样式。
 */
function renderStyledLine(options: RenderStyledLineOptions): string[] {
  const theme = options.theme || DEFAULT_TUI_THEME;
  const safeWidth = safeRenderWidth(options.width);
  const visibleContentPrefix = stripAnsi(options.contentPrefix ?? '');
  const visibleContinuationPrefix = options.continuationPrefix ?? ' '.repeat(displayWidth(visibleContentPrefix));
  const roleContinuationPrefix = ' '.repeat(displayWidth(options.prefix));
  const firstPrefixWidth = displayWidth(options.prefix) + displayWidth(visibleContentPrefix);
  const continuationPrefixWidth = displayWidth(roleContinuationPrefix) + displayWidth(visibleContinuationPrefix);
  const lines: string[] = [];
  let currentSpans: StyledSpan[] = [];
  let currentWidth = firstPrefixWidth;
  let lineIndex = 0;

  function flushLine(): void {
    const rolePrefix = lineIndex === 0 ? options.prefix : roleContinuationPrefix;
    const contentPrefix = lineIndex === 0 ? options.contentPrefix ?? '' : visibleContinuationPrefix;
    lines.push(renderPhysicalLine(rolePrefix, contentPrefix, currentSpans, theme, options.lineStyle));
    currentSpans = [];
    currentWidth = continuationPrefixWidth;
    lineIndex += 1;
  }

  for (const span of options.spans) {
    for (const char of splitGraphemes(span.text)) {
      const widthOfChar = charWidth(char);
      if (currentWidth + widthOfChar > safeWidth && currentWidth > (lineIndex === 0 ? firstPrefixWidth : continuationPrefixWidth)) {
        flushLine();
      }

      currentSpans.push({text: char, style: span.style});
      currentWidth += widthOfChar;
    }
  }

  flushLine();
  return lines;
}

/**
 * 输出单条物理行，所有 ANSI 样式都在这里闭合。
 */
function renderPhysicalLine(prefix: string, contentPrefix: string, spans: StyledSpan[], theme: TuiTheme, lineStyle?: TextStyle): string {
  const renderedSpans = mergeAdjacentSpans(spans)
    .map((span) => (span.style ? span.style(span.text) : span.text))
    .join('');
  const content = `${contentPrefix}${renderedSpans}`;
  return `${styleRolePrefix(prefix, theme)}${lineStyle ? lineStyle(content) : content}`;
}

/**
 * 给 assistant/pending role prefix 上色，缩进行保持原样空格。
 */
function styleRolePrefix(prefix: string, theme: TuiTheme = DEFAULT_TUI_THEME): string {
  return prefix.trim().length > 0 ? markdownStyle(theme, 'rolePrefix', prefix) : prefix;
}

export {renderStyledLine, styleRolePrefix};
export type {RenderStyledLineOptions};
