import * as ansi from '../terminal/ansi';
import {sanitizeTerminalText} from '../terminal/control-chars';
import {DEFAULT_RENDER_PREFERENCES} from '../config/app-settings-config';
import {DEFAULT_TUI_THEME} from '../config/theme-config';
import { getCommittableReasoningText, getCommittableStreamingText, renderAssistantBlock, renderAssistantMessageLines, renderBanner, renderCompactionNoticeBlock, renderConversationReferenceBlock, renderErrorBlock, renderLocalNoticeBlock, renderReasoningSummaryBlock, renderReasoningSummaryLines, renderShellBlock, renderStreamingCommitLines, renderUserBlock } from './blocks';
import { createFooterRenderer, renderFooterLayout } from './footer';
import { renderToolPairBlock, renderToolRecordBlock } from './tool-message-renderer';
import {renderSubagentRunAppendBlock, renderSubagentRunBlock} from './subagent-renderer';
import type { SubagentTranscriptRecord, ToolCallTranscriptRecord, ToolResultTranscriptRecord, TranscriptRecord, UserTranscriptRecord } from '../types/transcript';
import type {
  RenderRecordsOptions,
  AppRenderer,
  BannerContext,
  RenderDestructiveOptions,
  RenderFinalOptions,
  RenderInitialOptions,
  PendingState,
  RenderState
} from '../types/render';

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

type SubagentAppendRenderState = {
  parallelParentToolCallIds: Set<string>; // 并行分组内 run_subagent 外层 call id；其 tool pair 保持展开报告正文。
  parallelRunIds: Set<string>; // 并行分组子运行身份；其过程记录不进入主窗口投影，由增量批次间共享。
  pendingToolCalls: Map<string, SubagentTranscriptRecord>; // 已持久化但仍由 footer 展示的内部调用，等待 result 后成对写入历史区。
  runIds: Set<string>; // 已经把标题写入终端历史区的子运行，后续 callback 只追加事件行。
  terminalCallIds: Set<string>; // 已经出现终态的外层 call，用于稍后到达的 outer pair 压缩重复报告。
};

/**
 * 创建应用级 renderer 门面，统一处理 footer 局部重绘、记录追加和清屏重绘。
 *
 */
type DisplayedStreamingText = {
  assistant: string; // 已经移入终端历史区的 assistant 文本。
  reasoning: string; // 已经移入终端历史区的 reasoning 文本。
};

type StreamingDisplayState = DisplayedStreamingText & {
  reasoningDisplayClosed: boolean; // 首个正文 token 后禁止再把迟到 reasoning 追加到当前终端历史区。
};

/**
 * 外部来源的 pending 文本(模型草稿、工具参数)可能混入控制字符;
 * CR 会把光标拉回列首覆盖已写内容,ESC 可注入 ANSI 序列,进入渲染前统一净化。
 */
