import * as ansi from '../../terminal/ansi';
import {type TuiTheme} from '../../config/theme-config';
import {blockText} from '../colors';
import {displayWidth} from '../layout';
import {
  createToolCallTitle,
  renderPrefixedLines,
  resolveToolCallPrefixStyle,
  wrapContentLine
} from './shared';

import type {TodoItem} from '../../types/transcript';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord} from '../../types/transcript';

const TODO_TOOL_NAMES = new Set(['create_todos', 'complete_todo']);

type TodoToolDisplayPayload = {
  items: TodoItem[];
};

/**
 * 判断工具名是否需要走 todo 专属展示。
 */
function isTodoRenderToolName(toolName: unknown): boolean {
  return typeof toolName === 'string' && TODO_TOOL_NAMES.has(toolName);
}

/**
 * 渲染 todo 工具调用行，避免高频 todo 操作落到冗长 JSON 展示。
 */
function renderTodoToolCallLines(
  record: ToolCallTranscriptRecord,
  width: number,
  callStatus: boolean | undefined,
  theme: TuiTheme
): string[] {
  return renderPrefixedLines({
    text: createToolCallTitle(record.toolName),
    width,
    firstPrefix: '◆ ',
    continuationPrefix: '  ',
    colorizeFirstSymbol: resolveToolCallPrefixStyle(callStatus, theme)
  });
}

/**
 * 渲染 todo 工具结果；解析失败返回 null 交给通用 renderer。
 */
function renderTodoToolResultLines(record: ToolResultTranscriptRecord, width: number, theme: TuiTheme): string[] | null {
  const payload = parseTodoToolDisplayPayload(record.text);

  if (!payload) {
    return null;
  }

  const firstOpenIndex = payload.items.findIndex((item) => item.status === 'open');

  if (payload.items.length === 0) {
    return renderPrefixedLines({
      text: 'No active todos.',
      width,
      firstPrefix: '  ⎿ ',
      continuationPrefix: '    ',
      colorizeLine: (line) => blockText(theme, 'toolOutput', line)
    });
  }

  return payload.items.flatMap((item, index) => renderTodoItemLines({
    item,
    isFirstOpen: index === firstOpenIndex,
    isFirstItem: index === 0,
    theme,
    width
  }));
}

function renderTodoItemLines(options: {
  item: TodoItem;
  isFirstOpen: boolean;
  isFirstItem: boolean;
  theme: TuiTheme;
  width: number;
}): string[] {
  const {item, isFirstOpen, isFirstItem, theme, width} = options;
  const prefix = isFirstItem ? '  ⎿ ' : '    ';
  const content = `${item.status === 'completed' ? '✓' : '○'} ${item.text}`;
  const wrapped = wrapContentLine(content, width, displayWidth(prefix));

  return wrapped.map((segment, index) => {
    const renderedPrefix = index === 0 ? prefix : '    ';
    const line = `${renderedPrefix}${renderTodoSegment(segment, item.status, isFirstOpen, theme)}`;

    if (item.status === 'completed') {
      return line;
    }

    return isFirstOpen ? blockText(theme, 'pendingPrefix', line) : blockText(theme, 'toolOutput', line);
  });
}

function renderTodoSegment(segment: string, status: TodoItem['status'], isFirstOpen: boolean, theme: TuiTheme): string {
  if (status === 'completed') {
    const marker = segment.startsWith('✓') ? blockText(theme, 'toolSuccess', '✓') : '';
    const rest = marker ? segment.slice(1) : segment;

    return `${marker}${ansi.strikethrough(rest)}`;
  }

  if (!isFirstOpen) {
    return segment;
  }

  return segment;
}

function parseTodoToolDisplayPayload(text: string): TodoToolDisplayPayload | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const items = (parsed as {items?: unknown}).items;

  if (!Array.isArray(items)) {
    return null;
  }

  const normalizedItems: TodoItem[] = [];

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }

    const candidate = item as Partial<TodoItem>;

    if (typeof candidate.id !== 'string' || typeof candidate.text !== 'string' || (candidate.status !== 'open' && candidate.status !== 'completed')) {
      return null;
    }

    normalizedItems.push({
      id: candidate.id,
      text: candidate.text,
      status: candidate.status
    });
  }

  return {items: normalizedItems};
}

export {
  isTodoRenderToolName,
  renderTodoToolCallLines,
  renderTodoToolResultLines
};
