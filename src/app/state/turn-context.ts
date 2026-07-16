import {redactSensitiveText} from '../../agent/agent-errors';

import type {PendingState, StatusLineModelState, WorkingState} from '../../types/render';
import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';

import type {ToolCall, ToolExecutionResult} from '../../types/tool';
import type {ShellTranscriptRecord, TranscriptRecord} from '../../types/transcript';
import type {BashCommandOutputEvent, BashCommandRunResult} from '../../tools/bash-command-runner';

type ComposerTurnBridge = {
  recordInput: (text: string) => void;
  reset: () => void;
  leaveHistoryBrowsing: () => void;
};

type TranscriptTurnBridge = {
  appendRecord: (record: TranscriptRecord) => TranscriptRecord;
};

type SpinnerKind = 'thinking' | 'working';

type SpinnerTimerConfig = {
  onTick: () => void;
};

type StreamingRenderTimerConfig = {
  onRender: () => void;
};

type AssistantTurnHandle = {
  id: number;
  abortSignal: AbortSignal;
};

type ActiveAssistantTurn = {
  id: number;
  controller: AbortController;
  statusLineModel?: StatusLineModelState;
};

type InterruptAssistantTurnResult = {
  interrupted: boolean;
  partialRecord?: TranscriptRecord;
  noticeRecord?: TranscriptRecord;
};

// spinner 重绘周期；只用于在没有 token / 没有外部事件时按时间推动一帧。
const SPINNER_REDRAW_INTERVAL_MS = 100;
// streaming token footer 重绘周期；约束 onToken 高频路径到接近 20 FPS。
const STREAMING_RENDER_INTERVAL_MS = 50;
const ASSISTANT_INTERRUPTED_NOTICE = '已中断模型回答';

/**
 * 管理响应锁、pending preview、spinner 和 turn 生命周期。
 * spinner 帧由渲染层根据 elapsedMs 推算，不再持有递增的 frame 计数。
 * spinner 重绘 timer 由本 context 持有，由 main 层在初始化时通过 configureSpinnerTimer 注入回调。
 * streaming token footer 重绘 timer 同样由本 context 持有，只服务 onToken 路径的短窗口合并。
 */
class TurnContext {
  composerContext: ComposerTurnBridge;
  transcriptContext: TranscriptTurnBridge;
  responding: boolean;
  pendingKind: 'thinking' | 'streaming' | 'tool_call' | 'shell_output' | null;
  streamingDraft: string;
  shellOutputDraft: {command: string; output: string} | null;
  pendingTool: {toolName: string; argumentsText: string} | null;
  thinkingStartedAt: number | null;
  workingStartedAt: number | null;
  pendingToolCall: ToolCall | null;
  spinnerTimer: unknown;
  spinnerTimerConfig: SpinnerTimerConfig | null;
  streamingRenderTimer: unknown;
  streamingRenderTimerConfig: StreamingRenderTimerConfig | null;
  lastStreamingRenderAt: number | null;
  activeAssistantTurn: ActiveAssistantTurn | null;
  nextAssistantTurnId: number;

  constructor(composerContext: ComposerTurnBridge, transcriptContext: TranscriptTurnBridge) {
    this.composerContext = composerContext;
    this.transcriptContext = transcriptContext;
    this.responding = false;
    this.pendingKind = null;
    this.streamingDraft = '';
    this.shellOutputDraft = null;
    this.pendingTool = null;
    this.thinkingStartedAt = null;
    this.workingStartedAt = null;
    this.pendingToolCall = null;
    this.spinnerTimer = null;
    this.spinnerTimerConfig = null;
    this.streamingRenderTimer = null;
    this.streamingRenderTimerConfig = null;
    this.lastStreamingRenderAt = null;
    this.activeAssistantTurn = null;
    this.nextAssistantTurnId = 1;
  }

  /**
   * 注入 spinner 重绘 timer 配置。main 层负责在创建 app 时调用一次，
   * 把 footer 重绘回调交给本 context 持有；timer 实现固定使用全局 setInterval。
   */
  configureSpinnerTimer(config: SpinnerTimerConfig): void {
    this.spinnerTimerConfig = config;
  }

