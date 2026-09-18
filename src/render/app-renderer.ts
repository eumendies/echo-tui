import * as ansi from '../terminal/ansi';
import {sanitizeTerminalText} from '../terminal/control-chars';
import {renderBanner} from './blocks/banner-renderer';
import { createFooterRenderer, renderFooterLayout } from './footer';
import {ShellLiveRenderer} from './live/shell-renderer';
import {StreamingLiveRenderer} from './live/streaming-renderer';
import { createSubagentAppendRenderState, filterParallelSubagentRecords, filterPendingSubagentToolCallRecords, rebuildSubagentAppendState, renderTranscriptBlocks, renderTranscriptLines, splitRenderedBlock, trackParallelSubagentRecords } from './transcript-renderer';
import type { TranscriptRecord } from '../types/transcript';
import type {
  RenderRecordsOptions,
  AppRenderer,
  BannerContext,
  RenderDestructiveOptions,
  RenderInitialOptions,
  PendingState,
  RenderState
} from '../types/render';

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
 * 应用级 renderer 门面：统一 footer 局部重绘、记录追加和清屏重绘，
 * 并按固定顺序组合 transcript 投影、运行期投影与快照帧。
 */
class DefaultAppRenderer implements AppRenderer {
  private readonly output: NodeJS.WriteStream;
  private readonly footer: ReturnType<typeof createFooterRenderer>;
  private readonly streamingLive = new StreamingLiveRenderer();
  private readonly shellLive = new ShellLiveRenderer();
  private readonly subagentAppendState = createSubagentAppendRenderState();

  constructor(output: NodeJS.WriteStream = process.stdout) {
    this.output = output;
    this.footer = createFooterRenderer(output);
  }

  /** 给 footer 注入已进入终端历史区的文本与 shell 未确定尾部起点，避免同一内容重复显示。 */
  private prepareRenderState(options: RenderState): RenderState {
    return this.shellLive.injectHistory(this.streamingLive.injectHistory(options));
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
    // 流式通道与 shell 通道互斥；两者的确定与 footer 重绘合并为同一次 append。
    const content = this.streamingLive.commitDeltas(options, finalizeRecord) + this.shellLive.commitDeltas(options);

    this.footer.append(content, this.prepareRenderState(options));
  }

  /** transcript 成组新增时一次性追加所有可见块并重绘 footer。 */
  renderRecords({records, ...rawState}: RenderRecordsOptions): void {
    const options = rawState.pending ? {...rawState, pending: sanitizePendingDisplayText(rawState.pending)} : rawState;
    const shellCompletionContent = this.shellLive.takeCompletion(records, options);

    // shell record completion 只补写尚未确定的后缀投影；已确定前缀与命令行不重复写入。
    if (shellCompletionContent !== null) {
      this.shellLive.reset();
      this.footer.append(shellCompletionContent, this.prepareRenderState(options));
      return;
    }

    if (records.some((record) => record.role === 'shell' || record.role === 'error')) {
      // shell 执行失败以 error record 收尾；清掉可能残留的确定游标，避免污染下一次命令。
      this.shellLive.reset();
    }

    // 并行子运行的 start 到达后登记身份，同 run 的后续批次持续被过滤，与快照投影保持一致。
    trackParallelSubagentRecords(this.subagentAppendState, records);
    const visibleRecords = filterParallelSubagentRecords(records, this.subagentAppendState.parallelRunIds);
    const blocks = renderTranscriptBlocks(visibleRecords, options.width, options.theme, options.renderPreferences, false, this.subagentAppendState);
    this.footer.append(blocks.join(''), this.prepareRenderState(options));
  }

  /** 清屏后按当前宽度重画完整界面，并重新计算尚未生成正式记录的流式内容。 */
  renderDestructive({bannerContext, records, ...rawState}: RenderDestructiveOptions): void {
    const options = rawState.pending ? {...rawState, pending: sanitizePendingDisplayText(rawState.pending)} : rawState;
    const activeSubagentRunId = options.pending?.kind === 'subagent' ? options.pending.runId : undefined;
    // 隐藏期间积累的稳定投影先推进确定游标，再随完整快照一起重投影。
    const streamingLines = this.streamingLive.snapshotLines(options);
    const shellLines = this.shellLive.snapshotLines(options);
    rebuildSubagentAppendState(this.subagentAppendState, records, activeSubagentRunId);
    const prepared = this.prepareRenderState(options);
    const footerLayout = renderFooterLayout(prepared);
    // 会话窗口 body 已由调用方按 runId 选定记录，跳过主窗口的并行过滤；主投影保持既有过滤语义。
    const viewProjectionRecords = options.skipParallelSubagentFilter
      ? records
      : filterParallelSubagentRecords(records, this.subagentAppendState.parallelRunIds);
    const projectedRecords = filterPendingSubagentToolCallRecords(viewProjectionRecords, this.subagentAppendState);
    const transcriptLines = renderTranscriptLines(projectedRecords, options.width, options.theme, options.renderPreferences, true, activeSubagentRunId);
    const bannerLines = renderBannerLines(bannerContext, options.theme);
    const lines = [...bannerLines, ...transcriptLines, ...streamingLines, ...shellLines, ...footerLayout.lines];
    const cursorRow = bannerLines.length + transcriptLines.length + streamingLines.length + shellLines.length + footerLayout.cursorRow;

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
    this.footer.rememberLayout(footerLayout);
  }
}

/** 创建独立的应用 renderer 实例，保留现有调用入口。 */
export function createAppRenderer(output: NodeJS.WriteStream = process.stdout): AppRenderer {
  return new DefaultAppRenderer(output);
}

/** 把 banner block 拆成逐行数组，供完整快照统一拼接。 */
function renderBannerLines(context: BannerContext, theme: RenderState['theme']): string[] {
  return splitRenderedBlock(renderBanner(context, theme));
}
