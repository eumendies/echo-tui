/**
 * command 层跨模块协议入口。
 * 本目录按命令域拆分；此文件只做聚合导出，不再定义类型。
 */
export type {
  AgentsCommandDraft,
  AgentsCommandMode,
  AgentsCommandRow,
  AgentsCommandSection,
  AgentsCommandStats,
  AgentsCommandSummary,
  AgentsCommandSummaryField,
  AgentsCommandSurface,
  AgentsCommandTab,
  AgentsCommandTabInfo,
  AgentsCommandTone,
  CommandAgentBuiltinInfo,
  CommandAgentBuiltinPolicy,
  CommandAgentSkillInfo,
  CommandAgentsSnapshot
} from './agents-surface';

export type {
  AppearanceConfigState,
  CommandConfigListModelsResult,
  CommandThemeInfo,
  ConfigCommandState,
  ConfigCommandSurface,
  ConfigEditTarget,
  ConfigFormRow,
  ConfigModelDraft,
  ConfigModelListState,
  ConfigPanelMode,
  ConfigProviderDraft,
  ConfigRemoteModel,
  ConfigSurfaceTab,
  ConfigTabId,
  GeneralConfigState,
  LlmConfigDraft,
  SandboxConfigDraft,
  SandboxConfigState,
  ToolApprovalModelProfile,
  ToolsConfigItem,
  ToolsConfigState
} from './config-surface';

export type {
  SystemPromptConfigState,
  SystemPromptDynamicSection,
  SystemPromptMenuRow,
  SystemPromptMenuRowId,
  SystemPromptSummary,
  SystemPromptSurfaceMode
} from './system-prompt-surface';

export type {
  StatusLineConfigRowId,
  StatusLineConfigState
} from './status-line-surface';

export type {
  ClipboardWriteResult,
  CommandCompactionResult,
  CommandConfigSaveResult,
  CommandSystemPromptDeleteResult,
  CommandSystemPromptReadResult,
  CommandSystemPromptSaveResult,
  CommandHooksSaveResult,
  CommandHostApp,
  CommandMcpPromptReadResult,
  CommandMcpSaveResult,
  CommandReferencePrepareResult,
  CommandReferenceSubmissionOptions,
  CommandReferenceSubmissionResult,
  CommandSelectEffortResult,
  CommandSelectModelResult,
  CommandSelectThemeResult,
  CommandSkillInvocationResult
} from './host';

export type {
  CommandDeepseekBalanceInfo,
  CommandCodexUsageResult,
  CommandCodexUsageWindow,
  CommandDeepseekBalanceResult,
  CommandOpencodeUsageResult,
  CommandOpencodeUsageWindow,
  CommandStatusSandboxState,
  CommandStatusSnapshot,
  ContextUsageCommandSurface,
  StatusCommandDeepseekBalanceState,
  StatusCommandOpencodeUsageState,
  StatusCommandPage,
  StatusCommandSurface,
  StatusCommandUsageState,
  UsageCommandSurface
} from './status-surface';

export type {
  HooksCommandSurfaceMode,
  HooksCommandEditTarget,
  HooksCommandSurface,
  HooksCommandSurfaceTest,
  MemoryCatalogForm,
  MemoryCommandRow,
  MemoryCommandRowKind,
  MemoryCommandSection,
  MemoryCommandSurface,
  MemoryCommandSurfaceMode,
  MemoryItemCounts,
  TasksCommandSurface,
  TasksCommandSurfaceMode
} from './management-surface';

export type {
  CommandMcpInventoryItem,
  CommandMcpPromptInfo,
  CommandMcpServerFacts,
  CommandMcpServerInfo,
  McpCommandRow,
  McpCommandRowTone,
  McpCommandSurface,
  McpInventorySection,
  McpSurfaceView
} from './mcp-surface';

export type {
  CommandEffortInfo,
  CommandEffortInfoResult,
  CommandModelInfo,
  CommandModelInfoResult,
  CommandModelProfile,
  CommandSkillInfo,
  CommandSkillSurfaceInfo,
  SkillsCommandActiveField,
  SkillsCommandSurface
} from './model-skills-surface';

export type {
  BtwCommandSurface,
  ChoiceCommandSurface,
  ChoiceCommandSurfaceOption,
  ChoiceCommandSurfaceTab,
  CommandSurface,
  CommandSurfaceOption,
  ConfirmCommandSurface,
  CopyCommandSurface,
  CopySurfaceMessage,
  CopyableMessageRecord,
  CopyableMessageRole,
  DiffCommandSurface,
  FilePickerCommandSurface,
  FilePickerSurfaceEntry,
  InfoCommandSurface,
  ResumeCommandSurface,
  ResumeCommandSurfacePreviewRecord,
  ResumeCommandSurfaceSession,
  ScaleCommandSurface,
  SelectCommandSurface,
  SlashCommandDescriptor
} from './surface';

export type {
  CommandHandler,
  CommandHost,
  CommandHostSession,
  CommandRuntimeDependencies,
  CommandSession,
  CommandSessionPatch,
  CommandStartOptions,
  CommandStartResult,
  MatchableCommandHandler,
  ResolveSlashCommand
} from './runtime';
