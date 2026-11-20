import type {UserConfigSource} from './user-config';
import type {ActiveTurnMessagePolicy, AgentInstructionFileName} from '../types/agent';

type AppSettings = {
  activeTurnMessagePolicy: ActiveTurnMessagePolicy; // 主 assistant turn 响应期间普通消息的处理策略；缺省排队，启动时固定。
  agentInstructionFileName: AgentInstructionFileName;
  autoCompressImages: boolean; // 控制本地图片超过最终附件上限时是否自动缩小。
  checkUpdatesOnStartup: boolean; // 控制启动时是否检查 echo-tui 新版本，持久化为 updates.checkOnStartup。
  compactionThresholdRatio: number;
  defaultInteractionMode: DefaultInteractionMode;
  historyRenderLineLimit: number; // 主会话破坏性重绘的历史行数软预算；0 表示不限，完整消息块可超限。
  mouseInteractionEnabled: boolean; // 控制 TUI 是否启用终端鼠标报告、hover 与点击交互。
  skillCatalogContextRatio: number;
  showReasoningSummary: boolean;
  slashSuggestionMaxVisible: number;
  statusLineSegments: StatusLineSegments; // 控制普通输入态 status line 各可选 segment 的显隐；缺省全部显示。
  toolApprovalMode: ToolApprovalMode; // 控制交互式 approval-required 调用先人工确认还是先由模型判断。
  toolApprovalModelProfileId?: string; // 自动审批严格引用的已保存模型 profile；manual 模式仅保留该选择。
  titleGenerationEnabled: boolean; // 控制是否为新建会话生成 AI 标题；关闭时只保留派生标题。
  titleGenerationModelProfileId?: string; // 会话标题生成严格引用的已保存模型 profile；缺失时使用当前模型并覆盖 low effort。
};

type DefaultInteractionMode = 'normal' | 'plan';
type ToolApprovalMode = 'manual' | 'auto';

/**
 * status line 可选 segment 的显隐开关；每个字段对应一段独立文本，
 * 关闭后该段不参与拼接、宽度计算与分隔符输出，但不影响其事实来源。
 */
type StatusLineSegments = {
  approval: boolean; // 控制会话内全部工具已授权的 `TOOLS all` 段。
  contextUsage: boolean; // 控制右侧 `ctx <used>/<window>` 用量段。
  dir: boolean; // 控制左侧 `dir <项目名>` 目录段。
  effort: boolean; // 控制左侧 `effort <等级>` 推理强度段。
  model: boolean; // 控制左侧模型名段，含 `(SKILL override)` 后缀。
  title: boolean; // 控制左侧当前会话标题段。
};

type StatusLineSegment = keyof StatusLineSegments;

type ToolApprovalSettings = {
  mode: ToolApprovalMode; // 当前交互式工具审批策略，不改变 interaction mode。
  modelProfileId?: string; // auto 模式使用的本地模型 profile id。
};

type AppRenderPreferences = Pick<AppSettings, 'historyRenderLineLimit' | 'showReasoningSummary' | 'slashSuggestionMaxVisible' | 'statusLineSegments'>;

type AppSettingsValidationResult =
  | {ok: true}
  | {ok: false; error: string};

