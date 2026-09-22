import {resolveContextWindow} from '../../config/llm-config';
import {loadAgentInstructions} from '../agent-instructions';
import {createBuiltInSystemPrompt, loadSystemPromptOverride} from './system-prompt';
import {createSkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import {createSandboxRuntimeNote} from '../../sandbox/provider';

import type {AgentExecutionMode, AgentInstruction, AgentInstructionFileName, LlmConfig} from '../../types/agent';
import type {SandboxModeOverride} from '../../sandbox/types';
import type {SkillCatalogEntry} from '../../types/skill';
import type {SkillCatalogPromptProjection} from '../../skills/skill-catalog-prompt';
import type {ToolRegistry} from '../../types/tool';
import type {CompactionState, TranscriptRecord} from '../../types/transcript';

// 本模块只把「一次 provider 请求真正要发送的前导与材料」解析成纯数据，
// 供主/子 agent loop 与手动压缩路径共用同源口径，不持有运行状态或 provider 分支。
type RuntimeMaterials = {
  contextWindow: number; // 本次运行生效模型的上下文窗口；skill 预算与压缩估算同源。
  sandboxNote?: string; // bash 沙箱生效时的边界说明；缺省表示本次运行未包装沙箱。
  skillCatalog: SkillCatalogEntry[]; // 本次请求可见的有界 enabled skill 目录。
  skillCatalogProjection: Pick<SkillCatalogPromptProjection, 'budgetTokens' | 'mode' | 'originalTokens'>; // 调试使用的 skill 预算事实。
  skillCatalogTokens: number; // 当前 skill 目录投影的估算 token 数。
};

type ProviderPromptMaterials = RuntimeMaterials & {
  agentInstructions: AgentInstruction[]; // 当前 cwd 适用且已按层级排序的项目/用户指令链。
  basePrompt?: string; // 用户 system prompt override；缺省使用内置主 prompt。
};

type ResolveRuntimeMaterialsOptions = {
  config: LlmConfig; // 已解析的最终生效 provider 配置。
  executionMode: AgentExecutionMode; // 决定沙箱豁免档位的执行模式。
  registry: ToolRegistry; // skill 目录投影的事实来源。
  sandboxModeOverride?: SandboxModeOverride; // 运行级沙箱收紧；仅配置非 off 时把生效档位收紧为 read-only。
  skillCatalogContextRatio: number; // skill 目录 prompt 可占模型窗口的比例。
};

type ResolveProviderPromptMaterialsOptions = ResolveRuntimeMaterialsOptions & {
  agentInstructionFileName: AgentInstructionFileName; // 本回合加载项目指令时使用的文件名。
  cwd: string; // 运行工作目录；用于加载 system prompt override 与项目指令链。
};

type ProviderRequestPrefixOptions = {
  agentInstructions?: AgentInstruction[]; // 当前 cwd 适用且已按层级排序的项目指令。
  basePrompt?: string; // 用户 system prompt override；缺省使用内置主 prompt。
  compaction?: CompactionState; // 压缩状态；摘要非空时作为原位 user 记录随前导发送。
  cwd: string; // 注入 runtime environment 的工作目录。
  memoryPrompts?: string[]; // 当前请求动态解析的 user/agent memory sections。
  rolePrompt?: string; // 子 Agent 等隔离运行追加的明确角色边界 section。
  sandboxNote?: string; // bash 沙箱生效时的边界说明；缺省表示本次未包装沙箱。
  sessionJournalPath?: string; // 会话 journal 路径；压缩摘要附带完整历史回读提示。
  skillCatalog?: SkillCatalogEntry[]; // 当前 revision 的有界 enabled skill 目录。
};

/**
 * 解析运行派生材料：模型窗口、skill 目录投影与沙箱边界说明。
 * 主运行、子运行与手动压缩传入各自最终生效的配置与 registry，保证前导材料与同一请求的工具目录、窗口预算同源。
 */
function resolveRuntimeMaterials(options: ResolveRuntimeMaterialsOptions): RuntimeMaterials {
  const {config, executionMode, registry, sandboxModeOverride, skillCatalogContextRatio} = options;
  const contextWindow = resolveContextWindow(config);
  const skillCatalogProjection = createSkillCatalogPromptProjection(registry.listSkillCatalog?.() || [], contextWindow, skillCatalogContextRatio);
  const sandboxResolutionOptions = sandboxModeOverride ? {modeOverride: sandboxModeOverride} : {};
  const sandboxNote = createSandboxRuntimeNote(config.tools.sandbox, executionMode, sandboxResolutionOptions);

  return {
    contextWindow,
    ...(sandboxNote ? {sandboxNote} : {}),
    skillCatalog: skillCatalogProjection.catalog,
    skillCatalogTokens: skillCatalogProjection.estimatedTokens,
    skillCatalogProjection: {
      budgetTokens: skillCatalogProjection.budgetTokens,
      mode: skillCatalogProjection.mode,
      originalTokens: skillCatalogProjection.originalTokens
    }
  };
}

/**
 * 解析普通请求与压缩摘要请求共用的 prompt 材料：运行派生材料叠加磁盘加载的指令链与 system prompt override。
 * 子运行不调用本函数：它继承父运行冻结的指令链与 override，只用 resolveRuntimeMaterials 解析自身窗口与 skill scope。
 */
function resolveProviderPromptMaterials(options: ResolveProviderPromptMaterialsOptions): ProviderPromptMaterials {
  const {agentInstructionFileName, cwd} = options;
  const basePrompt = loadSystemPromptOverride({cwd})?.content;

  return {
    ...resolveRuntimeMaterials(options),
    ...(basePrompt ? {basePrompt} : {}),
    agentInstructions: loadAgentInstructions({cwd, fileName: agentInstructionFileName})
  };
}

/**
 * 构造 provider 请求前导记录：内置 system prompt，以及存在压缩状态时位置固定的摘要 user 记录。
 * 材料口径一致时，本函数输出与普通请求前导逐字一致，使压缩请求共享同一 token 前缀。
 */
function buildProviderRequestPrefix(options: ProviderRequestPrefixOptions): TranscriptRecord[] {
  const {agentInstructions = [], basePrompt, compaction, cwd, memoryPrompts = [], rolePrompt, sandboxNote, sessionJournalPath, skillCatalog = []} = options;
  const prefix: TranscriptRecord[] = [{
    role: 'system',
    text: createBuiltInSystemPrompt({agentInstructions, basePrompt, cwd, ...(sandboxNote ? {sandboxNote} : {}), skillCatalog, memoryPrompts, rolePrompt})
  }];

  if (compaction && compaction.summaryText.trim() !== '') {
    const summaryText = `Here is a structured summary of the earlier conversation:\n${compaction.summaryText}`;
    prefix.push({
      role: 'user',
      text: sessionJournalPath
        ? [
            summaryText,
            '',
            `The full original history is preserved in source_file: ${sessionJournalPath}`,
            'If exact details are needed, use the existing read_files tool to read source_file with pagination.',
            'source_file is an append-only JSONL journal; later truncate or set operations can supersede earlier entries.'
          ].join('\n')
        : summaryText
    });
  }

  return prefix;
}

export {
  buildProviderRequestPrefix,
  resolveProviderPromptMaterials,
  resolveRuntimeMaterials
};

export type {
  ProviderPromptMaterials,
  ProviderRequestPrefixOptions,
  ResolveProviderPromptMaterialsOptions,
  ResolveRuntimeMaterialsOptions,
  RuntimeMaterials
};
