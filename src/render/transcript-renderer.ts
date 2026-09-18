/**
 * 把稳定 transcript records 投影为终端历史区的 block 与行：tool pair 聚合、subagent run 分组、
 * role dispatch 与展示净化，并维护子 Agent 增量 append 状态；对 app 层暴露渲染函数与状态工厂。
 */
import {DEFAULT_RENDER_PREFERENCES} from '../config/app-settings-config';
import {DEFAULT_TUI_THEME} from '../config/theme-config';
import {sanitizeTerminalText} from '../terminal/control-chars';
import { renderAssistantBlock, renderCompactionNoticeBlock, renderConversationReferenceBlock, renderErrorBlock, renderLocalNoticeBlock, renderReasoningSummaryBlock, renderShellBlock, renderUserBlock } from './blocks/message-renderer';
import {renderSubagentRunAppendBlock, renderSubagentRunBlock} from './subagent-renderer';
import { renderToolPairBlock, renderToolRecordBlock } from './tool-message-renderer';

import type {RenderState} from '../types/render';
import type { SubagentTranscriptRecord, ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptRecord, UserTranscriptRecord } from '../types/transcript';

type TranscriptRecordBlock = {
  kind: 'record'; // 标识不参与相邻聚合的单条 transcript 记录。
  record: TranscriptRecord; // 交给普通 role renderer 的原始事实。
};

type TranscriptToolPairBlock = {
  call: ToolCallTranscriptRecord; // 与下一条 result 具有相同 call id 的工具调用。
  compactSubagentResult: boolean; // 已有本地子运行终态时隐藏外层重复报告正文。
  kind: 'tool_pair'; // 标识可由 pair-aware renderer 一次投影的工具对。
  result: ToolResultTranscriptRecord; // 与 call 配对的权威工具结果。
};

type TranscriptSubagentRunBlock = {
  kind: 'subagent_run'; // 标识连续同 runId 的本地子 Agent 过程。
  records: SubagentTranscriptRecord[]; // 按物理 transcript 顺序保留的稳定事件。
  showUnexpectedInterruption: boolean; // destructive/resume 投影是否补意外中断状态。
};

type TranscriptBlock = TranscriptRecordBlock | TranscriptToolPairBlock | TranscriptSubagentRunBlock;

export type SubagentAppendRenderState = {
  parallelParentToolCallIds: Set<string>; // 并行分组内 run_subagent 外层 call id；其 tool pair 保持展开报告正文。
  parallelRunIds: Set<string>; // 并行分组子运行身份；其过程记录不进入主窗口投影，由增量批次间共享。
  pendingToolCalls: Map<string, SubagentTranscriptRecord>; // 已持久化但仍由 footer 展示的内部调用，等待 result 后成对写入历史区。
  runIds: Set<string>; // 已经把标题写入终端历史区的子运行，后续 callback 只追加事件行。
  terminalCallIds: Set<string>; // 已经出现终态的外层 call，用于稍后到达的 outer pair 压缩重复报告。
};

export function createSubagentAppendRenderState(): SubagentAppendRenderState {
  return {
    parallelParentToolCallIds: new Set(),
    parallelRunIds: new Set(),
    pendingToolCalls: new Map(),
    runIds: new Set(),
    terminalCallIds: new Set()
  };
}

/**
 * transcript 文本来自模型、工具与用户粘贴等外部来源;渲染前剥离控制字符,
 * 只净化终端投影,持久化事实保持原样。
 */
function sanitizeRecordDisplayText(record: TranscriptRecord): TranscriptRecord {
  if (record.role === 'user') {
    return {
      ...record,
      text: sanitizeTerminalText(record.text),
      ...(record.displayText !== undefined ? {displayText: sanitizeTerminalText(record.displayText)} : {})
    };
  }

  if (record.role === 'tool_call') {
    return {
      ...record,
      text: sanitizeTerminalText(record.text),
      argumentsText: sanitizeTerminalText(record.argumentsText)
    };
  }

  if (record.role === 'tool_result') {
    return {...record, text: sanitizeTerminalText(record.text)};
  }

  if (record.role === 'subagent' || record.role === 'extension') {
    return record;
  }

  return {...record, text: sanitizeTerminalText(record.text)};
}

