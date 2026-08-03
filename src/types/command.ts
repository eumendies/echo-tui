import type { InputEvent } from './input';
import type { AgentInstructionFileName, AgentType, ContextUsage, InteractionMode, ReasoningEffort } from './agent';
import type {DiffFile, DiffSourceInfo, DiffSourceResult} from './diff';
import type { CompactionState, PendingConversationReference, PreparedConversationReference, TranscriptForkResult, TranscriptRecord, TranscriptSessionMetadata, UserTranscriptMetadata } from './transcript';
import type {UndoExecuteResult, UndoSummary} from './change-history';
import type {UsageDailyAggregate, UsageQueryOptions} from './usage';
import type {LifecycleHookConfigDraft, LifecycleHookDraftEntry, LifecycleHookEventName, LifecycleHookTestResult} from './hooks';
import type {AgentMemoryCatalog, AgentMemoryCatalogListResult, AgentMemoryCatalogReadResult, AgentMemoryItem, AgentMemoryMutationResult, AgentMemoryScope, UserMemory, UserMemoryMutationResult, UserMemoryReadResult} from './memory';
import type {SkillSourceKind} from './skill';
import type {AppSettings} from '../config/app-settings-config';

export type CommandSurfaceOption = {
  label: string;
  description?: string;
  inlineInput?: {
    placeholder: string;
    text: string;
    cursor: number;
  };
};

export type ChoiceCommandSurfaceOption = CommandSurfaceOption & {
  checked?: boolean;
  selected?: boolean;
};

export type ChoiceCommandSurfaceTab = {
  label: string;
  status?: 'complete' | 'missing' | 'ready' | 'blocked';
};

export type SlashCommandDescriptor = {
  name: string;
  description: string;
  allowDuringAssistantTurn?: boolean; // 指示 active assistant turn 期间是否允许展示并立即启动该命令。
};

export type InfoCommandSurface = {
  kind: 'info';
  title: string;
  lines: string[];
  dismissHint: string;
};

export type SelectCommandSurface = {
  kind: 'select';
  title: string;
  options: CommandSurfaceOption[];
  selectedIndex: number;
  dismissHint: string;
};

export type ResumeCommandSurfaceSession = {
  label: string;
};

export type ResumeCommandSurfacePreviewRecord = {
  role: string;
  text: string;
  createdAt?: string;
};

export type ResumeCommandSurface = {
  kind: 'resume';
  focus: 'list' | 'preview';
  title: string;
  sessions: ResumeCommandSurfaceSession[];
  hiddenSessionCountAbove: number; // 当前左栏窗口之前尚未显示的会话数量。
  hiddenSessionCountBelow: number; // 当前左栏窗口之后尚未显示的会话数量。
  selectedIndex: number;
  previewScroll: number;
  previewRecords: ResumeCommandSurfacePreviewRecord[];
  emptyPreviewHint: string;
  dismissHint: string;
};

export type SkillsCommandSurface = {
  activeField: SkillsCommandActiveField;
  kind: 'skills';
  title: string;
  skills: CommandSkillSurfaceInfo[];
  selectedIndex: number;
  emptyLines: string[];
  dismissHint: string;
};

export type SkillsCommandActiveField = 'effort' | 'model';

export type McpCommandSurface = {
  kind: 'mcp';
  title: string;
  servers: CommandMcpServerInfo[];
  selectedIndex: number;
  emptyLines: string[];
  dismissHint: string;
};

export type MemoryCommandSurfaceMode = 'list' | 'edit' | 'deleteConfirm';
export type MemoryCommandSection = 'types' | 'user' | 'catalogs' | 'items';
export type MemoryItemCounts = {
  user: number;
  global: number;
  project: number;
};

export type MemoryCatalogForm = {
  fields: {label: string; text: string; cursor: number}[];
  selectedIndex: number;
};

