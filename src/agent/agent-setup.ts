import {readLlmConfig} from '../config/llm-config';
import {createDefaultToolRegistry} from '../tools/tool-registry';
import {createAnthropicAgent} from './anthropic/agent';
import {createCodexAgent} from './codex/agent';
import {createFakeAgent} from './fake/agent';
import {createOpenAiChatAgent} from './openai-chat/agent';
import {createOpenAiAgent} from './openai-responses/agent';

import type {LlmConfig, ProviderAgent} from '../types/agent';
import type {ToolRegistry} from '../types/tool';

type PreparedAgent = {
  agent: ProviderAgent;
  config: LlmConfig;
  registry: ToolRegistry;
};

function createConfiguredAgent(config: LlmConfig): ProviderAgent {
  switch (config.agentType) {
    case 'fake':
      return createFakeAgent();
    case 'openai':
      return createOpenAiAgent();
    case 'openai-chat':
      return createOpenAiChatAgent();
    case 'anthropic':
      return createAnthropicAgent();
    case 'codex':
      return createCodexAgent();
  }
}

/**
 * 按拉模式准备 agent：读取最新配置、构建工具 registry 并初始化 provider 实例。
 * 每次调用都重新 loadConfig，使 /model 等配置变更在下一次调用时自动生效。
 *
 * 这里是 agent 装配的集中点；未来按 config 选择不同 provider（如 OpenAI / Anthropic）
 * 的逻辑也应落在这一层，而非散落到调用方。
 */
function prepareAgent(cwd?: string | (() => string)): PreparedAgent {
  const config = readLlmConfig();
  const agent = createConfiguredAgent(config);
  const registry = createDefaultToolRegistry(config, cwd);

  agent.initialize(config, registry);

  return {agent, config, registry};
}

export {createConfiguredAgent, prepareAgent};

export type {PreparedAgent};
