import {blockText} from '../colors';
import {displayWidth, safeRenderWidth, splitGraphemes, stripAnsi} from '../layout';
import {renderStyledLine} from '../markdown/styled-line';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  clampToDisplayWidth,
  expandTabs,
  normalizeContentText,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './shared';

import type {TuiTheme} from '../../config/theme-config';
import type {GrepDisplayMatch, GrepDisplayMetadata} from '../../types/tool';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const GREP_TOOL_NAME = 'grep';
const GREP_FAILURE_PREFIX = 'grep failed.\nReason: ';
const GREP_MATCH_MAX_PHYSICAL_LINES = 2;
const GREP_MAX_PATTERN_GRAPHEMES = 160;
const GREP_MAX_PATH_GRAPHEMES = 72;
const GREP_MAX_SCOPE_PATHS = 3;

type GrepCallDisplay = {
  caseSensitive?: boolean; // 调用显式指定的大小写语义；缺失时不得推断 ripgrep 默认行为。
  glob?: string; // 限定搜索文件的可选 glob，原始调用缺失时不显示。
  literal: boolean; // true 表示默认固定字符串搜索，false 表示 regex 搜索。
  paths: string[]; // 用于 scope 行的搜索根路径，缺失调用参数时规范化为当前目录。
  pattern: string; // 已折叠控制换行并限制长度的可见查询文本。
};

type GrepMatchGroup = {
  matches: GrepDisplayMatch[]; // 原始顺序中相邻且属于同一路径的匹配项。
  path: string; // 当前连续匹配组对应的文件路径。
};

/**
 * 渲染 pending 或孤立 grep call，使用查询标题与独立 scope 行隐藏原始 JSON。
 */
function renderGrepToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] | null {
  const request = parseGrepCall(record.argumentsText);
  if (!request) {
    return null;
  }

  const status = callStatus === undefined ? 'searching' : callStatus ? 'complete' : 'failed';
  return [
    ...renderGrepHeaderLines(request, status, callStatus, width, theme),
    ...renderGrepScopeLines(request, width, theme)
  ];
}

/**
 * 将相邻 grep call/result 投影成共享标题、scope 和结构化匹配树。
 */
function renderGrepToolPairLines(
  call: ToolCallTranscriptRecord,
  result: ToolResultTranscriptRecord,
  width: number,
  theme: TuiTheme
): string[] | null {
  const request = parseGrepCall(call.argumentsText);
  if (!request) {
    return null;
  }

  if (!result.ok) {
    const reason = parseGrepFailure(result.text);
    if (!reason) {
      return null;
    }

    return [
      ...renderGrepHeaderLines(request, 'failed', false, width, theme),
      ...renderGrepScopeLines(request, width, theme),
      ...renderGrepFailureLines(reason, width, theme)
    ];
  }

  if (result.details.kind !== 'grep' || !isGrepDisplayMetadata(result.details.display)) {
    return null;
  }

  const display = result.details.display;
  const status = createGrepSuccessStatus(display.matches.length, result.details.truncated);
  const lines = [
    ...renderGrepHeaderLines(request, status, true, width, theme),
    ...renderGrepScopeLines(request, width, theme)
  ];

  if (display.matches.length > 0) {
    const treeLines = renderGrepMatchTreeLines(display, width, theme);
    if (!treeLines) {
      return null;
    }
    lines.push(...treeLines);
  }

  return lines;
}

/**
 * 保守解析 grep arguments；任一已知字段形状不可信时整体交给通用 renderer。
 */
function parseGrepCall(argumentsText: unknown): GrepCallDisplay | null {
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
  if (!pattern) {
    return null;
  }

  const paths = parseGrepPaths(payload.paths);
  const glob = parseOptionalNonEmptyString(payload.glob);
  const literal = parseOptionalBoolean(payload.literal);
  const caseSensitive = parseOptionalBoolean(payload.case_sensitive);
  if (!paths || glob === null || literal === null || caseSensitive === null) {
    return null;
  }

  return {
    paths,
    pattern: ellipsizeGraphemes(pattern, GREP_MAX_PATTERN_GRAPHEMES),
    literal: literal !== false,
    ...(glob === undefined ? {} : {glob: ellipsizeGraphemes(normalizeHeaderText(glob), GREP_MAX_PATTERN_GRAPHEMES)}),
    ...(caseSensitive === undefined ? {} : {caseSensitive})
  };
}

/**
 * 解析 paths 并补齐默认当前目录；路径只做展示校验，不重复执行 handler 的文件系统约束。
 */
function parseGrepPaths(value: unknown): string[] | null {
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
    paths.push(ellipsizeGraphemes(normalized, GREP_MAX_PATH_GRAPHEMES));
  }
  return paths;
}

/** 解析可选非空字符串；null 表示字段形状非法。 */
function parseOptionalNonEmptyString(value: unknown): string | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** 解析可选 boolean；null 表示字段形状非法。 */
function parseOptionalBoolean(value: unknown): boolean | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }
  return typeof value === 'boolean' ? value : null;
}

