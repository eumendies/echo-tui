import {blockText} from '../colors';
import {charWidth, displayWidth, safeRenderWidth, splitGraphemes, stripAnsi} from '../layout';
import {renderStyledLine} from '../markdown/styled-line';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText,
  wrapContentLine
} from './shared';

import type {TuiTheme} from '../../config/theme-config';
import type {GlobDisplayMetadata} from '../../types/tool';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const GLOB_TOOL_NAME = 'glob';
const GLOB_FAILURE_PREFIX = 'glob failed.\nReason: ';
const GLOB_PATH_MAX_PHYSICAL_LINES = 2;
const GLOB_MAX_PATTERN_GRAPHEMES = 160;
const GLOB_MAX_ROOT_GRAPHEMES = 72;
const GLOB_MAX_SCOPE_ROOTS = 3;

type GlobCallDisplay = {
  paths: string[]; // 用于 scope 行的搜索根路径，缺失调用参数时规范化为当前目录。
  pattern: string; // 已折叠控制换行并限制长度的可见 glob pattern。
};

/**
 * 渲染 pending 或孤立 glob call，使用查询标题与独立 scope 行隐藏原始 JSON。
 */
function renderGlobToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] | null {
  const request = parseGlobCall(record.argumentsText);
  if (!request) {
    return null;
  }

  const status = callStatus === undefined ? 'searching' : callStatus ? 'complete' : 'failed';
  return [
    ...renderGlobHeaderLines(request, status, callStatus, width, theme),
    ...renderGlobScopeLines(request, width, theme)
  ];
}

/**
 * 将相邻 glob call/result 投影成共享标题、scope 和结构化扁平路径树。
 */
function renderGlobToolPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] | null {
  const request = parseGlobCall(call.argumentsText);
  if (!request) {
    return null;
  }

  if (!result.ok) {
    const reason = parseGlobFailure(result.text);
    if (!reason) {
      return null;
    }

    return [
      ...renderGlobHeaderLines(request, 'failed', false, width, theme),
      ...renderGlobScopeLines(request, width, theme),
      ...renderGlobFailureLines(reason, width, theme)
    ];
  }

  if (result.details.kind !== 'glob' || !isGlobDisplayMetadata(result.details.display)) {
    return null;
  }

  const display = result.details.display;
  const lines = [
    ...renderGlobHeaderLines(request, createGlobSuccessStatus(display.paths.length, result.details.truncated), true, width, theme),
    ...renderGlobScopeLines(request, width, theme)
  ];

  if (display.paths.length > 0) {
    const treeLines = renderGlobPathTreeLines(display, width, theme);
    if (!treeLines) {
      return null;
    }
    lines.push(...treeLines);
  }

  return lines;
}

/** 保守解析 glob arguments；任一已知字段形状不可信时整体交给通用 renderer。 */
function parseGlobCall(argumentsText: unknown): GlobCallDisplay | null {
  if (typeof argumentsText !== 'string') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const payload = parsed as Record<string, unknown>;
  const pattern = typeof payload.pattern === 'string' ? normalizeHeaderText(payload.pattern) : '';
  const paths = parseGlobPaths(payload.paths);
  if (!pattern || !paths) {
    return null;
  }

  return {
    pattern: ellipsizeGraphemes(pattern, GLOB_MAX_PATTERN_GRAPHEMES),
    paths
  };
}

/** 解析 roots 并补齐默认当前目录；这里只校验展示形状，不重复执行文件系统约束。 */
function parseGlobPaths(value: unknown): string[] | null {
  if (value === undefined || value === null) {
    return ['.'];
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const paths: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      return null;
    }
    const normalized = normalizeHeaderText(candidate);
    if (!normalized) {
      return null;
    }
    paths.push(ellipsizeGraphemes(normalized, GLOB_MAX_ROOT_GRAPHEMES));
  }
  return paths;
}

/** 校验持久化或运行期 glob display metadata，避免从部分可信数据构造路径树。 */
function isGlobDisplayMetadata(value: unknown): value is GlobDisplayMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const display = value as Partial<GlobDisplayMetadata>;
  return display.kind === 'glob' && Array.isArray(display.paths) &&
    display.paths.every((path) => typeof path === 'string' && path.trim() !== '');
}

/** 渲染带状态色 marker 的 glob 查询标题。 */
function renderGlobHeaderLines(
  request: GlobCallDisplay,
  status: string,
  callStatus: boolean | undefined,
  width: number,
  theme: TuiTheme
): string[] {
  const markerStyle = resolveToolCallPrefixStyle(callStatus, theme);
  return renderStyledLine({
    prefix: '',
    contentPrefix: `${markerStyle ? markerStyle('◆') : '◆'} `,
    continuationPrefix: '  ',
    spans: [{text: `Glob · “${request.pattern}” · ${status}`}],
    theme,
    width
  });
}

