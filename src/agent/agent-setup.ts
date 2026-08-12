import {createMcpToolRegistry, mergeToolRegistries} from '../mcp/tool-adapter';
import {createDefaultToolRegistry} from '../tools/tool-registry';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {createAnthropicAgent} from './anthropic/agent';
import {createCodexAgent} from './codex/agent';
import {createFakeAgent} from './fake/agent';
import {createOpenAiChatAgent} from './openai-chat/agent';
import {createOpenAiAgent} from './openai-responses/agent';

import type {AgentUserConfigSnapshot, LlmConfig, ProviderAgent, ReasoningEffort, SubagentToolPort} from '../types/agent';
import type {McpManager} from '../mcp/manager';
import type {ToolRegistry} from '../types/tool';

type PrepareAgentOptions = {
  config?: LlmConfig; // 调用方已经解析完成的 provider/tool 配置。
  configSnapshot?: AgentUserConfigSnapshot; // 未直接传 config 时用于同 revision 解析配置的快照。
  cwd?: string | (() => string); // 本地工具解析相对路径时使用的当前工作目录。
  mcpManager?: McpManager; // 可选共享 MCP 连接目录，不由本函数管理生命周期。
  modelProfileId?: string; // 从 snapshot 解析本次 provider 时使用的模型 profile。
  reasoningEffortOverride?: ReasoningEffort; // 仅本次准备生效的推理强度覆盖。
  allowedToolNames?: ReadonlySet<string>; // 存在时 registry 只保留该运行明确允许的本地工具。
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
 * 使用调用方捕获的运行配置构建完整工具 registry 并初始化 provider 实例。
 * MCP manager 的连接生命周期由调用方管理；这里只消费其已发现的工具。
 */
function prepareAgent(options: PrepareAgentOptions): PreparedAgent {
  const config = options.config || options.configSnapshot?.resolveLlmConfig({
    modelProfileId: options.modelProfileId,
    ...(options.reasoningEffortOverride !== undefined ? {reasoningEffortOverride: options.reasoningEffortOverride} : {})
  });
  if (!config) {
    throw new Error('prepareAgent 缺少用户配置 snapshot');
  }
  const toolResultStore = createToolResultStore({cwd: options.cwd});
  const baseRegistry = createDefaultToolRegistry(config, options.cwd, toolResultStore, {
    allowedToolNames: options.allowedToolNames,
    subagentPort: options.subagentPort
  });
  const registry = options.mcpManager
    ? mergeToolRegistries(baseRegistry, createMcpToolRegistry(options.mcpManager, toolResultStore))
    : baseRegistry;
  const agent = createConfiguredAgent(config, registry);

  return {agent, config, registry};
}

export {createConfiguredAgent, prepareAgent};

export type {PrepareAgentOptions, PreparedAgent};
