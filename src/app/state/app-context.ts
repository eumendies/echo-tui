import {ComposerContext} from './composer-context';
import {ModelContext} from './model-context';
import {RenderContext} from './render-context';
import {SlashSuggestionContext} from './slash-suggestion-context';
import {TranscriptContext} from './transcript-context';
import {TurnContext} from './turn-context';
import {ChangeHistoryContext} from './change-history-context';
import {INPUT_EVENTS} from '../../input/event-types';
import {createDiffSourceResult} from '../diff/source';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';

import type {TerminalController} from '../../types/app';
import type {AgentSessionInput, ContextUsage, InteractionMode} from '../../types/agent';
import type {DiffSourceResult} from '../../types/diff';
import type {BashCommandRunResult, BashCommandOutputEvent} from '../../tools/bash-command-runner';
import type {CommandSurface, SlashCommandDescriptor} from '../../types/command';
import type {InputEvent} from '../../types/input';
import type {BannerContext, PendingState, RenderState, SlashSuggestionState, StatusLineModelState, WorkingState} from '../../types/render';
import type {ToolCall, ToolExecutionResult} from '../../types/tool';
import type {CompactionState, TodoState, TranscriptRecord, TranscriptSession, TranscriptStore} from '../../types/transcript';
import type {ChangeFileRecorder, UndoExecuteResult, UndoSummary} from '../../types/change-history';
import type {ToolApprovalContext} from './tool-approval-context';
import type {AssistantTurnHandle, InterruptAssistantTurnResult} from './turn-context';

type AgentInteractionMode = 'normal' | 'plan';

const PLAN_MODE_INSTRUCTIONS = 'Plan mode is active. Discuss and inspect only; do not modify files, run mutating commands, run tests or builds, install dependencies, change branch or repository state, or use MCP tools. Ask the user to switch to /mode normal before implementing.';
const NORMAL_MODE_INSTRUCTIONS = 'Normal mode is active. Previous Plan Mode restrictions no longer apply. You may implement changes and use mutation tools, subject to the normal tool approval and risk policies.';

function isInteractionMode(value: unknown): value is InteractionMode {
  return value === 'normal' || value === 'plan' || value === 'shell' || value === 'shell-local';
}

/**
 * 把四种 UI interaction mode 收敛为模型可见的执行或规划语义。
 */
function toAgentInteractionMode(mode: InteractionMode): AgentInteractionMode {
  return mode === 'plan' ? 'plan' : 'normal';
}

/**
 * 仅在模型可见 mode 改变时包装 user message；返回 null 表示原文可直接提交。
 */
function createModeTransitionUserMessage(userText: string, from: AgentInteractionMode, to: AgentInteractionMode): {metadata: {from: AgentInteractionMode; to: AgentInteractionMode}; text: string} | null {
  if (from === to) {
    return null;
  }

  return {
    metadata: {from, to},
    text: [
      '[Interaction Mode Transition]',
      `from: ${from}`,
      `to: ${to}`,
      '',
      '[Mode Instructions]',
      to === 'plan' ? PLAN_MODE_INSTRUCTIONS : NORMAL_MODE_INSTRUCTIONS,
      '',
      '[User Request]',
      userText
    ].join('\n')
  };
}

/**
 * 组合单个 createApp 实例需要的语义 context；状态由各子 context 自己持有。
 */
class AppContext {
  getCurrentCwdValue: string | (() => string);
  getNodeVersionValue: string | (() => string);
  composerContext: ComposerContext;
  transcriptContext: TranscriptContext;
  modelContext: ModelContext;
  turnContext: TurnContext;
  changeHistoryContext: ChangeHistoryContext;
  theme: TuiTheme;
  renderContext: RenderContext;
  slashSuggestionContext: SlashSuggestionContext;
  interactionMode: InteractionMode;
  lastSubmittedAgentMode: AgentInteractionMode;
  contextUsage: ContextUsage | null;
  mcpBootstrapStatus: 'idle' | 'initializing' | 'ready';

