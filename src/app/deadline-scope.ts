import {AgentAbortError} from '../types/agent';

type DeadlineAbortScope = {
  dispose: () => void; // 清理 deadline timer 和 parent abort listener。
  run: <Value>(operation: Promise<Value>) => Promise<Value>; // 在 deadline 或 parent abort 前等待 provider operation。
  signal: AbortSignal; // 同时反映 deadline 和 parent abort 的 provider-facing signal。
  timedOut: () => boolean; // 区分独立 deadline 与父流程中断。
};

/**
 * 创建 parent abort 与独立 deadline 的组合信号，并用 Promise.race 约束忽略 signal 的 adapter。
 * 独立模型判断（工具审批、goal 评估）共用该边界，避免超时或父中断悬挂 provider 请求。
 */
function createDeadlineAbortScope(parentSignal: AbortSignal | undefined, timeoutMs: number, timeoutMessage: string): DeadlineAbortScope {
  const controller = new AbortController();
  let timeoutReached = false;
  let rejectAbort: ((error: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortFromParent = () => {
    controller.abort();
    rejectAbort?.(new AgentAbortError());
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, {once: true});
  const timer = setTimeout(() => {
    timeoutReached = true;
    controller.abort();
    rejectAbort?.(new AgentAbortError(timeoutMessage));
  }, Math.max(0, timeoutMs));

  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    run: <Value>(operation: Promise<Value>) => Promise.race([operation, abortPromise]),
    dispose() {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
      rejectAbort = undefined;
    }
  };
}

export {createDeadlineAbortScope};

export type {DeadlineAbortScope};