  /**
   * 注入 streaming token footer 重绘配置。main 只提供 render 回调，调度窗口和 timer 状态由本 context 收敛。
   */
  configureStreamingRenderTimer(config: StreamingRenderTimerConfig): void {
    this.streamingRenderTimerConfig = config;
  }

  /**
   * 调度一次由 onToken 触发的 footer 重绘：首帧立即显示，窗口内后续 token 合并到 trailing render。
   */
  scheduleStreamingRender(): void {
    const config = this.streamingRenderTimerConfig;
    if (!config) {
      return;
    }

    const now = Date.now();
    const lastRenderAt = this.lastStreamingRenderAt;
    const elapsedMs = lastRenderAt === null ? STREAMING_RENDER_INTERVAL_MS : now - lastRenderAt;

    if (lastRenderAt === null || elapsedMs >= STREAMING_RENDER_INTERVAL_MS) {
      this.cancelStreamingRender();
      this.lastStreamingRenderAt = now;
      config.onRender();
      return;
    }

    if (this.streamingRenderTimer) {
      return;
    }

    this.streamingRenderTimer = setTimeout(() => {
      this.streamingRenderTimer = null;
      this.lastStreamingRenderAt = Date.now();
      config.onRender();
    }, STREAMING_RENDER_INTERVAL_MS - elapsedMs);
  }

  /**
   * 取消尚未执行的 streaming token footer 重绘，并重置窗口锚点，避免旧 timer 覆盖结构性状态。
   */
  cancelStreamingRender(): void {
    if (this.streamingRenderTimer) {
      clearTimeout(this.streamingRenderTimer as Parameters<typeof clearTimeout>[0]);
      this.streamingRenderTimer = null;
    }

    this.lastStreamingRenderAt = null;
  }

  /**
   * 启动指定类型的 spinner：先停掉旧 timer，再更新 spinner 状态，最后注册周期重绘回调。
   * 周期 tick 仅用于在没有 token / 工具事件时按时间推进 spinner 帧。
   */
  startSpinner(kind: SpinnerKind): void {
    this.stopSpinner();
    this.enterSpinnerState(kind);

    const config = this.spinnerTimerConfig;
    if (!config) {
      return;
    }

    this.spinnerTimer = setInterval(config.onTick, SPINNER_REDRAW_INTERVAL_MS);
  }

  /**
   * 停止 spinner 重绘 timer；若未启动则直接返回。spinner 状态本身不在此清理，
   * 由 turn 生命周期相关的 finishAssistantTurn / failAssistantTurn 等方法负责。
   */
  stopSpinner(): void {
    if (!this.spinnerTimer) {
      this.spinnerTimer = null;
      return;
    }

    clearInterval(this.spinnerTimer as Parameters<typeof clearInterval>[0]);
    this.spinnerTimer = null;
  }

  /**
   * 返回当前是否处于响应中。
   */
  isResponding(): boolean {
    return this.responding;
  }

  /**
   * 返回当前 assistant turn 是否真实可通过 Esc 中断；手动压缩等仅占用 response lock 的流程不算。
   */
  canInterruptAssistantTurn(): boolean {
    const activeTurn = this.activeAssistantTurn;
    return this.responding && Boolean(activeTurn) && !activeTurn?.controller.signal.aborted;
  }

  /**
   * 创建当前 assistant turn 的身份与中断信号，供 app 层绑定本次 agent 调用。
   */
  beginAssistantTurn(statusLineModel?: StatusLineModelState): AssistantTurnHandle {
    const activeTurn = {
      id: this.nextAssistantTurnId,
      controller: new AbortController(),
      ...(statusLineModel ? {statusLineModel: {...statusLineModel}} : {})
    };

    this.nextAssistantTurnId += 1;
    this.activeAssistantTurn = activeTurn;

    return {id: activeTurn.id, abortSignal: activeTurn.controller.signal};
  }

  /**
   * 返回当前 assistant turn 的临时 status line 模型；普通 turn 不覆盖全局模型展示。
   */
  getActiveStatusLineModelState(): StatusLineModelState | undefined {
    const statusLineModel = this.activeAssistantTurn?.statusLineModel;
    return statusLineModel ? {...statusLineModel} : undefined;
  }