  constructor(
    terminal: TerminalController,
    transcriptStore: TranscriptStore,
    cwd: string | (() => string),
    nodeVersion: string | (() => string),
    theme: TuiTheme = DEFAULT_TUI_THEME
  ) {
    this.getCurrentCwdValue = cwd;
    this.getNodeVersionValue = nodeVersion;

    this.composerContext = new ComposerContext(() => this.turnContext ? this.turnContext.isResponding() : false);
    this.transcriptContext = new TranscriptContext(transcriptStore, () => this.getCurrentCwd());
    this.modelContext = new ModelContext();
    this.turnContext = new TurnContext(this.composerContext, this.transcriptContext);
    this.changeHistoryContext = new ChangeHistoryContext();
    this.theme = theme;
    this.interactionMode = 'normal';
    this.lastSubmittedAgentMode = 'normal';
    this.contextUsage = null;
    this.mcpBootstrapStatus = 'idle';
    this.slashSuggestionContext = new SlashSuggestionContext([], {
      hasActiveCommandSession: () => false,
      isResponding: () => this.responding
    });
    this.renderContext = new RenderContext(
      terminal,
      () => this.getCurrentCwd(),
      () => this.getNodeVersion(),
      this.composerContext,
      this.turnContext,
      this,
      () => this.interactionMode,
      this.theme
    );
  }

  /**
   * 返回当前 composer 状态。
   */
  get composer(): RenderState['composer'] {
    return this.composerContext.composer;
  }

  /**
   * 返回当前 transcript records。
   */
  get transcriptRecords(): TranscriptRecord[] {
    return this.transcriptContext.records;
  }

  /**
   * 返回上一次渲染宽度。
   */
  get previousColumns(): number {
    return this.renderContext.previousColumns;
  }

  /**
   * 更新上一次渲染宽度。
   */
  set previousColumns(columns: number) {
    this.renderContext.previousColumns = columns;
  }

  /**
   * 返回上一次渲染高度。
   */
  get previousRows(): number {
    return this.renderContext.previousRows;
  }

  /**
   * 更新上一次渲染高度。
   */
  set previousRows(rows: number) {
    this.renderContext.previousRows = rows;
  }

  /**
   * 返回当前是否在响应中。
   */
  get responding(): boolean {
    return this.turnContext.responding;
  }

  getMcpBootstrapStatus(): 'idle' | 'initializing' | 'ready' {
    return this.mcpBootstrapStatus;
  }

  setMcpBootstrapStatus(status: 'idle' | 'initializing' | 'ready'): void {
    this.mcpBootstrapStatus = status;
  }

  /**
   * 返回当前 app 工作目录；持久化分区和 banner 展示共用同一来源。
   */
  getCurrentCwd(): string {
    return String(typeof this.getCurrentCwdValue === 'function' ? this.getCurrentCwdValue() : this.getCurrentCwdValue);
  }

  /**
   * 返回当前 Node.js 版本展示文本。
   */
  getNodeVersion(): string {
    return String(typeof this.getNodeVersionValue === 'function' ? this.getNodeVersionValue() : this.getNodeVersionValue);
  }

  /**
   * 返回当前交互模式；mode 选择不写配置，模型可见切换由下一条 user record 持久化。
   */
  getInteractionMode(): InteractionMode {
    return this.interactionMode;
  }

  /**
   * 切换当前交互模式，供本地 slash 命令控制 agent 工具边界。
   */
  setInteractionMode(mode: InteractionMode): void {
    this.interactionMode = mode;
  }

  /**
   * 替换当前进程的 render theme；后续快照和重绘都会使用新 theme。
   */
  setTheme(theme: TuiTheme): void {
    this.theme = theme;
    this.renderContext.theme = theme;
  }

  /**
   * 在普通、规划、进入上下文的 shell 和本地 shell 之间循环切换。
   */
  cycleInteractionMode(): InteractionMode {
    if (this.interactionMode === 'normal') {
      this.setInteractionMode('plan');
      return this.interactionMode;
    }

    if (this.interactionMode === 'plan') {
      this.setInteractionMode('shell');
      return this.interactionMode;
    }

    if (this.interactionMode === 'shell') {
      this.setInteractionMode('shell-local');
      return this.interactionMode;
    }

    const nextMode = 'normal';
    this.setInteractionMode(nextMode);
    return nextMode;
  }

  /**
   * 生成 banner 所需的运行时上下文，避免渲染层直接依赖 process 全局状态。
   */
  createBannerContext(): BannerContext {
    return this.renderContext.createBannerContext();
  }

