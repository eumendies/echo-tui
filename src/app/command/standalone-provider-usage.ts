import {resolveContextWindow} from '../../config/llm-config';
import {createUsageCwdHash} from '../../persistence/usage-store';

import type {AgentTurnResult, LlmConfig} from '../../types/agent';
import type {UsageStore} from '../../types/usage';
import type {AppContext} from '../state/app-context';

type StandaloneProviderUsageOptions = {
  appContext: Pick<AppContext, 'getCurrentCwd' | 'getInteractionMode'>; // 提供记账所需的项目分区与模式归因。
  config: LlmConfig; // 发起该独立请求时使用的已解析配置。
  result: Pick<AgentTurnResult, 'usage' | 'usageInputTokens'>; // provider turn 返回的 token 事实。
  usageStore: UsageStore; // 本地 usage 账本。
};

/**
 * 把不属于 agent loop 的独立 provider 请求（引用总结、手动压缩摘要）写入本地 usage 账本。
 * 没有任何 token 事实时不写入；记账失败不反向影响已经完成的模型请求。
 */
function recordStandaloneProviderUsage(options: StandaloneProviderUsageOptions): void {
  const {appContext, config, result, usageStore} = options;

  try {
    usageStore.appendEvent({
      cwdHash: createUsageCwdHash(appContext.getCurrentCwd()),
      providerType: config.agentType,
      ...(config.providerId ? {providerId: config.providerId} : {}),
      model: config.model,
      interactionMode: appContext.getInteractionMode(),
      contextWindow: resolveContextWindow(config),
      inputTokens: result.usage?.inputTokens ?? result.usageInputTokens,
      cacheCreationInputTokens: result.usage?.cacheCreationInputTokens,
      cacheReadInputTokens: result.usage?.cacheReadInputTokens,
      outputTokens: result.usage?.outputTokens
    });
  } catch {
    // usage 持久化失败不能阻断已经完成的独立请求。
  }
}

export {recordStandaloneProviderUsage};

export type {StandaloneProviderUsageOptions};
