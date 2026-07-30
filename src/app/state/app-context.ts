import {ComposerContext} from './composer-context';
import {ModelContext, type AgentModelSelectionOverride} from './model-context';
import {ModelTuningContext} from './model-tuning-context';
import {RenderContext} from './render-context';
import {SlashSuggestionContext} from './slash-suggestion-context';
import {TranscriptContext} from './transcript-context';
import {TurnContext} from './turn-context';
import {ChangeHistoryContext} from './change-history-context';
import {ConversationReferenceContext} from './conversation-reference-context';
import {INPUT_EVENTS} from '../../input/event-types';
import {createDiffSourceResult} from '../diff/source';
import {DEFAULT_TUI_THEME, type TuiTheme} from '../../config/theme-config';
import {DEFAULT_APP_SETTINGS, readAppSettings, type AppSettings} from '../../config/app-settings-config';
import {createSessionModelSettingsStore} from '../../persistence/session-model-settings-store';
import {isShellInteractionMode} from '../../types/agent';

import type {TerminalController} from '../../types/app';
import type {AgentSessionInput, ContextUsage, InteractionMode, ReasoningEffort} from '../../types/agent';
import type {DiffSourceResult} from '../../types/diff';
import type {CommandSurface, SlashCommandDescriptor} from '../../types/command';
import type {InputEvent} from '../../types/input';
import type {RenderState, SlashSuggestionState, StatusLineModelRenderState} from '../../types/render';
import type {ToolExecutionResult} from '../../types/tool';
import type {TranscriptRecord, TranscriptSession, TranscriptStore, UserTranscriptMetadata} from '../../types/transcript';
import type {SessionModelSettingsStore} from '../../types/session-model-settings';
import type {UndoExecuteResult} from '../../types/change-history';
import type {ToolApprovalContext} from './tool-approval-context';
import type {AssistantTurnHandle, InterruptAssistantTurnResult} from './turn-context';

type AgentInteractionMode = 'normal' | 'plan';