  /**
   * 组合渲染层需要的瞬时状态，避免 main.ts 反复散落访问实例字段。
   */
  createRenderState(options: {commandSurface?: CommandSurface | null; toolApproval?: Pick<ToolApprovalContext, 'isAllowAllForSession'> | null} = {}): RenderState {
    const commandSurface = options.commandSurface ?? null;
    const slashSuggestions = commandSurface || this.mcpBootstrapStatus === 'initializing' ? null : this.getSlashSuggestionState();
    const model = commandSurface ? undefined : this.createStatusLineModelState();

    return this.renderContext.createRenderState({
      commandSurface,
      contextUsage: this.contextUsage,
      model,
      allowAllTools: options.toolApproval?.isAllowAllForSession() || false,
      slashSuggestions
    });
  }

  /**
   * 保存最近一次 provider 返回的真实 context usage；该状态只用于当前进程 status line。
   */
  setContextUsage(usage: ContextUsage): void {
    this.contextUsage = {...usage};
  }

  /**
   * 清理已失去语义的 provider usage，例如模型切换、清空或恢复会话后。
   */
  clearContextUsage(): void {
    this.contextUsage = null;
  }

  /**
   * 读取当前选择模型的展示名；配置不可用时返回稳定占位，避免 footer 重绘打断主流程。
   */
  private createStatusLineModelState(): StatusLineModelState {
    return this.turnContext.getActiveStatusLineModelState() ?? this.modelContext.getStatusLineModelState();
  }

  /**
   * 配置 composer 编辑态 slash 命令提示；AppContext 仍是 main.ts 唯一直接持有的语义 context。
   */
  configureSlashSuggestions(commands: SlashCommandDescriptor[] | (() => SlashCommandDescriptor[]), hasActiveCommandSession: () => boolean): void {
    this.slashSuggestionContext = new SlashSuggestionContext(commands, {
      hasActiveCommandSession,
      isResponding: () => this.responding
    });
  }

  /**
   * 返回当前 composer 对应的 slash suggestion 渲染状态。
   */
  getSlashSuggestionState(): SlashSuggestionState | null {
    return this.slashSuggestionContext.getState(this.composerContext.getText());
  }

  /**
   * 处理 composer 编辑态 slash suggestion 事件；返回事件是否已被消费。
   */
  handleSlashSuggestionEvent(event: InputEvent): boolean {
    const composerText = this.composerContext.getText();

    if (!this.slashSuggestionContext.isVisible(composerText)) {
      return false;
    }

    if (event.type === INPUT_EVENTS.MOVE_UP) {
      this.slashSuggestionContext.moveSelection(composerText, -1);
      return true;
    }

    if (event.type === INPUT_EVENTS.MOVE_DOWN) {
      this.slashSuggestionContext.moveSelection(composerText, 1);
      return true;
    }

    if (event.type === INPUT_EVENTS.TAB || event.type === INPUT_EVENTS.SUBMIT) {
      const completedText = this.slashSuggestionContext.completeSelection(composerText);

      if (completedText) {
        this.leaveHistoryBrowsing();
        this.composerContext.setText(completedText);
        this.slashSuggestionContext.resetSelection();
      }

      return event.type === INPUT_EVENTS.TAB;
    }

    return false;
  }

  /**
   * 从持久化存储加载 session，并用其 transcript records 替换当前可见 transcript。
   */
  loadTranscriptSession(sessionId: string): TranscriptSession | null {
    const loadedSession = this.transcriptContext.loadSession(sessionId);

    if (loadedSession) {
      this.changeHistoryContext.restoreHistory(this.transcriptContext.changeHistory);
      this.rebuildLastSubmittedAgentMode();
    }

    return loadedSession;
  }

  /**
   * 退出历史浏览模式；后续 Up/Down 将重新按当前 composer 内容决定语义。
   */
  leaveHistoryBrowsing(): void {
    this.composerContext.leaveHistoryBrowsing();
  }

  /**
   * 清空当前 transcript records，并把当前持久化 session 指针从实例上解绑。
   */
  clearTranscriptRecords(): void {
    this.transcriptContext.clearRecords();
    this.changeHistoryContext.restoreHistory(this.transcriptContext.changeHistory);
    this.lastSubmittedAgentMode = 'normal';
  }

  /**
   * 更新当前 session 的结构化 todo 状态并立即持久化；todo 状态不进入 transcript records。
   */
  updateTodoState(todoState: TodoState): void {
    this.transcriptContext.setTodoState(todoState);
    this.transcriptContext.persistCurrentSession();
  }

  /**
   * 重置当前 composer 内容和光标。
   */
  resetComposer(): void {
    this.composerContext.reset();
  }

