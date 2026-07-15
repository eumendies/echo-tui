import {
  getDefaultConfigPath,
  readLlmConfig,
  readLlmModelConfigInfo
} from '../../config/llm-config';
import {JsonConfigFile} from '../../config/json-config-file';
import {redactSensitiveText} from '../../agent/agent-errors';
import {REASONING_EFFORTS} from '../../types/agent';
import type {LlmModelConfigInfo} from '../../config/llm-config';
import type {ReasoningEffort} from '../../types/agent';
import type {AgentType} from '../../types/agent';
import type {StatusLineModelState} from '../../types/render';

type ModelCommandProfile = {
  id: string;
  model: string;
  provider: string;
  reasoningEffort?: ReasoningEffort;
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

type ModelStatusInfo = {
  agentType: AgentType;
  model: string;
  provider: string;
};

type ModelStatusInfoResult = ModelStatusInfo | {error: string};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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
 * 管理模型选择、推理等级和 status line 所需的非敏感模型状态。
 */
class ModelContext {
  private modelConfigError?: string;
  private modelLabel: string;
  private models: ModelCommandProfile[];
  private reasoningEffort?: ReasoningEffort;
  private selectedIndex: number;

  constructor() {
    this.modelLabel = 'model unavailable';
    this.models = [];
    this.selectedIndex = -1;
    this.refreshModelState();
  }

  /**
   * 读取当前模型配置并转换成 /model 命令需要的最小信息。
   */
  getModelInfo(): ModelCommandInfo {
    const info = readLlmModelConfigInfo();

    return normalizeModelInfo(info);
  }

  /**
   * 从用户配置刷新模型状态缓存；只保存模型命令和 status line 需要的非敏感字段。
   */
  refreshModelState(): void {
    try {
      const modelInfo = normalizeModelInfo(readLlmModelConfigInfo());
      const selectedModel = modelInfo.models[modelInfo.selectedIndex] || modelInfo.models[0];

      if (!selectedModel) {
        this.applyUnavailableModelState('LLM 配置缺少 models');
        return;
      }

      this.modelConfigError = undefined;
      this.modelLabel = selectedModel.model || selectedModel.id || 'model unavailable';
      this.models = modelInfo.models;
      this.reasoningEffort = selectedModel.reasoningEffort;
      this.selectedIndex = modelInfo.selectedIndex;
    } catch (error: unknown) {
      this.applyUnavailableModelState(sanitizeModelConfigError(error, '无法读取当前模型配置'));
    }
  }

  /**
   * 返回 status line 可直接使用的模型状态；该路径只读取内存缓存，不访问用户配置文件。
   */
  getStatusLineModelState(): StatusLineModelState {
    return {
      modelLabel: this.modelLabel,
      ...(this.reasoningEffort ? {reasoningEffort: this.reasoningEffort} : {})
    };
  }

  /**
   * 读取 /model 命令需要展示的当前模型信息；失败时返回可直接展示的错误摘要。
   */
  createModelCommandInfo(): ModelCommandInfoResult {
    this.refreshModelState();

    if (this.modelConfigError) {
      return {
        error: this.modelConfigError
      };
    }

    return {
      models: this.models.map((model) => ({...model})),
      selectedIndex: this.selectedIndex
    };
  }

  /**
   * 读取 `/status` 所需的当前模型、provider id 和 adapter 类型，不返回凭据或 headers。
   */
  createStatusInfo(): ModelStatusInfoResult {
    try {
      const modelInfo = normalizeModelInfo(readLlmModelConfigInfo());
      const selectedModel = modelInfo.models[modelInfo.selectedIndex] || modelInfo.models[0];

      if (!selectedModel) {
        return {error: 'LLM 配置缺少 models'};
      }

      return {
        agentType: readLlmConfig().agentType,
        model: selectedModel.model || selectedModel.id,
        provider: selectedModel.provider
      };
    } catch (error: unknown) {
      return {error: sanitizeModelConfigError(error, '无法读取当前模型配置')};
    }
  }

  /**
   * 读取 /effort 命令需要展示的当前模型推理等级信息；失败时返回可直接展示的错误摘要。
   */
  createEffortCommandInfo(): EffortCommandInfoResult {
    this.refreshModelState();

    if (this.modelConfigError) {
      return {
        error: this.modelConfigError
      };
    }

    const selectedModel = this.models[this.selectedIndex] || this.models[0];

    if (!selectedModel) {
      return {error: 'LLM 配置缺少 models'};
    }

    const selectedEffortIndex = selectedModel.reasoningEffort
      ? REASONING_EFFORTS.indexOf(selectedModel.reasoningEffort)
      : REASONING_EFFORTS.indexOf('medium');

    return {
      currentModelLabel: selectedModel.model || selectedModel.id,
      efforts: [...REASONING_EFFORTS],
      selectedIndex: selectedEffortIndex >= 0 ? selectedEffortIndex : REASONING_EFFORTS.indexOf('medium')
    };
  }

  /**
   * 将 /model 选择的 profile id 持久化到用户级配置文件。
   *
   * @param modelId 模型 profile id
   * @returns 选择结果
   */
  selectModel(modelId: string): SelectModelResult {
    try {
      this.writeSelectedModel(modelId);
      this.refreshModelState();

      return {ok: true};
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error && typeof error.message === 'string'
          ? redactSensitiveText(error.message)
          : '无法保存当前模型选择'
      };
    }
  }

  /**
   * 将 /effort 选择的推理等级写入当前模型 profile。
   *
   * @param effort 推理等级
   * @returns 选择结果
   */
  selectEffort(effort: ReasoningEffort): SelectEffortResult {
    try {
      const targetPath = getDefaultConfigPath();
      const configFile = new JsonConfigFile(targetPath);

      configFile.update((parsedConfig) => {
        if (!isJsonObject(parsedConfig.llm)) {
          throw new Error('LLM 配置 llm 必须是对象');
        }

        const info = readLlmModelConfigInfo();
        const models = parsedConfig.llm.models;

        if (!Array.isArray(models)) {
          throw new Error('LLM 配置缺少 models');
        }

        const selectedModel = models.find((model): model is JsonObject => isJsonObject(model) && model.id === info.selectedModelId);

        if (!selectedModel) {
          throw new Error(`无法更新不存在的模型：${info.selectedModelId}`);
        }

        selectedModel.reasoning = isJsonObject(selectedModel.reasoning) ? {...selectedModel.reasoning, effort} : {effort};
      }, {allowMissing: false});
      this.refreshModelState();

      return {ok: true};
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error && typeof error.message === 'string'
          ? redactSensitiveText(error.message)
          : '无法保存当前推理等级'
      };
    }
  }

  private writeSelectedModel(modelId: string): void {
    const targetPath = getDefaultConfigPath();
    const configFile = new JsonConfigFile(targetPath);

    configFile.update((parsedConfig) => {
      if (!isJsonObject(parsedConfig.llm)) {
        throw new Error('LLM 配置 llm 必须是对象');
      }

      const info = readLlmModelConfigInfo();

      if (!info.models.some((profile) => profile.id === modelId)) {
        throw new Error(`无法选择不存在的模型：${modelId}`);
      }

      parsedConfig.llm.selectedModel = modelId;
    }, {allowMissing: false});
  }

  /**
   * 写入无法使用模型配置时的安全占位状态，避免错误路径残留旧模型字段。
   */
  private applyUnavailableModelState(error?: string): void {
    this.modelConfigError = error;
    this.modelLabel = 'model unavailable';
    this.models = [];
    this.reasoningEffort = undefined;
    this.selectedIndex = -1;
  }
}

export {
  ModelContext
};

export type {
  ModelCommandInfo,
  ModelCommandInfoResult,
  ModelCommandProfile,
  ModelStatusInfo,
  ModelStatusInfoResult,
  EffortCommandInfo,
  EffortCommandInfoResult,
  SelectEffortResult,
  SelectModelResult
};