type AppSettingsRefreshResult = {
  agentInstructionFileChanged: boolean;
  fileEditModeChanged: boolean;
  reasoningVisibilityChanged: boolean;
  skillCatalogContextRatioChanged: boolean;
  slashSuggestionLimitChanged: boolean;
};

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
  private readonly getCurrentCwdValue: string | (() => string);
  private readonly getNodeVersionValue: string | (() => string);
  readonly composerContext: ComposerContext;
  readonly transcriptContext: TranscriptContext;
  readonly modelContext: ModelContext;
  readonly modelTuningContext: ModelTuningContext;
  readonly turnContext: TurnContext;
  readonly changeHistoryContext: ChangeHistoryContext;
  readonly conversationReferenceContext: ConversationReferenceContext;
  readonly renderContext: RenderContext;
  private theme: TuiTheme;
  private appSettings: AppSettings;
  private slashSuggestionContext: SlashSuggestionContext;
  private interactionMode: InteractionMode;
  private lastSubmittedAgentMode: AgentInteractionMode;
  private contextUsage: ContextUsage | null;
  private mcpBootstrapStatus: 'idle' | 'initializing' | 'ready';

  constructor(
    terminal: TerminalController,
    transcriptStore: TranscriptStore,
    cwd: string | (() => string),
    nodeVersion: string | (() => string),
    theme: TuiTheme = DEFAULT_TUI_THEME,
    appSettings: AppSettings = DEFAULT_APP_SETTINGS,
    sessionModelSettingsStore: SessionModelSettingsStore = createSessionModelSettingsStore(transcriptStore)
  ) {
    this.getCurrentCwdValue = cwd;
    this.getNodeVersionValue = nodeVersion;

    this.composerContext = new ComposerContext(() => this.turnContext.isResponding());
    this.transcriptContext = new TranscriptContext(transcriptStore, () => this.getCurrentCwd());
    this.modelContext = new ModelContext({
      getCurrentCwd: () => this.getCurrentCwd(),
      getCurrentSessionId: () => this.transcriptContext.getCurrentSessionId(),
      settingsStore: sessionModelSettingsStore
    });
    this.modelTuningContext = new ModelTuningContext();
    this.turnContext = new TurnContext(this.composerContext, this.transcriptContext);
    this.changeHistoryContext = new ChangeHistoryContext();
    this.conversationReferenceContext = new ConversationReferenceContext();
    this.theme = theme;
    this.appSettings = structuredClone(appSettings) as AppSettings;
    this.interactionMode = appSettings.defaultInteractionMode;
    this.lastSubmittedAgentMode = 'normal';
    this.contextUsage = null;
    this.mcpBootstrapStatus = 'idle';
    this.slashSuggestionContext = new SlashSuggestionContext([], {
      hasActiveCommandSession: () => false,
      isResponding: () => this.turnContext.responding
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
    return this.appSettings.autoCompressImages;
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
  createRenderState(options: {commandSurface?: CommandSurface | null; toolApproval?: Pick<ToolApprovalContext, 'isAllowAllForSession'> | null} = {}): RenderState {
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
      model,
      renderPreferences: {
        showReasoningSummary: this.appSettings.showReasoningSummary,
        slashSuggestionMaxVisible: this.appSettings.slashSuggestionMaxVisible
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
  refreshModelStateFromConfig(): boolean {
    const changed = this.modelContext.refreshModelState();

    if (changed) {
      this.clearContextUsage();
    }

    return changed;
  }

  /**
   * 从用户配置刷新常规设置缓存，分类报告渲染影响，并使失效的 context usage 归零。
   */
  refreshAppSettingsFromConfig(): AppSettingsRefreshResult {
    const next = readAppSettings();
    const agentInstructionFileChanged = next.agentInstructionFileName !== this.appSettings.agentInstructionFileName;
    const fileEditModeChanged = next.fileEditMode !== this.appSettings.fileEditMode;
    const reasoningVisibilityChanged = next.showReasoningSummary !== this.appSettings.showReasoningSummary;
    const skillCatalogContextRatioChanged = next.skillCatalogContextRatio !== this.appSettings.skillCatalogContextRatio;
    const slashSuggestionLimitChanged = next.slashSuggestionMaxVisible !== this.appSettings.slashSuggestionMaxVisible;

    this.appSettings = structuredClone(next) as AppSettings;
    if (agentInstructionFileChanged || fileEditModeChanged || skillCatalogContextRatioChanged) {
      this.clearContextUsage();
    }
    return {agentInstructionFileChanged, fileEditModeChanged, reasoningVisibilityChanged, skillCatalogContextRatioChanged, slashSuggestionLimitChanged};
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
      isResponding: () => this.turnContext.responding
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
   * 从持久化存储加载 session，并用其 transcript records 替换当前可见 transcript。
   */
  loadTranscriptSession(sessionId: string): TranscriptSession | null {
    const loadedSession = this.transcriptContext.loadSession(sessionId);

    if (loadedSession) {
      this.conversationReferenceContext.clear();
      this.changeHistoryContext.restoreHistory(this.transcriptContext.changeHistory);
      this.modelContext.restoreSession(sessionId);
      this.rebuildLastSubmittedAgentMode();
    }

    return loadedSession;
  }

  /**
   * 清空当前 transcript records，并把当前持久化 session 指针从实例上解绑。
   */
  clearTranscriptRecords(): void {
    this.conversationReferenceContext.clear();
    this.transcriptContext.clearRecords();
    this.changeHistoryContext.restoreHistory(this.transcriptContext.changeHistory);
    this.modelContext.resetSessionToGlobalDefaults();
    this.lastSubmittedAgentMode = 'normal';
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
  getAgentSession(skillOverride: AgentModelSelectionOverride = {}): AgentSessionInput {
    const modelSelection = this.modelContext.resolveAgentSelection(skillOverride);

    return {
      records: structuredClone(this.transcriptContext.getRecords()),
      compaction: this.transcriptContext.compaction ? {...this.transcriptContext.compaction} : undefined,
      todoState: structuredClone(this.transcriptContext.todoState),
      interactionMode: this.interactionMode,
      compactionThresholdRatio: this.appSettings.compactionThresholdRatio,
      skillCatalogContextRatio: this.appSettings.skillCatalogContextRatio,
      ...(modelSelection || {})
    };
  }

  /**
   * 提交用户消息并进入响应中状态；mode 改变时把一次性切换说明写入 provider-facing text。
   */
  beginUserTurn(userText: string, options: {displayText?: string; metadata?: UserTranscriptMetadata; attachments?: ToolExecutionResult['attachments']} = {}): TranscriptRecord {
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

    this.modelContext.persistCurrentSessionSettings();
    this.lastSubmittedAgentMode = currentAgentMode;
    return record;
  }

  /**
   * 从当前 transcript 尾部重建上一条模型可见 mode；旧记录缺少 metadata 时回退 normal。
   */
  private rebuildLastSubmittedAgentMode(): void {
    for (let index = this.transcriptContext.records.length - 1; index >= 0; index -= 1) {
      const record = this.transcriptContext.records[index];

      if (record.role === 'user' && isInteractionMode(record.metadata?.interactionMode)) {
        this.lastSubmittedAgentMode = toAgentInteractionMode(record.metadata.interactionMode);
        return;
      }
    }

    this.lastSubmittedAgentMode = 'normal';
  }

  /**
   * 创建当前 assistant turn 句柄，主流程只使用句柄绑定回调和 agent signal。
   */
  beginAssistantTurn(modelProfileIdOverride?: string, reasoningEffortOverride?: ReasoningEffort): AssistantTurnHandle {
    const statusLineModel = modelProfileIdOverride || reasoningEffortOverride
      ? this.modelContext.resolveSkillOverrideStatusLineModelState({modelProfileIdOverride, reasoningEffortOverride})
      : this.modelContext.getStatusLineModelState();

    return this.turnContext.beginAssistantTurn(statusLineModel);
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
