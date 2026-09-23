import type { InputEvent } from './input';
import type { AgentInstructionFileName, AgentToolPolicy, AgentType, ContextUsage, InteractionMode, ReasoningEffort } from './agent';
import type { SandboxMode, SandboxModeOverride } from '../sandbox/types';
import type {DiffFile, DiffSourceInfo, DiffSourceResult} from './diff';
import type { CompactionState, PendingConversationReference, PreparedConversationReference, TodoState, TranscriptForkResult, TranscriptRecord, TranscriptSessionDeleteResult, TranscriptSessionSummary, TranscriptSessionPreview, UserTranscriptMetadata } from './transcript';
import type {UndoExecuteResult, UndoSummary} from './change-history';
import type {UsageDailyAggregate, UsageModelAggregate, UsageQueryOptions} from './usage';
import type {LifecycleHookConfigDraft, LifecycleHookDraftEntry, LifecycleHookEventName, LifecycleHookTestResult} from './hooks';
import type {AgentMemoryCatalog, AgentMemoryCatalogListResult, AgentMemoryCatalogReadResult, AgentMemoryItem, AgentMemoryMutationResult, AgentMemoryScope, UserMemory, UserMemoryMutationResult, UserMemoryReadResult} from './memory';
import type {SkillSourceKind} from './skill';
import type {AppSettings} from '../config/app-settings-config';
import type {CustomSubagentCapability, SubagentEffortPolicy} from '../agent/subagent/definition';
import type {CustomSubagentManifest} from '../agent/subagent/manifest';
import type {AgentDefinitionMutationResult, AgentManagementDiagnostic, AgentManagementItem, AgentManagementScope} from '../agent/subagent/management-store';
import type {AgentsSettingsMutationResult, AgentsSettingsScopeReadResult, BuiltinSubagentName, BuiltinSubagentOverride} from '../agent/subagent/settings';
import type {McpConfigEditDraft, McpConfigEditIssue, McpPromptArgument, McpPromptMessage} from './mcp';
import type {FooterMouseTarget, FooterWheelPane} from './render';
import type {MouseWheelDirection} from './input';

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
  focus: 'list' | 'preview'; // 当前焦点栏，决定上下方向键作用对象。
  title: string; // 面板顶部标题。
  sessions: ResumeCommandSurfaceSession[]; // 完整候选列表，可见窗口由渲染层投影。
  selectedIndex: number; // 选中项在完整候选列表中的绝对索引。
  previewScroll: number; // 右栏预览相对首条渲染行的滚动偏移，上界由渲染层钳制。
  previewStatus: 'loading' | 'ready' | 'error'; // 当前右栏预览的异步生命周期状态。
  previewRecords: ResumeCommandSurfacePreviewRecord[]; // ready 状态下按渲染行折行显示的预览记录。
  previewError?: string; // 预览读取失败时展示的稳定错误文案。
  notice?: string; // 当前浏览器状态的临时中文说明，例如当前会话删除保护提示。
  emptyPreviewHint: string; // 预览无记录时的占位文案。
  dismissHint: string; // 面板底部键位提示。
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
  view: McpSurfaceView; // 当前面板视图，决定行语义与键位。
  title: string;
  rows: McpCommandRow[]; // handler 与渲染共享的行投影结果。
  selectedIndex: number;
  facts?: CommandMcpServerFacts; // server 视图附带的运行事实快照。
  emptyLines?: string[]; // 总览无 server 时的空状态说明。
  feedback?: string; // 最近一次成功的提示（例如保存完成）。
  error?: string; // 当前视图的错误提示。
  dirty: boolean; // 草稿是否存在未保存改动。
  dismissHint: string;
};

export type McpSurfaceView = 'overview' | 'server' | 'entries' | 'entryDetail' | 'inventory' | 'discardConfirm' | 'deleteConfirm' | 'error';

export type McpInventorySection = 'tools' | 'resources' | 'templates' | 'prompts';

export type McpCommandRowTone = 'normal' | 'muted' | 'warning' | 'success';

