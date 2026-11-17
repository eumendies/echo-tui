import type {AgentDefinitionMutationResult, AgentManagementScope} from '../../agent/subagent/management-store';
import type {CustomSubagentManifest} from '../../agent/subagent/manifest';
import type {AgentsSettingsMutationResult, BuiltinSubagentName, BuiltinSubagentOverride} from '../../agent/subagent/settings';
import type {AppSettings} from '../../config/app-settings-config';
import type {MainAgentToolsConfig} from '../../config/main-agent-tools-config';
import type {ContextUsage, InteractionMode, ReasoningEffort} from '../agent';
import type {BackgroundTaskReference, BackgroundTaskView} from '../background-task';
import type {UndoExecuteResult, UndoSummary} from '../change-history';
import type {DiffSourceResult} from '../diff';
import type {LifecycleHookConfigDraft, LifecycleHookDraftEntry, LifecycleHookEventName, LifecycleHookTestResult} from '../hooks';
import type {InputEvent} from '../input';
import type {McpConfigEditDraft, McpConfigEditIssue, McpPromptMessage} from '../mcp';
import type {AgentMemoryCatalogListResult, AgentMemoryCatalogReadResult, AgentMemoryMutationResult, AgentMemoryScope, UserMemoryMutationResult, UserMemoryReadResult} from '../memory';
import type {CompactionState, PendingConversationReference, PreparedConversationReference, TranscriptForkResult, TranscriptRecord, TranscriptSessionDeleteResult, TranscriptSessionSummary, TranscriptSessionPreview, UserTranscriptMetadata} from '../transcript';
import type {MainAgentToolCatalogEntry} from '../tool';
import type {UsageDailyAggregate, UsageModelAggregate, UsageQueryOptions} from '../usage';
import type {CommandAgentsSnapshot} from './agents-surface';
import type {CommandConfigListModelsResult, CommandThemeInfo, ConfigProviderDraft, LlmConfigDraft, SandboxConfigDraft, ToolApprovalModelProfile} from './config-surface';
import type {SystemPromptDynamicSection} from './system-prompt-surface';
import type {SystemPromptSnapshot, SystemPromptTarget} from '../agent';
import type {CommandMcpInventoryItem, CommandMcpPromptInfo, CommandMcpServerFacts, CommandMcpServerInfo, McpInventorySection} from './mcp-surface';
import type {CommandEffortInfoResult, CommandModelInfoResult, CommandSkillInfo} from './model-skills-surface';
import type {CommandCodexUsageResult, CommandDeepseekBalanceResult, CommandOpencodeUsageResult, CommandStatusSnapshot} from './status-surface';
import type {CopyableMessageRecord, SlashCommandDescriptor} from './surface';

export type ClipboardWriteResult =
  | {ok: true}
  | {error: string; ok: false};

export type CommandConfigSaveResult = {
  ok: boolean;
  error?: string;
};

export type CommandSystemPromptReadResult =
  | {
      ok: true; // 表示快照已构建。
      dynamicSections?: SystemPromptDynamicSection[]; // 仅按需返回的动态段摘要，段级失败已降级。
      snapshot: SystemPromptSnapshot; // 两个写入目标与当前生效来源的事实快照。
    }
  | {
      ok: false; // 表示快照整体无法构建，例如项目根判定抛错。
      error: string; // 可直接展示的中文原因。
    };

export type CommandSystemPromptSaveResult =
  | {
      ok: true; // 表示内容已落盘，或与现有内容一致而未写盘。
      filePath: string; // 实际写入目标绝对路径。
      overwritten: boolean; // 写入前目标是否已存在。
      unchanged: boolean; // 为真时没有发生写盘。
    }
  | {
      ok: false; // 表示内容为空或磁盘写入失败。
      error: string; // 可直接展示的中文原因。
    };

export type CommandSystemPromptDeleteResult =
  | {ok: true; filePath: string} // 目标已删除，或删除前已不存在。
  | {ok: false; error: string}; // 删除失败，文件可能仍然存在。

export type CommandSelectModelResult = {
  ok: boolean;
  error?: string;
};

export type CommandSelectEffortResult = {
  ok: boolean;
  error?: string;
};

export type CommandSelectThemeResult =
  | {ok: true}
  | {ok: false; error: string};

