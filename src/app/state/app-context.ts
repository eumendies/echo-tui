import {ComposerContext} from './composer-context';
import {ModelContext, type AgentModelSelectionOverride} from './model-context';
import {ModelTuningContext} from './model-tuning-context';
import {RenderContext} from './render-context';
import {SlashSuggestionContext} from './slash-suggestion-context';
import {TranscriptContext} from './transcript-context';
import {TurnContext} from './turn-context';
import {SubagentRunContext} from './subagent-run-context';
import {ChangeHistoryContext} from './change-history-context';
import {ConversationReferenceContext} from './conversation-reference-context';
import {PendingMessageContext} from './pending-message-context';
import {INPUT_EVENTS} from '../../input/event-types';
import {createDiffSourceResult} from '../diff/source';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import type {UserConfigContext, UserConfigSnapshot} from '../../config/user-config-context';
import {createSessionModelSettingsStore} from '../../persistence/session-model-settings-store';
import {isShellInteractionMode} from '../../types/agent';
import {createModeTransitionUserMessage} from '../../agent/context/interaction-mode';

import type {TerminalController} from '../../types/app';
import type {ActiveTurnMessagePolicy, AgentSessionInput, AgentUserConfigSnapshot, ContextUsage, InteractionMode, ReasoningEffort} from '../../types/agent';
import type {ToolApprovalSettings} from '../../config/app-settings-config';
import type {DiffSourceResult} from '../../types/diff';
import type {CommandSurface, SlashCommandDescriptor} from '../../types/command';
import type {InputEvent} from '../../types/input';
import type {RenderState, SlashSuggestionState, StatusLineModelRenderState} from '../../types/render';
import type {ToolExecutionResult} from '../../types/tool';
import type {TranscriptForkResult, TranscriptRecord, TranscriptSessionDeleteResult, TranscriptStore, UserTranscriptMetadata} from '../../types/transcript';
import type {SessionModelSettingsStore} from '../../types/session-model-settings';
import type {UndoExecuteResult} from '../../types/change-history';
import type {ToolApprovalContext} from './tool-approval-context';
import type {AssistantTurnHandle, InterruptAssistantTurnResult} from './turn-context';

type AppSettingsApplyResult = {
  agentInstructionFileChanged: boolean;
  fileEditModeChanged: boolean;
  reasoningVisibilityChanged: boolean;
  skillCatalogContextRatioChanged: boolean;
  slashSuggestionLimitChanged: boolean;
  mouseInteractionChanged: boolean; // 终端鼠标协议与可执行 hit region 是否需要重新投影。
  toolApprovalChanged: boolean; // 审批模式或 reviewer profile 是否变化，不代表需要 transcript 重绘。
};

function isInteractionMode(value: unknown): value is InteractionMode {
  return value === 'normal' || value === 'plan' || value === 'shell' || value === 'shell-local';
}

/**
 * 组合单个 createApp 实例需要的语义 context；状态由各子 context 自己持有。
 */
class AppContext {
  private readonly getCurrentCwdValue: string | (() => string);
  private readonly getNodeVersionValue: string | (() => string);
  readonly composerContext: ComposerContext;
  readonly transcriptContext: TranscriptContext;
  readonly modelContext: ModelContext;
  readonly modelTuningContext: ModelTuningContext;
  readonly turnContext: TurnContext;
  readonly subagentRunContext: SubagentRunContext;
  readonly changeHistoryContext: ChangeHistoryContext;
  readonly conversationReferenceContext: ConversationReferenceContext;
  readonly pendingMessageContext: PendingMessageContext;
  readonly renderContext: RenderContext;
  private theme: TuiTheme;
  private appSettingsSnapshot: UserConfigSnapshot;
  private slashSuggestionContext: SlashSuggestionContext;
  private interactionMode: InteractionMode;
  private contextUsage: ContextUsage | null;
  private mcpBootstrapStatus: 'idle' | 'initializing' | 'ready';
  private modelConfigSnapshot: UserConfigSnapshot;
  private readonly userConfigContext: UserConfigContext;
  private readonly sessionModelSettingsStore: SessionModelSettingsStore;

