import * as ansi from '../terminal/ansi';
import {sanitizeTerminalText} from '../terminal/control-chars';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../config/theme-config';
import {formatSubagentRawName} from '../agent/subagent/name';
import {clampToDisplayWidth} from './blocks/symbol-message-renderer';
import {blockText} from './colors';
import {createSelectedWindowRows} from './footer/window';
import {collapseToSingleLine, safeRenderWidth, stripAnsi} from './layout';
import {renderToolPairLines, renderToolRecordLines} from './tool-message-renderer';
import {createSubagentRailLayout, renderRailText, renderSubagentRailSpacer} from './tool-message-renderers/shared';

import type {SubagentPendingState} from '../types/render';
import type {ToolCallTranscriptRecord, ToolResultTranscriptRecord, SubagentTranscriptRecord} from '../types/transcript';

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
        lines.push(...renderRailText(`${formatSubagentRawName(record.agentName)} · ${record.event.task}`, width, firstPrefix, outerPrefix, theme, null, 'title'));
        hasHeader = true;
      }
      continue;
    }

    if (!hasHeader) {
      lines.push(...renderRailText(formatSubagentRawName(record.agentName), width, firstPrefix, outerPrefix, theme, 2, 'title'));
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

/** 内部工具保留既有布局，但其标题、状态、prefix 和正文都统一映射为工作过程暗色。 */
function prefixNestedToolLines(lines: string[], outerPrefix: string, theme: TuiTheme): string[] {
  const prefix = blockText(theme, 'subagentRail', outerPrefix);
  return lines.map((line) => `${prefix}${blockText(theme, 'toolOutput', stripAnsi(line))}`);
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

/** subagent 会话窗口 body 顶部 run 索引的行输入；statusText 由控制器按瞬时活动或稳定终态准备。 */
export type SubagentViewIndexEntry = {
  runId: string; // run 身份，用于标注当前观看行。
  agentName: string; // 已安全格式化的 agent 显示名。
  task: string; // 委派任务摘要原文；渲染时折叠为单行并按宽度截断。
  statusText: string; // 活跃 phase/耗时或终态标签。
  active: boolean; // run 是否仍在活动；结束行置灰。
};

// 索引窗口的最大物理行数（含上下折叠提示行）；越窗行以提示行承载，标题行始终给出总量。
const SUBAGENT_VIEW_INDEX_MAX_ROWS = 8;

/**
 * 渲染会话窗口顶部的 run 索引块：标题行给出运行中/总量计数，行清单以当前观看行为中心开窗。
 * 当前行使用 subagentRail 主题色与 ▸ 标记，结束行置灰，越窗行以上下折叠提示承载。
 */
export function renderSubagentViewIndex(entries: SubagentViewIndexEntry[], currentRunId: string | null, width = 80, theme: TuiTheme = DEFAULT_TUI_THEME): string[] {
  if (entries.length === 0) {
    return [];
  }

  const safeWidth = safeRenderWidth(width);
  const activeCount = entries.filter((entry) => entry.active).length;
  const headerPlain = clampToDisplayWidth(`◆ subagent 会话 · 运行中 ${activeCount} · 共 ${entries.length} 个 · ↑/↓ 切换 · Ctrl+O/Esc 返回`, safeWidth);
  const header = `${blockText(theme, 'subagentRail', '◆')}${headerPlain.slice(1)}`;

  const currentIndex = entries.findIndex((entry) => entry.runId === currentRunId);
  const windowRows = createSelectedWindowRows(entries, currentIndex === -1 ? undefined : currentIndex, SUBAGENT_VIEW_INDEX_MAX_ROWS);
  const rows = windowRows.map((row) => {
    if (row.kind === 'more') {
      const hintPlain = clampToDisplayWidth(`    … ${row.direction === 'up' ? '↑ 上方' : '↓ 下方'} ${row.count} 个`, safeWidth);
      return ansi.dim(blockText(theme, 'muted', hintPlain));
    }

    const entry = row.item;
    const marker = row.index === currentIndex ? '  ▸ ' : '    ';
    const text = `${row.index + 1}. ${entry.agentName} · ${collapseToSingleLine(entry.task)} · ${entry.statusText}`;
    const plain = clampToDisplayWidth(`${marker}${text}`, safeWidth);
    const content = plain.slice(marker.length);

    if (row.index === currentIndex) {
      return `${blockText(theme, 'subagentRail', '  ▸ ')}${blockText(theme, 'subagentRail', content)}`;
    }
    return `${blockText(theme, 'muted', '    ')}${entry.active ? content : ansi.dim(blockText(theme, 'muted', content))}`;
  });

  return [header, ...rows];
}

/** 组装单行子 Agent 摘要：名称、任务摘要、阶段、可选工具名与 elapsed；外部文本先经控制字符净化。 */
export function createSubagentRunRowText(run: SubagentPendingState): string {
  const phaseText = run.phase.replace('_', ' ');
  const toolText = run.toolName ? ` · ${run.toolName}` : '';
  return sanitizeTerminalText(`${run.agentName} · ${run.task} · ${phaseText}${toolText} · ${(run.elapsedMs / 1000).toFixed(1)}s`);
}

export {renderSubagentPendingLines, renderSubagentRunAppendBlock, renderSubagentRunBlock};
