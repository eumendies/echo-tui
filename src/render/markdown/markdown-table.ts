import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {markdownStyle} from '../colors';
import { charWidth, displayWidth, safeRenderWidth, splitGraphemes, stripAnsi } from '../layout';
import { mergeAdjacentSpans, parseInlineSpans, type StyledSpan, type TextStyle } from './markdown-inline';

export type TableAlignment = 'left' | 'right' | 'center';

export type MarkdownTable = {
  header: string[];
  alignments: TableAlignment[];
  rows: string[][];
  sourceLines: string[];
};

export type ParseTableResult = {
  table: MarkdownTable;
  nextIndex: number;
};

type CellLine = {
  spans: StyledSpan[];
  width: number;
};

type ColumnWidthStats = {
  natural: number; // 单元格完全不换行时需要的宽度
  preferredMinimum: number; // 正常终端宽度下优先保留的可读下限
};

const MIN_COLUMN_WIDTH = 3;
// 长文本列保留 16 列，约等于 8 个中文字符，避免压缩后变成接近竖排的阅读体验。
const READABLE_TEXT_COLUMN_WIDTH = 16;
// 用显示宽度识别需要换行的长文本列，避免依赖空格分词导致中文长句判断不稳定。
const LONG_TEXT_COLUMN_THRESHOLD = 24;
const CELL_PADDING = 1;
const COLUMN_SEPARATOR = '│';
const HEADER_SEPARATOR = '┼';
const HEADER_FILL = '─';

/**
 * 从指定行尝试解析连续 Markdown pipe table。
 *
 * @param {string[]} lines
 * @param {number} startIndex
 * @returns {ParseTableResult | null}
 */
export function tryParseMarkdownTable(lines: string[], startIndex: number): ParseTableResult | null {
  const header = parseTableSegments(lines[startIndex]);
  const delimiter = parseTableSegments(lines[startIndex + 1]);

  if (!header || !delimiter || !isTableHeaderSegments(header) || !isDelimiterSegments(delimiter)) {
    return null;
  }

  const columnCount = delimiter.length;
  if (columnCount < 1) {
    return null;
  }

  const rows: string[][] = [];
  const sourceLines = [lines[startIndex], lines[startIndex + 1]];
  let index = startIndex + 2;

  while (index < lines.length) {
    const segments = parseTableSegments(lines[index]);
    if (!segments || lines[index].trim() === '') {
      break;
    }

    rows.push(normalizeRow(segments, columnCount));
    sourceLines.push(lines[index]);
    index += 1;
  }

  return {
    table: {
      header: normalizeRow(header, columnCount),
      alignments: delimiter.map(parseAlignment),
      rows,
      sourceLines
    },
    nextIndex: index
  };
}

/**
 * 判断一组源行里是否包含有效 Markdown pipe table。
 *
 * @param {string[]} lines
 * @returns {boolean}
 */
export function containsMarkdownTable(lines: string[]): boolean {
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (tryParseMarkdownTable(lines, index)) {
      return true;
    }
  }

  return false;
}

/**
 * 渲染 Markdown table 为无外框 Unicode 内部分隔线表格。
 *
 * @param {MarkdownTable} table
 * @param {number} width
 * @param {string} prefix
 * @returns {string[]}
 */
export function renderMarkdownTable(table: MarkdownTable, width: number, prefix: string, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  const safeWidth = safeRenderWidth(width);
  const prefixWidth = displayWidth(prefix);
  const continuationPrefix = ' '.repeat(prefixWidth);
  const columnCount = table.header.length;
  const separatorWidth = Math.max(0, columnCount - 1) * (CELL_PADDING * 2 + displayWidth(COLUMN_SEPARATOR));
  const availableContentWidth = safeWidth - prefixWidth - separatorWidth;

  if (columnCount < 1 || availableContentWidth < columnCount * MIN_COLUMN_WIDTH) {
    return renderFallbackRows(table.sourceLines, width, prefix, theme);
  }

  const widths = computeColumnWidths(table, availableContentWidth);
  const headerLines = renderTableRow(table.header, table.alignments, widths, prefix, theme, (text) => markdownStyle(theme, 'tableHeader', text));
  const divider = renderDivider(widths, continuationPrefix, theme);
  const bodyLines = table.rows.flatMap((row) => renderTableRow(row, table.alignments, widths, continuationPrefix, theme));

  return [...headerLines, divider, ...bodyLines];
}