const DEFAULT_STATUS_LINE_SEGMENTS: Readonly<StatusLineSegments> = Object.freeze({
  approval: true,
  contextUsage: true,
  dir: true,
  effort: true,
  model: true,
  title: true
});
const DEFAULT_APP_SETTINGS: Readonly<AppSettings> = {
  activeTurnMessagePolicy: 'pending',
  agentInstructionFileName: 'AGENTS.md',
  autoCompressImages: true,
  checkUpdatesOnStartup: true,
  compactionThresholdRatio: 0.8,
  defaultInteractionMode: 'normal',
  historyRenderLineLimit: 1000,
  mouseInteractionEnabled: false,
  skillCatalogContextRatio: 0.02,
  showReasoningSummary: true,
  slashSuggestionMaxVisible: 8,
  statusLineSegments: DEFAULT_STATUS_LINE_SEGMENTS,
  titleGenerationEnabled: true,
  toolApprovalMode: 'manual'
};
const DEFAULT_RENDER_PREFERENCES: Readonly<AppRenderPreferences> = {
  historyRenderLineLimit: DEFAULT_APP_SETTINGS.historyRenderLineLimit,
  showReasoningSummary: DEFAULT_APP_SETTINGS.showReasoningSummary,
  slashSuggestionMaxVisible: DEFAULT_APP_SETTINGS.slashSuggestionMaxVisible,
  statusLineSegments: DEFAULT_APP_SETTINGS.statusLineSegments
};
// 配置面板行顺序即此数组顺序；renderer 与 handler 共用，避免焦点与渲染错位。
const STATUS_LINE_SEGMENT_KEYS: readonly StatusLineSegment[] = ['model', 'effort', 'title', 'dir', 'contextUsage', 'approval'];
const MIN_COMPACTION_THRESHOLD_RATIO = 0.5;
const MAX_COMPACTION_THRESHOLD_RATIO = 0.95;
const MIN_SKILL_CATALOG_CONTEXT_RATIO = 0.01;
const MAX_SKILL_CATALOG_CONTEXT_RATIO = 0.1;
const MIN_SLASH_SUGGESTION_MAX_VISIBLE = 1;
const MAX_SLASH_SUGGESTION_MAX_VISIBLE = 20;
const HISTORY_RENDER_LINE_LIMIT_OPTIONS: readonly number[] = Object.freeze([500, 1000, 2000, 5000, 10000, 0]);

/**
 * 校验面板草稿范围，确保写入后的值能被运行时无损读取。
 */
function validateAppSettingsDraft(draft: AppSettings, modelProfileIds?: ReadonlySet<string>): AppSettingsValidationResult {
  if (!isActiveTurnMessagePolicy(draft.activeTurnMessagePolicy)) {
    return {ok: false, error: '响应期间发送消息必须是排队（pending）或即时引导（steer）'};
  }

  if (!isAgentInstructionFileName(draft.agentInstructionFileName)) {
    return {ok: false, error: '项目指令文件必须是 AGENTS.md 或 CLAUDE.md'};
  }

  if (!isFiniteNumberInRange(draft.compactionThresholdRatio, MIN_COMPACTION_THRESHOLD_RATIO, MAX_COMPACTION_THRESHOLD_RATIO)) {
    return {ok: false, error: '自动压缩阈值必须在 50% 到 95% 之间'};
  }

  if (!isFiniteNumberInRange(draft.skillCatalogContextRatio, MIN_SKILL_CATALOG_CONTEXT_RATIO, MAX_SKILL_CATALOG_CONTEXT_RATIO)) {
    return {ok: false, error: '技能列表上下文占比上限必须在 1% 到 10% 之间'};
  }

  if (!isDefaultInteractionMode(draft.defaultInteractionMode)) {
    return {ok: false, error: '默认启动模式必须是普通或规划'};
  }

  if (typeof draft.autoCompressImages !== 'boolean') {
    return {ok: false, error: '超限图片自动压缩设置必须是布尔值'};
  }

  if (typeof draft.checkUpdatesOnStartup !== 'boolean') {
    return {ok: false, error: '启动更新检查设置必须是布尔值'};
  }

  if (typeof draft.mouseInteractionEnabled !== 'boolean') {
    return {ok: false, error: 'UI 鼠标交互设置必须是布尔值'};
  }

  if (!Number.isInteger(draft.slashSuggestionMaxVisible)
    || draft.slashSuggestionMaxVisible < MIN_SLASH_SUGGESTION_MAX_VISIBLE
    || draft.slashSuggestionMaxVisible > MAX_SLASH_SUGGESTION_MAX_VISIBLE) {
    return {ok: false, error: 'Slash suggestion 显示数量必须在 1 到 20 之间'};
  }

  if (typeof draft.showReasoningSummary !== 'boolean') {
    return {ok: false, error: 'Reasoning summary 显示设置必须是布尔值'};
  }

  if (!isPlainObject(draft.statusLineSegments)) {
    return {ok: false, error: '状态栏显示项必须是开关集合'};
  }

  for (const segment of STATUS_LINE_SEGMENT_KEYS) {
    if (typeof draft.statusLineSegments[segment] !== 'boolean') {
      return {ok: false, error: '状态栏显示项的每个开关必须是布尔值'};
    }
  }

  if (!isHistoryRenderLineLimit(draft.historyRenderLineLimit)) {
    return {ok: false, error: '历史重绘预算必须是 500、1000、2000、5000、10000 行或 0（不限）'};
  }

  if (!isToolApprovalMode(draft.toolApprovalMode)) {
    return {ok: false, error: '工具审批模式必须是 manual 或 auto'};
  }

  if (draft.toolApprovalModelProfileId !== undefined
    && (typeof draft.toolApprovalModelProfileId !== 'string' || draft.toolApprovalModelProfileId.trim() === '')) {
    return {ok: false, error: '工具审批模型必须引用有效的模型 profile'};
  }

  if (draft.toolApprovalMode === 'auto'
    && (!draft.toolApprovalModelProfileId || !modelProfileIds?.has(draft.toolApprovalModelProfileId))) {
    return {ok: false, error: '自动工具审批需要选择一个已保存的有效模型 profile'};
  }

  // 关闭生成时允许保留失效的旧引用：开关关闭不应因为历史 profile 消失而无法保存。
  if (draft.titleGenerationEnabled && draft.titleGenerationModelProfileId !== undefined) {
    if (typeof draft.titleGenerationModelProfileId !== 'string' || draft.titleGenerationModelProfileId.trim() === '') {
      return {ok: false, error: '标题生成模型必须引用有效的模型 profile'};
    }

    if (!modelProfileIds?.has(draft.titleGenerationModelProfileId)) {
      return {ok: false, error: '标题生成模型必须引用有效的模型 profile'};
    }
  }

  if (typeof draft.titleGenerationEnabled !== 'boolean') {
    return {ok: false, error: '标题生成开关必须是布尔值'};
  }

  return {ok: true};
}

