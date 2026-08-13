import {DEFAULT_TUI_THEME, type TuiTheme} from '../config/theme-config';
import {blockText} from './colors';
import {displayWidth, safeRenderWidth, stripAnsi} from './layout';
import {renderToolPairLines, renderToolRecordLines} from './tool-message-renderer';
import {renderPrefixedLines, truncateDisplayText} from './tool-message-renderers/shared';

import type {SubagentPendingState} from '../types/render';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord, SubagentTranscriptRecord} from '../types/transcript';

const SUBAGENT_TEXT_MAX_DISPLAY_LINES = 12;

type SubagentRunRenderOptions = {
  continuation: boolean; // true 表示同一 run 的标题已经写入终端历史区，本批只追加后续事件。
  showUnexpectedInterruption: boolean; // true 仅用于完整恢复投影，为缺少终态的历史运行补中断说明。
};

/** 将同一 run 的稳定过程投影为连续外层 rail；恢复路径可显式补充意外中断状态。 */
function renderSubagentRunBlock(records: SubagentTranscriptRecord[], width = 80, theme: TuiTheme = DEFAULT_TUI_THEME, showUnexpectedInterruption = false): string {
  return renderSubagentRecords(records, width, theme, {continuation: false, showUnexpectedInterruption});
}

/** 实时 append 只渲染本批新事件；continuation 防止每次 callback 重复输出子 Agent标题。 */
function renderSubagentRunAppendBlock(records: SubagentTranscriptRecord[], width = 80, theme: TuiTheme = DEFAULT_TUI_THEME, continuation = false): string {
  return renderSubagentRecords(records, width, theme, {continuation, showUnexpectedInterruption: false});
}

/** 在静态恢复与实时增量之间共享事件投影，二者只区别标题和意外中断策略。 */
function renderSubagentRecords(records: SubagentTranscriptRecord[], width: number, theme: TuiTheme, options: SubagentRunRenderOptions): string {
  if (records.length === 0) {
    return '';
  }

  const {firstPrefix, innerWidth, outerPrefix} = createSubagentRailLayout(width);
  const lines: string[] = [];
  let hasStart = false;
  let hasTerminal = false;
  let hasHeader = options.continuation;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const next = records[index + 1];

    if (record.event.kind === 'start') {
      hasStart = true;
      if (!hasHeader) {
        lines.push(...renderRailText(`${record.agentName} · ${record.event.task}`, width, firstPrefix, outerPrefix, theme, null, 'title'));
        hasHeader = true;
      }
      continue;
    }

    if (!hasHeader) {
      lines.push(...renderRailText(record.agentName, width, firstPrefix, outerPrefix, theme, 2, 'title'));
      hasHeader = true;
    }

    lines.push(renderSubagentRailSpacer(outerPrefix, theme));

    if (record.event.kind === 'tool_call' && next?.event.kind === 'tool_result' && record.event.toolCallId === next.event.toolCallId) {
      const call = toToolCallRecord(record);
      const result = toToolResultRecord(next);
      lines.push(...prefixNestedToolLines(renderToolPairLines(call, result, innerWidth, theme), outerPrefix, theme));
      index += 1;
      continue;
    }

    if (record.event.kind === 'tool_call') {
      lines.push(...prefixNestedToolLines(renderToolRecordLines(toToolCallRecord(record), innerWidth, {}, theme), outerPrefix, theme));
      continue;
    }

    if (record.event.kind === 'tool_result') {
      lines.push(...prefixNestedToolLines(renderToolRecordLines(toToolResultRecord(record), innerWidth, {}, theme), outerPrefix, theme));
      continue;
    }

    if (record.event.kind === 'reasoning_summary') {
      lines.push(...renderRailText(`Reasoning: ${record.text}`, width, outerPrefix, outerPrefix, theme));
      continue;
    }

    if (record.event.kind === 'assistant') {
      lines.push(...renderRailText(record.text, width, outerPrefix, outerPrefix, theme));
      continue;
    }

    hasTerminal = true;
    const duration = formatDuration(record.event.durationMs);
    const status = record.event.kind === 'completed'
      ? `completed · ${duration}`
      : record.event.kind === 'cancelled'
        ? `cancelled · ${duration}`
        : `failed · ${duration}${record.text.trim() ? ` · ${record.text}` : ''}`;
    lines.push(...renderRailText(status, width, outerPrefix, outerPrefix, theme, 3));
  }

  if (options.showUnexpectedInterruption && hasStart && !hasTerminal) {
    lines.push(renderSubagentRailSpacer(outerPrefix, theme));
    lines.push(...renderRailText('interrupted before completion', width, outerPrefix, outerPrefix, theme, 2));
  }

  const terminalSpacing = hasTerminal || options.showUnexpectedInterruption && hasStart ? '\n\n' : '\n';
  return lines.length > 0 ? `${lines.join('\n')}${terminalSpacing}` : '';
}