/**
 * 校验持久化或运行期 grep display metadata，避免从部分可信数据构造结果树。
 */
function isGrepDisplayMetadata(value: unknown): value is GrepDisplayMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const display = value as Partial<GrepDisplayMetadata>;
  return display.kind === 'grep' && Array.isArray(display.matches) && display.matches.every(isGrepDisplayMatch);
}

/** 校验单条 grep 匹配事实的必要字段和 1-based 位置。 */
function isGrepDisplayMatch(value: unknown): value is GrepDisplayMatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const match = value as Partial<GrepDisplayMatch>;
  return typeof match.path === 'string' && match.path.trim() !== '' &&
    Number.isInteger(match.line) && Number(match.line) > 0 &&
    Number.isInteger(match.column) && Number(match.column) > 0 &&
    typeof match.text === 'string';
}

/**
 * 渲染带状态色 marker 的查询标题；regex 与大小写语义固定留在第一层。
 */
function renderGrepHeaderLines(
  request: GrepCallDisplay,
  status: string,
  callStatus: boolean | undefined,
  width: number,
  theme: TuiTheme
): string[] {
  const optionParts = [
    ...(request.literal ? [] : ['regex']),
    ...(request.caseSensitive === true ? ['case sensitive'] : request.caseSensitive === false ? ['ignore case'] : [])
  ];
  const suffix = [...optionParts, status].map((part) => ` · ${part}`).join('');
  const markerStyle = resolveToolCallPrefixStyle(callStatus, theme);

  return renderStyledLine({
    prefix: '',
    contentPrefix: `${markerStyle ? markerStyle('◆') : '◆'} `,
    continuationPrefix: '  ',
    spans: [{text: `Grep · “${request.pattern}”${suffix}`}],
    theme,
    width
  });
}