  /**
   * 向当前 transcript 追加记录并立即同步当前 session。
   */
  appendTranscriptRecord(record: TranscriptRecord): TranscriptRecord {
    return this.transcriptContext.appendRecord(record);
  }

  /**
   * 成组追加紧邻 records 并仅写入一个 journal 操作，供 provider 与 tool 成对结果使用。
   */
  appendTranscriptRecords(records: TranscriptRecord[]): TranscriptRecord[] {
    return this.transcriptContext.appendRecords(records);
  }

  /**
   * 开始记录本轮 assistant loop 的文件变更 checkpoint。
   */
  beginChangeCheckpoint(): void {
    this.changeHistoryContext.beginCheckpoint({
      compactionBefore: this.transcriptContext.compaction ? {...this.transcriptContext.compaction} : undefined,
      cwd: this.getCurrentCwd(),
      transcriptStartIndex: this.transcriptContext.getRecords().length
    });
  }

  /**
   * 完成本轮文件变更 checkpoint，并把它放入 history。
   */
  finalizeChangeCheckpoint(): void {
    this.changeHistoryContext.finalizeCheckpoint();
    this.syncChangeHistory(true);
  }

  /**
   * 将当前文件变更 checkpoint 标记为不可安全回退。
   */
  invalidateChangeCheckpoint(reason: string): void {
    this.changeHistoryContext.invalidate(reason);
  }

  /**
   * 创建给受控工具使用的文件变更记录器。
   */
  createChangeRecorder(): ChangeFileRecorder {
    return this.changeHistoryContext.createRecorder();
  }

  /**
   * 返回 `/undo` 命令展示所需的当前 checkpoint 摘要。
   */
  getUndoSummary(): UndoSummary {
    return this.changeHistoryContext.getSummary();
  }

  /**
   * 读取当前 `/diff` 数据源；Git 成功时使用真实工作区，否则使用持久化 history fallback。
   */
  createDiffSourceResult(): DiffSourceResult {
    return createDiffSourceResult({
      cwd: this.getCurrentCwd(),
      changeHistory: this.changeHistoryContext.getHistory()
    });
  }

  /**
   * 执行一次 undo：先恢复文件，再以一个 journal batch 回退 transcript、compaction 和 history。
   */
  executeUndo(): UndoExecuteResult {
    const result = this.changeHistoryContext.executeUndo();

    if (!result.ok) {
      return result;
    }

    try {
      const nextChangeHistory = this.changeHistoryContext.getHistory();
      nextChangeHistory.pop();
      this.transcriptContext.restoreToBoundary(
        result.checkpoint.transcriptStartIndex,
        result.checkpoint.compactionBefore,
        nextChangeHistory
      );
      this.changeHistoryContext.markLastUsed();
      this.rebuildLastSubmittedAgentMode();
      this.clearContextUsage();
      return result;
    } catch (error: unknown) {
      return {
        ok: false,
        reason: 'restore_failed',
        message: error instanceof Error && error.message.trim() !== '' ? error.message : 'transcript 回退失败'
      };
    }
  }

  /**
   * 把文件变更历史同步到当前 transcript session，用于 `/undo` 和 `/diff` fallback。
   */
  private syncChangeHistory(persist: boolean): void {
    this.transcriptContext.setChangeHistory(this.changeHistoryContext.getHistory());

    if (persist) {
      this.transcriptContext.persistCurrentSession();
    }
  }

  /**
   * 组装本次 agent 调用的会话输入：当前 transcript 快照 + 当前压缩状态。
   * records 与 compaction 同源于 transcriptContext，拼装由 app 层内聚，不外泄到 main。
   */
  getAgentSession(): AgentSessionInput {
    return {
      records: structuredClone(this.transcriptContext.getRecords()),
      compaction: this.transcriptContext.compaction ? {...this.transcriptContext.compaction} : undefined,
      todoState: structuredClone(this.transcriptContext.todoState),
      interactionMode: this.interactionMode
    };
  }

  /**
   * 应用一次压缩结果：先更新内存压缩状态，再追加可见提示块记录；
   * 由 appendRecord 一次性追加 compaction 与 notice journal batch。提示块不发送给 provider。
   */
  applyCompaction(compaction: CompactionState): TranscriptRecord {
    this.transcriptContext.setCompaction(compaction);

    return this.transcriptContext.appendRecord({
      role: 'compaction_notice',
      text: `已将较早的 ${compaction.activeStartIndex} 条历史压缩为摘要`
    });
  }