/**
 * 将已校验的常规设置增量应用到最新根对象；调用方负责原子写入与 snapshot 安装。
 */
function applyAppSettingsDraft(rootConfig: UserConfigSource, draft: AppSettings): void {
  const validation = validateAppSettingsDraft(draft, readModelProfileIds(rootConfig));

  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const compaction = isPlainObject(rootConfig.compaction) ? {...rootConfig.compaction} : {};
  const instructions = isPlainObject(rootConfig.instructions) ? {...rootConfig.instructions} : {};
  const skills = isPlainObject(rootConfig.skills) ? {...rootConfig.skills} : {};
  const sessions = isPlainObject(rootConfig.sessions) ? {...rootConfig.sessions} : {};
  const ui = isPlainObject(rootConfig.ui) ? {...rootConfig.ui} : {};
  const updates = isPlainObject(rootConfig.updates) ? {...rootConfig.updates} : {};
  const tools = isPlainObject(rootConfig.tools) ? {...rootConfig.tools} : {};
  const readFiles = isPlainObject(tools.readFiles) ? {...tools.readFiles} : {};
  const approval = isPlainObject(tools.approval) ? {...tools.approval} : {};

  compaction.thresholdRatio = draft.compactionThresholdRatio;
  instructions.fileName = draft.agentInstructionFileName;
  skills.catalogContextRatio = draft.skillCatalogContextRatio;
  ui.activeTurnMessagePolicy = draft.activeTurnMessagePolicy;
  ui.defaultInteractionMode = draft.defaultInteractionMode;
  ui.historyRenderLineLimit = draft.historyRenderLineLimit;
  ui.mouseInteractionEnabled = draft.mouseInteractionEnabled;
  ui.slashSuggestionMaxVisible = draft.slashSuggestionMaxVisible;
  ui.showReasoningSummary = draft.showReasoningSummary;
  // 浅合并而非整体替换：ui.statusLine 下的未知字段与 ui 的其他兄弟键都必须保留。
  const statusLine = isPlainObject(ui.statusLine) ? {...ui.statusLine} : {};
  for (const segment of STATUS_LINE_SEGMENT_KEYS) {
    statusLine[segment] = draft.statusLineSegments[segment];
  }
  ui.statusLine = statusLine;
  updates.checkOnStartup = draft.checkUpdatesOnStartup;
  readFiles.autoCompressImages = draft.autoCompressImages;
  approval.mode = draft.toolApprovalMode;
  if (draft.toolApprovalModelProfileId !== undefined) {
    approval.modelProfileId = draft.toolApprovalModelProfileId;
  }
  if (draft.titleGenerationModelProfileId !== undefined) {
    sessions.titleModelProfileId = draft.titleGenerationModelProfileId;
  } else {
    // 显式切回"跟随当前模型"必须删除旧引用，否则 normalize 会读回旧 profile 让用户切不回去。
    delete sessions.titleModelProfileId;
  }
  sessions.titleGenerationEnabled = draft.titleGenerationEnabled;
  tools.readFiles = readFiles;
  tools.approval = approval;
  rootConfig.compaction = compaction;
  rootConfig.instructions = instructions;
  rootConfig.skills = skills;
  rootConfig.sessions = sessions;
  rootConfig.ui = ui;
  rootConfig.updates = updates;
  rootConfig.tools = tools;
}

