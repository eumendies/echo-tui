import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {charWidth, displayWidth, safeRenderWidth, splitGraphemes, stripAnsi, tabWidthAt} from '../layout';

const TOOL_RESULT_MAX_DISPLAY_LINES = 12;
const TOOL_RESULT_TRUNCATION_TEXT = '[tool output truncated for display]';

const TOOL_DISPLAY_NAMES = new Map<string, string>([
  ['apply_patch', 'Apply patch'],
  ['ask_user_questions', 'Ask user questions'],
  ['complete_todo', 'Complete todo'],
  ['create_todos', 'Create todos'],
  ['edit_file', 'Edit file'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['read_files', 'Read files'],
  ['run_bash_command', 'Bash'],
  ['run_subagent', 'Run subagent'],
  ['use_skill', 'Use skill'],
  ['web_fetch', 'Web fetch'],
  ['web_search', 'Web search']
]);

type ToolRecordRenderOptions = {
  callStatus?: boolean;
};

type ToolRailStyle = 'tool' | 'toolError' | 'toolOutput' | 'toolSuccess';
type ToolRailStatusStyle = 'toolError' | 'toolOutput' | 'toolSuccess';

type ToolRailRow<Style extends string> = {
  style: Style; // 当前逻辑行交给调用方语义着色器使用的样式标识。
  text: string; // 尚未换行或着色的 rail 正文。
};

type RenderToolRailRowsOptions<Style extends string> = {
  colorizeContent: (style: Style, text: string, theme: TuiTheme) => string; // 把一段物理行正文映射为语义样式。
  includeMarker: boolean; // 首个物理行是否展示状态 marker。
  markerStyle: ToolRailStatusStyle; // 状态 marker 的 blocks token。
  railStyle: ToolRailStyle; // 连续 rail 的 blocks token。
  rows: ToolRailRow<Style>[]; // 按原始顺序渲染的逻辑行。
  theme: TuiTheme; // 当前运行固定的完整主题。
  width: number; // 包含 marker、rail 与正文的终端总宽度。
};

/**
 * 将协议层工具标识符投影为 sentence case 标题；标准 MCP 名称保留 server/tool 来源层级。
 */
function formatToolDisplayName(toolName: unknown): string {
  const normalizedName = typeof toolName === 'string' ? toolName.trim() : '';

  if (normalizedName === '') {
    return 'Tool';
  }

  const knownName = TOOL_DISPLAY_NAMES.get(normalizedName);

  if (knownName) {
    return knownName;
  }

  const mcpSegments = normalizedName.split('__');

  if (mcpSegments.length === 3 && mcpSegments[0] === 'mcp' && mcpSegments[1] && mcpSegments[2]) {
    return `MCP · ${formatMcpServerName(mcpSegments[1])} · ${formatMcpToolName(mcpSegments[2])}`;
  }

  return formatIdentifierSentenceCase(normalizedName);
}

/**
 * 使用统一分隔符组合工具身份和可信摘要，过滤空片段以避免残留装饰符。
 */
function createToolCallTitle(toolName: unknown, segments: Array<string | null | undefined> = []): string {
  return [
    formatToolDisplayName(toolName),
    ...segments.map((segment) => segment?.trim()).filter((segment): segment is string => Boolean(segment))
  ].join(' · ');
}

/**
 * 按常见标识符边界拆词并生成 sentence case，同时保留全大写缩写。
 */
function formatIdentifierSentenceCase(identifier: string): string {
  const words = splitIdentifierWords(identifier);

  if (words.length === 0) {
    return 'Tool';
  }

  return words.map((word, index) => {
    if (/^[A-Z0-9]{2,}$/u.test(word)) {
      return word;
    }

    const lower = word.toLocaleLowerCase('en-US');
    return index === 0 ? `${lower.charAt(0).toLocaleUpperCase('en-US')}${lower.slice(1)}` : lower;
  }).join(' ');
}

/**
 * MCP server 只折叠技术分隔符，保留原有品牌大小写以维持来源可辨认性。
 */
function formatMcpServerName(serverName: string): string {
  return serverName.replace(/[_-]+/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/**
 * MCP tool 是完整标题的后续语义片段，除稳定缩写外使用小写句首。
 */
function formatMcpToolName(toolName: string): string {
  const displayName = formatIdentifierSentenceCase(toolName);

  if (/^[A-Z0-9]{2,}(?:\s|$)/u.test(displayName)) {
    return displayName;
  }

  return `${displayName.charAt(0).toLocaleLowerCase('en-US')}${displayName.slice(1)}`;
}

/**
 * 识别 acronym、camel/Pascal 边界和 snake/kebab 分隔符，供可见标题统一拆词。
 */
function splitIdentifierWords(identifier: string): string[] {
  return identifier
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * 根据 tool result 执行状态选择 tool_call 符号样式，历史记录缺少状态时保持中性显示。
 */
function resolveToolCallPrefixStyle(status: unknown, theme: TuiTheme = DEFAULT_TUI_THEME): ((symbol: string) => string) | undefined {
  if (status === true) {
    return (symbol) => blockText(theme, 'toolSuccess', symbol);
  }

  if (status === false) {
    return (symbol) => blockText(theme, 'toolError', symbol);
  }

  return undefined;
}

/**
 * 只截断可见投影，不改写 transcript record，也不影响回传给模型的 tool output。
 */
function truncateDisplayText(text: string, maxLines: number): string {
  const lines = text.split('\n');
  const normalizedMaxLines = Math.max(1, Math.floor(maxLines));

  if (lines.length <= normalizedMaxLines) {
    return text;
  }

  if (normalizedMaxLines === 1) {
    return TOOL_RESULT_TRUNCATION_TEXT;
  }

  return [...lines.slice(0, normalizedMaxLines - 1), TOOL_RESULT_TRUNCATION_TEXT].join('\n');
}

/**
 * 渲染带首行前缀和 continuation 缩进的工具消息行，并在样式前完成宽度计算。
 */
function renderPrefixedLines(options: {
  text: string;
  width: number;
  firstPrefix: string;
  continuationPrefix: string;
  colorizeFirstSymbol?: (symbol: string) => string;
  colorizeLine?: (line: string) => string;
}): string[] {
  const safeWidth = safeRenderWidth(options.width);
  const lines: string[] = [];
  let first = true;

  for (const sourceLine of splitRenderableLines(options.text)) {
    const prefix = first ? options.firstPrefix : options.continuationPrefix;
    const wrapped = wrapContentLine(sourceLine, safeWidth, displayWidth(prefix));

    for (const contentLine of wrapped) {
      const linePrefix = first ? options.firstPrefix : options.continuationPrefix;
      const renderedPrefix = first ? renderFirstPrefix(linePrefix, options.colorizeFirstSymbol) : linePrefix;
      const rawLine = `${renderedPrefix}${contentLine}`;
      lines.push(options.colorizeLine ? options.colorizeLine(rawLine) : rawLine);
      first = false;
    }
  }

  if (lines.length > 0) {
    return lines;
  }

  const rawLine = renderFirstPrefix(options.firstPrefix, options.colorizeFirstSymbol);
  return [options.colorizeLine ? options.colorizeLine(rawLine) : rawLine];
}

function renderFirstPrefix(prefix: string, colorizeFirstSymbol?: (symbol: string) => string): string {
  if (!colorizeFirstSymbol || prefix.length === 0) {
    return prefix;
  }

  const [firstSymbol, ...rest] = splitGraphemes(prefix);
  return `${colorizeFirstSymbol(firstSymbol)}${rest.join('')}`;
}

/**
 * 创建工具状态 rail 的 marker 与连续竖线；极窄终端退化为安全缩进。
 */
function createToolRailPrefix(
  first: boolean,
  width: number,
  theme: TuiTheme,
  railStyle: ToolRailStyle,
  markerStyle: ToolRailStatusStyle
): string {
  const safeWidth = safeRenderWidth(width);
  if (safeWidth >= 4) {
    const marker = first ? `${blockText(theme, markerStyle, '◆')} ` : '  ';
    return `${marker}${blockText(theme, railStyle, '▌')} `;
  }
  if (safeWidth >= 2) {
    return first ? `${blockText(theme, markerStyle, '◆')} ` : '  ';
  }
  return '';
}

/**
 * 渲染通用工具 rail 行：统一处理逻辑换行、窄宽度降级、首行 marker 与连续 rail。
 * 调用方只负责提供行语义和正文着色，不再复制 Bash 的终端布局算法。
 */
function renderToolRailRows<Style extends string>(options: RenderToolRailRowsOptions<Style>): string[] {
  const safeWidth = safeRenderWidth(options.width);
  const prefixWidth = safeWidth >= 4 ? 4 : safeWidth >= 2 ? 2 : 0;
  const rendered: string[] = [];
  let first = options.includeMarker;

  for (const row of options.rows) {
    for (const sourceLine of splitRenderableLines(row.text)) {
      for (const segment of wrapContentLine(sourceLine, safeWidth, prefixWidth)) {
        rendered.push(`${createToolRailPrefix(first, safeWidth, options.theme, options.railStyle, options.markerStyle)}${options.colorizeContent(row.style, segment, options.theme)}`);
        first = false;
      }
    }
  }

  return rendered.length > 0
    ? rendered
    : [createToolRailPrefix(options.includeMarker, safeWidth, options.theme, options.railStyle, options.markerStyle)];
}

/**
 * 按 grapheme 和显示宽度换行，避免 ANSI 样式、宽字符或制表符破坏工具输出对齐。
 */
function wrapContentLine(text: string, width: number, prefixWidth: number): string[] {
  const wrappedLines: string[] = [];

  for (const sourceLine of splitRenderableLines(text)) {
    wrappedLines.push(...wrapSingleContentLine(sourceLine, width, prefixWidth));
  }

  return wrappedLines.length > 0 ? wrappedLines : [''];
}

/**
 * 将外部文本中的 CR/LF 规范化为逻辑行，保证 renderer 返回数组元素不会暗含物理换行。
 */
function splitRenderableLines(text: string): string[] {
  return String(text).replace(/\r\n?/gu, '\n').split('\n');
}

function wrapSingleContentLine(text: string, width: number, prefixWidth: number): string[] {
  const safeWidth = Math.max(1, width);
  const normalizedPrefixWidth = Math.max(0, Math.floor(prefixWidth));
  const lines = [''];
  let column = normalizedPrefixWidth;

  for (const char of splitGraphemes(text)) {
    let widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);

    if (column + widthOfChar > safeWidth && column > normalizedPrefixWidth) {
      lines.push('');
      column = normalizedPrefixWidth;
      widthOfChar = char === '\t' ? tabWidthAt(column) : charWidth(char);
    }

    lines[lines.length - 1] += char === '\t' ? ' '.repeat(widthOfChar) : char;
    column += widthOfChar;
  }

  return lines;
}

/**
 * 保留代码空白，仅消除 ANSI 控制序列和原始换行，保证一个源行对应一个逻辑行。
 * 供 grep 匹配行与 read_files 内容预览等工具 renderer 共用。
 */
function normalizeContentText(value: string): string {
  return stripAnsi(value).replace(/\r\n?/gu, '\n').replace(/\n/gu, ' ');
}

/**
 * 按内容起始列展开 Tab，使渲染宽度与终端制表位一致。
 */
function expandTabs(value: string, startColumn: number): string {
  let column = Math.max(0, startColumn);
  let expanded = '';

  for (const grapheme of splitGraphemes(value)) {
    if (grapheme === '\t') {
      const spaces = tabWidthAt(column);
      expanded += ' '.repeat(spaces);
      column += spaces;
    } else {
      expanded += grapheme;
      column += charWidth(grapheme);
    }
  }

  return expanded;
}

/**
 * 按终端显示宽度截断纯文本，并为发生截断的内容保留省略号。
 */
function clampToDisplayWidth(value: string, maximumWidth: number): string {
  const limit = Math.max(1, Math.floor(maximumWidth));

  if (displayWidth(value) <= limit) {
    return value;
  }

  const ellipsis = '…';
  const contentLimit = Math.max(0, limit - charWidth(ellipsis));
  let output = '';
  let width = 0;

  for (const grapheme of splitGraphemes(value)) {
    const nextWidth = width + charWidth(grapheme);

    if (nextWidth > contentLimit) {
      break;
    }

    output += grapheme;
    width = nextWidth;
  }

  return `${output}${ellipsis}`;
}

export {
  clampToDisplayWidth,
  createToolCallTitle,
  TOOL_RESULT_MAX_DISPLAY_LINES,
  TOOL_RESULT_TRUNCATION_TEXT,
  createToolRailPrefix,
  expandTabs,
  formatToolDisplayName,
  normalizeContentText,
  renderPrefixedLines,
  renderToolRailRows,
  resolveToolCallPrefixStyle,
  truncateDisplayText,
  wrapContentLine
};

export type {
  ToolRecordRenderOptions
};
