import type {CustomSubagentCapability, SubagentEffortPolicy} from '../../agent/subagent/definition';
import type {AgentManagementDiagnostic, AgentManagementItem, AgentManagementScope} from '../../agent/subagent/management-store';
import type {AgentsSettingsScopeReadResult, BuiltinSubagentName, SelectedSubagentEnablement} from '../../agent/subagent/settings';
import type {SkillSourceKind} from '../skill';

export type AgentsCommandTab = 'overview' | 'project' | 'user' | 'builtin';

export type AgentsCommandMode = 'list' | 'detail' | 'form' | 'tools' | 'skills' | 'instructions' | 'confirm';

export type AgentsCommandSection = 'identity' | 'policy' | 'capability' | 'actions';

export type AgentsCommandTone = 'warning' | 'danger';

export type AgentsCommandTabInfo = {
  id: AgentsCommandTab; // 顶层来源范围的稳定标识。
  label: string; // 顶层范围在 surface 中显示的标签。
};

export type AgentsCommandRow = {
  capability?: CustomSubagentCapability; // Agent 列表行的权限模板摘要；普通字段和动作行缺省。
  description?: string; // Agent 摘要、字段当前值或动作补充说明。
  effort?: SubagentEffortPolicy; // Agent 列表行的 effective effort 策略。
  enablement?: Readonly<SelectedSubagentEnablement>; // 与定义状态独立的名称有效启停；enabled 缺省表示配置异常。
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
  enabledCount?: number; // 启用且定义胜出的候选数量，不代表主工具可调用；异常时缺省。
  disabledCount?: number; // 当前范围中有效停用的物理项数量；异常时缺省。
  unavailable?: boolean; // 全局配置异常时禁止报告有效启停数量。
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
  notice?: string; // 所有层级共享的配置异常或主委派工具独立关闭提示。
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
  items: Readonly<AgentManagementItem & {
    enablement: Readonly<SelectedSubagentEnablement>; // 同名物理项共用的有效启停；全局原始声明位于 user overrides。
  }>[]; // Built-in、User 与 Project 物理项及独立启停投影。
  delegationToolEnabled: boolean | undefined; // 主工具设置是否允许 run_subagent；undefined 表示配置不可读，与候选启停正交。
  models: Array<{id: string}>; // 当前用户配置 snapshot 中可供表单选择的模型 profile ID。
  overrides: readonly Readonly<AgentsSettingsScopeReadResult>[]; // 两个固定 sidecar 的物理读取状态和冲突指纹。
  skills: CommandAgentSkillInfo[]; // 管理会话捕获的当前 Skill 目录，供 Skills 多选层展示与选择。
};
