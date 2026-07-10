import {DEFAULT_TUI_THEME, type TuiTheme} from '../config/theme-config';
import {markdownStyle} from './colors';
import { displayWidth, safeRenderWidth } from './layout';
import { parseInlineSpans } from './markdown-inline';
import { containsMarkdownTable, renderMarkdownTable, tryParseMarkdownTable, type MarkdownTable } from './markdown-table';
import { highlightCodeBlock } from './syntax-highlight';
import { renderStyledLine, styleRolePrefix } from './styled-line';

type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'unorderedListItem'; text: string }
  | { kind: 'orderedListItem'; marker: string; text: string }
  | { kind: 'blockquote'; text: string }
  | { kind: 'rule' }
  | { kind: 'codeFence'; language: string; lines: string[] }
  | { kind: 'table'; table: MarkdownTable }
  | { kind: 'blank' };

const FENCE_PATTERN = /^(\s*>\s?)?\s*```\s*([^`]*)\s*$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const UNORDERED_LIST_PATTERN = /^\s{0,3}[-*+]\s+(.+)$/;
const ORDERED_LIST_PATTERN = /^\s{0,3}(\d+[.)])\s+(.+)$/;
const BLOCKQUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
const RULE_PATTERN = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/**
 * 把 assistant Markdown-ish 文本投影为终端可见行；只支持高价值子集并安全降级。
 *
 * @param {string} text
 * @param {number} [width=80]
 * @param {string} [prefix='◆ ']
 * @returns {string[]}
 */
export function renderMarkdownLines(text: string, width = 80, prefix = '◆ ', theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  return renderMarkdownLinesWithOptions(text, { width, prefix, theme });
}

/**
 * 使用显式渲染选项投影 Markdown，供 app 传入启动时解析好的语法高亮配置。
 */
export function renderMarkdownLinesWithOptions(
  text: string,
  options: {width?: number; prefix?: string; theme?: TuiTheme} = {}
): string[] {
  const width = options.width ?? 80;
  const prefix = options.prefix ?? '◆ ';
  const theme = options.theme ?? DEFAULT_TUI_THEME;
  const blocks = parseMarkdownBlocks(text);
  const lines: string[] = [];
  let isFirstVisualLine = true;

  for (const block of blocks) {
    const blockLines = renderMarkdownBlock(block, width, isFirstVisualLine ? prefix : ' '.repeat(displayWidth(prefix)), theme);
    lines.push(...blockLines);
    if (blockLines.length > 0) {
      isFirstVisualLine = false;
    }
  }

  return lines.length > 0 ? lines : [markdownStyle(theme, 'rolePrefix', prefix)];
}

/**
 * 容错解析 Markdown block；streaming 的未闭合 fence 会自然延续到文本末尾。
 *
 * @param {string} text
 * @returns {MarkdownBlock[]}
 */
function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const sourceLines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  let codeFence: { language: string; lines: string[]; blockquoted: boolean } | null = null;
  let index = 0;

  while (index < sourceLines.length) {
    const sourceLine = sourceLines[index];
    const fenceMatch = sourceLine.match(FENCE_PATTERN);

    if (codeFence) {
      if (fenceMatch) {
        blocks.push(...closeCodeFence(codeFence));
        codeFence = null;
      } else {
        codeFence.lines.push(codeFence.blockquoted ? stripBlockquotePrefix(sourceLine) : sourceLine);
      }
      index += 1;
      continue;
    }

    if (fenceMatch) {
      codeFence = { language: fenceMatch[2].trim(), lines: [], blockquoted: Boolean(fenceMatch[1]) };
      index += 1;
      continue;
    }

    if (sourceLine.trim() === '') {
      blocks.push({ kind: 'blank' });
      index += 1;
      continue;
    }

    const tableResult = tryParseMarkdownTable(sourceLines, index);
    if (tableResult) {
      blocks.push({ kind: 'table', table: tableResult.table });
      index = tableResult.nextIndex;
      continue;
    }

    const headingMatch = sourceLine.match(HEADING_PATTERN);
    if (headingMatch) {
      blocks.push({ kind: 'heading', level: headingMatch[1].length, text: headingMatch[2].trim() });
      index += 1;
      continue;
    }

    const unorderedListMatch = sourceLine.match(UNORDERED_LIST_PATTERN);
    if (unorderedListMatch) {
      blocks.push({ kind: 'unorderedListItem', text: unorderedListMatch[1] });
      index += 1;
      continue;
    }

    const orderedListMatch = sourceLine.match(ORDERED_LIST_PATTERN);
    if (orderedListMatch) {
      blocks.push({ kind: 'orderedListItem', marker: orderedListMatch[1], text: orderedListMatch[2] });
      index += 1;
      continue;
    }

    const blockquoteMatch = sourceLine.match(BLOCKQUOTE_PATTERN);
    if (blockquoteMatch) {
      blocks.push({ kind: 'blockquote', text: blockquoteMatch[1] });
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(sourceLine)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    blocks.push({ kind: 'paragraph', text: sourceLine });
    index += 1;
  }

  if (codeFence) {
    blocks.push({ kind: 'codeFence', language: codeFence.language, lines: codeFence.lines });
  }

  return blocks;
}

