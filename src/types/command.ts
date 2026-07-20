import type { InputEvent } from './input';
import type { AgentType, ContextUsage, InteractionMode, ReasoningEffort } from './agent';
import type {DiffFile, DiffSourceInfo, DiffSourceResult} from './diff';
import type { CompactionState, TranscriptRecord, TranscriptSessionMetadata } from './transcript';
import type {UndoExecuteResult, UndoSummary} from './change-history';
import type {UsageDailyAggregate, UsageQueryOptions} from './usage';
import type {LifecycleHookConfigDraft, LifecycleHookDraftEntry, LifecycleHookEventName, LifecycleHookTestResult} from './hooks';
import type {AgentMemoryCatalog, AgentMemoryCatalogListResult, AgentMemoryCatalogReadResult, AgentMemoryItem, AgentMemoryMutationResult, AgentMemoryScope, UserMemory, UserMemoryMutationResult, UserMemoryReadResult} from './memory';

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
  selectedIndex: number;
  previewScroll: number;
  previewRecords: ResumeCommandSurfacePreviewRecord[];
  emptyPreviewHint: string;
  dismissHint: string;
};

export type SkillsCommandSurface = {
  kind: 'skills';
  title: string;
  skills: CommandSkillSurfaceInfo[];
  selectedIndex: number;
  emptyLines: string[];
  dismissHint: string;
};

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
  diagnostics?: string[];
  dismissHint: string;
  editBuffer?: string;
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
  | 'modelDetail'
  | 'discardConfirm';

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

export type ConfigCommandSurface =
  | {kind: 'config'; view: 'loading'}
  | {kind: 'config'; view: 'editor'; state: ConfigCommandState; rows: ConfigFormRow[]}
  | {
      kind: 'config';
      view: 'result';
      result: {
        providersCount: number;
        modelsCount: number;
      };
    };

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

export type CommandSurface = InfoCommandSurface | SelectCommandSurface | ResumeCommandSurface | SkillsCommandSurface | McpCommandSurface | MemoryCommandSurface | HooksCommandSurface | ScaleCommandSurface | ChoiceCommandSurface | ConfirmCommandSurface | ConfigCommandSurface | ContextUsageCommandSurface | UsageCommandSurface | StatusCommandSurface | CopyCommandSurface | FilePickerCommandSurface | DiffCommandSurface;

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
  sourceKind: 'project' | 'user';
  sourcePath: string;
  enabled: boolean;
  modelProfileId?: string;
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
      metadata: Record<string, unknown>;
      modelProfileId?: string;
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

export type CommandHostApp = {
  composer: {
    reset(): void;
    leaveHistoryBrowsing(): void;
  };
  transcript: {
    clear(): void;
    loadSession(sessionId: string): boolean;
    append(record: TranscriptRecord): void;
    listCopyableRecords(): CopyableMessageRecord[];
    listResumeSessions(): TranscriptSessionMetadata[];
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
    readDraft(): LlmConfigDraft;
    listModels(provider: ConfigProviderDraft): Promise<CommandConfigListModelsResult>;
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
  match?(text: string): boolean;
  start(text: string, host: CommandHost): void | CommandStartResult;
  handleEvent?(session: CommandSession<TData>, event: InputEvent, host: CommandHost): void | Promise<void>;
};

export type CommandStartResult =
  | {kind: 'not_matched'}
  | {kind: 'handled'}
  | {kind: 'submit_user_message'; text: string; displayText?: string; metadata?: Record<string, unknown>; modelProfileId?: string};

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