export type CommandMcpPromptReadResult =
  | {
      ok: true; // 表示成功取回 prompt 消息。
      messages: McpPromptMessage[]; // 按 server 返回顺序排列，注入时保持顺序。
    }
  | {
      ok: false; // 表示目录中不存在该 prompt。
      reason: 'missing';
      message: string; // 可直接展示的未命中原因。
    }
  | {
      ok: false; // 表示 prompts/get 调用失败。
      reason: 'failed';
      message: string; // 已经过脱敏的有界错误信息。
    };

export type CommandMcpSaveResult = {
  ok: boolean;
  diagnostics?: string[];
  error?: string;
  issues?: McpConfigEditIssue[];
};

export type CommandHooksSaveResult =
  | {ok: true}
  | {error: string; ok: false};

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

/**
 * command handler 可用的受控 app 协议。
 * 每个域端口由 app/command 下的对应 factory 装配；handler 只应读取自身需要的端口。
 */
export type CommandHostApp = {
  btw: {
    open(initialQuestion?: string): void; // 捕获主会话快照并切换到 BTW 投影。
    handleEvent(event: InputEvent): Promise<void> | void; // 把 BTW composer 输入交给临时会话 controller。
    close(): void; // 中断并丢弃 BTW 后恢复主投影。
  };
  transcript: {
    clear(): void;
    forkSession(): TranscriptForkResult;
    getCurrentSessionId(): string | null; // 当前 app 持有写入 reference 的 session；未首次持久化时为空。
    loadSession(sessionId: string): boolean;
    stopSessionTasks(sessionId: string | null): Promise<void>; // 停止离开会话的后台任务;无管理器或身份时立即返回。
    deleteSession(sessionId: string): TranscriptSessionDeleteResult; // 请求删除当前 cwd 中的非当前历史 session。
    append(record: TranscriptRecord): void;
    listCopyableRecords(): CopyableMessageRecord[] | null; // 完整有效历史的可复制消息；历史读取失败时为 null。
    listSessionSummaries(): TranscriptSessionSummary[];
    loadSessionPreview(candidate: TranscriptSessionSummary): Promise<TranscriptSessionPreview | null>;
  };
  background: {
    list(): BackgroundTaskView[]; // 当前会话的管理器条目 ∪ transcript 引用,按三元身份去重且受管条目优先。
    hasSessionTasks(sessionId: string): boolean; // 该会话是否仍有受管任务;会话切换与 fork 据此决定是否需要等待清理。
    stop(taskId: string): Promise<boolean>; // 按任务身份查找当前实例句柄;历史条目返回 false。
    readLog(taskId: string, maxBytes: number): string | null; // 读取受管任务的有界日志尾部。
    readReferenceLog(reference: BackgroundTaskReference, maxBytes: number): string | null; // 读取仅有文件引用的历史日志尾部。
  };
  reference: {
    cancelPreparation(): boolean; // 取消正在运行的引用总结，同时保留 pending 素材。
    listSessionSummaries(): TranscriptSessionSummary[]; // 返回当前 cwd 中除当前会话外的轻量引用候选。
    loadSessionPreview(candidate: TranscriptSessionSummary): Promise<TranscriptSessionPreview | null>; // 按需只读加载当前引用候选的有界预览。
    prepare(candidate: TranscriptSessionSummary): Promise<CommandReferencePrepareResult>; // 只读完整加载候选会话并创建 pending 引用。
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
    listApprovalModelProfiles(): ToolApprovalModelProfile[];
    readSettings(): AppSettings;
    readDraft(): LlmConfigDraft;
    listModels(provider: ConfigProviderDraft): Promise<CommandConfigListModelsResult>;
    saveSettings(draft: AppSettings): CommandConfigSaveResult;
    saveDraft(draft: LlmConfigDraft): CommandConfigSaveResult;
    readToolsDraft(): MainAgentToolsConfig; // 读取主 Agent 工具偏好，不读取 provider 配置。
    saveToolsDraft(draft: MainAgentToolsConfig): CommandConfigSaveResult; // 只提交本页禁用名单。
    listToolCatalog(): MainAgentToolCatalogEntry[]; // 枚举现有候选，不主动建立 MCP 连接。
    readSandboxDraft(): SandboxConfigDraft;
    saveSandboxDraft(draft: SandboxConfigDraft): CommandConfigSaveResult;
    readSystemPrompt(options?: {includeDynamicSections?: boolean}): CommandSystemPromptReadResult; // 读取两个 SYSTEM.md 目标；动态段摘要按需计算。
    saveSystemPrompt(target: SystemPromptTarget, content: string): CommandSystemPromptSaveResult; // 原子写入指定目标。
    deleteSystemPrompt(target: SystemPromptTarget): CommandSystemPromptDeleteResult; // 删除指定覆盖文件。
  };
  skills: {
    createSkillInvocation(skillName: string, argumentsText?: string): CommandSkillInvocationResult;
    listSkills(): CommandSkillInfo[];
    listEnabledSkillDescriptors(): SlashCommandDescriptor[];
    saveSkillStates(skills: CommandSkillInfo[]): void;
  };
  mcp: {
    listServers(): CommandMcpServerInfo[];
    readConfigDraft(): McpConfigEditDraft;
    readServerFacts(name: string): CommandMcpServerFacts;
    listInventory(name: string, section: McpInventorySection): CommandMcpInventoryItem[];
    saveConfigDraft(draft: McpConfigEditDraft): Promise<CommandMcpSaveResult>;
    listPrompts(): CommandMcpPromptInfo[];
    listPromptCommands(): SlashCommandDescriptor[];
    getPromptMessages(serverName: string, promptName: string, args: Record<string, string>): Promise<CommandMcpPromptReadResult>;
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
  agents: {
    list(): CommandAgentsSnapshot; // 扫描物理定义、sidecar 与当前模型目录形成管理快照。
    validate(scope: AgentManagementScope, name: string, draft: Readonly<CustomSubagentManifest>): AgentDefinitionMutationResult; // 无副作用复用路径、manifest 与 runtime 策略校验。
    create(scope: AgentManagementScope, name: string, draft: Readonly<CustomSubagentManifest>): AgentDefinitionMutationResult; // 排他创建规范化定义。
    update(scope: AgentManagementScope, name: string, draft: Readonly<CustomSubagentManifest>, expectedFingerprint: string): AgentDefinitionMutationResult; // 指纹匹配时更新定义。
    delete(scope: AgentManagementScope, name: string, expectedFingerprint: string): AgentDefinitionMutationResult; // 指纹匹配时删除定义。
    writeEnablement(name: string, enabled: boolean | null, expectedFingerprint: string | null): AgentsSettingsMutationResult; // null 仅移除全局名称键，整文件指纹保护其他配置。
    writeBuiltinOverride(scope: AgentManagementScope, name: BuiltinSubagentName, override: Readonly<BuiltinSubagentOverride>, expectedFingerprint: string | null): AgentsSettingsMutationResult; // 乐观写入单个内置策略。
    deleteBuiltinOverride(scope: AgentManagementScope, name: BuiltinSubagentName, expectedFingerprint: string): AgentsSettingsMutationResult; // 乐观删除单个内置策略。
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
    getViewport(): {maxLines: number; width: number}; // 当前 footer 可供 status 详情正文使用的终端视口。
    queryDeepseekBalance(): Promise<CommandDeepseekBalanceResult>;
    queryCodexUsage(): Promise<CommandCodexUsageResult>;
    queryOpencodeUsage(): Promise<CommandOpencodeUsageResult>;
  };
  usage: {
    listDailyUsage(options?: UsageQueryOptions): UsageDailyAggregate[];
    listModelUsage(options?: UsageQueryOptions): UsageModelAggregate[];
    getViewport(): {maxLines: number; width: number};
  };
  diff: {
    getSource(): DiffSourceResult;
    getViewport(): {maxLines: number; width: number};
  };
  undo: {
    getSummary(): UndoSummary;
    execute(): Promise<UndoExecuteResult>; // 回退可能先停止本轮关联的后台只读任务,因此是异步的。
  };
  assistant: {
    beginManualCompaction(): boolean;
    compactContext(options: {force: true}): Promise<CommandCompactionResult>;
    finishManualCompaction(result: CommandCompactionResult): void;
    fail(error: unknown): void;
    submitUserMessage(input: {text: string; displayText?: string; metadata?: UserTranscriptMetadata}): Promise<boolean>;
  };
  ui: {
    render(): void;
    renderResizeRecovery(): void;
    exit(): void;
  };
};