/**
 * 登记并行子运行的 start 事实；增量批次之间共享，保证后续事件批次持续被过滤。
 */
export function trackParallelSubagentRecords(state: SubagentAppendRenderState, records: TranscriptRecord[]): void {
  for (const record of records) {
    if (record.role === 'subagent' && record.event.kind === 'start' && record.event.parallelSize !== undefined) {
      state.parallelRunIds.add(record.runId);
      state.parallelParentToolCallIds.add(record.parentToolCallId);
    }
  }
}

/**
 * 快照/重放路径按 records 重建子 Agent 增量 append 状态：run 身份、终态集合、
 * 并行集合与当前活跃 run 的 pending 内部调用。
 */
export function rebuildSubagentAppendState(state: SubagentAppendRenderState, records: TranscriptRecord[], activeSubagentRunId?: string): void {
  state.runIds.clear();
  state.terminalCallIds.clear();
  state.parallelRunIds.clear();
  state.parallelParentToolCallIds.clear();
  state.pendingToolCalls.clear();
  for (const record of records) {
    if (record.role === 'subagent') {
      state.runIds.add(record.runId);
      if (record.event.kind === 'start' && record.event.parallelSize !== undefined) {
        state.parallelRunIds.add(record.runId);
        state.parallelParentToolCallIds.add(record.parentToolCallId);
      }
      if (record.event.kind === 'completed' || record.event.kind === 'failed' || record.event.kind === 'cancelled') {
        state.terminalCallIds.add(record.parentToolCallId);
      }
      if (record.runId === activeSubagentRunId && record.event.kind === 'tool_call') {
        state.pendingToolCalls.set(createSubagentToolCallKey(record.runId, record.event.toolCallId), record);
      } else if (record.runId === activeSubagentRunId && record.event.kind === 'tool_result') {
        state.pendingToolCalls.delete(createSubagentToolCallKey(record.runId, record.event.toolCallId));
      }
    }
  }
}

/**
 * 把 transcript records 投影成当前宽度下的可见行。
 *
 */
export function renderTranscriptLines(
  records: TranscriptRecord[] = [],
  width = 80,
  theme: RenderState['theme'] = DEFAULT_TUI_THEME,
  renderPreferences: RenderState['renderPreferences'] = DEFAULT_RENDER_PREFERENCES,
  showUnexpectedSubagentInterruption = true,
  activeSubagentRunId?: string
): string[] {
  const lines: string[] = [];

  for (const block of renderTranscriptBlocks(records, width, theme, renderPreferences, showUnexpectedSubagentInterruption, undefined, activeSubagentRunId)) {
    lines.push(...splitRenderedBlock(block));
  }

  return lines;
}

/**
 * 把 transcript records 投影成完整 block 字符串，保留实时 append 所需的尾部换行。
 */
export function renderTranscriptBlocks(
  records: TranscriptRecord[] = [],
  width = 80,
  theme: RenderState['theme'] = DEFAULT_TUI_THEME,
  renderPreferences: RenderState['renderPreferences'] = DEFAULT_RENDER_PREFERENCES,
  showUnexpectedSubagentInterruption = false,
  subagentAppendState?: SubagentAppendRenderState,
  activeSubagentRunId?: string
): string[] {
  const visibleRecords = renderPreferences.showReasoningSummary
    ? records
    : records.filter((record) => record.role !== 'reasoning_summary');
  const renderRecords = subagentAppendState
    ? prepareSubagentAppendRecords(visibleRecords, subagentAppendState)
    : visibleRecords;
  return groupTranscriptRecords(renderRecords, showUnexpectedSubagentInterruption, subagentAppendState?.terminalCallIds, activeSubagentRunId, subagentAppendState?.parallelParentToolCallIds)
    .map((block) => renderTranscriptBlock(block, width, theme, subagentAppendState?.runIds))
    .filter((block) => block.length > 0);
}

/**
 * 实时追加时把内部 call 留在 footer，result 到达后再把完整工具对一次写入历史区。
 * transcript 已在调用方独立持久化；这里的缓冲只影响终端投影，不改变审计顺序。
 */