export type MemoryCommandSurface = {
  kind: 'memory';
  title: string;
  mode: MemoryCommandSurfaceMode;
  section?: MemoryCommandSection;
  scope?: AgentMemoryScope['kind'];
  memories: UserMemory[];
  catalogs?: AgentMemoryCatalog[];
  agentItems?: AgentMemoryItem[];
  selectedCatalog?: AgentMemoryCatalog;
  itemCounts?: MemoryItemCounts;
  catalogForm?: MemoryCatalogForm;
  selectedIndex: number;
  editText?: string;
  editCursor?: number;
  error?: string;
  dismissHint: string;
};

export type HooksCommandSurfaceMode = 'events' | 'entries' | 'entryDetail';

export type HooksCommandEditTarget = 'command' | 'timeoutMs';

export type HooksCommandSurfaceTest = {
  command: string;
  entryIndex: number;
  event: LifecycleHookEventName;
  result?: LifecycleHookTestResult;
  status: 'running' | 'completed';
};

export type HooksCommandSurface = {
  commandScroll?: number;
  diagnostics?: string[];
  dismissHint: string;
  editBuffer?: string;
  editCursor?: number;
  editTarget?: HooksCommandEditTarget;
  detailIndex?: number;
  entries: LifecycleHookDraftEntry[];
  entryIndex: number;
  error?: string;
  eventIndex: number;
  events: Array<{
    count: number;
    event: LifecycleHookEventName;
  }>;
  kind: 'hooks';
  mode: HooksCommandSurfaceMode;
  selectedEvent: LifecycleHookEventName;
  test?: HooksCommandSurfaceTest;
  title: string;
};

export type ScaleCommandSurface = {
  kind: 'scale';
  title: string;
  leftLabel: string;
  rightLabel: string;
  options: CommandSurfaceOption[];
  selectedIndex: number;
  dismissHint: string;
};

export type ChoiceCommandSurface = {
  kind: 'choice';
  title: string;
  message?: string;
  messageTitle?: string;
  messageStyle?: 'text' | 'code';
  optionsTitle: string;
  options: ChoiceCommandSurfaceOption[];
  focusedIndex: number;
  selectionMode?: 'single' | 'multiple';
  tabs?: ChoiceCommandSurfaceTab[];
  activeTabIndex?: number;
  dismissHint: string;
};

export type ConfirmCommandSurface = {
  kind: 'confirm';
  title: string;
  bodyLines: string[];
  confirmLabel: string;
  cancelLabel: string;
};

export type ConfigPanelMode =
  | 'list'
  | 'form'
  | 'preset'
  | 'modelList'
  | 'headerList'
  | 'headerDetail'
  | 'modelDetail';

export type ConfigRemoteModel = {
  id: string;
};

export type ConfigModelListState = {
  error?: string;
  models: ConfigRemoteModel[];
  requestId: number;
  selectedIndex: number;
  status: 'loading' | 'ready' | 'empty' | 'unsupported' | 'error';
  truncated?: boolean;
};

export type ConfigFormRow =
  | {kind: 'preset'}
  | {kind: 'field'; field: 'label' | 'apiKey' | 'baseURL' | 'codexAuthFile'}
  | {kind: 'headers'}
  | {kind: 'model'; modelIndex: number}
  | {kind: 'addModel'}
  | {kind: 'listModels'}
  | {kind: 'deleteProvider'}
  | {kind: 'save'};

export type ConfigEditTarget =
  | {kind: 'field'; field: 'label' | 'apiKey' | 'baseURL' | 'codexAuthFile'}
  | {kind: 'headerName'}
  | {kind: 'headerValue'}
  | {kind: 'modelName'}
  | {kind: 'contextWindow'};

export type ConfigModelDraft = {
  id: string;
  model: string;
  contextWindow?: number;
  reasoning?: Record<string, unknown>;
};

export type ConfigProviderDraft = {
  id: string;
  label: string;
  preset: string;
  apiKey: string;
  baseURL?: string;
  codexAuthFile?: string;
  headers?: Record<string, string>;
  models: ConfigModelDraft[];
};

export type LlmConfigDraft = {
  providers: ConfigProviderDraft[];
  selectedModelId?: string;
  rootConfig: Record<string, unknown>;
};

