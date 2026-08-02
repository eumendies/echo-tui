import {
  readLlmConfig,
  readLlmModelConfigInfo
} from '../../config/llm-config';
import {redactSensitiveText} from '../../agent/agent-errors';
import {REASONING_EFFORTS} from '../../types/agent';

import type {LlmModelConfigInfo} from '../../config/llm-config';
import type {AgentType, ReasoningEffort} from '../../types/agent';
import type {StatusLineModelState} from '../../types/render';
import type {SessionModelSettingsStore} from '../../types/session-model-settings';

type ModelCommandProfile = {
  id: string;
  model: string;
  provider: string;
  reasoningEffort?: ReasoningEffort;
};

type ModelStateFingerprintProfile = ModelCommandProfile & {
  contextWindow?: number;
};

type ModelCommandInfo = {
  models: ModelCommandProfile[];
  selectedIndex: number;
};

type ModelCommandInfoResult = ModelCommandInfo | {
  error: string;
};

type SelectModelResult = {
  ok: boolean;
  error?: string;
};

type EffortCommandInfo = {
  currentModelLabel: string;
  efforts: ReasoningEffort[];
  selectedIndex: number;
};

type EffortCommandInfoResult = EffortCommandInfo | {
  error: string;
};

type SelectEffortResult = {
  ok: boolean;
  error?: string;
};

type SelectModelAndEffortResult = {
  ok: boolean;
  error?: string;
  modelChanged?: boolean;
};

type ModelStatusInfo = {
  agentType: AgentType;
  model: string;
  provider: string;
};

type ModelStatusInfoResult = ModelStatusInfo | {error: string};

type ModelContextOptions = {
  getCurrentCwd?: () => string; // 返回 sidecar 所属 cwd，与 transcript 分区保持一致。
  getCurrentSessionId?: () => string | null; // 返回已创建 journal 的当前 session id；新草稿返回 null。
  settingsStore?: SessionModelSettingsStore; // 保存和恢复当前 session model/effort 的 sidecar store。
};

type AgentModelSelection = {
  modelProfileId: string; // 普通 turn 应使用的当前 session profile id。
  reasoningEffortOverride?: ReasoningEffort; // 当前 session 显式 effort，缺失时继承 profile。
};

type AgentModelSelectionOverride = {
  modelProfileIdOverride?: string; // skill 为当前 turn 请求的 profile 覆盖，尚未验证是否存在。
  reasoningEffortOverride?: ReasoningEffort; // skill 为当前 turn 请求的 effort 覆盖，`none` 也是明确值。
};

function normalizeModelInfo(info: LlmModelConfigInfo): ModelCommandInfo {
  const models = info.models.map((profile) => ({
    id: profile.id,
    model: profile.model,
    provider: profile.provider,
    ...(profile.reasoningEffort ? {reasoningEffort: profile.reasoningEffort} : {})
  }));

  return {
    models,
    selectedIndex: models.findIndex((profile) => profile.id === info.selectedModelId)
  };
}

function sanitizeModelConfigError(error: unknown, fallback: string): string {
  return error instanceof Error && typeof error.message === 'string'
    ? redactSensitiveText(error.message)
    : fallback;
}

/**
 * 管理用户级 model catalog 与当前 session 的 model/effort 选择，并缓存 footer 所需非敏感状态。
 */
class ModelContext {
  private readonly getCurrentCwd: () => string;
  private readonly getCurrentSessionId: () => string | null;
  private modelConfigError?: string;
  private modelLabel: string;
  private models: ModelCommandProfile[];
  private modelStateFingerprint: string;
  private reasoningEffortOverride?: ReasoningEffort;
  private selectedModelId?: string;
  private readonly settingsStore?: SessionModelSettingsStore;
  private sessionSettingsDirty: boolean;