export type McpCommandRow = {
  id: string; // 稳定行 id；handler 用它定位动作，渲染只做投影。
  kind: 'global' | 'server' | 'field' | 'inventory' | 'entries' | 'action' | 'entry' | 'option';
  label: string; // 行主文本。
  value?: string; // 行右侧值（密钥已掩码）。
  detail?: string; // 次级说明：普通行渲染为缩进备注，动作/清单行渲染为右侧提示。
  tone?: McpCommandRowTone; // 行强调色语义。
  disabled?: boolean; // 条目不可用（例如未初始化 server 的清单入口）。
  dot?: 'on' | 'off'; // 行首开关圆点：on 为绿色实心，off 为暗色空心。
  masked?: boolean; // 输入行是否为密钥值：缓冲按 • 掩码显示。
  input?: {text: string; cursor: number; placeholder?: string}; // 内联编辑缓冲。
};

export type CommandMcpServerFacts = {
  initialized: boolean; // server 是否初始化成功；false 时清单不可用。
  capabilities: {tools: boolean; resources: boolean; prompts: boolean}; // server 声明的能力。
  toolCount: number;
  readOnlyToolCount: number;
  resourceCount: number;
  resourceTemplateCount: number;
  promptCount: number;
  diagnostics: string[]; // 该 server 的配置与运行诊断摘要。
};