export type ConfigCommandState = {
  draft: LlmConfigDraft;
  editBuffer: string;
  editReplacePending: boolean;
  editTarget?: ConfigEditTarget;
  error?: string;
  feedback?: string;
  formIndex: number;
  headerDetailIndex: number;
  headerEditor?: {
    existingValue?: string;
    isNew: boolean;
    name: string;
    originalName?: string;
    value: string;
  };
  headerIndex: number;
  initialDraftFingerprint: string;
  modelDetailIndex: number;
  modelIndex: number;
  modelList?: ConfigModelListState;
  mode: ConfigPanelMode;
  presetIndex: number;
  providerIndex: number;
};

export type ConfigTabId = 'general' | 'models' | 'appearance';

export type ConfigSurfaceTab = {
  id: ConfigTabId;
  label: string;
  status?: 'dirty' | 'error';
};

export type GeneralConfigState = {
  draft: AppSettings;
  error?: string;
  feedback?: string;
  initialDraftFingerprint: string;
  selectedIndex: number;
};

export type AppearanceConfigState = {
  error?: string;
  feedback?: string;
  selectedIndex: number;
  themes: CommandThemeInfo[];
};

export type ConfigCommandSurface =
  | {kind: 'config'; view: 'general'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: GeneralConfigState}
  | {kind: 'config'; view: 'models'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: ConfigCommandState; rows: ConfigFormRow[]}
  | {kind: 'config'; view: 'appearance'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: AppearanceConfigState}
  | {kind: 'config'; view: 'error'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; error: string}
  | {kind: 'config'; view: 'discardConfirm'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; dirtyTabs: string[]; selectedIndex: number};

export type ContextUsageCommandSurface = {
  kind: 'context';
  title: string;
  usage: ContextUsage;
  dismissHint: string;
};

export type UsageCommandSurface = {
  dailyUsage: UsageDailyAggregate[];
  dismissHint: string;
  kind: 'usage';
  offset: number;
  title: string;
};

export type CommandStatusSnapshot = {
  agentInstructionFileName: AgentInstructionFileName;
  agentInstructions: Array<{
    filePath: string;
    label: string;
    sourceKind: 'global' | 'project';
  }>;
  agentMemoryCatalogs: Array<{
    name: string;
    scope: 'global' | 'project';
  }>;
  cwd: string;
  diagnostics: string[];
  model: {
    agentType: AgentType;
    model: string;
    provider: string;
  } | null;
  sessionId: string | null;
  userMemoryCount: number;
};

export type CommandCodexUsageWindow = {
  resetAt: number;
  usedPercent: number;
};

export type CommandCodexUsageResult =
  | {
      status: 'available';
      primary: CommandCodexUsageWindow;
      secondary?: CommandCodexUsageWindow;
    }
  | {status: 'not_applicable'}
  | {status: 'unavailable'; error: string};

export type StatusCommandUsageState = CommandCodexUsageResult | {status: 'loading'};

export type StatusCommandSurface = {
  dismissHint: string;
  kind: 'status';
  snapshot: CommandStatusSnapshot;
  title: string;
  usage: StatusCommandUsageState;
};

export type CopyableMessageRole = 'user' | 'assistant';

export type CopyableMessageRecord = {
  createdAt?: string;
  id: string;
  role: CopyableMessageRole;
  text: string;
};

export type ClipboardWriteResult =
  | {ok: true}
  | {error: string; ok: false};

export type CopySurfaceMessage = CopyableMessageRecord & {
  selected: boolean;
};

export type CopyCommandSurface = {
  dismissHint: string;
  focus: 'list' | 'preview';
  kind: 'copy';
  messages: CopySurfaceMessage[];
  notice?: string;
  previewScroll: number;
  selectedIds: string[];
  selectedIndex: number;
  title: string;
};

export type FilePickerSurfaceEntry = {
  kind: 'directory' | 'text' | 'pdf' | 'image' | 'unsupported';
  name: string;
  path: string;
  selectable: boolean;
  selected: boolean;
};

export type FilePickerCommandSurface = {
  kind: 'file_picker';
  currentDir: string;
  dismissHint: string;
  entries: FilePickerSurfaceEntry[];
  focus: 'list' | 'preview';
  notice?: string;
  previewLines: string[];
  previewMode?: 'code' | 'text';
  query: string;
  selectedIndex: number;
  selectedPaths: string[];
  title: string;
};