  constructor(options: ModelContextOptions = {}) {
    this.getCurrentCwd = options.getCurrentCwd || (() => process.cwd());
    this.getCurrentSessionId = options.getCurrentSessionId || (() => null);
    this.settingsStore = options.settingsStore;
    this.modelStateFingerprint = 'uninitialized';
    this.modelLabel = 'model unavailable';
    this.models = [];
    this.sessionSettingsDirty = true;
    this.resetSessionToGlobalDefaults();
  }

  /**
   * 从用户配置刷新 catalog；当前 session profile 有效时保持其选择，只更新 profile 定义和展示。
   */
  refreshModelState(): boolean {
    const previousFingerprint = this.modelStateFingerprint;

    try {
      const rawInfo = readLlmModelConfigInfo();
      const info = normalizeModelInfo(rawInfo);
      this.models = info.models;
      if (!this.selectedModelId || !this.models.some((model) => model.id === this.selectedModelId)) {
        const previousModelId = this.selectedModelId;
        this.selectedModelId = rawInfo.selectedModelId;
        this.reasoningEffortOverride = undefined;

        this.sessionSettingsDirty ||= Boolean(previousModelId && previousModelId !== this.selectedModelId);
      }

      this.applyEffectiveModelState(rawInfo.models as ModelStateFingerprintProfile[]);
    } catch (error: unknown) {
      this.applyUnavailableModelState(sanitizeModelConfigError(error, '无法读取当前模型配置'));
    }

    return previousFingerprint !== this.modelStateFingerprint;
  }

  /**
   * 返回 status line 可直接使用的当前 session 模型状态；普通 redraw 不访问磁盘。
   */
  getStatusLineModelState(): StatusLineModelState {
    const profile = this.getSelectedModel();
    const reasoningEffort = this.reasoningEffortOverride ?? profile?.reasoningEffort;

    return {
      modelLabel: this.modelLabel,
      ...(reasoningEffort !== undefined ? {reasoningEffort} : {})
    };
  }

