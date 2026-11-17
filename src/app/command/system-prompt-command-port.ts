import {loadAgentInstructions} from '../../agent/agent-instructions';
import {resolveMemoryPrompt} from '../../agent/context/memory-prompt';
import {deleteSystemPromptOverride, formatRuntimeEnvironmentPrompt, resolveSystemPromptSnapshot, writeSystemPromptOverride} from '../../agent/context/system-prompt';
import {estimateTextTokens} from '../../agent/context/token-estimator';
import {DEFAULT_APP_SETTINGS} from '../../config/app-settings-config';
import {resolveContextWindow} from '../../config/llm-config';
import {createSandboxRuntimeNote} from '../../sandbox/provider';
import {createSkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import {createSkillManager} from '../../skills/skill-manager';

import type {AppSettings} from '../../config/app-settings-config';
import type {UserConfigContext} from '../../config/user-config-context';
import type {AgentInstructionFileName, LlmConfig} from '../../types/agent';
import type {CommandHostApp, SystemPromptDynamicSection} from '../../types/command';
import type {AppContext} from '../state/app-context';

type SystemPromptPortContext = Pick<AppContext, 'clearContextUsage' | 'getCurrentCwd'>;

type SystemPromptCommandPortOptions = {
  appContext: SystemPromptPortContext; // 共享 cwd 与 context usage 失效入口。
  userConfigContext: UserConfigContext; // 只读配置 snapshot，用于动态段与默认比例口径。
};

type DynamicSectionProjection = {
  detail: string; // 该段来源摘要。
  estimatedTokens?: number; // 估算 token；无法估算时省略。
};

type DynamicSectionOptions = {
  cwd: string; // 当前工作目录，动态段同源。
  userConfigContext: UserConfigContext; // 读取设置与模型配置的只读入口。
};

/**
 * 创建系统提示词文件端口：快照读取、原子写入与删除都经 agent 层同一份文件契约。
 */
function createSystemPromptCommandPort(options: SystemPromptCommandPortOptions): Pick<CommandHostApp['config'], 'deleteSystemPrompt' | 'readSystemPrompt' | 'saveSystemPrompt'> {
  const {appContext, userConfigContext} = options;
  const cwd = () => appContext.getCurrentCwd();

  return {
    readSystemPrompt(options = {}) {
      try {
        return {
          ok: true,
          snapshot: resolveSystemPromptSnapshot({cwd: cwd()}),
          // 动态段要扫 skills/instructions/memory，只在进入视图时按需计算。
          ...(options.includeDynamicSections ? {dynamicSections: createDynamicSections({cwd: cwd(), userConfigContext})} : {})
        };
      } catch (error: unknown) {
        return {ok: false, error: toErrorMessage(error)};
      }
    },
    saveSystemPrompt(target, content) {
      try {
        const result = writeSystemPromptOverride({content, cwd: cwd(), target});

        if (!result.ok) {
          return {ok: false, error: result.error};
        }

        // 基础文本变化会改变 system record 体积，陈旧 context usage 不再可信。
        if (!result.unchanged) {
          appContext.clearContextUsage();
        }

        return {
          ok: true,
          filePath: result.filePath,
          overwritten: result.overwritten,
          unchanged: result.unchanged
        };
      } catch (error: unknown) {
        return {ok: false, error: toErrorMessage(error)};
      }
    },
    deleteSystemPrompt(target) {
      try {
        const result = deleteSystemPromptOverride({cwd: cwd(), target});

        if (!result.ok) {
          return {ok: false, error: result.error};
        }

        // ENOENT 也返回成功；只有真的删掉文件才让 context usage 失效。
        if (result.removed) {
          appContext.clearContextUsage();
        }

        return {filePath: result.filePath, ok: true};
      } catch (error: unknown) {
        return {ok: false, error: toErrorMessage(error)};
      }
    }
  };
}

/**
 * 组装动态段摘要：只统计来源与 token，不重建完整 system prompt 全文。
 * 每段独立降级，单段读取失败不得影响其它段或快照主体。
 */
function createDynamicSections(options: DynamicSectionOptions): SystemPromptDynamicSection[] {
  const settings = captureAppSettings(options.userConfigContext);
  const config = captureLlmConfig(options.userConfigContext);
  const contextWindow = config ? resolveContextWindow(config) : resolveContextWindow({model: ''});
  const fileName: AgentInstructionFileName = settings?.agentInstructionFileName ?? DEFAULT_APP_SETTINGS.agentInstructionFileName;

  return [
    createDynamicSection('Runtime environment', () => {
      const sandboxNote = config ? createSandboxRuntimeNote(config.tools.sandbox, {kind: 'interactive'}) : null;
      // 与真实 system prompt 复用同一段构造，避免文案漂移。
      const text = formatRuntimeEnvironmentPrompt({cwd: options.cwd, ...(sandboxNote ? {sandboxNote} : {})});

      return {detail: sandboxNote ? 'cwd + 沙箱说明' : 'cwd', estimatedTokens: estimateTextTokens(text)};
    }),
    createDynamicSection(`${fileName} instructions`, () => {
      const instructions = loadAgentInstructions({cwd: options.cwd, fileName});

      if (instructions.length === 0) {
        return {detail: '未发现'};
      }

      return {
        detail: `${instructions.length} 个文件`,
        estimatedTokens: estimateTextTokens(instructions.map((instruction) => instruction.content).join('\n\n'))
      };
    }),
    createDynamicSection('Available Skills', () => {
      if (!config) {
        return {detail: '模型配置不可读'};
      }

      const catalog = createSkillManager({cwd: options.cwd}).listCatalog();
      const ratio = settings?.skillCatalogContextRatio ?? DEFAULT_APP_SETTINGS.skillCatalogContextRatio;
      const projection = createSkillCatalogPromptProjection(catalog, contextWindow, ratio);

      return {detail: `${catalog.length} 个已启用`, estimatedTokens: projection.estimatedTokens};
    }),
    createDynamicSection('Memory', () => {
      const memory = resolveMemoryPrompt(options.cwd, contextWindow);

      return {
        detail: `user ${memory.userMemoryCount} 条 · agent ${memory.agentMemory.itemCount} 项`,
        estimatedTokens: memory.estimatedTokens
      };
    })
  ];
}

/**
 * 计算单个动态段；抛错时降级为“无法解析”而不是中断整个快照。
 */
function createDynamicSection(label: string, compute: () => DynamicSectionProjection): SystemPromptDynamicSection {
  try {
    const projection = compute();
    return {
      detail: projection.detail,
      label,
      ...(projection.estimatedTokens !== undefined ? {estimatedTokens: projection.estimatedTokens} : {})
    };
  } catch {
    return {detail: '无法解析', label};
  }
}

// 配置读取统一经 UserConfigContext snapshot，不在 command 层直接读盘。
function captureAppSettings(context: UserConfigContext): AppSettings | null {
  try {
    return context.capture().getAppSettings();
  } catch {
    return null;
  }
}

function captureLlmConfig(context: UserConfigContext): LlmConfig | null {
  try {
    return context.capture().resolveLlmConfig();
  } catch {
    return null;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  createSystemPromptCommandPort
};

export type {
  SystemPromptCommandPortOptions
};