export type DiffCommandSurface = {
  detailScroll: number;
  files: DiffFile[];
  focus: 'list' | 'detail';
  kind: 'diff';
  notices?: string[];
  selectedIndex: number;
  source: DiffSourceInfo;
  title: string;
};

export type BtwCommandSurface = {
  kind: 'btw'; // 标识 command session 当前拥有 BTW 全视图输入。
  title: string; // BTW command runtime 的可读标题，仅用于兜底 surface。
  dismissHint: string; // BTW surface 意外直接渲染时的退出提示。
};

export type CommandSurface = InfoCommandSurface | SelectCommandSurface | ResumeCommandSurface | SkillsCommandSurface | McpCommandSurface | MemoryCommandSurface | HooksCommandSurface | ScaleCommandSurface | ChoiceCommandSurface | ConfirmCommandSurface | ConfigCommandSurface | ContextUsageCommandSurface | UsageCommandSurface | StatusCommandSurface | CopyCommandSurface | FilePickerCommandSurface | DiffCommandSurface | BtwCommandSurface;

export type CommandModelProfile = {
  id: string;
  model: string;
  provider: string;
  reasoningEffort?: ReasoningEffort;
};

export type CommandModelInfo = {
  models: CommandModelProfile[];
  selectedIndex: number;
};

export type CommandModelInfoResult = CommandModelInfo | {
  error: string;
};

export type CommandSelectModelResult = {
  ok: boolean;
  error?: string;
};

export type CommandEffortInfo = {
  currentModelLabel: string;
  efforts: ReasoningEffort[];
  selectedIndex: number;
};

export type CommandEffortInfoResult = CommandEffortInfo | {
  error: string;
};

export type CommandSelectEffortResult = {
  ok: boolean;
  error?: string;
};

export type CommandConfigSaveResult = {
  ok: boolean;
  error?: string;
};

export type CommandConfigListModelsResult =
  | {ok: true; models: ConfigRemoteModel[]; truncated?: boolean}
  | {ok: false; error: string; reason: 'error' | 'invalid' | 'unsupported'};

export type CommandSkillInfo = {
  name: string;
  description: string;
  sourceKind: SkillSourceKind;
  sourcePath: string;
  enabled: boolean;
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
};

export type CommandSkillSurfaceInfo = CommandSkillInfo & {
  modelLabel: string;
};

export type CommandMcpServerInfo = {
  name: string;
  enabled: boolean;
  valid: boolean;
  summary: string;
  kind: 'global' | 'server';
  transport?: 'stdio' | 'http';
  diagnostic?: string;
  toolCount?: number;
};

export type CommandMcpSaveResult = {
  ok: boolean;
  diagnostics?: string[];
  error?: string;
};

export type CommandHooksSaveResult =
  | {ok: true}
  | {error: string; ok: false};

export type CommandThemeInfo = {
  description: string;
  id: string;
  label: string;
  selected: boolean;
};

export type CommandSelectThemeResult =
  | {ok: true}
  | {ok: false; error: string};

export type CommandSkillInvocationResult =
  | {
      ok: true;
      text: string;
      metadata: UserTranscriptMetadata;
      modelProfileId?: string;
      reasoningEffortOverride?: ReasoningEffort;
    }
  | {
      ok: false;
      reason: 'disabled' | 'missing';
      message: string;
    };

export type CommandCompactionResult = {
  didCompact: boolean;
  reason: 'compacted' | 'below_threshold' | 'no_boundary';
  compaction?: CompactionState;
};

export type CommandReferencePrepareResult =
  | {
      ok: true; // 表示所选历史会话已保存为 pending 引用。
    }
  | {
      ok: false; // 表示选择阶段未能生成 pending 引用。
      reason: 'failed'; // 区分可展示失败与成功结果，选择阶段不产生取消状态。
      error?: string; // 经过脱敏、可直接展示在错误 surface 中的原因。
    };

