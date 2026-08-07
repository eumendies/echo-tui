import {createMcpToolRegistry, mergeToolRegistries} from '../mcp/tool-adapter';
import {createDefaultToolRegistry} from '../tools/tool-registry';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {createAnthropicAgent} from './anthropic/agent';
import {createCodexAgent} from './codex/agent';
import {createFakeAgent} from './fake/agent';
import {createOpenAiChatAgent} from './openai-chat/agent';
import {createOpenAiAgent} from './openai-responses/agent';

import type {AgentUserConfigSnapshot, LlmConfig, ProviderAgent, ReasoningEffort} from '../types/agent';
import type {McpManager} from '../mcp/manager';
import type {ToolRegistry} from '../types/tool';

type PrepareAgentOptions = {
  config?: LlmConfig;
  configSnapshot?: AgentUserConfigSnapshot;
  cwd?: string | (() => string);
  mcpManager?: McpManager;
  modelProfileId?: string;
  reasoningEffortOverride?: ReasoningEffort;
};

type PreparedAgent = {
  agent: ProviderAgent;
  config: LlmConfig;
  registry: ToolRegistry;
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
  const baseRegistry = createDefaultToolRegistry(config, options.cwd, toolResultStore);
  const registry = options.mcpManager
    ? mergeToolRegistries(baseRegistry, createMcpToolRegistry(options.mcpManager, toolResultStore))
    : baseRegistry;
  const agent = createConfiguredAgent(config, registry);

  return {agent, config, registry};
}

export {createConfiguredAgent, prepareAgent};

export type {PrepareAgentOptions, PreparedAgent};