/**
 * Split pipe-delimited line into trimmed cells, ignoring escaped pipe syntax.
 *
 * @param {string} line
 * @returns {string[] | null}
 */
function parseTableSegments(line: string | undefined): string[] | null {
  if (line === undefined) {
    return null;
  }

  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }

  const hasOuterPipe = trimmed.startsWith('|') || trimmed.endsWith('|');
  const withoutLeading = trimmed.startsWith('|') ? trimmed.slice(1) : trimmed;
  const content = withoutLeading.endsWith('|') ? withoutLeading.slice(0, -1) : withoutLeading;
  const segments = splitUnescapedPipe(content);

  if (!hasOuterPipe && segments.length <= 1) {
    return null;
  }

  return segments.map((segment) => segment.trim().replace(/\\\|/g, '|'));
}

/** @param {string} content @returns {string[]} */
function splitUnescapedPipe(content: string): string[] {
  const segments: string[] = [];
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\\') {
      index += 1;
      continue;
    }

    if (content[index] === '|') {
      segments.push(content.slice(start, index));
      start = index + 1;
    }
  }

  segments.push(content.slice(start));
  return segments;
}

/** @param {string[]} segments @returns {boolean} */
function isTableHeaderSegments(segments: string[]): boolean {
  return segments.some((segment) => segment.trim() !== '');
}

/** @param {string[]} segments @returns {boolean} */
function isDelimiterSegments(segments: string[]): boolean {
  return segments.length > 0 && segments.every(isDelimiterSegment);
}

/** @param {string} segment @returns {boolean} */
function isDelimiterSegment(segment: string): boolean {
  const trimmed = segment.trim();
  if (trimmed === '') {
    return false;
  }

  const withoutLeading = trimmed.startsWith(':') ? trimmed.slice(1) : trimmed;
  const withoutTrailing = withoutLeading.endsWith(':') ? withoutLeading.slice(0, -1) : withoutLeading;
  return withoutTrailing.length >= 3 && /^-+$/.test(withoutTrailing);
}

/** @param {string} delimiter @returns {TableAlignment} */
function parseAlignment(delimiter: string): TableAlignment {
  const trimmed = delimiter.trim();
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');

  if (left && right) {
    return 'center';
  }

  if (right) {
    return 'right';
  }

  return 'left';
}

/** @param {string[]} row @param {number} columnCount @returns {string[]} */
function normalizeRow(row: string[], columnCount: number): string[] {
  const normalized = row.slice(0, columnCount);
  while (normalized.length < columnCount) {
    normalized.push('');
  }
  return normalized;
}

/**
 * 为表格内容区分配列宽，先保证自然宽度，空间不足时保留长文本列的可读下限。
 *
 * 分配分三段：自然宽度能放下时不换行；放不下但可读下限能放下时，从可读下限向自然宽度按需扩展；
 * 连可读下限都放不下时，才从硬下限向可读下限退化。这样长文本列会主动换行，但不会被优先压成竖排。
 *
 * @param {MarkdownTable} table
 * @param {number} availableContentWidth
 * @returns {number[]}
 */
function computeColumnWidths(table: MarkdownTable, availableContentWidth: number): number[] {
  const allRows = [table.header, ...table.rows];
  const stats = table.header.map((_cell, columnIndex) => computeColumnWidthStats(allRows, columnIndex));
  const naturalWidths = stats.map((stat) => stat.natural);
  const naturalTotal = sumWidths(naturalWidths);

  if (naturalTotal <= availableContentWidth) {
    return naturalWidths;
  }

  const preferredMinimums = stats.map((stat) => stat.preferredMinimum);
  if (sumWidths(preferredMinimums) <= availableContentWidth) {
    return distributeColumnWidths(preferredMinimums, naturalWidths, availableContentWidth);
  }

  return distributeColumnWidths(stats.map(() => MIN_COLUMN_WIDTH), preferredMinimums, availableContentWidth);
}

