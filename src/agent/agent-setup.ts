import {createMcpToolRegistry, mergeToolRegistries} from '../mcp/tool-adapter';
import {createDefaultToolRegistry, createToolRegistry} from '../tools/tool-registry';
import {normalizeDisabledTools} from '../config/main-agent-tools-config';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {createAnthropicAgent} from './anthropic/agent';
import {createCodexAgent} from './codex/agent';
import {createFakeAgent} from './fake/agent';
import {createOpenAiChatAgent} from './openai-chat/agent';
import {createOpenAiAgent} from './openai-responses/agent';

import type {AgentExecutionMode, AgentUserConfigSnapshot, LlmConfig, ProviderAgent, ReasoningEffort, SubagentToolPort} from '../types/agent';
import type {McpManager} from '../mcp/manager';
import type {SandboxModeOverride} from '../sandbox/types';
import type {SkillRegistry} from '../types/skill';
import type {ToolRegistry} from '../types/tool';
import type {MainAgentToolsConfig} from '../config/main-agent-tools-config';

type PrepareAgentOptions = {
  config?: LlmConfig; // 调用方已经解析完成的 provider/tool 配置。
  configSnapshot?: AgentUserConfigSnapshot; // 未直接传 config 时用于同 revision 解析配置的快照。
  cwd?: string | (() => string); // 本地工具解析相对路径时使用的当前工作目录。
  executionMode?: AgentExecutionMode; // 本次运行执行模式;headless full-access 时 bash 工具强制关闭沙箱。
  sandboxModeOverride?: SandboxModeOverride; // 本次运行的沙箱收紧;只读 workflow 用它强制 bash 走 read-only 档。
  includeMcpTools?: boolean; // 是否合并共享 manager 的 MCP tools；缺省 true，资源读取工具不受该开关影响。
  mcpManager?: McpManager; // 可选共享 MCP 连接目录，不由本函数管理生命周期。
  mainAgentTools?: MainAgentToolsConfig; // 存在时明确表示主运行：合并 MCP 后应用禁用名单，不影响子运行白名单。
  modelProfileId?: string; // 从 snapshot 解析本次 provider 时使用的模型 profile。
  reasoningEffortOverride?: ReasoningEffort; // 仅本次准备生效的推理强度覆盖。
  skillRegistry?: SkillRegistry; // 注入运行级 Skill 快照 scope；缺省时由默认装配重新创建 SkillManager。
  allowedToolNames?: ReadonlySet<string>; // 存在时 registry 只保留该运行明确允许的本地工具。
  sessionId?: string; // 当前会话稳定身份；preset 声明 sessionHeader 时用它注入会话亲和 header。
  subagentPort?: SubagentToolPort; // 仅允许委派的父 run 注入的同步子运行端口。
};

type PreparedAgent = {
  agent: ProviderAgent; // 已绑定本次 registry 的 provider adapter。
  config: LlmConfig; // 本次运行固定使用的已解析配置。
  registry: ToolRegistry; // provider schema 与本地 executor 共享的真实工具目录。
};

function createConfiguredAgent(config: LlmConfig, registry?: ToolRegistry): ProviderAgent {
  switch (config.agentType) {
    case 'fake':
      return createFakeAgent();
    case 'openai':
      return createOpenAiAgent(config, registry);
    case 'openai-chat':
      return createOpenAiChatAgent(config, registry);
    case 'anthropic':
      return createAnthropicAgent(config, registry);
    case 'codex':
      return createCodexAgent(config, registry);
  }
}

/**
 * 按 preset 声明注入会话亲和 header；运行时会话值优先于同名静态 header。
 * 缺会话身份时刻意不伪造值，让缺失在 provider 侧显式暴露而不是漂移成假会话。
 */
function withSessionHeader(config: LlmConfig, sessionId?: string): LlmConfig {
  if (!config.sessionHeader || !sessionId) {
    return config;
  }

  return {
    ...config,
    headers: {
      ...(config.headers || {}),
      [config.sessionHeader]: sessionId
    }
  };
}

/**
 * 使用调用方捕获的运行配置构建完整工具 registry 并初始化 provider 实例。
 * MCP manager 的连接生命周期由调用方管理；这里只消费其已发现的工具。
 */
function prepareAgent(options: PrepareAgentOptions): PreparedAgent {
  const resolvedConfig = options.config || options.configSnapshot?.resolveLlmConfig({
    modelProfileId: options.modelProfileId,
    ...(options.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: options.reasoningEffortOverride} : {})
  });
  if (!resolvedConfig) {
    throw new Error('prepareAgent 缺少用户配置 snapshot');
  }
  const config = withSessionHeader(resolvedConfig, options.sessionId);
  const toolResultStore = createToolResultStore({cwd: options.cwd});
  const baseRegistry = createDefaultToolRegistry(config, options.cwd, toolResultStore, {
    allowedToolNames: options.allowedToolNames,
    executionMode: options.executionMode,
    ...(options.mcpManager ? {mcpManager: options.mcpManager} : {}),
    // 引导在安全边界更新运行模式；handler 执行时读取最新派生收紧，不重建固定工具目录。
    get sandboxModeOverride() { return options.sandboxModeOverride; },
    ...(options.skillRegistry ? {skillRegistry: options.skillRegistry} : {}),
    subagentPort: options.subagentPort
  });
  const mergedRegistry = options.mcpManager && options.includeMcpTools !== false
    ? mergeToolRegistries(baseRegistry, createMcpToolRegistry(options.mcpManager, toolResultStore))
    : baseRegistry;
  // 工具偏好只在显式主入口应用；子运行继续沿用自身 allowlist。
  // 每次装配复制为固定集合，后续配置刷新或名单数组变化不影响当前 continuation。
  const disabledTools = options.mainAgentTools
    ? new Set(normalizeDisabledTools(options.mainAgentTools.disabledTools))
    : undefined;
  const registry: ToolRegistry = disabledTools
    ? {
        ...createToolRegistry(mergedRegistry.listDefinitions()
          .filter(({name}) => !disabledTools.has(name))
          .map(({name}) => mergedRegistry.getHandler(name)!)),
        listSkillCatalog: mergedRegistry.listSkillCatalog
      }
    : mergedRegistry;
  const agent = createConfiguredAgent(config, registry);

  return {agent, config, registry};
}

export {createConfiguredAgent, prepareAgent};

export type {PrepareAgentOptions, PreparedAgent};
