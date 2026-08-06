import {redactSensitiveText} from '../../agent/agent-errors';

import type {PendingState, StatusLineModelState, WorkingState} from '../../types/render';
import {createToolCallTranscriptRecord, createToolResultTranscriptRecord} from '../../tools/tool-transcript-record';
import {createToolResultTruncationMarker} from '../../tools/tool-result-offloading';

import type {ToolCall, ToolExecutionResult} from '../../types/tool';
import type {ShellTranscriptRecord, TranscriptRecord, UserTranscriptMetadata} from '../../types/transcript';
import type {BashCommandOutputEvent, BashCommandRunResult} from '../../tools/bash-command-runner';

type TranscriptTurnBridge = {
  appendRecord: (record: TranscriptRecord) => TranscriptRecord;
};

type SpinnerKind = 'thinking' | 'working';

type SpinnerTimerConfig = {
  onTick: () => void;
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

// 响应活动重绘周期；同时推进 spinner 动效并投影期间累积的最新 pending 内容。
const SPINNER_REDRAW_INTERVAL_MS = 100;
const ASSISTANT_INTERRUPTED_NOTICE = '已中断模型回答';

/**
 * 管理响应锁、pending preview、spinner 和 turn 生命周期。
 * spinner 帧由渲染层根据 elapsedMs 推算，不再持有递增的 frame 计数。
 * 活动重绘 timer 由本 context 持有，由 main 层在初始化时通过 configureSpinnerTimer 注入回调。
 * token 与 shell chunk 只累积 pending 状态，由同一周期 tick 批量投影到 footer。
 */
class TurnContext {
  transcriptContext: TranscriptTurnBridge;
  responding: boolean;
  pendingKind: 'thinking' | 'reasoning_streaming' | 'streaming' | 'tool_call' | 'shell_output' | null;
  streamingDraft: string;
  reasoningDraft: string;
  shellOutputDraft: {command: string; output: string} | null;
  pendingTool: {toolName: string; argumentsText: string} | null;
  thinkingStartedAt: number | null;
  workingStartedAt: number | null;
  pendingToolCall: ToolCall | null;
  spinnerTimer: unknown;
  spinnerTimerConfig: SpinnerTimerConfig | null;
  activeAssistantTurn: ActiveAssistantTurn | null;
  nextAssistantTurnId: number;

  constructor(transcriptContext: TranscriptTurnBridge) {
    this.transcriptContext = transcriptContext;
    this.responding = false;
    this.pendingKind = null;
    this.streamingDraft = '';
    this.reasoningDraft = '';
    this.shellOutputDraft = null;
    this.pendingTool = null;
    this.thinkingStartedAt = null;
    this.workingStartedAt = null;
    this.pendingToolCall = null;
    this.spinnerTimer = null;
    this.spinnerTimerConfig = null;
    this.activeAssistantTurn = null;
    this.nextAssistantTurnId = 1;
  }

  /**
   * 注入响应活动重绘 timer 配置。main 层负责在创建 app 时调用一次，
   * 把 footer 重绘回调交给本 context 持有；timer 同时服务 spinner 和高频 pending 合并。
   */
  configureSpinnerTimer(config: SpinnerTimerConfig): void {
    this.spinnerTimerConfig = config;
  }

  /**
   * 启动指定类型的 spinner：先停掉旧 timer，再更新 spinner 状态，最后注册周期重绘回调。
   * 周期 tick 推进 spinner 帧，并投影期间累积的最新 assistant 或 shell pending 内容。
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
   * 返回当前 assistant turn 的临时 status line 模型 (skill override)；普通 turn 不覆盖全局模型展示。
   */
  getActiveStatusLineModelState(): StatusLineModelState | undefined {
    const statusLineModel = this.activeAssistantTurn?.statusLineModel;
    return statusLineModel ? {...statusLineModel} : undefined;
  }

  /**
   * 用 agent runtime 实际解析出的模型更新当前 turn；旧 turn 回调不会覆盖新 turn。
   */
  setActiveStatusLineModelState(turn: AssistantTurnHandle, model: StatusLineModelState): boolean {
    if (!this.isCurrentAssistantTurn(turn)) {
      return false;
    }

    this.activeAssistantTurn!.statusLineModel = {...model};
    return true;
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

    if (this.pendingKind === 'reasoning_streaming') {
      return {kind: 'reasoning_streaming', text: this.reasoningDraft};
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
  beginUserTurn(userText: string, options: {displayText?: string; metadata?: UserTranscriptMetadata; attachments?: ToolExecutionResult['attachments']} = {}): TranscriptRecord {
    this.responding = true;
    this.pendingToolCall = null;
    this.clearPending();
    this.clearWorking();

    return this.transcriptContext.appendRecord({
      role: 'user',
      text: userText,
      ...(options.displayText ? {displayText: options.displayText} : {}),
      ...(options.attachments && options.attachments.length > 0 ? {attachments: options.attachments} : {}),
      ...(options.metadata ? {metadata: options.metadata} : {})
    });
  }

  /**
   * 进入手动压缩的响应中状态：不追加 user record，仅占用响应锁并清理 pending/working，
   * 供 /compact 后台异步压缩使用；结束由 finishAssistantTurn('') 或 failAssistantTurn 释放。
   */
  beginManualCompaction(): void {
    this.responding = true;
    this.pendingToolCall = null;
    this.clearPending();
    this.clearWorking();
  }

  /** 进入用户 shell 命令执行态，并用 working spinner 表示本地执行中。 */
  beginShellCommand(command: string): void {
    this.responding = true;
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
   * 更新 assistant 正文 streaming 草稿，并结束 transient reasoning pending 阶段。
   */
  setStreamingPending(draft: string): void {
    this.pendingKind = 'streaming';
    this.streamingDraft = draft;
    this.reasoningDraft = '';
  }

  /**
   * 更新可读 reasoning streaming 草稿；完成后由 summary transcript 切换到正文或工具阶段。
   */
  setReasoningStreamingPending(draft: string): void {
    this.pendingKind = 'reasoning_streaming';
    this.reasoningDraft = draft;
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
    this.reasoningDraft = '';
    this.shellOutputDraft = null;
    this.pendingTool = null;
    this.thinkingStartedAt = null;
  }

  /**
   * 完成 assistant 响应，提交 assistant record 并释放 response lock。
   */
  finishAssistantTurn(finalText: string): TranscriptRecord | null {
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
   * 记录 provider 已确认完成的 reasoning summary，并清理 reasoning pending。
   * turn-end fallback 可能发生在正文 streaming 之后，此时保留正文 pending。
   */
  appendReasoningSummary(text: string): TranscriptRecord {
    this.reasoningDraft = '';
    this.thinkingStartedAt = null;

    if (this.pendingKind === 'thinking' || this.pendingKind === 'reasoning_streaming') {
      this.pendingKind = null;
    }

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

    const partialRecord = this.commitPendingAssistantDraft() || undefined;
    const noticeRecord = this.cancelAssistantTurn();
    this.activeAssistantTurn = null;

    return {interrupted: true, partialRecord, noticeRecord};
  }
}

function createShellRecord(result: BashCommandRunResult, includeInContext: boolean): ShellTranscriptRecord {
  const output = formatShellOutput(result);

  return {
    role: 'shell',
    text: formatShellRecordText(result, includeInContext, output),
    command: result.command,
    durationMs: result.durationMs,
    ...(result.error ? {error: result.error} : {}),
    exitCode: result.exitCode,
    includeInContext,
    output,
    timedOut: result.timedOut,
    truncated: result.truncated
  };
}

function formatShellRecordText(result: BashCommandRunResult, includeInContext: boolean, output: string): string {
  const lines = [`$ ${result.command}${includeInContext ? '' : ' [local]'}`];

  if (output.trim() !== '') {
    lines.push('', output.replace(/\n$/, ''));
  }

  if (result.error) {
    lines.push('', result.error);
  }

  if (result.timedOut) {
    lines.push('', `[timed out after ${result.durationMs}ms]`);
  }

  if (result.truncated && !result.offloadFilePath) {
    lines.push('', '[output truncated]');
  }

  if (result.exitCode !== 0 || result.timedOut || output.trim() === '') {
    lines.push('', `[exit ${result.exitCode === null ? 'null' : result.exitCode}]`);
  }

  return lines.join('\n');
}

function formatShellOutput(result: BashCommandRunResult): string {
  if (!result.offloadFilePath) {
    return result.output;
  }

  const marker = createToolResultTruncationMarker(result.offloadFilePath);
  return result.output.trim() === '' ? marker : `${marker}\n\n${result.output}`;
}

export {
  TurnContext
};
export type {
  AssistantTurnHandle,
  InterruptAssistantTurnResult
};