/**
 * 统计单列宽度边界，把“可换行的长文本”和“短字段/标签列”区分开。
 *
 * 长文本列不会直接使用自然宽度作为最小值，而是保留一个可读下限；短字段列通常应完整显示，避免为了扩展长文本而被截得过窄。
 *
 * @param {string[][]} rows
 * @param {number} columnIndex
 * @returns {ColumnWidthStats}
 */
function computeColumnWidthStats(rows: string[][], columnIndex: number): ColumnWidthStats {
  const cells = rows.map((row) => row[columnIndex] ?? '');
  const natural = Math.max(...cells.map(displayWidth), MIN_COLUMN_WIDTH);
  const preferredMinimum = isLongTextColumn(cells) ? Math.min(natural, READABLE_TEXT_COLUMN_WIDTH) : natural;

  return {
    natural,
    preferredMinimum: Math.max(MIN_COLUMN_WIDTH, preferredMinimum)
  };
}

/**
 * 判断某列是否包含需要换行排版的长文本。
 *
 * 这里使用终端显示宽度而不是单词数量，因为中文、emoji 和内联代码都可能没有稳定的空格分隔。
 *
 * @param {string[]} cells
 * @returns {boolean}
 */
function isLongTextColumn(cells: string[]): boolean {
  return cells.some((cell) => displayWidth(cell) >= LONG_TEXT_COLUMN_THRESHOLD);
}

/**
 * 在 base 和 target 两组边界之间按需求比例分配剩余列宽。
 *
 * base 是必须满足的下限，target 是希望达到的宽度；当剩余空间不足以达到 target 时，按各列缺口比例分配，
 * 再用小数余量顺序补齐，保证总宽度稳定落在可用内容区内。
 *
 * @param {number[]} baseWidths
 * @param {number[]} targetWidths
 * @param {number} availableContentWidth
 * @returns {number[]}
 */
function distributeColumnWidths(baseWidths: number[], targetWidths: number[], availableContentWidth: number): number[] {
  const widths = [...baseWidths];
  let remaining = availableContentWidth - sumWidths(widths);
  if (remaining <= 0) {
    return widths;
  }

  const demands = targetWidths.map((target, index) => Math.max(0, target - widths[index]));
  const totalDemand = sumWidths(demands);
  if (totalDemand <= 0) {
    return widths;
  }

  if (totalDemand <= remaining) {
    return [...targetWidths];
  }

  const allocations = demands.map((demand) => Math.floor((remaining * demand) / totalDemand));
  for (let index = 0; index < widths.length; index += 1) {
    widths[index] += allocations[index];
  }
  remaining -= sumWidths(allocations);

  const fractionalOrder = demands
    .map((demand, index) => ({
      index,
      fraction: (availableContentWidth - sumWidths(baseWidths)) * demand / totalDemand - allocations[index],
      demand
    }))
    .sort((a, b) => b.fraction - a.fraction || b.demand - a.demand || a.index - b.index);

  for (const item of fractionalOrder) {
    if (remaining <= 0) {
      break;
    }

    if (widths[item.index] < targetWidths[item.index]) {
      widths[item.index] += 1;
      remaining -= 1;
    }
  }

  return widths;
}

/** @param {number[]} widths @returns {number} */
function sumWidths(widths: number[]): number {
  return widths.reduce((sum, value) => sum + value, 0);
}

