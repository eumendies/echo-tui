import {prepareAgent} from '../../agent/agent-setup';
import {createPendingConversationReference, prepareConversationReference} from '../../agent/context/conversation-reference';
import {redactSensitiveText} from '../../agent/agent-errors';
import {readLlmConfig, resolveContextWindow} from '../../config/llm-config';
import {createUsageCwdHash} from '../../persistence/usage-store';
import {isAbortError} from '../../types/agent';

import type {AgentTurnResult, LlmConfig} from '../../types/agent';
import type {CommandHostApp} from '../../types/command';
import type {UsageStore} from '../../types/usage';
import type {AppContext} from '../state/app-context';

// 该端口把 slash command、引用状态、模型初始化和 usage 账本组合在同一应用边界。
type ConversationReferenceCommandPortOptions = {
  appContext: AppContext; // 提供 transcript、引用和 turn 生命周期状态。
  renderFooter: () => void; // 在选择、取消和总结状态变化后重绘输入区。
  usageStore: UsageStore; // 记录独立引用总结请求产生的 token 用量。
};

/**
 * 创建历史会话附件端口：选择时只读加载目标，发送时才处理摘要请求和取消生命周期。
 */
function createConversationReferenceCommandPort(options: ConversationReferenceCommandPortOptions): CommandHostApp['reference'] {
  const {appContext, renderFooter, usageStore} = options;

  return {
    /** 返回当前 cwd 可引用的历史会话 metadata，不加载 journal 正文。 */
    listSessions() {
      return appContext.transcriptContext.listReferenceSessions();
    },
    /** 取消正在进行的延迟总结，并立即恢复 footer 的非工作状态。 */
    cancelPreparation() {
      const cancelled = appContext.conversationReferenceContext.cancelPreparation();

      if (cancelled) {
        appContext.turnContext.stopSpinner();
        appContext.turnContext.clearWorking();
        renderFooter();
      }

      return cancelled;
    },
    /** 只读加载所选 journal，并把中立素材保存为 composer 的 pending 引用。 */
    async prepare(candidate) {
      const source = appContext.transcriptContext.loadReferenceSession(candidate);

      if (!source) {
        return {ok: false as const, reason: 'failed' as const, error: '无法读取所选历史会话'};
      }

      try {
        const config = readLlmConfig();
        const pending = createPendingConversationReference({
          contextWindow: resolveContextWindow(config),
          session: source.session,
          sourcePath: source.sourcePath,
          sourceSessionId: candidate.sessionId,
          title: source.title
        });
        appContext.conversationReferenceContext.setPending(pending);
        renderFooter();
        return {ok: true as const};
      } catch (error: unknown) {
        return {
          ok: false as const,
          reason: 'failed' as const,
          error: error instanceof Error && error.message.trim() !== '' ? redactSensitiveText(error.message) : '引用准备失败'
        };
      }
    },
    /** 发送前使用本轮生效模型生成最终引用；长引用在此发起可取消的总结请求。 */
    async prepareForSubmission(submissionOptions = {}) {
      const pending = appContext.conversationReferenceContext.getPending();

      if (!pending) {
        return {ok: false as const, reason: 'failed' as const, error: '没有待发送的会话引用'};
      }

      const controller = appContext.conversationReferenceContext.beginPreparation();
      appContext.turnContext.startSpinner('working');
      renderFooter();

      try {
        const prepared = prepareAgent({
          cwd: () => appContext.getCurrentCwd(),
          modelProfileId: submissionOptions.modelProfileId,
          reasoningEffortOverride: submissionOptions.reasoningEffortOverride
        });
        const reference = await prepareConversationReference({
          abortSignal: controller.signal,
          agent: prepared.agent,
          contextWindow: resolveContextWindow(prepared.config),
          pending,
          onProviderUsage(result) {
            recordReferenceUsage(usageStore, appContext, prepared.config, result);
          }
        });
        const completed = appContext.conversationReferenceContext.completePreparation(controller);

        return completed
          ? {ok: true as const, reference}
          : {ok: false as const, reason: 'cancelled' as const};
      } catch (error: unknown) {
        appContext.conversationReferenceContext.failPreparation(controller);

        if (controller.signal.aborted || isAbortError(error)) {
          return {ok: false as const, reason: 'cancelled' as const};
        }

        return {
          ok: false as const,
          reason: 'failed' as const,
          error: error instanceof Error && error.message.trim() !== '' ? redactSensitiveText(error.message) : '引用准备失败'
        };
      } finally {
        appContext.turnContext.stopSpinner();
        appContext.turnContext.clearWorking();
        renderFooter();
      }
    }
  };
}

/**
 * 把独立总结请求写入本地 usage 账本；记账失败不反向影响已完成的模型请求。
 */
function recordReferenceUsage(
  usageStore: UsageStore,
  appContext: AppContext,
  config: LlmConfig,
  result: Pick<AgentTurnResult, 'usage' | 'usageInputTokens'>
): void {
  try {
    usageStore.appendEvent({
      cwdHash: createUsageCwdHash(appContext.getCurrentCwd()),
      providerType: config.agentType,
      model: config.model,
      interactionMode: appContext.getInteractionMode(),
      contextWindow: resolveContextWindow(config),
      inputTokens: result.usage?.inputTokens ?? result.usageInputTokens,
      cacheCreationInputTokens: result.usage?.cacheCreationInputTokens,
      cacheReadInputTokens: result.usage?.cacheReadInputTokens,
      outputTokens: result.usage?.outputTokens
    });
  } catch {
    // usage 持久化失败不能阻断已经完成的引用总结。
  }
}

export {createConversationReferenceCommandPort};
