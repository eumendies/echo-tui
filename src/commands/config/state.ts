import type {MainAgentToolsConfig} from '../../config/main-agent-tools-config';
import {getProviderPreset, providerRequiresApiKey} from '../../config/provider-presets';
import {normalizeConfigDraft} from '../../config/llm-config-editor';
import {REASONING_EFFORTS} from '../../types/agent';

import type {
  AppearanceConfigState,
  ConfigCommandState,
  ConfigCommandSurface,
  ConfigFormRow,
  ConfigModelDraft,
  ConfigProviderDraft,
  ConfigSurfaceTab,
  ConfigTabId,
  GeneralConfigState,
  LlmConfigDraft,
  SandboxConfigDraft,
  SandboxConfigState,
  ToolApprovalModelProfile,
  MainAgentToolCatalogEntry,
  ToolsConfigState
} from '../../types/command';
import type {AppSettings} from '../../config/app-settings-config';
import type {ReasoningEffort} from '../../types/agent';

type ConfigStateSlot<T> = {
  error?: string;
  state?: T;
};

type ConfigCommandData = {
  activeTab: ConfigTabId;
  appearance?: ConfigStateSlot<AppearanceConfigState>;
  discardConfirm?: {
    dirtyTabs: string[];
    selectedIndex: number;
  };
  general?: ConfigStateSlot<GeneralConfigState>;
  models?: ConfigStateSlot<ConfigCommandState>;
  sandbox?: ConfigStateSlot<SandboxConfigState>;
  tools?: ConfigStateSlot<ToolsConfigState>; // 主 Agent 工具页的独立草稿或读取错误。
};

const GENERAL_CONFIG_BASE_ROW_IDS = [
  'compactionThreshold',
  'skillCatalogRatio',
  'slashSuggestionLimit',
  'reasoningSummary',
  'mouseInteraction',
  'defaultInteractionMode',
  'autoCompressImages',
  'checkUpdatesOnStartup',
  'toolApprovalMode',
  'instructionFile',
  'activeTurnMessagePolicy',
  'save'
] as const;

type GeneralConfigRowId = typeof GENERAL_CONFIG_BASE_ROW_IDS[number] | 'toolApprovalModel';

/**
 * 根据常规草稿投影当前真实行集合；handler 和 renderer 必须共享该结果以避免动态焦点错位。
 */
function getGeneralConfigRowIds(state: Pick<GeneralConfigState, 'draft'>): GeneralConfigRowId[] {
  const rows = [...GENERAL_CONFIG_BASE_ROW_IDS] as GeneralConfigRowId[];
  if (state.draft.toolApprovalMode === 'auto') {
    rows.splice(rows.indexOf('toolApprovalMode') + 1, 0, 'toolApprovalModel');
  }
  return rows;
}

const CONFIG_TABS: ReadonlyArray<{id: ConfigTabId; label: string}> = [
  {id: 'general', label: '常规'},
  {id: 'models', label: '模型与 Provider'},
  {id: 'tools', label: '工具'},
  {id: 'sandbox', label: '沙箱'},
  {id: 'appearance', label: '外观'}
];

const CONFIG_MODEL_EFFORT_OPTIONS: readonly (ReasoningEffort | undefined)[] = [undefined, ...REASONING_EFFORTS];

/**
 * 读取模型草稿中的有效默认 effort；未知手写值按未设置展示，等待用户重新选择。
 */
function getConfigModelReasoningEffort(model: ConfigModelDraft | undefined): ReasoningEffort | undefined {
  const effort = model?.reasoning?.effort;
  return typeof effort === 'string' && (REASONING_EFFORTS as readonly string[]).includes(effort)
    ? effort as ReasoningEffort
    : undefined;
}

/**
 * 更新单个模型的默认 effort，同时保留 summary 等其它 reasoning 配置。
 */