  /**
   * 按方向浏览 session 输入历史；返回是否消费了本次 Up/Down。
   */
  browseHistory(direction: number): boolean {
    return this.composerContext.browseHistory(direction);
  }

  /**
   * 提交用户消息并进入响应中状态；mode 改变时把一次性切换说明写入 provider-facing text。
   */
  beginUserTurn(userText: string, options: {historyText?: string; displayText?: string; metadata?: Record<string, unknown>; attachments?: ToolExecutionResult['attachments']} = {}): TranscriptRecord {
    const currentAgentMode = toAgentInteractionMode(this.interactionMode);
    const transition = createModeTransitionUserMessage(userText, this.lastSubmittedAgentMode, currentAgentMode);
    const record = this.turnContext.beginUserTurn(transition?.text || userText, {
      ...options,
      ...(transition ? {displayText: options.displayText || userText} : {}),
      metadata: {
        ...(options.metadata || {}),
        ...(transition ? {
          interactionMode: this.interactionMode,
          modeTransition: transition.metadata
        } : {})
      }
    });

    this.lastSubmittedAgentMode = currentAgentMode;
    return record;
  }

  /**
   * 从当前 transcript 尾部重建上一条模型可见 mode；旧记录缺少 metadata 时回退 normal。
   */
  private rebuildLastSubmittedAgentMode(): void {
    for (let index = this.transcriptRecords.length - 1; index >= 0; index -= 1) {
      const record = this.transcriptRecords[index];

      if (record.role === 'user' && isInteractionMode(record.interactionMode)) {
        this.lastSubmittedAgentMode = toAgentInteractionMode(record.interactionMode);
        return;
      }
    }

    this.lastSubmittedAgentMode = 'normal';
  }

  /**
   * 创建当前 assistant turn 句柄，主流程只使用句柄绑定回调和 agent signal。
   */
  beginAssistantTurn(modelProfileId?: string): AssistantTurnHandle {
    const statusLineModel = modelProfileId
      ? this.modelContext.resolveSkillOverrideStatusLineModelState(modelProfileId)
      : undefined;

    return this.turnContext.beginAssistantTurn(statusLineModel);
  }

  /**
   * 返回当前 assistant turn 已生效的 skill override 模型名，供主流程生成本地提示。
   */
  getActiveSkillOverrideModelLabel(): string | undefined {
    const statusLineModel = this.turnContext.getActiveStatusLineModelState();
    return statusLineModel?.skillOverride ? statusLineModel.modelLabel : undefined;
  }

  /**
   * 返回当前 assistant turn 是否可由用户通过 Esc 中断。
   */
  canInterruptAssistantTurn(): boolean {
    return this.turnContext.canInterruptAssistantTurn();
  }

  /**
   * 判断给定句柄是否仍是当前 assistant turn。
   */
  isCurrentAssistantTurn(turn: AssistantTurnHandle): boolean {
    return this.turnContext.isCurrentAssistantTurn(turn);
  }

  /**
   * 当前 assistant turn 收尾后清理句柄，旧 turn 不会清掉新 turn。
   */
  clearAssistantTurnIfCurrent(turn: AssistantTurnHandle): void {
    this.turnContext.clearAssistantTurnIfCurrent(turn);
  }

  /**
   * 进入手动压缩响应态（不追加 user record，仅占用响应锁）。
   */
  beginManualCompaction(): void {
    this.turnContext.beginManualCompaction();
  }

  /**
   * 进入用户 shell 命令执行态。
   */
  beginShellCommand(command: string): void {
    this.turnContext.beginShellCommand(command);
  }

  /**
   * 记录 shell 命令执行结果并释放响应锁。
   */
  finishShellCommand(result: BashCommandRunResult, includeInContext: boolean): TranscriptRecord {
    return this.turnContext.finishShellCommand(result, includeInContext);
  }

  /**
   * 进入指定 spinner 状态。spinner 帧由渲染层根据 elapsedMs 推算，无需逐帧推进。
   */
  enterSpinnerState(kind: 'thinking' | 'working'): void {
    this.turnContext.enterSpinnerState(kind);
  }

  /**
   * 注入 spinner 重绘 timer 的 footer 回调；main 层在初始化时调用一次。
   */
  configureSpinnerTimer(config: {onTick: () => void}): void {
    this.turnContext.configureSpinnerTimer(config);
  }

  /**
   * 注入 streaming token footer 重绘回调；节流窗口由 turn context 自己管理。
   */
  configureStreamingRenderTimer(config: {onRender: () => void}): void {
    this.turnContext.configureStreamingRenderTimer(config);
  }

