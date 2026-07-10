import fs from 'node:fs';
import path from 'node:path';

import {
  getDefaultConfigPath,
  readLlmModelConfigInfo
} from '../../config/llm-config';
import {redactSensitiveText} from '../../agent/agent-errors';
import {REASONING_EFFORTS} from '../../types/agent';
import type {LlmModelConfigInfo} from '../../config/llm-config';
import type {ReasoningEffort} from '../../types/agent';

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

/**
 * 管理 /model 命令需要的模型信息读取与脱敏。
 */
class ModelContext {
  /**
   * 读取当前模型配置并转换成 /model 命令需要的最小信息。
   */
  getModelInfo(): ModelCommandInfo {
    const info = readLlmModelConfigInfo();

    return normalizeModelInfo(info);
  }

  /**
   * 读取 /model 命令需要展示的当前模型信息；失败时返回可直接展示的错误摘要。
   */
  createModelCommandInfo(): ModelCommandInfoResult {
    try {
      const info = this.getModelInfo();

      return {
        models: info.models.map((model) => ({ ...model })),
        selectedIndex: info.selectedIndex
      };
    } catch (error: unknown) {
      return {
        error: error instanceof Error && typeof error.message === 'string'
          ? redactSensitiveText(error.message)
          : '无法读取当前模型配置'
      };
    }
  }

  /**
   * 读取 /effort 命令需要展示的当前模型推理等级信息；失败时返回可直接展示的错误摘要。
   */
  createEffortCommandInfo(): EffortCommandInfoResult {
    try {
      const info = this.getModelInfo();
      const selectedModel = info.models[info.selectedIndex] || info.models[0];

      if (!selectedModel) {
        throw new Error('LLM 配置缺少 models');
      }

      const selectedEffortIndex = selectedModel.reasoningEffort
        ? REASONING_EFFORTS.indexOf(selectedModel.reasoningEffort)
        : REASONING_EFFORTS.indexOf('medium');

      return {
        currentModelLabel: selectedModel.model || selectedModel.id,
        efforts: [...REASONING_EFFORTS],
        selectedIndex: selectedEffortIndex >= 0 ? selectedEffortIndex : REASONING_EFFORTS.indexOf('medium')
      };
    } catch (error: unknown) {
      return {
        error: error instanceof Error && typeof error.message === 'string'
          ? redactSensitiveText(error.message)
          : '无法读取当前推理等级配置'
      };
    }
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
      const rawConfig = fs.readFileSync(targetPath, 'utf8');
      let parsedConfig: unknown;

      try {
        parsedConfig = JSON.parse(rawConfig);
      } catch {
        throw new Error(`LLM 配置文件不是有效 JSON：${targetPath}`);
      }

      if (!isJsonObject(parsedConfig) || !isJsonObject(parsedConfig.llm)) {
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

      const tempPath = createTempConfigPath(targetPath);
      fs.mkdirSync(path.dirname(targetPath), {recursive: true});
      fs.writeFileSync(tempPath, `${JSON.stringify(parsedConfig, null, 2)}\n`);
      fs.renameSync(tempPath, targetPath);

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
    const rawConfig = fs.readFileSync(targetPath, 'utf8');
    let parsedConfig: unknown;

    try {
      parsedConfig = JSON.parse(rawConfig);
    } catch {
      throw new Error(`LLM 配置文件不是有效 JSON：${targetPath}`);
    }

    if (!isJsonObject(parsedConfig) || !isJsonObject(parsedConfig.llm)) {
      throw new Error('LLM 配置 llm 必须是对象');
    }

    const info = readLlmModelConfigInfo();

    if (!info.models.some((profile) => profile.id === modelId)) {
      throw new Error(`无法选择不存在的模型：${modelId}`);
    }

    parsedConfig.llm.selectedModel = modelId;

    const tempPath = createTempConfigPath(targetPath);
    fs.mkdirSync(path.dirname(targetPath), {recursive: true});
    fs.writeFileSync(tempPath, `${JSON.stringify(parsedConfig, null, 2)}\n`);
    fs.renameSync(tempPath, targetPath);
  }
}

function createTempConfigPath(targetPath: string): string {
  return `${targetPath}.tmp-${process.pid}-${Date.now()}`;
}

export {
  ModelContext
};

export type {
  ModelCommandInfo,
  ModelCommandInfoResult,
  ModelCommandProfile,
  EffortCommandInfo,
  EffortCommandInfoResult,
  SelectEffortResult,
  SelectModelResult
};