export type CommandReferenceSubmissionOptions = {
  modelProfileIdOverride?: string; // 当前消息通过 skill 等入口指定的本轮模型覆盖。
  reference?: PendingConversationReference; // 普通 composer 提交时捕获的引用素材；省略时读取当前 live composer 附件。
  reasoningEffortOverride?: ReasoningEffort; // 当前消息覆盖模型配置的本轮 reasoning effort。
};

export type CommandReferenceSubmissionResult =
  | {
      ok: true; // 表示引用已可附加到当前用户消息。
      reference: PreparedConversationReference; // 已完成全文或总结投影的历史会话引用。
    }
  | {
      ok: false; // 表示发送前准备未产生可用引用。
      reason: 'cancelled' | 'failed'; // 区分用户取消与可展示的准备失败。
      error?: string; // 仅失败状态携带的脱敏展示文案。
    };

export type CommandHostApp = {
  btw: {
    open(initialQuestion?: string): void; // 捕获主会话快照并切换到 BTW 投影。
    handleEvent(event: InputEvent): Promise<void> | void; // 把 BTW composer 输入交给临时会话 controller。
    close(): void; // 中断并丢弃 BTW 后恢复主投影。
  };
  transcript: {
    clear(): void;
    forkSession(): TranscriptForkResult;
    loadSession(sessionId: string): boolean;
    append(record: TranscriptRecord): void;
    listCopyableRecords(): CopyableMessageRecord[];
    listResumeSessions(): TranscriptSessionMetadata[];
  };
  reference: {
    cancelPreparation(): boolean; // 取消正在运行的引用总结，同时保留 pending 素材。
    listSessions(): TranscriptSessionMetadata[]; // 返回当前 cwd 中除当前会话外的引用候选。
    prepare(candidate: TranscriptSessionMetadata): Promise<CommandReferencePrepareResult>; // 只读加载候选会话并创建 pending 引用。
    prepareForSubmission(options?: CommandReferenceSubmissionOptions): Promise<CommandReferenceSubmissionResult>; // 发送前使用本轮模型配置生成最终引用。
  };
  clipboard: {
    writeText(text: string): Promise<ClipboardWriteResult>;
  };
  model: {
    createModelCommandInfo(): CommandModelInfoResult;
    createEffortCommandInfo(): CommandEffortInfoResult;
    selectModel(modelId: string): CommandSelectModelResult;
    selectEffort(effort: ReasoningEffort): CommandSelectEffortResult;
  };
  config: {
    readSettings(): AppSettings;
    readDraft(): LlmConfigDraft;
    listModels(provider: ConfigProviderDraft): Promise<CommandConfigListModelsResult>;
    saveSettings(draft: AppSettings): CommandConfigSaveResult;
    saveDraft(draft: LlmConfigDraft): CommandConfigSaveResult;
  };
  skills: {
    createSkillInvocation(skillName: string, argumentsText?: string): CommandSkillInvocationResult;
    listSkills(): CommandSkillInfo[];
    listEnabledSkillDescriptors(): SlashCommandDescriptor[];
    saveSkillStates(skills: CommandSkillInfo[]): void;
  };
  mcp: {
    listServers(): CommandMcpServerInfo[];
    saveServerStates(servers: CommandMcpServerInfo[]): Promise<CommandMcpSaveResult>;
  };
  memory: {
    list(): UserMemoryReadResult;
    create(content: string): UserMemoryMutationResult;
    update(id: string, content: string): UserMemoryMutationResult;
    setEnabled(id: string, enabled: boolean): UserMemoryMutationResult;
    delete(id: string): UserMemoryMutationResult;
    listAgentCatalogs(): AgentMemoryCatalogListResult;
    readAgentCatalog(name: string, scope?: AgentMemoryScope['kind']): AgentMemoryCatalogReadResult;
    addAgentMemory(input: {catalog: string; description?: string; content: string; scope?: AgentMemoryScope['kind']}): AgentMemoryMutationResult;
    updateAgentCatalog(name: string, updates: {name?: string; description?: string}, scope?: AgentMemoryScope['kind']): AgentMemoryMutationResult;
    setAgentCatalogEnabled(name: string, enabled: boolean, scope?: AgentMemoryScope['kind']): AgentMemoryMutationResult;
    updateAgentItem(catalog: string, itemId: string, content: string, scope?: AgentMemoryScope['kind']): AgentMemoryMutationResult;
    setAgentItemEnabled(catalog: string, itemId: string, enabled: boolean, scope?: AgentMemoryScope['kind']): AgentMemoryMutationResult;
    removeAgentCatalog(name: string, scope?: AgentMemoryScope['kind']): AgentMemoryMutationResult;
    removeAgentItem(catalog: string, itemId: string, scope?: AgentMemoryScope['kind']): AgentMemoryMutationResult;
  };
  hooks: {
    readDraft(): LifecycleHookConfigDraft;
    saveDraft(draft: LifecycleHookConfigDraft): CommandHooksSaveResult;
    testEntry(event: LifecycleHookEventName, entry: LifecycleHookDraftEntry): Promise<LifecycleHookTestResult>;
  };
  mode: {
    getInteractionMode(): InteractionMode;
    setInteractionMode(mode: InteractionMode): void;
  };
  theme: {
    listThemes(): CommandThemeInfo[];
    selectTheme(themeId: string): CommandSelectThemeResult;
  };
  context: {
    getUsage(): ContextUsage | null;
  };
  status: {
    createSnapshot(): CommandStatusSnapshot;
    queryCodexUsage(): Promise<CommandCodexUsageResult>;
  };
  usage: {
    listDailyUsage(options?: UsageQueryOptions): UsageDailyAggregate[];
    getViewport(): {maxLines: number; width: number};
  };
  diff: {
    getSource(): DiffSourceResult;
    getViewport(): {maxLines: number; width: number};
  };
  undo: {
    getSummary(): UndoSummary;
    execute(): UndoExecuteResult;
  };
  assistant: {
    beginManualCompaction(): boolean;
    compactContext(options: {force: true}): Promise<CommandCompactionResult>;
    finishManualCompaction(result: CommandCompactionResult): void;
    fail(error: unknown): void;
  };
  ui: {
    renderFooter(): void;
    renderResizeRecovery(): void;
    exit(): void;
  };
};