function prepareSubagentAppendRecords(records: TranscriptRecord[], state: SubagentAppendRenderState): TranscriptRecord[] {
  const prepared: TranscriptRecord[] = [];

  for (const record of records) {
    if (record.role !== 'subagent') {
      prepared.push(record);
      continue;
    }

    const key = createSubagentToolCallKey(record.runId, record.event.kind === 'tool_call' || record.event.kind === 'tool_result'
      ? record.event.toolCallId
      : '');
    if (record.event.kind === 'tool_call') {
      state.pendingToolCalls.set(key, record);
      continue;
    }

    if (record.event.kind === 'tool_result') {
      const call = state.pendingToolCalls.get(key);
      if (call) {
        prepared.push(call);
        state.pendingToolCalls.delete(key);
      }
      prepared.push(record);
      continue;
    }

    if (record.event.kind !== 'start') {
      for (const [pendingKey, call] of state.pendingToolCalls) {
        if (call.runId === record.runId) {
          prepared.push(call);
          state.pendingToolCalls.delete(pendingKey);
        }
      }
    }
    prepared.push(record);
  }

  return prepared;
}

/** 为运行内工具调用生成不会跨 run 冲突的瞬时渲染键。 */
function createSubagentToolCallKey(runId: string, toolCallId: string): string {
  return `${runId}\u0000${toolCallId}`;
}

/** 收集记录中的并行子运行身份；增量批次可能不含 start，因此与已知集合合并。 */
export function collectParallelSubagentRunIds(records: TranscriptRecord[], known?: Set<string>): Set<string> {
  const runIds = new Set(known || []);
  for (const record of records) {
    if (record.role === 'subagent' && record.event.kind === 'start' && record.event.parallelSize !== undefined) {
      runIds.add(record.runId);
    }
  }
  return runIds;
}

/** 主窗口投影过滤并行子运行的全部过程记录；外层 tool pair 保留并负责展示最终报告。 */
export function filterParallelSubagentRecords(records: TranscriptRecord[], parallelRunIds: Set<string>): TranscriptRecord[] {
  if (parallelRunIds.size === 0) {
    return records;
  }
  return records.filter((record) => record.role !== 'subagent' || !parallelRunIds.has(record.runId));
}

/**
 * 快照路径过滤仍由 footer 展示的活跃 run 内部调用，避免同一调用重复投影。
 */
export function filterPendingSubagentToolCallRecords(records: TranscriptRecord[], state: SubagentAppendRenderState): TranscriptRecord[] {
  return records.filter((record) => record.role !== 'subagent' || record.event.kind !== 'tool_call' ||
    !state.pendingToolCalls.has(createSubagentToolCallKey(record.runId, record.event.toolCallId)));
}
/**
 * 顺序扫描 transcript，把相邻且同 call id 的工具调用和结果聚合为一个渲染块。
 */
function groupTranscriptRecords(records: TranscriptRecord[], showUnexpectedSubagentInterruption = false, knownTerminalCallIds?: Set<string>, activeSubagentRunId?: string, knownParallelToolCallIds?: Set<string>): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = [];
  const subagentTerminalCallIds = new Set(knownTerminalCallIds || []);
  const parallelToolCallIds = new Set(knownParallelToolCallIds || []);
  for (const parentToolCallId of records
    .filter((record): record is SubagentTranscriptRecord => record.role === 'subagent')
    .filter((record) => record.event.kind === 'completed' || record.event.kind === 'failed' || record.event.kind === 'cancelled')
    .map((record) => record.parentToolCallId)) {
    subagentTerminalCallIds.add(parentToolCallId);
    knownTerminalCallIds?.add(parentToolCallId);
  }
  for (const record of records) {
    if (record.role === 'subagent' && record.event.kind === 'start' && record.event.parallelSize !== undefined) {
      // start 在场的路径（快照/重放/退出）自行携带并行事实；增量批次由 appendState 传入补充。
      parallelToolCallIds.add(record.parentToolCallId);
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const nextRecord = records[index + 1];

    if (record.role === 'subagent') {
      const runRecords = [record];
      while (true) {
        const following = records[index + 1];
        if (!following || following.role !== 'subagent' || following.runId !== record.runId) {
          break;
        }
        runRecords.push(following);
        index += 1;
      }
      blocks.push({
        kind: 'subagent_run',
        records: runRecords,
        showUnexpectedInterruption: showUnexpectedSubagentInterruption && record.runId !== activeSubagentRunId
      });
      continue;
    }

    if (
      record.role === 'tool_call' &&
      nextRecord?.role === 'tool_result' &&
      record.toolCallId !== '' &&
      record.toolCallId === nextRecord.toolCallId
    ) {
      blocks.push({
        kind: 'tool_pair',
        call: record,
        result: nextRecord,
        // 并行 run 的过程 rail 不进主窗口，外层 pair 必须展开报告正文，避免父 Agent 结论无处可看。
        compactSubagentResult: record.toolName === 'run_subagent' && subagentTerminalCallIds.has(record.toolCallId) && !parallelToolCallIds.has(record.toolCallId)
      });
      index += 1;
      continue;
    }

    blocks.push({ kind: 'record', record });
  }

  return blocks;
}