/**
 * 关闭 fenced code block；markdown fence 中的有效 table 会保守 unwrap。
 *
 * @param {{language: string, lines: string[]}} codeFence
 * @returns {MarkdownBlock[]}
 */
function closeCodeFence(codeFence: { language: string; lines: string[] }): MarkdownBlock[] {
  if (isMarkdownFenceLanguage(codeFence.language) && containsMarkdownTable(codeFence.lines)) {
    return parseMarkdownBlocks(codeFence.lines.join('\n'));
  }

  return [{ kind: 'codeFence', language: codeFence.language, lines: codeFence.lines }];
}

/** @param {string} language @returns {boolean} */
function isMarkdownFenceLanguage(language: string): boolean {
  const firstToken = language.trim().split(/\s+/)[0] ?? '';
  return firstToken.toLowerCase() === 'md' || firstToken.toLowerCase() === 'markdown';
}

/** @param {string} line @returns {string} */
function stripBlockquotePrefix(line: string): string {
  return line.replace(/^\s*>\s?/, '');
}

/**
 * 把单个 Markdown block 渲染为带 role 前缀或缩进的终端行。
 *
 * @param {MarkdownBlock} block
 * @param {number} width
 * @param {string} prefix
 * @returns {string[]}
 */
function renderMarkdownBlock(block: MarkdownBlock, width: number, prefix: string, theme: TuiTheme): string[] {
  switch (block.kind) {
    case 'paragraph':
      return renderStyledLine({ prefix, spans: parseInlineSpans(block.text, theme), theme, width });
    case 'heading':
      return renderHeading(block, width, prefix, theme);
    case 'unorderedListItem':
      return renderStyledLine({
        prefix,
        contentPrefix: `${markdownStyle(theme, 'listMarker', '•')} `,
        continuationPrefix: '  ',
        spans: parseInlineSpans(block.text, theme),
        theme,
        width
      });
    case 'orderedListItem':
      return renderStyledLine({
        prefix,
        contentPrefix: `${markdownStyle(theme, 'listMarker', block.marker)} `,
        continuationPrefix: ' '.repeat(displayWidth(`${block.marker} `)),
        spans: parseInlineSpans(block.text, theme),
        theme,
        width
      });
    case 'blockquote':
      return renderStyledLine({
        prefix,
        contentPrefix: `${markdownStyle(theme, 'quote', '│')} `,
        continuationPrefix: '│ ',
        spans: parseInlineSpans(block.text, theme),
        theme,
        width,
        lineStyle: (text) => markdownStyle(theme, 'quote', text)
      });
    case 'rule':
      return [`${styleRolePrefix(prefix, theme)}${markdownStyle(theme, 'rule', '─'.repeat(Math.max(1, safeRenderWidth(width) - displayWidth(prefix))))}`];
    case 'codeFence':
      return renderCodeFence(block, width, prefix, theme);
    case 'table':
      return renderMarkdownTable(block.table, width, prefix, theme);
    case 'blank':
      return [prefix];
    default:
      return [prefix];
  }
}

/**
 * 渲染 heading，去掉 Markdown marker 并使用强调样式。
 *
 * @param {{level: number, text: string}} block
 * @param {number} width
 * @param {string} prefix
 * @returns {string[]}
 */
function renderHeading(block: Extract<MarkdownBlock, { kind: 'heading' }>, width: number, prefix: string, theme: TuiTheme): string[] {
  const style = block.level <= 2 ? (text: string): string => markdownStyle(theme, 'heading', text) : (text: string): string => markdownStyle(theme, 'bold', text);
  return renderStyledLine({ prefix, spans: [{ text: block.text, style }], theme, width });
}

/**
 * 渲染 fenced code block：不画边框，只保留缩进并直接高亮代码内容。
 *
 * @param {{language: string, lines: string[]}} block
 * @param {number} width
 * @param {string} prefix
 * @returns {string[]}
 */
function renderCodeFence(block: Extract<MarkdownBlock, { kind: 'codeFence' }>, width: number, prefix: string, theme: TuiTheme): string[] {
  const lines: string[] = [];

  if (block.lines.length === 0) {
    lines.push(`${styleRolePrefix(prefix, theme)}${markdownStyle(theme, 'italic', '')}`);
    return lines;
  }

  for (const spans of highlightCodeBlock(block.lines, theme.syntax)) {
    const rendered = renderStyledLine({ prefix, spans, theme, width });
    lines.push(...rendered);
    prefix = ' '.repeat(displayWidth(prefix));
  }

  return lines;
}