/** footer 中的瞬时活动只续接已提交 rail，不重复子 Agent标题与任务。 */
function renderSubagentPendingLines(pending: SubagentPendingState, width: number, maxLines: number, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  if (maxLines <= 0) {
    return [];
  }

  const {innerWidth, outerPrefix} = createSubagentRailLayout(width);
  const phase = pending.phase.replace('_', ' ');
  const seconds = (pending.elapsedMs / 1000).toFixed(1);
  const rows = renderRailText(`${phase} · ${seconds}s`, width, outerPrefix, outerPrefix, theme, 1);

  if (pending.phase === 'tool' && pending.toolName) {
    rows.push(...prefixNestedToolLines(
      renderToolRecordLines({
        role: 'tool_call',
        toolCallId: 'pending',
        text: `${pending.toolName}(${pending.argumentsText || '{}'})`,
        toolName: pending.toolName,
        argumentsText: pending.argumentsText || '{}'
      }, innerWidth, {}, theme),
      outerPrefix,
      theme
    ));
  } else if (pending.draft?.trim()) {
    rows.push(...renderRailText(pending.draft, width, outerPrefix, outerPrefix, theme));
  }

  if (maxLines > 1) {
    rows.unshift(renderSubagentRailSpacer(outerPrefix, theme));
  }

  if (rows.length <= maxLines) {
    return rows;
  }
  if (maxLines === 1) {
    return rows.slice(0, 1);
  }
  const hidden = rows.length - maxLines + 1;
  const omitted = renderRailText(`… ${hidden} more lines`, width, outerPrefix, outerPrefix, theme, 1)[0];
  return [...rows.slice(0, maxLines - 1), omitted];
}

/** 稳定区与 footer 共享同一 rail 列和内容宽度，避免局部重绘边界发生横向跳变。 */
function createSubagentRailLayout(width: number) {
  const safeWidth = safeRenderWidth(width);
  const outerPrefix = safeWidth >= 12 ? '  ▌ ' : safeWidth >= 3 ? '› ' : '';
  const firstPrefix = safeWidth >= 12 ? '◆ ▌ ' : safeWidth >= 3 ? '◆ ' : '';
  return {
    firstPrefix,
    innerWidth: Math.max(1, safeWidth - displayWidth(outerPrefix)),
    outerPrefix
  };
}

/** 外层 rail/prefix 与子 Agent标题使用专属色，其余工作内容统一弱化。 */
function renderRailText(text: string, width: number, firstPrefix: string, continuationPrefix: string, theme: TuiTheme, maxLines: number | null = SUBAGENT_TEXT_MAX_DISPLAY_LINES, tone: 'title' | 'work' = 'work'): string[] {
  const lines = renderPrefixedLines({
    text: maxLines === null ? text : truncateDisplayText(text, maxLines),
    width,
    firstPrefix,
    continuationPrefix
  });
  return lines.map((line, index) => {
    const prefix = index === 0 ? firstPrefix : continuationPrefix;
    const content = line.slice(prefix.length);
    return `${blockText(theme, 'subagentRail', prefix)}${blockText(theme, tone === 'title' ? 'subagentRail' : 'toolOutput', content)}`;
  });
}

/** 内部工具保留既有布局，但其标题、状态、prefix 和正文都统一映射为工作过程暗色。 */
function prefixNestedToolLines(lines: string[], outerPrefix: string, theme: TuiTheme): string[] {
  const prefix = blockText(theme, 'subagentRail', outerPrefix);
  return lines.map((line) => `${prefix}${blockText(theme, 'toolOutput', stripAnsi(line))}`);
}

/** 逻辑工作块之间保留一条不断开的最外层 rail 空行。 */
function renderSubagentRailSpacer(outerPrefix: string, theme: TuiTheme): string {
  return blockText(theme, 'subagentRail', outerPrefix);
}

function toToolCallRecord(record: Extract<SubagentTranscriptRecord, {event: {kind: 'tool_call'}}> | SubagentTranscriptRecord): ToolCallTranscriptRecord {
  if (record.event.kind !== 'tool_call') {
    throw new Error('Expected subagent tool_call record.');
  }
  return {
    role: 'tool_call',
    text: record.text,
    argumentsText: record.event.argumentsText,
    toolCallId: record.event.toolCallId,
    toolName: record.event.toolName
  };
}

function toToolResultRecord(record: Extract<SubagentTranscriptRecord, {event: {kind: 'tool_result'}}> | SubagentTranscriptRecord): ToolResultTranscriptRecord {
  if (record.event.kind !== 'tool_result') {
    throw new Error('Expected subagent tool_result record.');
  }
  return {
    role: 'tool_result',
    text: record.text,
    details: record.event.details,
    ok: record.event.ok,
    toolCallId: record.event.toolCallId,
    toolName: record.event.toolName,
    ...(record.event.attachments ? {attachments: record.event.attachments} : {})
  };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

export {renderSubagentPendingLines, renderSubagentRunAppendBlock, renderSubagentRunBlock};