function setConfigModelReasoningEffort(model: ConfigModelDraft, effort: ReasoningEffort | undefined): void {
  const reasoning = {...(model.reasoning || {})};

  if (effort === undefined) {
    delete reasoning.effort;
  } else {
    reasoning.effort = effort;
  }

  model.reasoning = Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function configProviderSupportsReasoningEffort(provider: ConfigProviderDraft | undefined): boolean {
  const preset = provider ? getProviderPreset(provider.preset) : undefined;
  return Boolean(preset && preset.agentType !== 'fake');
}

/**
 * 把配置中心 command data 投影为当前 Tab 的只读 surface 快照。
 */
function createConfigSurface(data: ConfigCommandData): ConfigCommandSurface {
  const tabs = createConfigTabs(data);

  if (data.discardConfirm) {
    return {
      kind: 'config',
      view: 'discardConfirm',
      activeTab: data.activeTab,
      tabs,
      dirtyTabs: [...data.discardConfirm.dirtyTabs],
      selectedIndex: data.discardConfirm.selectedIndex
    };
  }

  const slot = data[data.activeTab];
  if (slot?.error) {
    return {kind: 'config', view: 'error', activeTab: data.activeTab, tabs, error: slot.error};
  }

  if (data.activeTab === 'general' && data.general?.state) {
    return {kind: 'config', view: 'general', activeTab: data.activeTab, tabs, state: structuredClone(data.general.state)};
  }

  if (data.activeTab === 'models' && data.models?.state) {
    return {
      kind: 'config',
      view: 'models',
      activeTab: data.activeTab,
      tabs,
      state: cloneConfigState(data.models.state),
      rows: getConfigRows(data.models.state)
    };
  }

  if (data.activeTab === 'appearance' && data.appearance?.state) {
    return {kind: 'config', view: 'appearance', activeTab: data.activeTab, tabs, state: structuredClone(data.appearance.state)};
  }

  if (data.activeTab === 'tools' && data.tools?.state) {
    return {kind: 'config', view: 'tools', activeTab: data.activeTab, tabs, state: structuredClone(data.tools.state)};
  }

  if (data.activeTab === 'sandbox' && data.sandbox?.state) {
    return {kind: 'config', view: 'sandbox', activeTab: data.activeTab, tabs, state: structuredClone(data.sandbox.state)};
  }

  return {kind: 'config', view: 'error', activeTab: data.activeTab, tabs, error: '配置页面未初始化'};
}

function createInitialConfigState(initialDraft: LlmConfigDraft): ConfigCommandState {
  const draft = normalizeConfigDraft(initialDraft);

  return {
    draft,
    editBuffer: '',
    editReplacePending: false,
    formIndex: 0,
    headerDetailIndex: 0,
    headerIndex: 0,
    initialDraftFingerprint: createDraftFingerprint(draft),
    mode: 'list',
    modelDetailIndex: 0,
    modelIndex: 0,
    presetIndex: 0,
    providerIndex: 0
  };
}

function createInitialGeneralConfigState(settings: AppSettings, approvalModelProfiles: ToolApprovalModelProfile[] = []): GeneralConfigState {
  const draft = structuredClone(settings) as AppSettings;
  return {
    approvalModelProfiles: approvalModelProfiles.map((profile) => ({...profile})),
    draft,
    initialDraftFingerprint: createGeneralDraftFingerprint(draft),
    selectedIndex: 0
  };
}

function createInitialAppearanceConfigState(themes: AppearanceConfigState['themes']): AppearanceConfigState {
  return {
    selectedIndex: Math.max(0, themes.findIndex((theme) => theme.selected)),
    themes: themes.map((theme) => ({...theme}))
  };
}

// 配置页只维护面向用户的短说明；候选名称来自轻量目录，模型完整描述仍由 handler 提供。
const TOOL_CONFIG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  run_bash_command: '运行 Bash 命令（必选）',
  apply_patch: '应用文件补丁',
  edit_file: '替换文件内容',
  ask_user_questions: '向用户提问',
  glob: '查找文件路径',
  grep: '搜索文件内容',
  read_files: '读取文件与目录',
  use_skill: '加载技能说明',
  web_fetch: '获取网页内容',
  web_search: '搜索网页',
  run_subagent: '委派子 Agent',
  list_mcp_resources: '列出 MCP 资源',
  read_mcp_resource: '读取 MCP 资源'
};