  /**
   * 返回普通 agent turn 使用的 session model/effort；配置不可用时不伪造 profile id。
   */
  getAgentSelection(): AgentModelSelection | null {
    return this.selectedModelId
      ? {
          modelProfileId: this.selectedModelId,
          ...(this.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: this.reasoningEffortOverride} : {})
        }
      : null;
  }

  /**
   * 按字段合并本轮 skill override 与 session 选择；陈旧的 skill profile 回退 session，而非全局默认。
   */
  resolveAgentSelection(override: AgentModelSelectionOverride = {}): AgentModelSelection | null {
    const session = this.getAgentSelection();
    if (!session) {
      return null;
    }

    const selection: AgentModelSelection = {modelProfileId: session.modelProfileId};
    // skill 指定的 profile 只有仍存在于当前 catalog 时才能覆盖 session，避免陈旧配置让请求退回全局默认。
    if (override.modelProfileIdOverride && this.models.some((model) => model.id === override.modelProfileIdOverride)) {
      selection.modelProfileId = override.modelProfileIdOverride;
    }

    // `undefined` 表示未覆盖；`none` 是有效值，须覆盖 session 中已有的 effort。
    if (override.reasoningEffortOverride !== undefined) {
      selection.reasoningEffortOverride = override.reasoningEffortOverride;
    } else if (session.reasoningEffortOverride !== undefined) {
      selection.reasoningEffortOverride = session.reasoningEffortOverride;
    }

    return selection;
  }

  /**
   * 解析显式 skill 调用的展示状态；每个明确 override 字段覆盖对应 session 字段。
   */
  resolveSkillOverrideStatusLineModelState(override: AgentModelSelectionOverride): StatusLineModelState {
    this.refreshModelState();
    const requestedProfile = override.modelProfileIdOverride
      ? this.models.find((model) => model.id === override.modelProfileIdOverride)
      : this.getSelectedModel();
    const fallback = this.getSelectedModel();
    const selected = requestedProfile || fallback;
    const effort = override.reasoningEffortOverride ?? this.reasoningEffortOverride ?? selected?.reasoningEffort;

    return {
      modelLabel: selected?.model || selected?.id || this.modelLabel,
      ...(effort !== undefined ? {reasoningEffort: effort} : {}),
      ...(requestedProfile && override.modelProfileIdOverride || override.reasoningEffortOverride !== undefined ? {skillOverride: true} : {})
    };
  }

  /**
   * 读取 /model 候选并把当前 session effort 投影到选中 profile。
   */
  createModelCommandInfo(): ModelCommandInfoResult {
    this.refreshModelState();

    if (this.modelConfigError) {
      return {error: this.modelConfigError};
    }

    return {
      models: this.models.map((model) => model.id === this.selectedModelId && this.reasoningEffortOverride !== undefined
        ? {...model, reasoningEffort: this.reasoningEffortOverride}
        : {...model}),
      selectedIndex: this.models.findIndex((model) => model.id === this.selectedModelId)
    };
  }

  /**
   * 读取 `/status` 当前 session 对应的 adapter、model 与 provider，不返回凭据。
   */
  createStatusInfo(): ModelStatusInfoResult {
    try {
      this.refreshModelState();
      const selected = this.getSelectedModel();

      if (!selected || !this.selectedModelId) {
        return {error: this.modelConfigError || 'LLM 配置缺少 models'};
      }

      const config = readLlmConfig({
        modelProfileId: this.selectedModelId,
        ...(this.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: this.reasoningEffortOverride} : {})
      });
      return {
        agentType: config.agentType,
        model: selected.model || selected.id,
        provider: selected.provider
      };
    } catch (error: unknown) {
      return {error: sanitizeModelConfigError(error, '无法读取当前模型配置')};
    }
  }

  /**
   * 读取 /effort 候选，优先使用当前 session override，否则使用 profile 默认或 medium。
   */
  createEffortCommandInfo(): EffortCommandInfoResult {
    this.refreshModelState();

    if (this.modelConfigError) {
      return {error: this.modelConfigError};
    }

    const selected = this.getSelectedModel();
    if (!selected) {
      return {error: 'LLM 配置缺少 models'};
    }

    const effort = this.reasoningEffortOverride ?? selected.reasoningEffort ?? 'medium';
    return {
      currentModelLabel: selected.model || selected.id,
      efforts: [...REASONING_EFFORTS],
      selectedIndex: REASONING_EFFORTS.indexOf(effort)
    };
  }

  /**
   * 更新当前 session model 并清除旧 effort override；不改写用户级默认配置。
   */
  selectModel(modelId: string): SelectModelResult {
    return this.commitSelection(modelId, undefined);
  }

  /**
   * 更新当前 session 的显式 effort override；包括 `none` 在内均作为明确值保存。
   */
  selectEffort(effort: ReasoningEffort): SelectEffortResult {
    if (!this.selectedModelId) {
      return {ok: false, error: 'LLM 配置缺少 models'};
    }

    return this.commitSelection(this.selectedModelId, effort);
  }

  /**
   * 一次性保存 composer tuning 的当前 session model 与显式 effort。
   */
  selectModelAndEffort(modelId: string, effort: ReasoningEffort): SelectModelAndEffortResult {
    const previousModelId = this.selectedModelId;
    const result = this.commitSelection(modelId, effort);
    return result.ok
      ? {ok: true, modelChanged: previousModelId !== modelId}
      : result;
  }

  /**
   * 恢复指定持久化 session 的 sidecar；缺失、损坏或失效时直接保留全局默认。
   */
  restoreSession(sessionId: string): void {
    this.selectedModelId = undefined;
    this.reasoningEffortOverride = undefined;
    this.sessionSettingsDirty = true;
    this.refreshModelState();

    if (!this.settingsStore) {
      return;
    }

    const result = this.settingsStore.read(this.getCurrentCwd(), sessionId);
    if (result.kind !== 'found') {
      return;
    }

    if (!this.models.some((model) => model.id === result.settings.modelProfileId)) {
      return;
    }

    this.selectedModelId = result.settings.modelProfileId;
    this.reasoningEffortOverride = result.settings.reasoningEffortOverride;
    this.sessionSettingsDirty = false;
    this.applyEffectiveModelState();
  }

  /**
   * 清除当前 session 绑定并从此刻用户级默认重新初始化新会话草稿。
   */
  resetSessionToGlobalDefaults(): void {
    this.selectedModelId = undefined;
    this.reasoningEffortOverride = undefined;
    this.sessionSettingsDirty = true;
    this.refreshModelState();
  }

  /**
   * 在 journal 已创建后尽力同步当前 session settings；失败只保留内存选择并留待后续重试。
   */
  persistCurrentSessionSettings(): void {
    const sessionId = this.getCurrentSessionId();
    if (!this.sessionSettingsDirty || !sessionId || !this.settingsStore || !this.selectedModelId) {
      return;
    }

    try {
      this.settingsStore.write(this.getCurrentCwd(), {
        sessionId,
        modelProfileId: this.selectedModelId,
        ...(this.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: this.reasoningEffortOverride} : {})
      });
      this.sessionSettingsDirty = false;
    } catch {
      // Sidecar 仅用于恢复；写入失败不阻塞后续provider请求
    }
  }

  /**
   * 将当前内存选择重新绑定到刚创建的 session；即使源 session 已同步也强制尝试新 sidecar。
   */
  rebindCurrentSelectionToSession(): void {
    this.sessionSettingsDirty = true;
    this.persistCurrentSessionSettings();
  }

  private commitSelection(modelId: string, effort: ReasoningEffort | undefined): SelectModelResult {
    this.refreshModelState();

    if (this.modelConfigError || this.models.length === 0) {
      return {ok: false, error: this.modelConfigError || 'LLM 配置缺少 models'};
    }

    if (!this.models.some((model) => model.id === modelId)) {
      return {ok: false, error: `无法选择不存在的模型：${modelId}`};
    }

    this.selectedModelId = modelId;
    this.reasoningEffortOverride = effort;
    this.sessionSettingsDirty = true;
    this.applyEffectiveModelState();
    this.persistCurrentSessionSettings();
    return {ok: true};
  }

  private getSelectedModel(): ModelCommandProfile | undefined {
    return this.models.find((model) => model.id === this.selectedModelId);
  }

  private applyEffectiveModelState(rawModels: ModelStateFingerprintProfile[] = []): void {
    const selected = this.getSelectedModel();
    if (!selected) {
      this.applyUnavailableModelState('LLM 配置缺少 models');
      return;
    }

    const raw = rawModels.find((model) => model.id === selected.id);
    const effort = this.reasoningEffortOverride ?? selected.reasoningEffort;
    this.modelConfigError = undefined;
    this.modelLabel = selected.model || selected.id || 'model unavailable';
    this.modelStateFingerprint = JSON.stringify({
      id: selected.id,
      model: selected.model,
      provider: selected.provider,
      reasoningEffort: effort,
      contextWindow: raw?.contextWindow
    });
  }

  private applyUnavailableModelState(error?: string): void {
    this.modelConfigError = error;
    this.modelStateFingerprint = `unavailable:${error || ''}`;
    this.modelLabel = 'model unavailable';
    this.models = [];
    this.selectedModelId = undefined;
    this.reasoningEffortOverride = undefined;
  }
}

export {
  ModelContext
};

export type {
  AgentModelSelection,
  AgentModelSelectionOverride,
  EffortCommandInfo,
  EffortCommandInfoResult,
  ModelCommandInfo,
  ModelCommandInfoResult,
  ModelCommandProfile,
  ModelContextOptions,
  ModelStatusInfo,
  ModelStatusInfoResult,
  SelectEffortResult,
  SelectModelAndEffortResult,
  SelectModelResult
};