/**
 * 按聚合后的 transcript block 类型选择对应 renderer。
 */
function renderTranscriptBlock(block: TranscriptBlock, width: number, theme: RenderState['theme'], appendedSubagentRuns?: Set<string>): string {
  if (block.kind === 'tool_pair') {
    return renderToolPairBlock(block.call, block.result, width, theme, block.compactSubagentResult);
  }

  if (block.kind === 'subagent_run') {
    if (appendedSubagentRuns) {
      const runId = block.records[0]?.runId || '';
      const continuation = appendedSubagentRuns.has(runId);
      appendedSubagentRuns.add(runId);
      return renderSubagentRunAppendBlock(block.records, width, theme, continuation);
    }
    return renderSubagentRunBlock(block.records, width, theme, block.showUnexpectedInterruption);
  }

  return renderRecordBlock(block.record, width, theme);
}

/**
 * 按 record role 选择对应的 transcript block renderer。
 * user record 的 plan mode 颜色依赖提交时写入的 metadata，避免重绘时受当前 mode 影响。
 *
 */
function renderRecordBlock(record: TranscriptRecord, width: number, theme: RenderState['theme']): string {
  const safeRecord = sanitizeRecordDisplayText(record);
  if (safeRecord.role === 'user') {
    const reference = safeRecord.metadata?.conversationReference;
    const referenceBlock = reference
      ? renderConversationReferenceBlock(reference.title, reference.projectionMode, width, theme)
      : '';
    return `${referenceBlock}${renderUserBlock(getUserDisplayText(safeRecord), width, theme, safeRecord.metadata?.interactionMode)}`;
  }

  if (safeRecord.role === 'assistant') {
    return renderAssistantBlock(safeRecord.text, width, theme);
  }

  if (safeRecord.role === 'tool_call' || safeRecord.role === 'tool_result') {
    return renderToolRecordBlock(safeRecord, width, theme);
  }

  if (safeRecord.role === 'shell') {
    return renderShellBlock(safeRecord.text, width, theme);
  }

  if (safeRecord.role === 'error') {
    return renderErrorBlock(safeRecord.text, width, theme);
  }

  if (safeRecord.role === 'compaction_notice') {
    return renderCompactionNoticeBlock(safeRecord.text, width, theme);
  }

  if (safeRecord.role === 'local_notice') {
    return renderLocalNoticeBlock(safeRecord.text, width, theme);
  }

  if (safeRecord.role === 'reasoning_summary') {
    return renderReasoningSummaryBlock(safeRecord.text, width, theme);
  }

  return '';
}

function getUserDisplayText(record: UserTranscriptRecord): string {
  return record.displayText && record.displayText.trim() !== '' ? record.displayText : record.text;
}

/**
 * 把 block 字符串拆成逐行数组，并去掉仅用于 block 拼接的末尾空行。
 *
 */
export function splitRenderedBlock(block: string): string[] {
  const lines = String(block).split('\n');

  if (lines[lines.length - 1] === '') {
    // block 末尾的换行只表示下一个 block 从新行开始，拼接数组时不能再额外放大一行。
    lines.pop();
  }

  return lines;
}