/** 复制已归一化的 snapshot 草稿并投影中文配置行；Todo 只占一项，离线及未知偏好仍保留。 */
function createInitialToolsConfigState(initialDraft: MainAgentToolsConfig, catalog: MainAgentToolCatalogEntry[]): ToolsConfigState {
  const draft = structuredClone(initialDraft);
  const todoNames = ['create_todos', 'complete_todo'];
  const items: ToolsConfigState['items'] = [];
  for (const entry of catalog) {
    if (todoNames.includes(entry.name)) {
      if (!items.some((item) => item.names.includes('create_todos'))) {
        items.push({
          names: todoNames,
          label: 'Todo',
          description: '创建与完成任务',
          available: todoNames.every((name) => catalog.some((tool) => tool.name === name && tool.available))
        });
      }
    } else {
      items.push({
        names: [entry.name], label: entry.name,
        description: entry.unknown ? '未发现工具定义' : entry.serverName ? '调用 MCP 工具' : TOOL_CONFIG_DESCRIPTIONS[entry.name] || '调用内置工具',
        available: entry.available,
        ...(entry.serverName ? {serverName: entry.serverName} : {}),
        ...(entry.unknown ? {unknown: true} : {})
      });
    }
  }
  items.sort((left, right) => (left.serverName || '').localeCompare(right.serverName || ''));
  return {draft, items, selectedIndex: 0, initialDraftFingerprint: createToolsDraftFingerprint(draft)};
}

/** 禁用名单按集合比较，反复切换后不因插入顺序产生虚假的 dirty。 */
function createToolsDraftFingerprint(draft: MainAgentToolsConfig): string {
  return JSON.stringify([...draft.disabledTools].sort());
}