function normalizeAppSettings(rootConfig: UserConfigSource): AppSettings {
  const compaction = isPlainObject(rootConfig.compaction) ? rootConfig.compaction : {};
  const instructions = isPlainObject(rootConfig.instructions) ? rootConfig.instructions : {};
  const skills = isPlainObject(rootConfig.skills) ? rootConfig.skills : {};
  const sessions = isPlainObject(rootConfig.sessions) ? rootConfig.sessions : {};
  const ui = isPlainObject(rootConfig.ui) ? rootConfig.ui : {};
  const updates = isPlainObject(rootConfig.updates) ? rootConfig.updates : {};
  const tools = isPlainObject(rootConfig.tools) ? rootConfig.tools : {};
  const readFiles = isPlainObject(tools.readFiles) ? tools.readFiles : {};
  const approval = isPlainObject(tools.approval) ? tools.approval : {};
  const thresholdRatio = compaction.thresholdRatio;
  const skillCatalogRatio = skills.catalogContextRatio;
  const slashMaxVisible = ui.slashSuggestionMaxVisible;

  return {
    activeTurnMessagePolicy: isActiveTurnMessagePolicy(ui.activeTurnMessagePolicy)
      ? ui.activeTurnMessagePolicy
      : DEFAULT_APP_SETTINGS.activeTurnMessagePolicy,
    agentInstructionFileName: isAgentInstructionFileName(instructions.fileName)
      ? instructions.fileName
      : DEFAULT_APP_SETTINGS.agentInstructionFileName,
    autoCompressImages: typeof readFiles.autoCompressImages === 'boolean'
      ? readFiles.autoCompressImages
      : DEFAULT_APP_SETTINGS.autoCompressImages,
    checkUpdatesOnStartup: typeof updates.checkOnStartup === 'boolean'
      ? updates.checkOnStartup
      : DEFAULT_APP_SETTINGS.checkUpdatesOnStartup,
    compactionThresholdRatio: isFiniteNumberInRange(thresholdRatio, MIN_COMPACTION_THRESHOLD_RATIO, MAX_COMPACTION_THRESHOLD_RATIO)
      ? thresholdRatio
      : DEFAULT_APP_SETTINGS.compactionThresholdRatio,
    defaultInteractionMode: isDefaultInteractionMode(ui.defaultInteractionMode)
      ? ui.defaultInteractionMode
      : DEFAULT_APP_SETTINGS.defaultInteractionMode,
    historyRenderLineLimit: isHistoryRenderLineLimit(ui.historyRenderLineLimit)
      ? ui.historyRenderLineLimit
      : DEFAULT_APP_SETTINGS.historyRenderLineLimit,
    mouseInteractionEnabled: typeof ui.mouseInteractionEnabled === 'boolean'
      ? ui.mouseInteractionEnabled
      : DEFAULT_APP_SETTINGS.mouseInteractionEnabled,
    skillCatalogContextRatio: isFiniteNumberInRange(skillCatalogRatio, MIN_SKILL_CATALOG_CONTEXT_RATIO, MAX_SKILL_CATALOG_CONTEXT_RATIO)
      ? skillCatalogRatio
      : DEFAULT_APP_SETTINGS.skillCatalogContextRatio,
    showReasoningSummary: typeof ui.showReasoningSummary === 'boolean'
      ? ui.showReasoningSummary
      : DEFAULT_APP_SETTINGS.showReasoningSummary,
    slashSuggestionMaxVisible: Number.isInteger(slashMaxVisible)
      && Number(slashMaxVisible) >= MIN_SLASH_SUGGESTION_MAX_VISIBLE
      && Number(slashMaxVisible) <= MAX_SLASH_SUGGESTION_MAX_VISIBLE
      ? Number(slashMaxVisible)
      : DEFAULT_APP_SETTINGS.slashSuggestionMaxVisible,
    statusLineSegments: normalizeStatusLineSegments(isPlainObject(ui.statusLine) ? ui.statusLine : {}),
    toolApprovalMode: isToolApprovalMode(approval.mode) ? approval.mode : DEFAULT_APP_SETTINGS.toolApprovalMode,
    ...(typeof approval.modelProfileId === 'string' && approval.modelProfileId.trim() !== ''
      ? {toolApprovalModelProfileId: approval.modelProfileId}
      : {}),
    titleGenerationEnabled: typeof sessions.titleGenerationEnabled === 'boolean'
      ? sessions.titleGenerationEnabled
      : DEFAULT_APP_SETTINGS.titleGenerationEnabled,
    ...(typeof sessions.titleModelProfileId === 'string' && sessions.titleModelProfileId.trim() !== ''
      ? {titleGenerationModelProfileId: sessions.titleModelProfileId}
      : {})
  };
}