  /**
   * 调度一次 onToken 引发的 footer 重绘，首帧即时、后续短窗口合并。
   */
  scheduleStreamingRender(): void {
    this.turnContext.scheduleStreamingRender();
  }

  /**
   * 取消尚未执行的 onToken footer 重绘，供结构性状态变化前调用。
   */
  cancelStreamingRender(): void {
    this.turnContext.cancelStreamingRender();
  }

  /**
   * 启动指定类型的 spinner，并注册周期重绘 timer。
   */
  startSpinner(kind: 'thinking' | 'working'): void {
    this.turnContext.startSpinner(kind);
  }

  /**
   * 停止 spinner 重绘 timer。
   */
  stopSpinner(): void {
    this.turnContext.stopSpinner();
  }

  /**
   * 清理本地 working 状态；用于不属于 assistant/shell turn 的启动期后台任务收尾。
   */
  clearWorking(): void {
    this.turnContext.clearWorking();
  }

  /**
   * 更新 streaming pending 文本草稿。
   */
  setStreamingPending(draft: string): void {
    this.turnContext.setStreamingPending(draft);
  }

  /**
   * 追加 shell mode 运行中的本地输出 preview。
   */
  appendShellOutputPending(event: BashCommandOutputEvent): void {
    this.turnContext.appendShellOutputPending(event);
  }

  /**
   * 更新 tool call pending 预览，暂不追加 transcript record。
   */
  setToolCallPending(call: ToolCall): void {
    this.turnContext.setToolCallPending(call);
  }

  /**
   * 返回当前 working 状态。
   */
  getWorking(): WorkingState | null {
    return this.turnContext.getWorking();
  }

  /**
   * 返回当前 pending 预览状态，供输入层判断当前响应阶段。
   */
  getPending(): PendingState | null {
    return this.turnContext.getPending();
  }

  /**
   * 完成 assistant 响应，提交 assistant record 并释放 response lock。
   */
  finishAssistantTurn(finalText: string): TranscriptRecord | null {
    return this.turnContext.finishAssistantTurn(finalText);
  }

  /**
   * 提交已经流出的 partial assistant 内容，但不释放 response lock。
   */
  commitPartialAssistantTurn(partialText: string): TranscriptRecord | null {
    return this.turnContext.commitPartialAssistantTurn(partialText);
  }

  /**
   * 提交当前 pending assistant 草稿，由 turn context 作为唯一 draft 来源。
   */
  commitPendingAssistantDraft(): TranscriptRecord | null {
    return this.turnContext.commitPendingAssistantDraft();
  }

  /**
   * 追加 reasoning summary record，但不释放 response lock。
   */
  appendReasoningSummary(text: string): TranscriptRecord {
    return this.turnContext.appendReasoningSummary(text);
  }

  /**
   * 追加 tool_call record，但不释放 response lock。
   */
  appendToolCall(call: ToolCall): TranscriptRecord {
    return this.turnContext.appendToolCall(call);
  }

  /**
   * 追加 tool_result record，但不释放 response lock。
   */
  appendToolResult(result: ToolExecutionResult): TranscriptRecord {
    return this.turnContext.appendToolResult(result);
  }

  /**
   * 追加暂存 tool_call 与当前 tool_result record，但不释放 response lock。
   */
  appendPendingToolResult(result: ToolExecutionResult): TranscriptRecord[] {
    return this.turnContext.appendPendingToolResult(result);
  }

  /**
   * 记录本地 assistant 错误消息，并释放 response lock。
   */
  failAssistantTurn(error: unknown): TranscriptRecord {
    return this.turnContext.failAssistantTurn(error);
  }

  /**
   * 记录本地 shell 错误消息，并释放 response lock。
   */
  failShellCommand(error: unknown): TranscriptRecord {
    return this.turnContext.failShellCommand(error);
  }

  /**
   * 记录本地中断提示，并释放 response lock。
   */
  cancelAssistantTurn(): TranscriptRecord {
    return this.turnContext.cancelAssistantTurn();
  }

  /**
   * 中断当前 active assistant turn。
   */
  interruptActiveAssistantTurn(): InterruptAssistantTurnResult {
    const result = this.turnContext.interruptActiveAssistantTurn();

    if (result.interrupted) {
      this.finalizeChangeCheckpoint();
    }

    return result;
  }
}

export {
  AppContext
};