/** 渲染只包含搜索 roots 的第二层 scope metadata。 */
function renderGlobScopeLines(request: GlobCallDisplay, width: number, theme: TuiTheme): string[] {
  const visiblePaths = request.paths.slice(0, GLOB_MAX_SCOPE_ROOTS);
  const omitted = request.paths.length - visiblePaths.length;
  const pathText = omitted > 0 ? `${visiblePaths.join(', ')} · +${omitted} paths` : visiblePaths.join(', ');

  return renderPrefixedLines({
    text: `in ${pathText}`,
    width,
    firstPrefix: '  ',
    continuationPrefix: '  ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/** 根据结构化数量与 handler 截断事实生成完成态标题。 */
function createGlobSuccessStatus(pathCount: number, truncated: boolean): string {
  if (pathCount === 0) {
    return 'no files';
  }
  if (truncated) {
    return `${pathCount} files shown · more available`;
  }
  return `${pathCount} ${pathCount === 1 ? 'file' : 'files'}`;
}

/** 从固定失败 envelope 中提取原因，避免重复展示内部协议标题。 */
function parseGlobFailure(text: unknown): string | null {
  if (typeof text !== 'string') {
    return null;
  }
  const normalized = text.replace(/\r\n?/gu, '\n');
  if (!normalized.startsWith(GLOB_FAILURE_PREFIX)) {
    return null;
  }
  const reason = normalized.slice(GLOB_FAILURE_PREFIX.length).trim();
  return reason || null;
}

/** 渲染有界 glob 失败诊断。 */
function renderGlobFailureLines(reason: string, width: number, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text: truncateDisplayText(reason, TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/**
 * 只按共享物理行预算选择前序路径，并在专属树无法满足 safe width 时触发通用 fallback。
 */
function renderGlobPathTreeLines(display: GlobDisplayMetadata, width: number, theme: TuiTheme): string[] | null {
  const total = display.paths.length;
  let visibleCount = Math.min(total, TOOL_RESULT_MAX_DISPLAY_LINES);

  while (visibleCount > 0) {
    const lines = renderVisibleGlobPaths(display.paths.slice(0, visibleCount), total - visibleCount, width, theme);
    if (lines.length <= TOOL_RESULT_MAX_DISPLAY_LINES) {
      return globTreeLinesFitWidth(lines, width) ? lines : null;
    }
    visibleCount -= 1;
  }

  return null;
}

/** 渲染扁平文件节点和末尾可计数省略节点，不重建目录层级。 */
function renderVisibleGlobPaths(paths: string[], omitted: number, width: number, theme: TuiTheme): string[] {
  const lines: string[] = [];
  paths.forEach((path, index) => {
    const hasFollowingNode = index < paths.length - 1 || omitted > 0;
    lines.push(...renderGlobPathLines(path, hasFollowingNode, width, theme));
  });

  if (omitted > 0) {
    lines.push(...renderGlobTreeNodeLines(`… ${omitted} more ${omitted === 1 ? 'file' : 'files'}`, false, width, theme, 1));
  }
  return lines;
}

/** 规范化并渲染单个路径逻辑节点，最多占用两个物理行。 */
function renderGlobPathLines(path: string, hasFollowingNode: boolean, width: number, theme: TuiTheme): string[] {
  return renderGlobTreeNodeLines(normalizePathText(path), hasFollowingNode, width, theme, GLOB_PATH_MAX_PHYSICAL_LINES);
}

/** 渲染一条扁平树节点，并在超出单节点预算时给末行追加省略号。 */
function renderGlobTreeNodeLines(
  text: string,
  hasFollowingNode: boolean,
  width: number,
  theme: TuiTheme,
  maxPhysicalLines: number
): string[] {
  const firstPrefix = hasFollowingNode ? '  ├─ ' : '  └─ ';
  const continuationPrefix = hasFollowingNode ? '  │  ' : '     ';
  const safeWidth = safeRenderWidth(width);
  const prefixWidth = displayWidth(firstPrefix);
  const wrapped = wrapContentLine(text, safeWidth, prefixWidth);
  const visible = wrapped.slice(0, maxPhysicalLines);

  if (wrapped.length > maxPhysicalLines && visible.length > 0) {
    visible[visible.length - 1] = clampToDisplayWidth(`${visible[visible.length - 1]}…`, Math.max(1, safeWidth - prefixWidth));
  }

  return visible.map((line, index) => blockText(theme, 'toolOutput', `${index === 0 ? firstPrefix : continuationPrefix}${line}`));
}

/** 检查最终树行宽度，避免固定前缀在极窄终端突破 safe width。 */
function globTreeLinesFitWidth(lines: string[], width: number): boolean {
  const safeWidth = safeRenderWidth(width);
  return lines.every((line) => displayWidth(line) <= safeWidth);
}

/** 将标题和 scope 字段折叠为空格并移除可执行 ANSI 序列。 */
function normalizeHeaderText(value: string): string {
  return stripAnsi(value).replace(/\s+/gu, ' ').trim();
}

/** 保留路径普通空白和 Tab，仅消除 ANSI 与控制换行，保证一个路径对应一个逻辑节点。 */
function normalizePathText(value: string): string {
  return stripAnsi(value).replace(/\r\n?/gu, '\n').replace(/\n/gu, ' ');
}

/** 按 grapheme 数量省略长标题字段。 */
function ellipsizeGraphemes(value: string, maximum: number): string {
  const graphemes = splitGraphemes(value);
  if (graphemes.length <= maximum) {
    return value;
  }
  return `${graphemes.slice(0, Math.max(1, maximum - 1)).join('')}…`;
}

/** 按终端显示宽度截断纯文本，并为发生截断的内容保留省略号。 */
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
  GLOB_TOOL_NAME,
  renderGlobToolCallLines,
  renderGlobToolPairLines
};
