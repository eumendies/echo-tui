import type {AppSettings, StatusLineSegments} from '../../config/app-settings-config';
import type {MainAgentToolsConfig} from '../../config/main-agent-tools-config';
import type {SandboxMode} from '../../sandbox/types';
import type {StatusLineConfigState} from './status-line-surface';
import type {SystemPromptConfigState} from './system-prompt-surface';
import type {SystemPromptSummary} from './system-prompt-surface';

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

export type ConfigTabId = 'general' | 'models' | 'tools' | 'sandbox' | 'appearance';

export type ConfigSurfaceTab = {
  id: ConfigTabId;
  label: string;
  status?: 'dirty' | 'error';
};

export type GeneralConfigState = {
  approvalModelProfiles: ToolApprovalModelProfile[]; // 当前配置文件中可供自动审批与标题生成引用的非敏感模型目录。
  draft: AppSettings;
  error?: string;
  feedback?: string;
  initialDraftFingerprint: string;
  selectedIndex: number;
  systemPromptSummary: SystemPromptSummary; // 常规行展示的生效来源摘要；读取失败时为 unknown。
};

export type ToolApprovalModelProfile = {
  id: string; // 持久化模型 profile 的稳定引用 id。
  model: string; // Provider 请求使用的 API model 展示名。
  provider: string; // 所属 provider id，仅用于帮助用户区分候选。
};

export type ToolsConfigItem = {
  names: string[]; // 本行联动的真实工具名；只有 Todo 包含两个名称。
  label: string; // 展示名称；Todo 不作为新的 provider 工具注册。
  description: string; // 配置页专用的简短中文说明，不展开模型使用的原始工具描述。
  available: boolean; // 当前运行依赖是否可用；离线仍允许编辑偏好。
  serverName?: string; // 分节显示的 MCP 服务名。
  unknown?: boolean; // 缺少工具定义的保留偏好，单独分组而非显示为内置工具。
};

export type ToolsConfigState = {
  draft: MainAgentToolsConfig; // 工具页独立草稿，显式保存前不影响运行。
  items: ToolsConfigItem[]; // 未应用禁用名单的候选投影，关闭后仍能重新开启。
  error?: string; // 保存失败的就地错误，不阻断其他 Tab。
  feedback?: string; // 保存成功及下一轮生效提示。
  initialDraftFingerprint: string; // 最近读取或成功保存的禁用集合指纹。
  selectedIndex: number; // 工具索引；items.length 表示保存动作。
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

export type CommandThemeInfo = {
  description: string;
  id: string;
  label: string;
  selected: boolean;
};

export type AppearanceConfigState = {
  error?: string;
  feedback?: string;
  selectedIndex: number;
  themes: CommandThemeInfo[];
};

export type CommandConfigListModelsResult =
  | {ok: true; models: ConfigRemoteModel[]; truncated?: boolean}
  | {ok: false; error: string; reason: 'error' | 'invalid' | 'unsupported'};

export type ConfigCommandSurface =
  | {kind: 'config'; view: 'general'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: GeneralConfigState}
  | {kind: 'config'; view: 'models'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: ConfigCommandState; rows: ConfigFormRow[]}
  | {kind: 'config'; view: 'appearance'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: AppearanceConfigState}
  | {
      kind: 'config'; // 复用配置中心 footer，不新开 command session。
      view: 'systemPrompt'; // 常规 Tab 内的系统提示词管理子视图。
      activeTab: ConfigTabId; // 子视图仍保留 Tab strip，退出时按当前页切换。
      tabs: ConfigSurfaceTab[]; // 跨页脏状态与读取错误标记。
      state: SystemPromptConfigState; // 文件快照与状态机阶段的只读投影。
    }
  | {
      kind: 'config'; // 复用配置中心 footer，不追加 transcript。
      view: 'statusLine'; // 常规 Tab 内的状态栏显示项子面板。
      activeTab: ConfigTabId; // 子面板保留 Tab strip，Tab 键按当前页切走。
      tabs: ConfigSurfaceTab[]; // 跨页脏状态与读取错误标记。
      state: StatusLineConfigState; // 子面板焦点与保存反馈。
      segments: StatusLineSegments; // 常规草稿中的开关快照；开关真值始终在 general 草稿里。
    }
  | {
      kind: 'config'; // 使用配置中心 footer，不追加 transcript。
      view: 'tools'; // 主 Agent 工具页独立视图。
      activeTab: ConfigTabId; // Tab 循环中的当前页。
      tabs: ConfigSurfaceTab[]; // 跨页脏状态和读取错误标记。
      state: ToolsConfigState; // 当前工具草稿的只读渲染快照。
    }
  | {kind: 'config'; view: 'sandbox'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; state: SandboxConfigState}
  | {kind: 'config'; view: 'error'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; error: string}
  | {kind: 'config'; view: 'discardConfirm'; activeTab: ConfigTabId; tabs: ConfigSurfaceTab[]; dirtyTabs: string[]; selectedIndex: number};