export type CommandMcpInventoryItem = {
  label: string; // 主展示文本（工具名、uri、命令名）。
  detail?: string; // 次级信息（只读标记、mime、参数签名、描述）。
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

export type AgentsCommandTab = 'overview' | 'project' | 'user' | 'builtin';
type AgentsCommandMode = 'list' | 'detail' | 'form' | 'tools' | 'skills' | 'instructions' | 'confirm';
export type AgentsCommandSection = 'identity' | 'policy' | 'capability' | 'actions';
export type AgentsCommandTone = 'warning' | 'danger';

type AgentsCommandTabInfo = {
  id: AgentsCommandTab; // 顶层来源范围的稳定标识。
  label: string; // 顶层范围在 surface 中显示的标签。
};

export type AgentsCommandRow = {
  capability?: CustomSubagentCapability; // Agent 列表行的权限模板摘要；普通字段和动作行缺省。
  description?: string; // Agent 摘要、字段当前值或动作补充说明。
  effort?: SubagentEffortPolicy; // Agent 列表行的 effective effort 策略。
  id: string; // handler 与 renderer 共享的稳定行标识。
  kind: 'agent' | 'action' | 'field' | 'tool' | 'confirm'; // 行的领域角色，决定 Enter 或 Space 语义。
  label: string; // 当前行的主要可见文案。
  mcp?: boolean; // Agent 列表行是否可见父运行 MCP 工具。
  model?: string; // Agent 列表行的显式模型 profile；缺省表示继承父模型。
  readonly?: boolean; // true 表示该字段仅展示且不得进入编辑状态。
  section?: AgentsCommandSection; // 详情或表单中的语义分区；不参与焦点索引。
  selected?: boolean; // tools 多选时表示当前工具是否已纳入草稿。
  skillSummary?: string; // Agent 列表行的 Skill 策略摘要，区分全部、无与已配置数量。
  sourceKind?: 'builtin' | AgentManagementScope; // Agent 列表行的物理来源。
  status?: string; // Agent 的 active、shadowed、invalid 或 reserved 等状态摘要。
  tone?: AgentsCommandTone; // 动作或诊断的视觉语气，不改变 Enter 行为。
  toolCount?: number; // Agent 列表行当前本地工具数量。
};

export type AgentsCommandSummaryField = {
  label: string; // 摘要字段的短标签，与 value 拼成一行紧凑展示文本。
  value: string; // 已由 handler 确定业务语义的可见值。
};

export type AgentsCommandSummary = {
  description?: string; // Agent 定义描述或动作说明；诊断文本只出现在 diagnostics。
  diagnostics: string[]; // 当前选中物理项的有界诊断；无诊断时为空数组。
  fields: AgentsCommandSummaryField[]; // 按重要性排序的策略、权限与来源字段。
  sourceKind?: 'builtin' | AgentManagementScope; // Agent 或 scope 动作对应的来源层级。
  status?: string; // 当前选中 Agent 的 canonical 状态，renderer 负责本地化显示。
  title: string; // 摘要标题，通常是 Agent 名称或动作名称。
};

export type AgentsCommandStats = {
  agentCount: number; // 当前范围内可见的 Agent 物理项或 effective 项数量。
  issueCount: number; // 当前范围内无效、保留或独立诊断的数量。
};

export type AgentsCommandDraft = {
  capability: CustomSubagentCapability; // 当前自定义 Agent 的固定权限模板。
  description: string; // 主 Agent 目录可见的能力摘要草稿。
  effort: SubagentEffortPolicy; // 相对父运行或目标模型默认值的 effort 策略。
  instructions: string; // 追加到系统安全约束后的 Markdown instructions 草稿。
  mcp: boolean; // 通用 Agent 是否请求父运行已初始化的全部 MCP tools。
  modelProfileId?: string; // 当前配置 snapshot 中的显式模型 profile；缺省表示继承。
  name: string; // 新建时可编辑、已有定义编辑时只读的文件基础名。
  skillNames?: string[]; // 三态 Skill allowlist：缺省允许全部 enabled Skills，空数组明确禁止，非空按名称收窄。
  tools: string[]; // 当前 capability ceiling 内选择的 provider-neutral 工具名。
};

export type AgentsCommandSurface = {
  activeTab: AgentsCommandTab; // 当前 Overview、Project、User 或 Built-in 范围。
  dismissHint: string; // 当前层级可用键位的简短说明。
  editCursor?: number; // 行内字段或 instructions composer 的 grapheme 光标位置。
  editField?: 'name' | 'description'; // 当前正在接收行内文本编辑的字段。
  editText?: string; // 当前行内字段或 instructions composer 的完整可见文本。
  error?: string; // 校验、冲突或 I/O 失败后的可见反馈。
  feedback?: string; // 成功刷新后的下一 assistant turn 生效提示。
  kind: 'agents'; // 独立 footer surface 分派标识。
  mode: AgentsCommandMode; // 当前列表、详情、表单或嵌套 modal 层级。
  rows: AgentsCommandRow[]; // Agent 与动作混合的可聚焦行快照。
  selectedIndex: number; // 当前 rows 中已钳制的焦点索引。
  stats?: AgentsCommandStats; // 列表模式当前范围的简短计数；其他模式缺省。
  summary?: AgentsCommandSummary; // 列表模式当前选中项的结构化摘要；空范围缺省。
  tabs: AgentsCommandTabInfo[]; // 顶层固定 Tab 列表。
  title: string; // 当前层级标题。
};

export type CommandAgentBuiltinPolicy = {
  fields: readonly ('model' | 'effort' | 'skills')[]; // 胜出 override 实际覆盖的策略字段；未生效时为空序列。
  missingModelProfileId?: string; // status 为 ignored 时使整条 override 失效的模型 profile 引用。
  sourceKind?: 'project' | 'user'; // 胜出 override 的 scope；status 为 none 时缺省。
  sourcePath?: string; // 胜出 scope 的 sidecar 绝对路径；status 为 none 时缺省。
  status: 'applied' | 'ignored' | 'none'; // 生效、已声明但被整体丢弃、或没有任何 scope 声明该 override。
};

export type CommandAgentBuiltinInfo = {
  capability: CustomSubagentCapability; // 从固定 execution policy 投影的只读能力模板。
  description: string; // 内置定义的固定目录描述。
  effort: SubagentEffortPolicy; // 当前有效 override 或完整继承策略。
  includeMcpTools: boolean; // 内置定义固定的 MCP 可见性，只读展示。
  localToolNames: string[]; // 内置定义固定的本地工具白名单，只读展示。
  modelProfileId?: string; // 当前有效 override 的显式模型 profile。
  name: BuiltinSubagentName; // Explorer 或 Worker 的固定保留名称。
  policy: CommandAgentBuiltinPolicy; // 当前生效策略的来源、覆盖字段与失效原因，供详情页与策略表单展示。
  skillNames?: string[]; // 当前有效 override 的 Skill allowlist；缺省表示全部 enabled Skills。
};

export type CommandAgentSkillInfo = {
  enabled: boolean; // 当前全局 /skills 状态；disabled 名称保留在 allowlist 中但不在 effective 集合内。
  name: string; // 与 manifest `skills` 序列和 `use_skill` 参数一致的稳定名称。
  sourceKind: SkillSourceKind; // 当前按 project、user、builtin 优先级胜出的来源。
};

export type CommandAgentsSnapshot = {
  builtins: CommandAgentBuiltinInfo[]; // 固定内置定义及其当前有效模型策略。
  diagnostics: Readonly<AgentManagementDiagnostic>[]; // 无法归属单个定义的目录级诊断。
  items: Readonly<AgentManagementItem>[]; // Built-in、User 与 Project 物理项及覆盖状态。
  models: Array<{id: string}>; // 当前用户配置 snapshot 中可供表单选择的模型 profile ID。
  overrides: readonly Readonly<AgentsSettingsScopeReadResult>[]; // 两个固定 sidecar 的物理读取状态和冲突指纹。
  skills: CommandAgentSkillInfo[]; // 管理会话捕获的当前 Skill 目录，供 Skills 多选层展示与选择。
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
  isNew?: boolean; // 新建未定型 provider 标记；id 需跟随最终选择的 preset。
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

export type ConfigTabId = 'general' | 'models' | 'sandbox' | 'appearance';

export type ConfigSurfaceTab = {
  id: ConfigTabId;
  label: string;
  status?: 'dirty' | 'error';
};

export type GeneralConfigState = {
  approvalModelProfiles: ToolApprovalModelProfile[]; // 当前配置文件中可供自动审批引用的非敏感模型目录。
  draft: AppSettings;
  error?: string;
  feedback?: string;
  initialDraftFingerprint: string;
  selectedIndex: number;
};

export type ToolApprovalModelProfile = {
  id: string; // 持久化模型 profile 的稳定引用 id。
  model: string; // Provider 请求使用的 API model 展示名。
  provider: string; // 所属 provider id，仅用于帮助用户区分候选。
};

export type SandboxConfigDraft = {
  mode: SandboxMode; // 沙箱档位：off / read-only / workspace-write。
  network: boolean; // 配置原值；read-only 档由 runtime 归一化为禁网。
  extraWritablePaths: string[]; // 用户追加的可写目录绝对路径。
};

export type SandboxConfigState = {
  draft: SandboxConfigDraft; // 当前沙箱草稿；保存前不落盘。
  error?: string; // 最近一次操作的就地错误；由下一次操作清除。
  feedback?: string; // 最近一次成功保存的提示。
  initialDraftFingerprint: string; // 打开或保存成功时的草稿指纹；脏跟踪基线。
  pathInput?: string; // 新目录行内输入缓冲；undefined 表示列表模式，'' 表示空输入。
  selectedIndex: number; // 列表选中行；输入模式下忽略。
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
  | {kind: 'config'; view: 'sandbox'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: SandboxConfigState}
  | {kind: 'config'; view: 'error'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; error: string}
  | {kind: 'config'; view: 'discardConfirm'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; dirtyTabs: string[]; selectedIndex: number};

export type ContextUsageCommandSurface = {
  kind: 'context';
  title: string;
  usage: ContextUsage;
  dismissHint: string;
};

export type UsageCommandSurface = {
  dailyUsage: UsageDailyAggregate[]; // 全部按日聚合数据；日期列表与当日明细共享其选中日期上下文。
  dismissHint: string; // 当前视图对应的中文键位提示。
  kind: 'usage'; // footer command surface 的稳定分派标识。
  modelUsage: UsageModelAggregate[]; // 选中日期内 provider/模型组合的聚合；按日视图为空。
  offset: number; // 当前视图可见窗口在完整日期或当日模型列表中的起始索引。
  selectedIndex: number; // 当前选中日期在 dailyUsage 中的绝对索引；模型明细中仅保留该上下文。
  title: string; // 当前视图显示的面板标题。
  view: 'daily' | 'dayModels'; // 可选择的按日列表或选中日期的模型明细。
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
  sandbox: CommandStatusSandboxState;
  sessionId: string | null;
  userMemoryCount: number;
  compaction: CompactionState | null; // 打开或刷新 status 时复制的当前生效压缩摘要；无压缩时为 null。
  todoState: TodoState; // 打开或刷新 status 时复制的当前会话结构化待办状态。
};

export type StatusCommandPage = 'overview' | 'compaction' | 'todos';

export type CommandStatusSandboxState = {
  mode: SandboxMode; // 归一化后的生效档位;plan interaction mode 派生的只读收紧也反映在这里。
  network: boolean; // 沙箱生效后的实际网络状态;read-only 恒为 false,与配置原值无关。
  provider: string | null; // 沙箱实现标识;平台不支持时为 null。
  available: boolean; // 沙箱在当前环境是否实际生效。
  unavailableReason?: string; // 配置生效但沙箱不可用时的降级原因;available 时缺省。
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

export type CommandDeepseekBalanceInfo = {
  currency: string; // 币种代码，如 CNY / USD。
  grantedBalance: string; // 赠送余额。
  totalBalance: string; // 账户总余额。
  toppedUpBalance: string; // 充值余额。
};

export type CommandDeepseekBalanceResult =
  | {
      status: 'available';
      isAvailable: boolean; // 余额是否足以继续调用 API。
      balanceInfos: CommandDeepseekBalanceInfo[];
    }
  | {status: 'not_applicable'}
  | {status: 'unavailable'; error: string};

export type StatusCommandDeepseekBalanceState = CommandDeepseekBalanceResult | {status: 'loading'};

export type CommandOpencodeUsageWindow = {
  name: string; // 窗口键名:rolling/weekly/monthly,未知键原样展示。
  status: string; // 窗口状态原文,展示层不做枚举假设。
  percent: number; // 已用百分比,规范到 0–100。
  resetsAtMs: number; // 重置时间点毫秒值。
};

export type CommandOpencodeUsageResult =
  | {
      status: 'available';
      windows: CommandOpencodeUsageWindow[];
    }
  | {status: 'not_applicable'}
  | {status: 'unavailable'; error: string};

export type StatusCommandOpencodeUsageState = CommandOpencodeUsageResult | {status: 'loading'};

export type StatusCommandSurface = {
  compactionScroll: number; // 压缩摘要正文的视觉行偏移；渲染时再按实际行数钳制。
  deepseekBalance: StatusCommandDeepseekBalanceState;
  dismissHint: string;
  kind: 'status';
  opencodeUsage: StatusCommandOpencodeUsageState;
  page: StatusCommandPage; // 当前显示的 status 页面，概览页保留运行信息和账户用量。
  snapshot: CommandStatusSnapshot;
  title: string;
  todoScroll: number; // Todo 正文的视觉行偏移；渲染时再按实际行数钳制。
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
  previewScroll: number; // 文本预览正文在换行后物理行中的滚动偏移，标题保持固定。
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

export type CommandSurface = InfoCommandSurface | SelectCommandSurface | ResumeCommandSurface | SkillsCommandSurface | McpCommandSurface | MemoryCommandSurface | HooksCommandSurface | AgentsCommandSurface | ScaleCommandSurface | ChoiceCommandSurface | ConfirmCommandSurface | ConfigCommandSurface | ContextUsageCommandSurface | UsageCommandSurface | StatusCommandSurface | CopyCommandSurface | FilePickerCommandSurface | DiffCommandSurface | BtwCommandSurface;

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
  resourceCount?: number;
  promptCount?: number;
};

export type CommandMcpPromptInfo = {
  serverName: string; // prompt 所属的 server 名。
  promptName: string; // server 侧 prompt 名称。
  commandName: string; // 归一后的命令名 `<server>:<prompt>`，供匹配与补全共用。
  description?: string; // 可选描述，用于命令建议。
  arguments: McpPromptArgument[]; // 按 server 声明顺序排列的参数，供解析与缺失收集。
};

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
    getCurrentSessionId(): string | null; // 当前 app 持有写入 reference 的 session；未首次持久化时为空。
    loadSession(sessionId: string): boolean;
    deleteSession(sessionId: string): TranscriptSessionDeleteResult; // 请求删除当前 cwd 中的非当前历史 session。
    append(record: TranscriptRecord): void;
    listCopyableRecords(): CopyableMessageRecord[];
    listSessionSummaries(): TranscriptSessionSummary[];
    loadSessionPreview(candidate: TranscriptSessionSummary): Promise<TranscriptSessionPreview | null>;
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
    readSandboxDraft(): SandboxConfigDraft;
    saveSandboxDraft(draft: SandboxConfigDraft): CommandConfigSaveResult;
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
    execute(): UndoExecuteResult;
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
  handlePointer?(session: CommandSession<TData>, target: FooterMouseTarget, activate: boolean, host: CommandHost): void | Promise<void>; // 已完成 footer frame 与 consumer 校验的语义命中；handler 负责验证 target 是否适用于当前 session。
  handleWheel?(session: CommandSession<TData>, pane: FooterWheelPane, direction: MouseWheelDirection, host: CommandHost): void | Promise<void>; // 仅接收已校验的滚轮栏位与方向；handler 不应将滚轮作为点击或确认。
};

export type CommandStartResult =
  | {kind: 'not_matched'}
  | {kind: 'handled'}
  | {kind: 'submit_user_message'; text: string; displayText?: string; metadata?: UserTranscriptMetadata; modelProfileId?: string; reasoningEffortOverride?: ReasoningEffort; toolPolicy?: AgentToolPolicy; sandboxModeOverride?: SandboxModeOverride};

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