/** 渲染只包含 paths 与 glob 的第二层搜索范围 metadata。 */
function renderGrepScopeLines(request: GrepCallDisplay, width: number, theme: TuiTheme): string[] {
  const visiblePaths = request.paths.slice(0, GREP_MAX_SCOPE_PATHS);
  const omitted = request.paths.length - visiblePaths.length;
  const pathText = omitted > 0 ? `${visiblePaths.join(', ')} · +${omitted} paths` : visiblePaths.join(', ');
  const scope = [`in ${pathText}`, ...(request.glob ? [`glob ${request.glob}`] : [])].join(' · ');

  return renderPrefixedLines({
    text: scope,
    width,
    firstPrefix: '  ',
    continuationPrefix: '  ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/** 根据结构化数量与 handler 截断事实生成完成态标题。 */
function createGrepSuccessStatus(matchCount: number, truncated: boolean): string {
  if (matchCount === 0) {
    return 'no matches';
  }
  if (truncated) {
    return `${matchCount} matches shown · more available`;
  }
  return `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`;
}

/** 从固定失败 envelope 中提取原因，避免把协议标题重复展示给用户。 */
function parseGrepFailure(text: unknown): string | null {
  if (typeof text !== 'string') {
    return null;
  }
  const normalized = text.replace(/\r\n?/gu, '\n');
  if (!normalized.startsWith(GREP_FAILURE_PREFIX)) {
    return null;
  }
  const reason = normalized.slice(GREP_FAILURE_PREFIX.length).trim();
  return reason || null;
}

/** 渲染有界 grep 失败诊断。 */
function renderGrepFailureLines(reason: string, width: number, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text: truncateDisplayText(reason, TOOL_RESULT_MAX_DISPLAY_LINES),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/**
 * 在物理行预算内选择前序匹配；固定树结构无法适配当前宽度时回退通用 renderer。
 */
function renderGrepMatchTreeLines(display: GrepDisplayMetadata, width: number, theme: TuiTheme): string[] | null {
  const total = display.matches.length;
  let visibleCount = Math.min(total, Math.max(1, TOOL_RESULT_MAX_DISPLAY_LINES - 1));

  while (visibleCount > 1) {
    const lines = renderVisibleGrepMatches(display.matches.slice(0, visibleCount), total - visibleCount, width, theme);
    if (lines.length <= TOOL_RESULT_MAX_DISPLAY_LINES) {
      return grepTreeLinesFitWidth(lines, width) ? lines : null;
    }
    visibleCount -= 1;
  }

  const lines = renderVisibleGrepMatches(display.matches.slice(0, visibleCount), total - visibleCount, width, theme)
    .slice(0, TOOL_RESULT_MAX_DISPLAY_LINES);
  return grepTreeLinesFitWidth(lines, width) ? lines : null;
}

/** 检查最终树行宽度，避免超长 locator 或极窄终端让固定前缀突破 safe width。 */
function grepTreeLinesFitWidth(lines: string[], width: number): boolean {
  const safeWidth = safeRenderWidth(width);
  return lines.every((line) => displayWidth(line) <= safeWidth);
}

/** 按连续路径分组并渲染树节点、匹配 gutter 与末尾省略节点。 */
function renderVisibleGrepMatches(matches: GrepDisplayMatch[], omitted: number, width: number, theme: TuiTheme): string[] {
  const groups = groupAdjacentGrepMatches(matches);
  const locatorWidth = matches.reduce((maximum, match) => Math.max(maximum, displayWidth(`${match.line}:${match.column}`)), 1);
  const lines: string[] = [];

  groups.forEach((group, groupIndex) => {
    const hasFollowingRoot = groupIndex < groups.length - 1 || omitted > 0;
    lines.push(renderGrepPathLine(group.path, hasFollowingRoot, width, theme));
    for (const match of group.matches) {
      lines.push(...renderGrepMatchLines(match, locatorWidth, hasFollowingRoot, width, theme));
    }
  });

  if (omitted > 0) {
    lines.push(renderGrepOmissionLine(omitted, width, theme));
  }
  return lines;
}

/** 只合并原始顺序中相邻且 path 相同的匹配，避免为了分组重排事实。 */
function groupAdjacentGrepMatches(matches: GrepDisplayMatch[]): GrepMatchGroup[] {
  const groups: GrepMatchGroup[] = [];
  for (const match of matches) {
    const previous = groups[groups.length - 1];
    if (previous?.path === match.path) {
      previous.matches.push(match);
    } else {
      groups.push({path: match.path, matches: [match]});
    }
  }
  return groups;
}

/** 渲染单行文件树节点，超长路径按当前 safe width 尾部省略。 */
function renderGrepPathLine(path: string, hasFollowingRoot: boolean, width: number, theme: TuiTheme): string {
  const prefix = hasFollowingRoot ? '  ├─ ' : '  └─ ';
  const available = Math.max(1, safeRenderWidth(width) - displayWidth(prefix));
  const visiblePath = clampToDisplayWidth(normalizeHeaderText(path), available);
  return blockText(theme, 'toolOutput', `${prefix}${visiblePath}`);
}

/**
 * 渲染单条匹配的行列 gutter 与弱化正文，并把单条超长正文限制为两个物理行。
 */
function renderGrepMatchLines(
  match: GrepDisplayMatch,
  locatorWidth: number,
  hasFollowingRoot: boolean,
  width: number,
  theme: TuiTheme
): string[] {
  const locator = `${match.line}:${match.column}`;
  const paddedLocator = `${' '.repeat(Math.max(0, locatorWidth - displayWidth(locator)))}${locator}`;
  const rail = hasFollowingRoot ? '  │ ' : '    ';
  const visiblePrefix = `${rail}${paddedLocator} │ `;
  const available = Math.max(1, safeRenderWidth(width) - displayWidth(visiblePrefix));
  const normalized = normalizeContentText(match.text);
  const expanded = expandTabs(normalized, displayWidth(visiblePrefix));
  const bounded = clampToDisplayWidth(expanded, available * GREP_MATCH_MAX_PHYSICAL_LINES);
  const renderedRail = blockText(theme, 'toolOutput', rail);
  const renderedGutter = blockText(theme, 'toolOutput', `${paddedLocator} │ `);
  const continuationGutter = `${blockText(theme, 'toolOutput', rail)}${' '.repeat(displayWidth(paddedLocator))}${blockText(theme, 'toolOutput', ' │ ')}`;

  return renderStyledLine({
    prefix: '',
    contentPrefix: `${renderedRail}${renderedGutter}`,
    continuationPrefix: continuationGutter,
    spans: [{text: bounded, style: (text) => blockText(theme, 'toolOutput', text)}],
    theme,
    width
  }).slice(0, GREP_MATCH_MAX_PHYSICAL_LINES);
}

/** 渲染 renderer 自身省略数量，和 handler 的 more-available 标题保持独立。 */
function renderGrepOmissionLine(omitted: number, width: number, theme: TuiTheme): string {
  const prefix = '  └─ ';
  const text = `… ${omitted} more ${omitted === 1 ? 'match' : 'matches'}`;
  const available = Math.max(1, safeRenderWidth(width) - displayWidth(prefix));
  return blockText(theme, 'toolOutput', `${prefix}${clampToDisplayWidth(text, available)}`);
}

/** 将标题、路径等单行字段折叠为空格并移除可执行 ANSI 序列。 */
function normalizeHeaderText(value: string): string {
  return stripAnsi(value).replace(/\s+/gu, ' ').trim();
}

/** 按 grapheme 数量省略长标题字段。 */
function ellipsizeGraphemes(value: string, maximum: number): string {
  const graphemes = splitGraphemes(value);
  if (graphemes.length <= maximum) {
    return value;
  }
  return `${graphemes.slice(0, Math.max(1, maximum - 1)).join('')}…`;
}


export {
  GREP_TOOL_NAME,
  renderGrepToolCallLines,
  renderGrepToolPairLines
};
