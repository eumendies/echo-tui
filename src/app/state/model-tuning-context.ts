import {REASONING_EFFORTS} from '../../types/agent';

import type {ReasoningEffort} from '../../types/agent';
import type {ModelCommandInfoResult, ModelCommandProfile} from './model-context';

type ModelTuningActiveField = 'model' | 'effort';

type ModelTuningState = {
  activeField: ModelTuningActiveField;
  effort: ReasoningEffort;
  error?: string;
  models: ModelCommandProfile[];
  originalModelId: string;
  selectedIndex: number;
};

type ModelTuningSelection = {
  effort: ReasoningEffort;
  modelId: string;
  originalModelId: string;
};

type ModelTuningRenderSnapshot = {
  activeField: ModelTuningActiveField;
  effort: ReasoningEffort;
  error?: string;
  modelLabel: string;
};

const DEFAULT_MODEL_TUNING_EFFORT: ReasoningEffort = 'medium';
const MODEL_TUNING_EFFORTS: readonly ReasoningEffort[] = REASONING_EFFORTS;

/**
 * 管理 composer model/effort 调节的实例级草稿；只有外层确认流程会写用户配置。
 */
class ModelTuningContext {
  private state: ModelTuningState | null = null;

  /**
   * 从当前 ModelContext 快照启动调节；配置不可用时保持关闭并返回 false。
   */
  open(info: ModelCommandInfoResult): boolean {
    if (!('models' in info) || info.models.length === 0) {
      return false;
    }

    const selectedIndex = info.models[info.selectedIndex] ? info.selectedIndex : 0;
    const selectedModel = info.models[selectedIndex];
    this.state = {
      activeField: 'model',
      effort: selectedModel.reasoningEffort ?? DEFAULT_MODEL_TUNING_EFFORT,
      models: info.models.map((model) => ({...model})),
      originalModelId: selectedModel.id,
      selectedIndex
    };
    return true;
  }

  /**
   * 返回当前实例是否正在调节，不读取模型配置或 composer。
   */
  isActive(): boolean {
    return this.state !== null;
  }

  /**
   * 丢弃全部暂存选择；composer 草稿由 ComposerContext 独立持有，不参与此操作。
   */
  cancel(): void {
    this.state = null;
  }

  /**
   * 在 model 与 effort 字段之间切换焦点，并清除上一次保存错误。
   */
  toggleField(): void {
    if (!this.state) {
      return;
    }

    this.state.activeField = this.state.activeField === 'model' ? 'effort' : 'model';
    this.state.error = undefined;
  }

  /**
   * 首尾循环活动字段；未配置 effort 的 profile 使用与 /effort 一致的 medium 起点。
   */
  cycle(direction: number): void {
    if (!this.state || direction === 0) {
      return;
    }

    this.state.error = undefined;

    if (this.state.activeField === 'model') {
      const nextIndex = wrapIndex(this.state.selectedIndex + Math.sign(direction), this.state.models.length);
      const nextModel = this.state.models[nextIndex];
      this.state.selectedIndex = nextIndex;
      this.state.effort = nextModel.reasoningEffort ?? DEFAULT_MODEL_TUNING_EFFORT;
      return;
    }

    const currentIndex = MODEL_TUNING_EFFORTS.indexOf(this.state.effort);
    const nextIndex = wrapIndex(currentIndex + Math.sign(direction), MODEL_TUNING_EFFORTS.length);
    this.state.effort = MODEL_TUNING_EFFORTS[nextIndex];
  }

  /**
   * 保存脱敏错误摘要供 footer 展示，保持当前候选可继续重试。
   */
  setError(error: string): void {
    if (this.state) {
      this.state.error = error;
    }
  }

  /**
   * 返回确认写入所需的暂存选择；调用方不可借此修改内部候选状态。
   */
  getSelection(): ModelTuningSelection | null {
    if (!this.state) {
      return null;
    }

    const model = this.state.models[this.state.selectedIndex];
    return model ? {
      effort: this.state.effort,
      modelId: model.id,
      originalModelId: this.state.originalModelId
    } : null;
  }

  /**
   * 返回 footer 可直接投影的不可变快照。
   */
  getRenderState(): ModelTuningRenderSnapshot | null {
    if (!this.state) {
      return null;
    }

    const model = this.state.models[this.state.selectedIndex];

    if (!model) {
      return null;
    }

    return {
      activeField: this.state.activeField,
      effort: this.state.effort,
      modelLabel: model.model || model.id,
      ...(this.state.error ? {error: this.state.error} : {})
    };
  }
}

/**
 * 将任意整数索引收敛到首尾循环区间，空候选固定返回零。
 */
function wrapIndex(index: number, count: number): number {
  return count > 0 ? (index + count) % count : 0;
}

export {
  ModelTuningContext
};