function renderTableRow(cells: string[], alignments: TableAlignment[], widths: number[], prefix: string, theme: TuiTheme, lineStyle?: TextStyle): string[] {
  const wrappedCells = cells.map((cell, index) => wrapCell(parseInlineSpans(cell, theme), widths[index]));
  const rowHeight = Math.max(...wrappedCells.map((cellLines) => cellLines.length), 1);
  const lines: string[] = [];

  for (let rowLineIndex = 0; rowLineIndex < rowHeight; rowLineIndex += 1) {
    const renderedCells = wrappedCells.map((cellLines, columnIndex) => {
      const line = cellLines[rowLineIndex] ?? { spans: [], width: 0 };
      return renderAlignedCellLine(line, widths[columnIndex], alignments[columnIndex]);
    });
    const content = renderedCells.join(markdownStyle(theme, 'tableSeparator', ` ${COLUMN_SEPARATOR} `));
    lines.push(`${styleRolePrefix(prefix, theme)}${lineStyle ? lineStyle(content) : content}`);
    prefix = ' '.repeat(displayWidth(prefix));
  }

  return lines;
}

/** @param {StyledSpan[]} spans @param {number} width @returns {CellLine[]} */
function wrapCell(spans: StyledSpan[], width: number): CellLine[] {
  const lines: CellLine[] = [];
  let currentSpans: StyledSpan[] = [];
  let currentWidth = 0;

  function flush(): void {
    lines.push({ spans: currentSpans, width: currentWidth });
    currentSpans = [];
    currentWidth = 0;
  }

  for (const span of spans) {
    for (const char of splitGraphemes(span.text)) {
      const widthOfChar = charWidth(char);
      if (currentWidth + widthOfChar > width && currentWidth > 0) {
        flush();
      }

      currentSpans.push({ text: char, style: span.style });
      currentWidth += widthOfChar;
    }
  }

  flush();
  return lines.length > 0 ? lines : [{ spans: [], width: 0 }];
}

/** @param {CellLine} line @param {number} width @param {TableAlignment} alignment @returns {string} */
function renderAlignedCellLine(line: CellLine, width: number, alignment: TableAlignment): string {
  const padding = Math.max(0, width - line.width);
  const leftPadding = alignment === 'right' ? padding : alignment === 'center' ? Math.floor(padding / 2) : 0;
  const rightPadding = padding - leftPadding;
  const rendered = mergeAdjacentSpans(line.spans)
    .map((span) => (span.style ? span.style(span.text) : span.text))
    .join('');
  return `${' '.repeat(leftPadding)}${rendered}${' '.repeat(rightPadding)}`;
}

/** @param {number[]} widths @param {string} prefix @returns {string} */
function renderDivider(widths: number[], prefix: string, theme: TuiTheme): string {
  const segments = widths.map((width) => HEADER_FILL.repeat(width));
  return `${styleRolePrefix(prefix, theme)}${markdownStyle(theme, 'tableSeparator', segments.join(`${HEADER_FILL.repeat(CELL_PADDING)}${HEADER_SEPARATOR}${HEADER_FILL.repeat(CELL_PADDING)}`))}`;
}

/** @param {string[]} sourceLines @param {number} width @param {string} prefix @returns {string[]} */
function renderFallbackRows(sourceLines: string[], width: number, prefix: string, theme: TuiTheme): string[] {
  const safeWidth = safeRenderWidth(width);
  const lines: string[] = [];

  for (const sourceLine of sourceLines) {
    let current = styleRolePrefix(prefix, theme);
    let currentWidth = displayWidth(prefix);

    for (const char of splitGraphemes(sourceLine)) {
      const widthOfChar = charWidth(char);
      if (currentWidth + widthOfChar > safeWidth && currentWidth > displayWidth(prefix)) {
        lines.push(current);
        prefix = ' '.repeat(displayWidth(prefix));
        current = prefix;
        currentWidth = displayWidth(prefix);
      }

      current += char;
      currentWidth += widthOfChar;
    }

    lines.push(current);
    prefix = ' '.repeat(displayWidth(prefix));
  }

  return lines.length > 0 ? lines : [prefix];
}

/** @param {string} prefix @returns {string} */
function styleRolePrefix(prefix: string, theme: TuiTheme): string {
  return stripAnsi(prefix).trim().length > 0 ? markdownStyle(theme, 'rolePrefix', prefix) : prefix;
}
