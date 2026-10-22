import {isAbortError, throwIfAborted} from '../../types/agent';
import type {AgentTurnCallbacks, AgentSteeringInputPort, AgentTurnOptions, AgentTurnResult, ProviderAgent} from '../../types/agent';
import type {TranscriptRecord} from '../../types/transcript';

type ProviderStepResult = {
  result: AgentTurnResult | null; // SDK 确认的完整响应；引导取消时为空，不能据此结束 turn 或执行工具。
  draft: string; // 完整响应正文或截至抢占边界的累计正文，交给主循环唯一提交。
  reasoningDraft: string; // 尚未发布为本地 summary 的可读推理草稿，不充当 provider 私有推理。
};

/** 普通请求独占步骤身份；抢占冻结正文与本地推理，等待 SDK 收尾后再交付，完整结果优先。 */
async function runProviderStep(agent: ProviderAgent, records: TranscriptRecord[], callbacks: AgentTurnCallbacks, options: AgentTurnOptions, steeringInput?: AgentSteeringInputPort, onPreempted?: () => void): Promise<ProviderStepResult> {
  const controller = new AbortController();
  let active = true;
  let preempted = false;
  let currentDraft = '';
  let reasoningDraft = '';
  const onParentAbort = () => {
    active = false;
    controller.abort();
  };
  /** 就绪引导触发请求级抢占：封闭旧回调并取消请求，不消费消息或取消整个 turn。 */
  const preemptRequestForSteering = () => {
    if (!active || !steeringInput?.hasReady() || options.abortSignal?.aborted) {
      return;
    }
    active = false;
    preempted = true;
    controller.abort();
    onPreempted?.();
  };
  options.abortSignal?.addEventListener('abort', onParentAbort, {once: true});
  const unsubscribe = steeringInput?.subscribe(preemptRequestForSteering);
  const stepCallbacks: AgentTurnCallbacks = {
    onToken(delta, draft) {
      if (active) {
        currentDraft = draft;
        callbacks.onToken?.(delta, draft);
      }
    },
    onProviderRetry(retry) {
      if (active) callbacks.onProviderRetry?.(retry);
    },
    ...(callbacks.onReasoningUpdate ? {
      onReasoningUpdate(update) {
        if (active) {
          reasoningDraft = update.kind === 'complete' ? '' : update.text;
          callbacks.onReasoningUpdate?.(update);
        }
      }
    } : {})
  };

  try {
    throwIfAborted(options.abortSignal);
    preemptRequestForSteering();
    if (preempted) return {result: null, draft: currentDraft, reasoningDraft};
    // 完整返回的结果仍须落盘和补齐工具协议，不能仅因抢占标记而丢弃。
    const result = await agent.runTurn(records, stepCallbacks, {...options, abortSignal: controller.signal});
    throwIfAborted(options.abortSignal);
    return {result, draft: result.draft, reasoningDraft: preempted ? reasoningDraft : ''};
  } catch (error: unknown) {
    throwIfAborted(options.abortSignal);
    if (preempted && isAbortError(error)) return {result: null, draft: currentDraft, reasoningDraft};
    throw error;
  } finally {
    active = false;
    unsubscribe?.();
    options.abortSignal?.removeEventListener('abort', onParentAbort);
  }
}

export {runProviderStep};