function isAgentInstructionFileName(value: unknown): value is AgentInstructionFileName {
  return value === 'AGENTS.md' || value === 'CLAUDE.md';
}

/**
 * 逐项归一化 ui.statusLine；每个开关独立回退默认值，一个非法子项不牵连其他 segment，
 * 节点整体缺失或不是对象时按默认全开处理。
 */
function normalizeStatusLineSegments(node: UserConfigSource): StatusLineSegments {
  return {
    approval: typeof node.approval === 'boolean' ? node.approval : DEFAULT_STATUS_LINE_SEGMENTS.approval,
    contextUsage: typeof node.contextUsage === 'boolean' ? node.contextUsage : DEFAULT_STATUS_LINE_SEGMENTS.contextUsage,
    dir: typeof node.dir === 'boolean' ? node.dir : DEFAULT_STATUS_LINE_SEGMENTS.dir,
    effort: typeof node.effort === 'boolean' ? node.effort : DEFAULT_STATUS_LINE_SEGMENTS.effort,
    model: typeof node.model === 'boolean' ? node.model : DEFAULT_STATUS_LINE_SEGMENTS.model,
    title: typeof node.title === 'boolean' ? node.title : DEFAULT_STATUS_LINE_SEGMENTS.title
  };
}

function isDefaultInteractionMode(value: unknown): value is DefaultInteractionMode {
  return value === 'normal' || value === 'plan';
}

function isActiveTurnMessagePolicy(value: unknown): value is ActiveTurnMessagePolicy {
  return value === 'pending' || value === 'steer';
}

function isToolApprovalMode(value: unknown): value is ToolApprovalMode {
  return value === 'manual' || value === 'auto';
}

function isHistoryRenderLineLimit(value: unknown): value is number {
  return typeof value === 'number' && HISTORY_RENDER_LINE_LIMIT_OPTIONS.includes(value);
}

/**
 * 从同一份持久化配置提取可引用的模型 id，避免 auto 设置在保存时接受陈旧草稿。
 */
function readModelProfileIds(rootConfig: UserConfigSource): Set<string> {
  const llm = isPlainObject(rootConfig.llm) ? rootConfig.llm : {};
  const models = Array.isArray(llm.models) ? llm.models : [];
  return new Set(models.flatMap((model) => isPlainObject(model) && typeof model.id === 'string' && model.id.trim() !== '' ? [model.id] : []));
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isPlainObject(value: unknown): value is UserConfigSource {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  DEFAULT_APP_SETTINGS,
  DEFAULT_RENDER_PREFERENCES,
  DEFAULT_STATUS_LINE_SEGMENTS,
  HISTORY_RENDER_LINE_LIMIT_OPTIONS,
  MAX_COMPACTION_THRESHOLD_RATIO,
  MAX_SKILL_CATALOG_CONTEXT_RATIO,
  MAX_SLASH_SUGGESTION_MAX_VISIBLE,
  MIN_COMPACTION_THRESHOLD_RATIO,
  MIN_SKILL_CATALOG_CONTEXT_RATIO,
  MIN_SLASH_SUGGESTION_MAX_VISIBLE,
  STATUS_LINE_SEGMENT_KEYS,
  applyAppSettingsDraft,
  normalizeAppSettings,
  validateAppSettingsDraft
};

export type {
  ActiveTurnMessagePolicy,
  AppRenderPreferences,
  AppSettings,
  AppSettingsValidationResult,
  DefaultInteractionMode,
  StatusLineSegment,
  StatusLineSegments,
  ToolApprovalMode,
  ToolApprovalSettings
};