export type CommandHostSession = {
  open<TData extends object = Record<string, unknown>>(session: CommandSession<TData>): void;
  update<TData extends object = Record<string, unknown>>(patch: CommandSessionPatch<TData>): void;
  close(): void;
  getActive(): CommandSession | null;
};

export type CommandHost = CommandHostApp & {
  session: CommandHostSession;
};

export type CommandHandler<TData extends object = Record<string, unknown>> = {
  name?: string;
  description?: string;
  allowDuringAssistantTurn?: boolean; // 指示该 handler 是否可与 active assistant turn 并行启动。
  match?(text: string): boolean;
  start(text: string, host: CommandHost): void | CommandStartResult;
  handleEvent?(session: CommandSession<TData>, event: InputEvent, host: CommandHost): void | Promise<void>;
};

export type CommandStartResult =
  | {kind: 'not_matched'}
  | {kind: 'handled'}
  | {kind: 'submit_user_message'; text: string; displayText?: string; metadata?: UserTranscriptMetadata; modelProfileId?: string; reasoningEffortOverride?: ReasoningEffort};

export type CommandStartOptions = {
  duringAssistantTurn?: boolean; // 指示本次启动发生于仍可中断的 active assistant turn。
};

export type MatchableCommandHandler<TData extends object = Record<string, unknown>> =
  CommandHandler<TData> & {
    match(text: string): boolean;
  };

export type CommandSession<TData extends object = Record<string, unknown>> = {
  commandName: string;
  handler: CommandHandler<TData>;
  surface: CommandSurface;
  data: TData | null;
};

export type CommandSessionPatch<TData extends object = Record<string, unknown>> = {
  surface?: CommandSurface;
  data?: TData | null;
};

export type ResolveSlashCommand = (text: string) => CommandHandler | null;

export type CommandRuntimeDependencies = {
  resolveSlashCommand: ResolveSlashCommand;
  host: CommandHostApp;
};