  /**
   * 判断回调是否仍属于当前 assistant turn，避免旧异步回调污染新 turn。
   */
  isCurrentAssistantTurn(turn: AssistantTurnHandle): boolean {
    return this.activeAssistantTurn?.id === turn.id;
  }

  /**
   * 当前 turn 正常收尾后清除身份；旧 turn 的 finally 不应影响新 turn。
   */
  clearAssistantTurnIfCurrent(turn: AssistantTurnHandle): void {
    if (this.isCurrentAssistantTurn(turn)) {
      this.activeAssistantTurn = null;
    }
  }

  /**
   * 返回当前 pending 预览。读取时根据当前时钟把 thinking 状态投影为 elapsedMs。
   */
  getPending(): PendingState | null {
    if (this.pendingKind === null) {
      return null;
    }

    if (this.pendingKind === 'thinking') {
      const startedAt = this.thinkingStartedAt;
      const elapsedMs = startedAt === null ? 0 : Math.max(0, Date.now() - startedAt);
      return {kind: 'thinking', elapsedMs};
    }

    if (this.pendingKind === 'streaming') {
      return {kind: 'streaming', text: this.streamingDraft};
    }

    if (this.pendingKind === 'shell_output') {
      const draft = this.shellOutputDraft;
      return draft ? {kind: 'shell_output', command: draft.command, output: draft.output} : null;
    }

    const tool = this.pendingTool;
    if (!tool) {
      return null;
    }
    return {kind: 'tool_call', toolName: tool.toolName, argumentsText: tool.argumentsText};
  }

  /**
   * 返回当前本轮工作状态；首次访问后才生效，elapsedMs 实时由当前时钟派生。
   */
  getWorking(): WorkingState | null {
    if (this.workingStartedAt === null) {
      return null;
    }

    return {elapsedMs: Math.max(0, Date.now() - this.workingStartedAt)};
  }

  /**
   * 把 agent 失败转换成可见但不泄露敏感值的本地 error 消息。
   */
  createAgentErrorRecord(error: unknown): TranscriptRecord {
    return this.createErrorRecord(error, '模型响应失败');
  }

  private createErrorRecord(error: unknown, prefix: string): TranscriptRecord {
    const message = error instanceof Error && typeof error.message === 'string' && error.message.trim() !== ''
      ? redactSensitiveText(error.message)
      : '未知错误';

    return {
      role: 'error',
      text: `${prefix}：${message}`
    };
  }

  /**
   * 提交用户消息并进入响应中状态。
   */
  beginUserTurn(userText: string, options: {historyText?: string; displayText?: string; metadata?: Record<string, unknown>; attachments?: ToolExecutionResult['attachments']} = {}): TranscriptRecord {
    this.composerContext.leaveHistoryBrowsing();
    this.composerContext.recordInput(options.historyText || userText);
    this.composerContext.reset();
    this.responding = true;
    this.cancelStreamingRender();
    this.pendingToolCall = null;
    this.clearPending();
    this.clearWorking();

    return this.transcriptContext.appendRecord({
      role: 'user',
      text: userText,
      ...(options.displayText ? {displayText: options.displayText} : {}),
      ...(options.attachments && options.attachments.length > 0 ? {attachments: options.attachments} : {}),
      ...(options.metadata || {})
    });
  }

  /**
   * 进入手动压缩的响应中状态：不追加 user record，仅占用响应锁并清理 pending/working，
   * 供 /compact 后台异步压缩使用；结束由 finishAssistantTurn('') 或 failAssistantTurn 释放。
   */
  beginManualCompaction(): void {
    this.responding = true;
    this.cancelStreamingRender();
    this.pendingToolCall = null;
    this.clearPending();
    this.clearWorking();
  }

  /**
   * 进入用户 shell 命令执行态：记录输入历史、清空 composer，并用 working spinner 表示本地执行中。
   */
  beginShellCommand(command: string): void {
    this.composerContext.leaveHistoryBrowsing();
    this.composerContext.recordInput(command);
    this.composerContext.reset();
    this.responding = true;
    this.cancelStreamingRender();
    this.pendingToolCall = null;
    this.clearPending();
    this.clearWorking();
    this.shellOutputDraft = {command, output: ''};
    this.enterSpinnerState('working');
  }

