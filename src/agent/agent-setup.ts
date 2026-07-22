import {readLlmConfig} from '../config/llm-config';
import {createMcpToolRegistry, mergeToolRegistries} from '../mcp/tool-adapter';
import {createDefaultToolRegistry} from '../tools/tool-registry';
import {createToolResultStore} from '../tools/tool-result-offloading';
import {createAnthropicAgent} from './anthropic/agent';
import {createCodexAgent} from './codex/agent';
import {createFakeAgent} from './fake/agent';
import {createOpenAiChatAgent} from './openai-chat/agent';
import {createOpenAiAgent} from './openai-responses/agent';

import type {LlmConfig, ProviderAgent} from '../types/agent';
import type {McpManager} from '../mcp/manager';
import type {ToolRegistry} from '../types/tool';

type PrepareAgentOptions = {
  cwd?: string | (() => string);
  mcpManager?: McpManager;
  modelProfileId?: string;
};

type PreparedAgent = {
  agent: ProviderAgent;
  config: LlmConfig;
  registry: ToolRegistry;
};

function createConfiguredAgent(config: LlmConfig, registry: ToolRegistry): ProviderAgent {
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
 * 按拉模式准备 agent：读取最新配置、构建完整工具 registry 并初始化 provider 实例。
 * 每次调用都重新 loadConfig，使 /model 等配置变更在下一次调用时自动生效。
 * MCP manager 的连接生命周期由调用方管理；这里只消费其已发现的工具。
 */
function prepareAgent(options: PrepareAgentOptions = {}): PreparedAgent {
  const config = readLlmConfig({modelProfileId: options.modelProfileId});
  const toolResultStore = createToolResultStore({cwd: options.cwd});
  const baseRegistry = createDefaultToolRegistry(config, options.cwd, toolResultStore);
  const registry = options.mcpManager
    ? mergeToolRegistries(baseRegistry, createMcpToolRegistry(options.mcpManager, toolResultStore))
    : baseRegistry;
  const agent = createConfiguredAgent(config, registry);

  return {agent, config, registry};
}

export {prepareAgent};

export type {PrepareAgentOptions, PreparedAgent};