/** 工具页的脏跟踪不依赖其他 Tab 草稿或当前 MCP 可用性。 */
function isToolsConfigDirty(state: ToolsConfigState | undefined): boolean {
  return Boolean(state && createToolsDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

/** 成功保存后只重置工具页的基线，保留焦点并明确运行快照边界。 */
function markToolsConfigSaved(state: ToolsConfigState): ToolsConfigState {
  return {...structuredClone(state), error: undefined, feedback: '✓ 主 Agent 工具已保存，下轮生效', initialDraftFingerprint: createToolsDraftFingerprint(state.draft)};
}

const SANDBOX_MODE_CYCLE: readonly SandboxConfigDraft['mode'][] = ['off', 'read-only', 'workspace-write'];

type SandboxConfigRowId = 'mode' | 'network' | 'header' | 'addPath' | 'save' | `path:${number}`;
// header:「额外可写目录」分组标题行,仅用于渲染分组,焦点移动时必须跳过它。

/**
 * 根据沙箱草稿投影当前真实行集合；handler 和 renderer 必须共享该结果以避免动态焦点错位。
 */
function getSandboxConfigRowIds(state: Pick<SandboxConfigState, 'draft'>): SandboxConfigRowId[] {
  const rows: SandboxConfigRowId[] = ['mode', 'network'];
  if (state.draft.extraWritablePaths.length > 0) {
    // 仅在存在路径行时插入标题行,让额外可写目录区在面板中自解释。
    rows.push('header');
  }
  state.draft.extraWritablePaths.forEach((_path, index) => rows.push(`path:${index}`));
  rows.push('addPath', 'save');
  return rows;
}

function createInitialSandboxConfigState(draft: SandboxConfigDraft): SandboxConfigState {
  return {
    draft,
    initialDraftFingerprint: createSandboxDraftFingerprint(draft),
    selectedIndex: 0
  };
}

function createSandboxDraftFingerprint(draft: SandboxConfigDraft): string {
  return JSON.stringify(draft);
}

function isSandboxConfigDirty(state: SandboxConfigState | undefined): boolean {
  return Boolean(state && createSandboxDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

function markSandboxConfigSaved(state: SandboxConfigState): SandboxConfigState {
  return {
    ...structuredClone(state),
    error: undefined,
    feedback: '✓ 沙箱设置已保存',
    initialDraftFingerprint: createSandboxDraftFingerprint(state.draft)
  };
}

function cloneConfigState(state: ConfigCommandState): ConfigCommandState {
  return structuredClone(state) as ConfigCommandState;
}

function createDraftFingerprint(draft: LlmConfigDraft): string {
  return JSON.stringify({
    providers: draft.providers,
    selectedModelId: draft.selectedModelId
  });
}

function createGeneralDraftFingerprint(draft: AppSettings): string {
  return JSON.stringify(draft);
}

function isModelConfigDirty(state: ConfigCommandState | undefined): boolean {
  return Boolean(state && createDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

function isGeneralConfigDirty(state: GeneralConfigState | undefined): boolean {
  return Boolean(state && createGeneralDraftFingerprint(state.draft) !== state.initialDraftFingerprint);
}

function markModelConfigSaved(state: ConfigCommandState): ConfigCommandState {
  return {
    ...cloneConfigState(state),
    error: undefined,
    feedback: '✓ 模型配置已保存',
    initialDraftFingerprint: createDraftFingerprint(state.draft)
  };
}

function markGeneralConfigSaved(state: GeneralConfigState): GeneralConfigState {
  return {
    ...structuredClone(state),
    error: undefined,
    feedback: '✓ 常规设置已保存',
    initialDraftFingerprint: createGeneralDraftFingerprint(state.draft)
  };
}

function getConfigRows(state: ConfigCommandState): ConfigFormRow[] {
  const provider = state.draft.providers[state.providerIndex];

  if (!provider) {
    return [];
  }

  const preset = getProviderPreset(provider.preset);
  const rows: ConfigFormRow[] = [
    {kind: 'preset'},
    {kind: 'field', field: 'label'}
  ];

  if (!preset || providerRequiresApiKey(preset) || provider.apiKey !== '') {
    rows.push({kind: 'field', field: 'apiKey'});
  }

  if (!preset || preset.baseURLMode !== 'hidden') {
    rows.push({kind: 'field', field: 'baseURL'});
  }

  if (preset?.codexOAuth) {
    rows.push({kind: 'field', field: 'codexAuthFile'});
  }

  rows.push({kind: 'headers'});
  provider.models.forEach((_model, modelIndex) => rows.push({kind: 'model', modelIndex}));
  rows.push({kind: 'addModel'});
  rows.push({kind: 'listModels'});
  rows.push({kind: 'deleteProvider'});
  rows.push({kind: 'save'});
  return rows;
}

function createConfigTabs(data: ConfigCommandData): ConfigSurfaceTab[] {
  return CONFIG_TABS.map((tab) => {
    const slot = data[tab.id];
    const dirty = tab.id === 'general'
      ? isGeneralConfigDirty(data.general?.state)
      : tab.id === 'models'
        ? isModelConfigDirty(data.models?.state)
        : tab.id === 'tools'
          ? isToolsConfigDirty(data.tools?.state)
          : tab.id === 'sandbox'
            ? isSandboxConfigDirty(data.sandbox?.state)
            : false;
    return {
      ...tab,
      ...(slot?.error ? {status: 'error' as const} : dirty ? {status: 'dirty' as const} : {})
    };
  });
}

export {
  CONFIG_MODEL_EFFORT_OPTIONS,
  getGeneralConfigRowIds,
  CONFIG_TABS,
  SANDBOX_MODE_CYCLE,
  cloneConfigState,
  configProviderSupportsReasoningEffort,
  createConfigSurface,
  createDraftFingerprint,
  createInitialAppearanceConfigState,
  createInitialConfigState,
  createInitialGeneralConfigState,
  createInitialSandboxConfigState,
  createInitialToolsConfigState,
  isToolsConfigDirty,
  markToolsConfigSaved,
  getConfigRows,
  getConfigModelReasoningEffort,
  getSandboxConfigRowIds,
  isGeneralConfigDirty,
  isModelConfigDirty,
  isSandboxConfigDirty,
  markGeneralConfigSaved,
  markModelConfigSaved,
  markSandboxConfigSaved,
  setConfigModelReasoningEffort
};

export type {
  ConfigCommandData,
  ConfigStateSlot
};