  /**
   * 记录 shell 执行结果并释放响应锁。
   */
  finishShellCommand(result: BashCommandRunResult, includeInContext: boolean): TranscriptRecord {
    this.cancelStreamingRender();
    this.stopSpinner();
    this.clearPending();
    this.clearWorking();
    this.pendingToolCall = null;
    this.responding = false;

    return this.transcriptContext.appendRecord(createShellRecord(result, includeInContext));
  }

  /**
   * 进入指定状态。thinking 时锚定起点用于推算 elapsedMs；working 同理且只锚定一次。
   */
  enterSpinnerState(kind: SpinnerKind): void {
    if (kind === 'thinking') {
      this.pendingKind = 'thinking';
      if (this.thinkingStartedAt === null) {
        this.thinkingStartedAt = Date.now();
      }
      return;
    }

    if (this.workingStartedAt === null) {
      this.workingStartedAt = Date.now();
    }
  }

  /**
   * 更新 streaming pending 文本草稿。
   */
  setStreamingPending(draft: string): void {
    this.pendingKind = 'streaming';
    this.streamingDraft = draft;
  }

  /**
   * 追加 shell 命令运行中的本地输出预览；只更新 footer pending，不追加 transcript。
   */
  appendShellOutputPending(event: BashCommandOutputEvent): void {
    if (!this.shellOutputDraft) {
      return;
    }

    this.pendingKind = 'shell_output';
    this.shellOutputDraft.output += event.chunk;
  }

  /**
   * 更新 tool call pending 预览，并暂存 call 供 result 到达后落盘。
   */
  setToolCallPending(call: ToolCall): void {
    this.pendingToolCall = call;
    this.pendingKind = 'tool_call';
    this.pendingTool = {toolName: call.toolName, argumentsText: call.argumentsText};
  }

  /**
   * 清空当前 working 状态。
   */
  clearWorking(): void {
    this.workingStartedAt = null;
  }

  /**
   * 清空当前 pending 预览。
   */
  clearPending(): void {
    this.pendingKind = null;
    this.streamingDraft = '';
    this.shellOutputDraft = null;
    this.pendingTool = null;
    this.thinkingStartedAt = null;
  }

  /**
   * 完成 assistant 响应，提交 assistant record 并释放 response lock。
   */
  finishAssistantTurn(finalText: string): TranscriptRecord | null {
    this.cancelStreamingRender();
    this.clearPending();
    this.clearWorking();
    this.pendingToolCall = null;
    this.responding = false;

    if (finalText.trim() === '') {
      return null;
    }

    return this.transcriptContext.appendRecord({
      role: 'assistant',
      text: finalText
    });
  }

  /**
   * 记录已经流出的 partial assistant 内容，但保持响应锁给随后的 error record 释放。
   */
  commitPartialAssistantTurn(partialText: string): TranscriptRecord | null {
    if (partialText.trim() === '') {
      return null;
    }

    this.clearPending();

    return this.transcriptContext.appendRecord({
      role: 'assistant',
      text: partialText
    });
  }

  /**
   * 提交当前 streaming pending 中保存的 assistant 草稿，避免 app 层重复持有 draft。
   */
  commitPendingAssistantDraft(): TranscriptRecord | null {
    return this.commitPartialAssistantTurn(this.streamingDraft);
  }

  /**
   * 记录 provider 返回的 reasoning summary；它是可见事实，但不是 assistant 正文。
   */
  appendReasoningSummary(text: string): TranscriptRecord {
    this.clearPending();

    return this.transcriptContext.appendRecord({
      role: 'reasoning_summary',
      text
    });
  }

  /**
   * 记录模型请求执行的工具调用，保持响应锁。
   */
  appendToolCall(call: ToolCall): TranscriptRecord {
    this.clearPending();

    return this.transcriptContext.appendRecord(createToolCallTranscriptRecord(call));
  }

