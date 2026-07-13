import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {displayWidth, splitGraphemes} from '../layout';
import {
  TOOL_RESULT_MAX_DISPLAY_LINES,
  TOOL_RESULT_TRUNCATION_TEXT,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  truncateDisplayText
} from './shared';

import type {TranscriptRecord} from '../../types/transcript';

const MEMORY_TOOL_NAMES = ['read_memory', 'add_memory', 'update_memory', 'remove_memory'] as const;
const MEMORY_TOOL_NAME_SET = new Set<string>(MEMORY_TOOL_NAMES);
const MEMORY_CONTENT_PREVIEW_WIDTH = 160;

type MemoryToolName = typeof MEMORY_TOOL_NAMES[number];

/** 判断工具是否应使用 memory 专属终端投影。 */
function isMemoryRenderToolName(toolName: unknown): toolName is MemoryToolName {
  return typeof toolName === 'string' && MEMORY_TOOL_NAME_SET.has(toolName);
}

/** 渲染 memory call 的动作摘要，供 pending、孤立 call 和 pair 共享。 */
function renderMemoryToolCallLines(record: TranscriptRecord, width: number, callStatus: unknown, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text: createMemoryCallSummary(record.toolName as MemoryToolName, parseJsonObject(record.argumentsText)),
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/** 按 memory tool 的成功/失败语义组合相邻 call 与 result。 */
function renderMemoryToolPairLines(call: TranscriptRecord, result: TranscriptRecord, width: number, theme: TuiTheme): string[] {
  const lines = renderMemoryToolCallLines(call, width, result.ok, theme);

  if (result.ok === false) {
    lines.push(...renderMemoryFailureLines(result, width, theme));
    return lines;
  }

  if (call.toolName === 'read_memory') {
    lines.push(...renderMemoryReadResultLines(result, width, theme));
  }

  return lines;
}

/** 渲染未与 call 聚合的 result，避免恢复到 raw JSON 展示。 */
function renderMemoryToolResultLines(record: TranscriptRecord, width: number, theme: TuiTheme): string[] {
  if (record.ok === false) {
    return renderMemoryFailureLines(record, width, theme);
  }

  if (record.toolName === 'read_memory') {
    return renderMemoryReadResultLines(record, width, theme);
  }

  return renderMemoryOutputLines(resolveMutationCompletionText(record.toolName), width, theme);
}

/** 根据 call 参数生成不含 id、scope 和 JSON 字段名的动作摘要。 */
function createMemoryCallSummary(toolName: MemoryToolName, args: Record<string, unknown> | null): string {
  if (!args) {
    return resolveMalformedCallSummary(toolName);
  }

  if (toolName === 'add_memory') {
    return createAddSummary(args);
  }

  if (toolName === 'read_memory') {
    return createReadSummary(args);
  }

  if (toolName === 'update_memory') {
    return createUpdateSummary(args);
  }

  return createRemoveSummary(args);
}

/** 为新增 user/agent memory 生成 Remembering 摘要。 */
function createAddSummary(args: Record<string, unknown>): string {
  const content = readNonEmptyString(args.content);
  const catalog = readNonEmptyString(args.catalog);
  const preview = content ? createContentPreview(content) : null;

  if (args.type === 'agent' && catalog) {
    return preview ? `Remembering in ${catalog} · ${preview}` : `Remembering in ${catalog}`;
  }

  return preview ? `Remembering · ${preview}` : 'Remembering memory';
}

/** 为 user 列表或 agent catalog 读取生成 Recalling 摘要。 */
function createReadSummary(args: Record<string, unknown>): string {
  if (args.type === 'user') {
    return 'Recalling user memories';
  }

  const catalog = readNonEmptyString(args.catalog);
  return args.type === 'agent' && catalog ? `Recalling · ${catalog}` : 'Recalling memories';
}

/** 为 item 内容或 catalog 元数据更新生成 Revising 摘要。 */
function createUpdateSummary(args: Record<string, unknown>): string {
  const content = readNonEmptyString(args.content);
  const preview = content ? createContentPreview(content) : null;

  if (args.type === 'user' && args.target === 'item') {
    return preview ? `Revising user memory · ${preview}` : 'Revising user memory';
  }

  const catalog = readNonEmptyString(args.catalog);
  if (args.type === 'agent' && args.target === 'item') {
    const base = catalog ? `Revising in ${catalog}` : 'Revising memory';
    return preview ? `${base} · ${preview}` : base;
  }

  if (args.type === 'agent' && args.target === 'catalog') {
    return createCatalogUpdateSummary(catalog, args);
  }

  return 'Revising memory';
}

/** 表达 catalog rename 和 description 修订，但不展开其余参数。 */
function createCatalogUpdateSummary(catalog: string | null, args: Record<string, unknown>): string {
  const nextName = readNonEmptyString(args.name);
  const description = readNonEmptyString(args.description);
  let summary = catalog ? `Revising catalog · ${catalog}` : 'Revising catalog';

  if (nextName && nextName !== catalog) {
    summary += ` → ${nextName}`;
  }

  if (description) {
    summary += ` · ${createContentPreview(description)}`;
  }

  return summary;
}

/** 为 user item、agent item 或完整 catalog 删除生成 Forgetting 摘要。 */
function createRemoveSummary(args: Record<string, unknown>): string {
  if (args.type === 'user') {
    return 'Forgetting user memory';
  }

  const catalog = readNonEmptyString(args.catalog);
  if (args.type === 'agent' && args.target === 'catalog') {
    return catalog ? `Forgetting catalog · ${catalog}` : 'Forgetting catalog';
  }

  if (args.type === 'agent' && args.target === 'item') {
    return catalog ? `Forgetting from ${catalog}` : 'Forgetting memory';
  }

  return 'Forgetting memory';
}

/** 将 read_memory 成功 payload 投影为不带 enabled 和 id 的统一分点列表。 */
function renderMemoryReadResultLines(record: TranscriptRecord, width: number, theme: TuiTheme): string[] {
  const contents = parseMemoryContents(record.text);

  if (!contents) {
    return renderMemoryOutputLines('Memory result unavailable.', width, theme);
  }

  if (contents.length === 0) {
    return renderMemoryOutputLines('No memories found.', width, theme);
  }

  const lines = renderPrefixedLines({
    text: contents.map((content) => `• ${content}`).join('\n'),
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });

  return limitMemoryResultLines(lines, width, theme);
}

/** 失败结果保留短诊断，同时沿用通用结果行数预算。 */
function renderMemoryFailureLines(record: TranscriptRecord, width: number, theme: TuiTheme): string[] {
  const text = typeof record.text === 'string' && record.text.trim() !== '' ? record.text : '(no output)';
  return renderMemoryOutputLines(truncateDisplayText(text, TOOL_RESULT_MAX_DISPLAY_LINES), width, theme);
}

/** 渲染一段安全的 memory 输出摘要。 */
function renderMemoryOutputLines(text: string, width: number, theme: TuiTheme): string[] {
  return renderPrefixedLines({
    text,
    width,
    firstPrefix: '  ⎿ ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
}

/** 按物理行限制 memory 列表，并保留统一的截断提示。 */
function limitMemoryResultLines(lines: string[], width: number, theme: TuiTheme): string[] {
  if (lines.length <= TOOL_RESULT_MAX_DISPLAY_LINES) {
    return lines;
  }

  const markerLines = renderPrefixedLines({
    text: TOOL_RESULT_TRUNCATION_TEXT,
    width,
    firstPrefix: '    ',
    continuationPrefix: '    ',
    colorizeLine: (line) => blockText(theme, 'toolOutput', line)
  });
  const markerBudget = Math.min(markerLines.length, TOOL_RESULT_MAX_DISPLAY_LINES);
  const contentBudget = TOOL_RESULT_MAX_DISPLAY_LINES - markerBudget;
  return [...lines.slice(0, contentBudget), ...markerLines.slice(0, markerBudget)];
}

/** 从 user/agent read result 中只提取有效 content，忽略所有管理元数据。 */
function parseMemoryContents(text: unknown): string[] | null {
  const payload = parseJsonObject(text);
  if (!payload || !Array.isArray(payload.memories)) {
    return null;
  }

  const contents: string[] = [];
  for (const item of payload.memories) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const content = readNonEmptyString((item as Record<string, unknown>).content);
    if (content) {
      contents.push(normalizeWhitespace(content));
    }
  }

  return contents;
}

/** 解析 JSON object；任何非 object shape 都作为不可用 payload。 */
function parseJsonObject(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** 读取并规范化非空字符串字段。 */
function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = normalizeWhitespace(value);
  return normalized === '' ? null : normalized;
}

/** 压缩 memory 文本中的换行和连续空白，避免摘要伪造额外物理行。 */
function normalizeWhitespace(value: string): string {
  return String(value).replace(/\s+/gu, ' ').trim();
}

/** 将 memory 或 description 限制为有界可见宽度预览。 */
function createContentPreview(value: string): string {
  const normalized = normalizeWhitespace(value);
  if (displayWidth(normalized) <= MEMORY_CONTENT_PREVIEW_WIDTH) {
    return normalized;
  }

  let preview = '';
  for (const grapheme of splitGraphemes(normalized)) {
    if (displayWidth(`${preview}${grapheme}…`) > MEMORY_CONTENT_PREVIEW_WIDTH) {
      break;
    }
    preview += grapheme;
  }
  return `${preview}…`;
}

/** 为 malformed call 提供不包含原始参数的工具级摘要。 */
function resolveMalformedCallSummary(toolName: MemoryToolName): string {
  if (toolName === 'add_memory') return 'Remembering memory';
  if (toolName === 'read_memory') return 'Recalling memories';
  if (toolName === 'update_memory') return 'Revising memory';
  return 'Forgetting memory';
}

/** 为孤立成功 mutation result 提供一行安全完成状态。 */
function resolveMutationCompletionText(toolName: unknown): string {
  if (toolName === 'add_memory') return 'Memory remembered.';
  if (toolName === 'update_memory') return 'Memory revised.';
  if (toolName === 'remove_memory') return 'Memory forgotten.';
  return 'Memory operation completed.';
}

export {
  isMemoryRenderToolName,
  renderMemoryToolCallLines,
  renderMemoryToolPairLines,
  renderMemoryToolResultLines
};