export function sanitizePendingDisplayText(pending: PendingState): PendingState {
  if (pending.kind === 'reasoning_streaming') {
    return {
      ...pending,
      text: sanitizeTerminalText(pending.text),
      ...(pending.historyText !== undefined ? {historyText: sanitizeTerminalText(pending.historyText)} : {})
    };
  }

  if (pending.kind === 'streaming') {
    return {
      ...pending,
      text: sanitizeTerminalText(pending.text),
      ...(pending.reasoningText !== undefined ? {reasoningText: sanitizeTerminalText(pending.reasoningText)} : {}),
      ...(pending.historyText !== undefined ? {historyText: sanitizeTerminalText(pending.historyText)} : {})
    };
  }

  if (pending.kind === 'tool_call') {
    return {...pending, argumentsText: sanitizeTerminalText(pending.argumentsText)};
  }

  if (pending.kind === 'tool_calls') {
    return {
      ...pending,
      calls: pending.calls.map((call) => ({...call, argumentsText: sanitizeTerminalText(call.argumentsText)}))
    };
  }

  if (pending.kind === 'subagents') {
    return {
      ...pending,
      runs: pending.runs.map((run) => ({
        ...run,
        argumentsText: run.argumentsText === undefined ? undefined : sanitizeTerminalText(run.argumentsText),
        draft: run.draft === undefined ? undefined : sanitizeTerminalText(run.draft),
        task: sanitizeTerminalText(run.task),
        toolName: run.toolName === undefined ? undefined : sanitizeTerminalText(run.toolName)
      }))
    };
  }

  // thinking 无文本,shell 输出的 CR 具有进度条语义,subagent 由专属 renderer 处理,均保持原样。
  return pending;
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
 * 管理应用级终端渲染，并为主会话与 BTW 分别保存流式显示进度。
 */
class DefaultAppRenderer implements AppRenderer {
  private readonly output: NodeJS.WriteStream;
  private readonly footer: ReturnType<typeof createFooterRenderer>;
  private readonly streamingByOwner = new Map<string, StreamingDisplayState>();
  private readonly subagentAppendState: SubagentAppendRenderState = {
    parallelParentToolCallIds: new Set(),
    parallelRunIds: new Set(),
    pendingToolCalls: new Map(),
    runIds: new Set(),
    terminalCallIds: new Set()
  };

  constructor(output: NodeJS.WriteStream = process.stdout) {
    this.output = output;
    this.footer = createFooterRenderer(output);
  }

  /** 返回当前会话已经写入终端历史区的流式文本。 */
  private getStreamingState(options: RenderState): StreamingDisplayState {
    const owner = options.streamingOwner || 'main';
    let state = this.streamingByOwner.get(owner);
    if (!state) {
      state = {assistant: '', reasoning: '', reasoningDisplayClosed: false};
      this.streamingByOwner.set(owner, state);
    }
    return state;
  }

  /** 给 footer 补充已经移入终端历史区的文本，避免同一内容重复显示。 */
  private prepareRenderState(options: RenderState, state: DisplayedStreamingText = this.getStreamingState(options)): RenderState {
    const pending = options.pending;
    if (pending?.kind === 'reasoning_streaming' && state.reasoning !== '') {
      const pendingWithHistory = {
        ...pending,
        historyText: state.reasoning
      };
      return {
        ...options,
        pending: pendingWithHistory
      };
    }

    if (pending?.kind === 'streaming' && state.assistant !== '') {
      const pendingWithHistory = {
        ...pending,
        historyText: state.assistant
      };
      return {
        ...options,
        pending: pendingWithHistory
      };
    }

    return options;
  }

  /** 根据完整草稿计算当前时刻可以留在终端历史区的文本。 */
  private getStableStreamingText(options: RenderState, current: StreamingDisplayState): DisplayedStreamingText {
    const pending = options.pending;
    const preferences = options.renderPreferences || DEFAULT_RENDER_PREFERENCES;
    if (pending?.kind === 'reasoning_streaming') {
      return {
        assistant: current.assistant,
        reasoning: preferences.showReasoningSummary
          ? getCommittableReasoningText(pending.text, options.width)
          : current.reasoning
      };
    }
    if (pending?.kind === 'streaming') {
      return {
        assistant: getCommittableStreamingText(pending.text),
        reasoning: !preferences.showReasoningSummary
          ? ''
          : current.reasoningDisplayClosed
            ? current.reasoning
            : pending.reasoningText || current.reasoning
      };
    }
    return {assistant: '', reasoning: ''};
  }

  /** 启动时先追加 banner，再绘制 footer。 */
  renderInitial({bannerContext, ...options}: RenderInitialOptions): void {
    this.output.write(renderBanner(bannerContext, options.theme));
    this.footer.render(this.prepareRenderState(options));
  }

  /** 移除当前 footer，供退出或其他需要清空临时区域的场景使用。 */
  clearFooter(): void {
    this.footer.clear();
  }

  /**
   * 追加本轮新增的稳定内容、按需完成 assistant/reasoning 流式记录，并重绘 footer。
   * finalizeRecord 是已经写入会话事实的权威文本；对应通道由 record role 决定。
   */
  render(options: RenderState, finalizeRecord?: Extract<TranscriptRecord, {role: 'assistant' | 'reasoning_summary'}>): void {
    options = options.pending ? {...options, pending: sanitizePendingDisplayText(options.pending)} : options;
    const current = this.getStreamingState(options);
    const next = finalizeRecord && !options.pending
      ? {assistant: current.assistant, reasoning: current.reasoning}
      : this.getStableStreamingText(options, current);
    const reasoningLines = renderStreamingCommitLines('reasoning', next.reasoning, current.reasoning, options.width, options.theme);
    const assistantLines = renderStreamingCommitLines('assistant', next.assistant, current.assistant, options.width, options.theme);
    // 首次进入正文时补齐当时已有的 reasoning 和消息间距；之后的迟到 reasoning 不再进入当前历史区。
    const startsAssistant = options.pending?.kind === 'streaming' && !current.reasoningDisplayClosed;
    const closesReasoning = startsAssistant && next.reasoning !== '';
    const lines = [...reasoningLines, ...(closesReasoning ? [''] : []), ...assistantLines];
    let content = lines.length > 0 ? `${lines.join('\n')}\n` : '';

    current.reasoning = next.reasoning;
    current.assistant = next.assistant;
    if (startsAssistant) current.reasoningDisplayClosed = true;

    if (finalizeRecord) {
      const kind = finalizeRecord.role === 'assistant' ? 'assistant' : 'reasoning';
      const renderMessage = kind === 'assistant' ? renderAssistantMessageLines : renderReasoningSummaryLines;
      const fullLines = renderMessage(sanitizeTerminalText(finalizeRecord.text), options.width, options.theme);
      const displayedText = current[kind];
      const displayedLines = displayedText === '' ? [] : renderMessage(displayedText, options.width, options.theme);
      const remainingLines = fullLines.slice(displayedLines.length);
      const visible = finalizeRecord.role !== 'reasoning_summary' || options.renderPreferences.showReasoningSummary;
      const suppressLateReasoning = kind === 'reasoning' && current.reasoningDisplayClosed;

      if (visible && !suppressLateReasoning) {
        content += `${remainingLines.join('\n')}${remainingLines.length > 0 ? '\n' : ''}\n`;
      }

      current[kind] = '';
      if (kind === 'assistant') {
        current.reasoning = '';
        current.reasoningDisplayClosed = false;
      }
    }

    this.footer.append(content, this.prepareRenderState(options, current));
  }

  /** transcript 成组新增时一次性追加所有可见块并重绘 footer。 */
  renderRecords({records, ...rawState}: RenderRecordsOptions): void {
    const options = rawState.pending ? {...rawState, pending: sanitizePendingDisplayText(rawState.pending)} : rawState;
    // 并行子运行的 start 到达后登记身份，同 run 的后续批次持续被过滤，与快照投影保持一致。
    this.trackParallelSubagentRecords(records);
    const visibleRecords = filterParallelSubagentRecords(records, this.subagentAppendState.parallelRunIds);
    const blocks = renderTranscriptBlocks(visibleRecords, options.width, options.theme, options.renderPreferences, false, this.subagentAppendState);
    this.footer.append(blocks.join(''), this.prepareRenderState(options));
  }

  /** 登记并行子运行的 start 事实；增量批次之间共享，保证后续事件批次持续被过滤。 */
  private trackParallelSubagentRecords(records: TranscriptRecord[]): void {
    for (const record of records) {
      if (record.role === 'subagent' && record.event.kind === 'start' && record.event.parallelSize !== undefined) {
        this.subagentAppendState.parallelRunIds.add(record.runId);
        this.subagentAppendState.parallelParentToolCallIds.add(record.parentToolCallId);
      }
    }
  }

  /** 清屏后按当前宽度重画完整界面，并重新计算尚未生成正式记录的流式内容。 */
  renderDestructive({bannerContext, records, ...rawState}: RenderDestructiveOptions): void {
    const options = rawState.pending ? {...rawState, pending: sanitizePendingDisplayText(rawState.pending)} : rawState;
    const activeSubagentRunId = options.pending?.kind === 'subagent' ? options.pending.runId : undefined;
    this.subagentAppendState.runIds.clear();
    this.subagentAppendState.terminalCallIds.clear();
    this.subagentAppendState.parallelRunIds.clear();
    this.subagentAppendState.parallelParentToolCallIds.clear();
    this.subagentAppendState.pendingToolCalls.clear();
    for (const record of records) {
      if (record.role === 'subagent') {
        this.subagentAppendState.runIds.add(record.runId);
        if (record.event.kind === 'start' && record.event.parallelSize !== undefined) {
          this.subagentAppendState.parallelRunIds.add(record.runId);
          this.subagentAppendState.parallelParentToolCallIds.add(record.parentToolCallId);
        }
        if (record.event.kind === 'completed' || record.event.kind === 'failed' || record.event.kind === 'cancelled') {
          this.subagentAppendState.terminalCallIds.add(record.parentToolCallId);
        }
        if (record.runId === activeSubagentRunId && record.event.kind === 'tool_call') {
          this.subagentAppendState.pendingToolCalls.set(createSubagentToolCallKey(record.runId, record.event.toolCallId), record);
        } else if (record.runId === activeSubagentRunId && record.event.kind === 'tool_result') {
          this.subagentAppendState.pendingToolCalls.delete(createSubagentToolCallKey(record.runId, record.event.toolCallId));
        }
      }
    }
    const current = this.getStreamingState(options);
    const empty: StreamingDisplayState = {assistant: '', reasoning: '', reasoningDisplayClosed: false};
    const next = this.getStableStreamingText(options, empty);
    const prepared = this.prepareRenderState(options, next);
    const footerLayout = renderFooterLayout(prepared);
    const bannerLines = splitRenderedBlock(renderBanner(bannerContext, options.theme));
    // 会话窗口 body 已由调用方按 runId 选定记录，跳过主窗口的并行过滤；主投影保持既有过滤语义。
    const viewProjectionRecords = options.skipParallelSubagentFilter
      ? records
      : filterParallelSubagentRecords(records, this.subagentAppendState.parallelRunIds);
    const projectedRecords = viewProjectionRecords
      .filter((record) => record.role !== 'subagent' || record.event.kind !== 'tool_call' ||
        !this.subagentAppendState.pendingToolCalls.has(createSubagentToolCallKey(record.runId, record.event.toolCallId)));
    const transcriptLines = renderTranscriptLines(projectedRecords, options.width, options.theme, options.renderPreferences, true, activeSubagentRunId);
    const reasoningLines = next.reasoning === '' ? [] : renderReasoningSummaryLines(next.reasoning, options.width, options.theme);
    const assistantLines = next.assistant === '' ? [] : renderAssistantMessageLines(next.assistant, options.width, options.theme);
    const lines = [...bannerLines, ...transcriptLines, ...reasoningLines, ...assistantLines, ...footerLayout.lines];
    const cursorRow = bannerLines.length + transcriptLines.length + reasoningLines.length + assistantLines.length + footerLayout.cursorRow;

    let sequence = ansi.hideCursor();
    sequence += ansi.resetScrollRegion();
    sequence += ansi.reset();
    sequence += ansi.cursorHome();
    sequence += ansi.clearVisibleScreen();
    sequence += ansi.clearScrollback();
    sequence += ansi.cursorHome();
    sequence += lines.join('\n');
    sequence += ansi.cursorUp(lines.length - 1 - cursorRow);
    sequence += ansi.carriageReturn();
    sequence += ansi.cursorForward(footerLayout.cursorColumn);
    if (footerLayout.showCursor) sequence += ansi.showCursor();

    this.output.write(sequence);
    current.reasoning = next.reasoning;
    current.assistant = next.assistant;
    current.reasoningDisplayClosed = options.pending?.kind === 'streaming';
    this.footer.rememberLayout(footerLayout);
  }

  /** 输出退出时使用的最终静态内容；调用方应先移除临时 footer。 */
  renderFinal({bannerContext, records, theme, renderPreferences, width}: RenderFinalOptions): void {
    const visibleRecords = filterParallelSubagentRecords(records, collectParallelSubagentRunIds(records));
    const lines = [...renderBannerLines(bannerContext, theme), ...renderTranscriptLines(visibleRecords, width, theme, renderPreferences)];
    this.output.write(`${ansi.showCursor()}${lines.join('\n')}\n`);
  }
}

/** 创建独立的应用 renderer 实例，保留现有调用入口。 */
export function createAppRenderer(output: NodeJS.WriteStream = process.stdout): AppRenderer {
  return new DefaultAppRenderer(output);
}

/**
 * 把 banner block 拆成逐行数组，供完整快照统一拼接。
 *
 */
  function renderBannerLines(context: BannerContext, theme: RenderState['theme']): string[] {
    return splitRenderedBlock(renderBanner(context, theme));
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
function renderTranscriptBlocks(
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
function collectParallelSubagentRunIds(records: TranscriptRecord[], known?: Set<string>): Set<string> {
  const runIds = new Set(known || []);
  for (const record of records) {
    if (record.role === 'subagent' && record.event.kind === 'start' && record.event.parallelSize !== undefined) {
      runIds.add(record.runId);
    }
  }
  return runIds;
}

/** 主窗口投影过滤并行子运行的全部过程记录；外层 tool pair 保留并负责展示最终报告。 */
function filterParallelSubagentRecords(records: TranscriptRecord[], parallelRunIds: Set<string>): TranscriptRecord[] {
  if (parallelRunIds.size === 0) {
    return records;
  }
  return records.filter((record) => record.role !== 'subagent' || !parallelRunIds.has(record.runId));
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
function splitRenderedBlock(block: string): string[] {
  const lines = String(block).split('\n');

  if (lines[lines.length - 1] === '') {
    // block 末尾的换行只表示下一个 block 从新行开始，拼接数组时不能再额外放大一行。
    lines.pop();
  }

  return lines;
}