  /**
   * 记录本地工具执行结果，保持响应锁。
   */
  appendToolResult(result: ToolExecutionResult): TranscriptRecord {
    this.clearPending();

    return this.transcriptContext.appendRecord(createToolResultTranscriptRecord(result));
  }

  /**
   * 工具结果到达后，消费暂存 call 并按既有 transcript 类型顺序构造 records。
   * 调用方必须通过 TranscriptContext 成组落盘，避免 tool pair 被逐条或重复持久化。
   */
  appendPendingToolResult(result: ToolExecutionResult): TranscriptRecord[] {
    const records: TranscriptRecord[] = [];
    const pendingToolCall = this.pendingToolCall;

    this.pendingToolCall = null;
    this.clearPending();

    if (pendingToolCall) {
      records.push(createToolCallTranscriptRecord(pendingToolCall));
    }

    records.push(createToolResultTranscriptRecord(result));

    return records;
  }

  /**
   * 记录本地 error 消息，并释放 response lock。
   */
  failAssistantTurn(error: unknown): TranscriptRecord {
    this.cancelStreamingRender();
    this.clearPending();
    this.clearWorking();
    this.pendingToolCall = null;
    this.responding = false;

    return this.transcriptContext.appendRecord(this.createAgentErrorRecord(error));
  }

  /**
   * 记录 shell 执行异常消息，并释放 response lock。
   */
  failShellCommand(error: unknown): TranscriptRecord {
    this.cancelStreamingRender();
    this.stopSpinner();
    this.clearPending();
    this.clearWorking();
    this.pendingToolCall = null;
    this.responding = false;

    return this.transcriptContext.appendRecord(this.createErrorRecord(error, 'Shell 执行失败'));
  }

  /**
   * 记录用户主动中断提示，并释放 response lock；partial assistant 由调用方先落盘。
   */
  cancelAssistantTurn(): TranscriptRecord {
    this.cancelStreamingRender();
    this.clearPending();
    this.clearWorking();
    this.pendingToolCall = null;
    this.responding = false;

    return this.transcriptContext.appendRecord({
      role: 'local_notice',
      text: ASSISTANT_INTERRUPTED_NOTICE
    });
  }

  /**
   * 中断当前 active assistant turn，并返回需要追加渲染的 partial 和本地提示记录。
   */
  interruptActiveAssistantTurn(): InterruptAssistantTurnResult {
    const activeTurn = this.activeAssistantTurn;

    if (!this.responding || !activeTurn || activeTurn.controller.signal.aborted) {
      return {interrupted: false};
    }

    activeTurn.controller.abort();
    this.stopSpinner();
    this.cancelStreamingRender();

    const partialRecord = this.commitPendingAssistantDraft() || undefined;
    const noticeRecord = this.cancelAssistantTurn();
    this.activeAssistantTurn = null;

    return {interrupted: true, partialRecord, noticeRecord};
  }
}

function createShellRecord(result: BashCommandRunResult, includeInContext: boolean): ShellTranscriptRecord {
  return {
    role: 'shell',
    text: formatShellRecordText(result, includeInContext),
    command: result.command,
    durationMs: result.durationMs,
    ...(result.error ? {error: result.error} : {}),
    exitCode: result.exitCode,
    includeInContext,
    output: result.output,
    timedOut: result.timedOut,
    truncated: result.truncated
  };
}

function formatShellRecordText(result: BashCommandRunResult, includeInContext: boolean): string {
  const lines = [`$ ${result.command}${includeInContext ? '' : ' [local]'}`];

  if (result.output.trim() !== '') {
    lines.push('', result.output.replace(/\n$/, ''));
  }

  if (result.error) {
    lines.push('', result.error);
  }

  if (result.timedOut) {
    lines.push('', `[timed out after ${result.durationMs}ms]`);
  }

  if (result.truncated) {
    lines.push('', '[output truncated]');
  }

  if (result.exitCode !== 0 || result.timedOut || result.output.trim() === '') {
    lines.push('', `[exit ${result.exitCode === null ? 'null' : result.exitCode}]`);
  }

  return lines.join('\n');
}

export {
  TurnContext
};
export type {
  AssistantTurnHandle,
  InterruptAssistantTurnResult
};