  constructor(
    terminal: TerminalController,
    transcriptStore: TranscriptStore,
    cwd: string | (() => string),
    nodeVersion: string | (() => string),
    theme: TuiTheme = DEFAULT_TUI_THEME,
    sessionModelSettingsStore: SessionModelSettingsStore = createSessionModelSettingsStore(transcriptStore),
    userConfigContext: UserConfigContext
  ) {
    if (!userConfigContext) {
      throw new Error('AppContext 必须注入共享的 UserConfigContext');
    }
    this.getCurrentCwdValue = cwd;
    this.getNodeVersionValue = nodeVersion;
    this.userConfigContext = userConfigContext;
    this.sessionModelSettingsStore = sessionModelSettingsStore;
    this.modelConfigSnapshot = userConfigContext.capture();
    this.appSettingsSnapshot = this.modelConfigSnapshot;
    const initialAppSettings = this.appSettingsSnapshot.getAppSettings();

    this.composerContext = new ComposerContext(() => this.turnContext.isResponding());
    this.transcriptContext = new TranscriptContext(transcriptStore, () => this.getCurrentCwd());
    this.modelContext = new ModelContext({
      config: {
        getModelInfo: () => this.modelConfigSnapshot.getLlmModelConfigInfo(),
        resolveLlmConfig: (options) => this.modelConfigSnapshot.resolveLlmConfig(options)
      },
      getCurrentCwd: () => this.getCurrentCwd(),
      getCurrentSessionId: () => this.transcriptContext.getCurrentSessionId(),
      settingsStore: sessionModelSettingsStore
    });
    this.modelTuningContext = new ModelTuningContext();
    this.turnContext = new TurnContext(this.transcriptContext);
    this.subagentRunContext = new SubagentRunContext();
    this.changeHistoryContext = new ChangeHistoryContext();
    this.conversationReferenceContext = new ConversationReferenceContext();
    this.pendingMessageContext = new PendingMessageContext();
    this.theme = theme;
    this.interactionMode = initialAppSettings.defaultInteractionMode;
    this.contextUsage = null;
    this.mcpBootstrapStatus = 'idle';
    this.slashSuggestionContext = new SlashSuggestionContext([], {
      hasActiveCommandSession: () => false,
      isAssistantTurnActive: () => this.turnContext.canInterruptAssistantTurn()
    });
    this.renderContext = new RenderContext(
      terminal,
      () => this.getCurrentCwd(),
      () => this.getNodeVersion(),
      this.composerContext,
      {
        canInterruptAssistantTurn: () => this.turnContext.canInterruptAssistantTurn(),
        getPending: () => this.subagentRunContext.getPending() || this.turnContext.getPending(),
        getWorking: () => this.turnContext.getWorking()
      },
      this,
      () => this.interactionMode,
      this.theme
    );
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
   * 返回当前实例缓存的超限图片压缩偏好，供提交前 mention 展开使用。
   */
  getAutoCompressImages(): boolean {
    return this.userConfigContext.capture().getAppSettings().autoCompressImages;
  }

  /** 返回当前实例缓存的 UI 鼠标交互开关；main render 据此决定是否暴露可执行 hit region。 */
  isMouseInteractionEnabled(): boolean {
    return this.appSettingsSnapshot.getAppSettings().mouseInteractionEnabled;
  }

  /**
   * 返回工具审批设置副本，供 assistant turn 在启动时固定策略与模型引用。
   */
  getToolApprovalSettings(snapshot: AgentUserConfigSnapshot = this.userConfigContext.capture()): ToolApprovalSettings {
    const settings = snapshot.getAppSettings();
    return {
      mode: settings.toolApprovalMode,
      ...(settings.toolApprovalModelProfileId ? {modelProfileId: settings.toolApprovalModelProfileId} : {})
    };
  }

  /** 捕获当前用户配置 revision，供一次操作的所有下游请求共享。 */
  captureUserConfigSnapshot(): UserConfigSnapshot {
    return this.userConfigContext.capture();
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
   * 组合渲染层需要的瞬时状态，避免 main.ts 反复散落访问实例字段。
   */
  createRenderState(options: {commandSurface?: CommandSurface | null; footerInteractionId?: RenderState['footerInteractionId']; toolApproval?: Pick<ToolApprovalContext, 'isAllowAllForSession'> | null} = {}): RenderState {
    const appSettings = this.userConfigContext.capture().getAppSettings();
    const commandSurface = options.commandSurface ?? null;
    const modelTuningSnapshot = commandSurface ? null : this.modelTuningContext.getRenderState();
    const slashSuggestions = commandSurface || modelTuningSnapshot || this.mcpBootstrapStatus === 'initializing' ? null : this.getSlashSuggestionState();
    const model = commandSurface
      ? undefined
      : modelTuningSnapshot
        ? {
            kind: 'tuning' as const,
            label: modelTuningSnapshot.modelLabel,
            effort: modelTuningSnapshot.effort,
            activeField: modelTuningSnapshot.activeField,
            ...(modelTuningSnapshot.error ? {error: modelTuningSnapshot.error} : {})
          }
        : this.createStatusLineModelRenderState();

    return this.renderContext.createRenderState({
      commandSurface,
      conversationReference: this.conversationReferenceContext.getRenderState(),
      contextUsage: this.contextUsage,
      footerInteractionId: options.footerInteractionId,
      model,
      pendingMessage: this.pendingMessageContext.getRenderState(),
      renderPreferences: {
        showReasoningSummary: appSettings.showReasoningSummary,
        slashSuggestionMaxVisible: appSettings.slashSuggestionMaxVisible
      },
      allowAllTools: options.toolApproval?.isAllowAllForSession() || false,
      slashSuggestions
    });
  }

  /**
   * 从当前模型快照启动 composer 调节；配置不可用时返回 false 且不创建瞬时状态。
   */
  openModelTuning(): boolean {
    if (this.turnContext.responding || this.mcpBootstrapStatus === 'initializing' || isShellInteractionMode(this.interactionMode)) {
      return false;
    }

    return this.modelTuningContext.open(this.modelContext.createModelCommandInfo());
  }

  /**
   * 原子应用暂存 model/effort；失败时保留调节状态并显示脱敏错误。
   */
  applyModelTuning(): boolean {
    const selection = this.modelTuningContext.getSelection();

    if (!selection) {
      return false;
    }

    const result = this.modelContext.selectModelAndEffort(selection.modelId, selection.effort);

    if (!result.ok) {
      this.modelTuningContext.setError(result.error || '无法保存模型调节选择');
      return false;
    }

    this.clearContextUsage();

    this.modelTuningContext.cancel();
    return true;
  }

  /**
   * 消费活跃调节模式的 modal 输入；Exit 留给 app 全局退出流程处理。
   */
  handleModelTuningEvent(event: InputEvent): boolean {
    if (!this.modelTuningContext.isActive() || event.type === INPUT_EVENTS.EXIT) {
      return false;
    }

    if (event.type === INPUT_EVENTS.ESCAPE || event.type === INPUT_EVENTS.TOGGLE_MODEL_TUNING) {
      this.modelTuningContext.cancel();
      return true;
    }

    if (event.type === INPUT_EVENTS.TAB || event.type === INPUT_EVENTS.SHIFT_TAB) {
      this.modelTuningContext.toggleField();
      return true;
    }

    if (event.type === INPUT_EVENTS.MOVE_LEFT || event.type === INPUT_EVENTS.MOVE_RIGHT) {
      this.modelTuningContext.cycle(event.type === INPUT_EVENTS.MOVE_LEFT ? -1 : 1);
      return true;
    }

    if (event.type === INPUT_EVENTS.SUBMIT) {
      this.applyModelTuning();
      return true;
    }

    return true;
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
   * 返回当前 provider context usage 快照，避免命令层修改 AppContext 持有的瞬时状态。
   */
  getContextUsage(): ContextUsage | null {
    return this.contextUsage
      ? {...this.contextUsage, segments: this.contextUsage.segments ? [...this.contextUsage.segments] : undefined}
      : null;
  }

  /**
   * 配置文件发生外部变化时刷新模型缓存；模型语义变化会使旧 context usage 失效。
   */
  applyModelConfigSnapshot(snapshot: UserConfigSnapshot): boolean {
    this.modelConfigSnapshot = snapshot;
    const changed = this.modelContext.refreshModelState();

    if (changed) {
      this.clearContextUsage();
    }

    return changed;
  }

  /**
   * 从共享 revision 刷新后续运行的常规设置；工具目录变化清理 usage，不修改活跃运行或请求 transcript 重绘。
   */
  applyAppSettingsSnapshot(snapshot: UserConfigSnapshot): AppSettingsApplyResult {
    const previous = this.appSettingsSnapshot.getAppSettings();
    const next = snapshot.getAppSettings();
    const agentInstructionFileChanged = next.agentInstructionFileName !== previous.agentInstructionFileName;
    const fileEditModeChanged = next.fileEditMode !== previous.fileEditMode;
    const codeModeChanged = next.codeModeEnabled !== previous.codeModeEnabled;
    const reasoningVisibilityChanged = next.showReasoningSummary !== previous.showReasoningSummary;
    const skillCatalogContextRatioChanged = next.skillCatalogContextRatio !== previous.skillCatalogContextRatio;
    const slashSuggestionLimitChanged = next.slashSuggestionMaxVisible !== previous.slashSuggestionMaxVisible;
    const mouseInteractionChanged = next.mouseInteractionEnabled !== previous.mouseInteractionEnabled;
    const toolApprovalChanged = next.toolApprovalMode !== previous.toolApprovalMode
      || next.toolApprovalModelProfileId !== previous.toolApprovalModelProfileId;

    this.appSettingsSnapshot = snapshot;
    if (agentInstructionFileChanged || fileEditModeChanged || codeModeChanged || skillCatalogContextRatioChanged) {
      this.clearContextUsage();
    }
    return {agentInstructionFileChanged, fileEditModeChanged, reasoningVisibilityChanged, skillCatalogContextRatioChanged, slashSuggestionLimitChanged, mouseInteractionChanged, toolApprovalChanged};
  }

  /**
   * 读取当前选择模型的展示名；配置不可用时返回稳定占位，避免 footer 重绘打断主流程。
   */
  private createStatusLineModelRenderState(): StatusLineModelRenderState {
    const model = this.turnContext.getActiveStatusLineModelState() ?? this.modelContext.getStatusLineModelState();

    return {
      kind: 'default',
      label: model.modelLabel,
      ...(model.reasoningEffort ? {effort: model.reasoningEffort} : {}),
      ...(model.skillOverride ? {skillOverride: true} : {})
    };
  }

  /**
   * 配置 composer 编辑态 slash 命令提示；AppContext 仍是 main.ts 唯一直接持有的语义 context。
   */
  configureSlashSuggestions(commands: SlashCommandDescriptor[] | (() => SlashCommandDescriptor[]), hasActiveCommandSession: () => boolean): void {
    this.slashSuggestionContext = new SlashSuggestionContext(commands, {
      hasActiveCommandSession,
      isAssistantTurnActive: () => this.turnContext.canInterruptAssistantTurn()
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
      const completedText = this.slashSuggestionContext.completeSelection(composerText, {appendSpace: event.type === INPUT_EVENTS.TAB});

      if (completedText) {
        this.composerContext.leaveHistoryBrowsing();
        this.composerContext.setText(completedText);
        this.slashSuggestionContext.resetSelection();
      }

      return event.type === INPUT_EVENTS.TAB;
    }

    return false;
  }

  /**
   * 处理 slash 建议的鼠标命中；点击只完成命令文本，不复用 Enter 的提交语义。
   */
  handleSlashSuggestionPointer(index: number, activate: boolean): boolean {
    const composerText = this.composerContext.getText();

    if (!this.slashSuggestionContext.isVisible(composerText)) {
      return false;
    }

    const focused = this.slashSuggestionContext.selectIndex(composerText, index);

    if (!activate) {
      return focused;
    }

    const completedText = this.slashSuggestionContext.completeSelection(composerText, {appendSpace: true});

    if (!completedText) {
      return focused;
    }

    this.composerContext.leaveHistoryBrowsing();
    this.composerContext.setText(completedText);
    this.slashSuggestionContext.resetSelection();
    return true;
  }

  /**
   * 恢复 session 的活跃 transcript 及关联状态，只返回成功标志，不向调用方复制会话记录。
   */
  loadTranscriptSession(sessionId: string): boolean {
    const loadedSession = this.transcriptContext.loadSession(sessionId);

    if (loadedSession) {
      this.conversationReferenceContext.clear();
      this.pendingMessageContext.clear();
      this.changeHistoryContext.restoreHistory(this.transcriptContext.changeHistory);
      this.modelContext.restoreSession(sessionId);
    }

    return loadedSession;
  }

  /**
   * 删除非当前的历史 transcript，并在 journal 提交后尽力回收对应 model settings sidecar。
   */
  deleteTranscriptSession(sessionId: string): TranscriptSessionDeleteResult {
    const result = this.transcriptContext.deleteSession(sessionId);
    if (!result.ok) {
      return result;
    }

    try {
      this.sessionModelSettingsStore.remove(this.getCurrentCwd(), result.sessionId);
    } catch {
      // Sidecar 仅用于恢复，清理失败不得改变已提交的 journal 删除结果。
    }

    return result;
  }

  /**
   * 从当前稳定 transcript 创建独立 session，并协调新 sidecar 与失效的 provider usage。
   */
  forkTranscriptSession(): TranscriptForkResult {
    try {
      const result = this.transcriptContext.forkSession();

      if (result.ok) {
        this.modelContext.rebindCurrentSelectionToSession();
        this.clearContextUsage();
      }

      return result;
    } catch {
      return {ok: false, reason: 'failed', error: '无法创建分叉会话'};
    }
  }

  /**
   * 清空当前 transcript records，并把当前持久化 session 指针从实例上解绑。
   */
  clearTranscriptRecords(): void {
    this.conversationReferenceContext.clear();
    this.pendingMessageContext.clear();
    this.transcriptContext.clearRecords();
    this.changeHistoryContext.restoreHistory(this.transcriptContext.changeHistory);
    this.modelContext.resetSessionToGlobalDefaults();
  }

  /**
   * 开始记录本轮 assistant loop 的文件变更 checkpoint。
   */
  beginChangeCheckpoint(): void {
    this.changeHistoryContext.beginCheckpoint({
      compactionBefore: this.transcriptContext.compaction ? {...this.transcriptContext.compaction} : undefined,
      cwd: this.getCurrentCwd(),
      transcriptStartIndex: this.transcriptContext.getRecordCount()
    });
  }

  /**
   * 完成本轮文件变更 checkpoint，并把它放入 history。
   */
  finalizeChangeCheckpoint(): void {
    const delta = this.changeHistoryContext.finalizeCheckpoint();

    if (delta) {
      this.transcriptContext.stageChangeHistoryDelta(delta);
    }

    this.transcriptContext.persistCurrentSession();
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
   * 只有跨驻留边界的 undo 才预读完整历史，读取失败不得先改写文件；其余回退直接截短驻留后缀。
   */
  executeUndo(): UndoExecuteResult {
    let completeRecords: TranscriptRecord[] | undefined;
    const checkpoint = this.changeHistoryContext.last;
    if (checkpoint?.status === 'ready' && (checkpoint.compactionBefore?.activeStartIndex ?? 0) < this.transcriptContext.baseRecordIndex) {
      const loadedRecords = this.transcriptContext.getCompleteRecords();
      if (!loadedRecords) {
        return {ok: false, reason: 'restore_failed', message: '无法读取当前会话的完整历史'};
      }
      completeRecords = loadedRecords;
    }
    const result = this.changeHistoryContext.executeUndo();

    if (!result.ok) {
      return result;
    }

    try {
      this.transcriptContext.restoreToBoundary(
        result.checkpoint.transcriptStartIndex,
        result.checkpoint.compactionBefore,
        completeRecords
      );
      this.changeHistoryContext.markLastUsed();
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
   * 复制活跃 transcript 与完整历史起点，将独立快照所有权交给 runtime 原地裁剪。
   */
  getAgentSession(skillOverride: AgentModelSelectionOverride = {}, snapshot?: AgentUserConfigSnapshot): AgentSessionInput {
    const modelSelection = this.modelContext.resolveAgentSelection(skillOverride);
    const sessionJournalPath = this.transcriptContext.getCurrentSessionJournalPath();
    const sessionId = this.transcriptContext.getCurrentSessionId();
    const capturedSnapshot = snapshot || this.userConfigContext.capture();
    const appSettings = capturedSnapshot.getAppSettings();

    return {
      records: structuredClone(this.transcriptContext.getResidentRecords()),
      baseRecordIndex: this.transcriptContext.baseRecordIndex,
      recordsOwnership: 'transfer',
      compaction: this.transcriptContext.compaction ? {...this.transcriptContext.compaction} : undefined,
      todoState: structuredClone(this.transcriptContext.todoState),
      interactionMode: this.interactionMode,
      compactionThresholdRatio: appSettings.compactionThresholdRatio,
      skillCatalogContextRatio: appSettings.skillCatalogContextRatio,
      userConfigSnapshot: capturedSnapshot,
      ...(sessionJournalPath ? {sessionJournalPath} : {}),
      ...(sessionId ? {sessionId} : {}),
      ...(modelSelection || {})
    };
  }

  /**
   * 按提交记录的 mode 进入响应状态；共享转换函数仅在模型语义改变时追加切换说明。
   */
  beginUserTurn(userText: string, options: {displayText?: string; metadata?: UserTranscriptMetadata; attachments?: ToolExecutionResult['attachments']} = {}): TranscriptRecord {
    const interactionMode = options.metadata?.interactionMode ?? this.interactionMode;
    const transition = createModeTransitionUserMessage(userText, this.getLastSubmittedInteractionMode(), interactionMode);
    const record = this.turnContext.beginUserTurn(transition?.text || userText, {
      ...options,
      ...(transition ? {displayText: options.displayText || userText} : {}),
      metadata: {
        ...(options.metadata || {}),
        ...(transition ? {
          interactionMode,
          modeTransition: transition.metadata
        } : {})
      }
    });

    this.modelContext.persistCurrentSessionSettings();
    return record;
  }

  /**
   * 从已提交历史取得原始 interaction mode，包含同轮引导；无有效模式记录或历史读取失败时回退 normal。
   * 每个压缩周期最多回读一次：新的 user record 落入驻留后缀后，上面的驻留扫描即可命中。
   */
  private getLastSubmittedInteractionMode(): InteractionMode {
    const residentRecords = this.transcriptContext.getResidentRecords();
    for (let index = residentRecords.length - 1; index >= 0; index -= 1) {
      const record = residentRecords[index];

      if (record.role === 'user' && isInteractionMode(record.metadata?.interactionMode)) {
        return record.metadata.interactionMode;
      }
    }
    if (this.transcriptContext.baseRecordIndex > 0) {
      const records = this.transcriptContext.getCompleteRecords();
      if (records) {
        for (let index = this.transcriptContext.baseRecordIndex - 1; index >= 0; index -= 1) {
          const record = records[index];
          if (record.role === 'user' && isInteractionMode(record.metadata?.interactionMode)) return record.metadata.interactionMode;
        }
      }
    }
    return 'normal';
  }

  /**
   * 创建当前 assistant turn 句柄并固定启动 snapshot 的消息策略；句柄用于绑定回调和整轮取消。
   */
  beginAssistantTurn(modelProfileIdOverride?: string, reasoningEffortOverride?: ReasoningEffort, messagePolicy: ActiveTurnMessagePolicy = 'pending'): AssistantTurnHandle {
    const statusLineModel = modelProfileIdOverride || reasoningEffortOverride
      ? this.modelContext.resolveSkillOverrideStatusLineModelState({modelProfileIdOverride, reasoningEffortOverride})
      : this.modelContext.getStatusLineModelState();

    return this.turnContext.beginAssistantTurn(statusLineModel, messagePolicy);
  }

  /**
   * 中断当前 active assistant turn。
   */
  interruptActiveAssistantTurn(): InterruptAssistantTurnResult {
    const result = this.turnContext.interruptActiveAssistantTurn();

    if (result.interrupted) {
      this.subagentRunContext.markParentCancelled();
      this.finalizeChangeCheckpoint();
    }

    return result;
  }
}

export {
  AppContext
};
