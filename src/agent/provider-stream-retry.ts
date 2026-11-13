import {AgentAbortError, isAbortError, throwIfAborted} from '../types/agent';

import {DEFAULT_MAX_RETRIES, DEFAULT_STREAM_IDLE_TIMEOUT_MS, ProviderError, classifyProviderError, describeProviderErrorKind, resolveRetryDelayMs} from './provider-error';

import type {AgentTurnCallbacks, AgentTurnOptions, AgentTurnResult} from '../types/agent';

/** reader 向执行器报告「已产生不可回滚产物」的入口；任一标记都会阻止后续自动重试。 */
type ProviderStreamAttemptObserver = {
  markProviderRecord: () => void; // reader 已产生 provider-private record（如 encrypted reasoning item）。
  markToolCall: () => void; // reader 已解析出完整工具调用。
};

type ProviderStreamRetryDeps = {
  sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>; // 退避等待；必须响应取消信号。
  random: () => number; // 抖动随机源，返回 [0, 1)。
};

type ProviderStreamRetryConfig = {
  createStream: (signal: AbortSignal) => Promise<AsyncIterable<unknown>>; // 每次 attempt 重建 stream 的工厂。
  readStream: (stream: AsyncIterable<unknown>, callbacks: AgentTurnCallbacks, options: AgentTurnOptions, observer: ProviderStreamAttemptObserver) => Promise<AgentTurnResult>;
  callbacks?: AgentTurnCallbacks;
  options?: AgentTurnOptions;
  maxRetries?: number; // 单个 provider turn 允许的额外尝试次数；缺省使用共享默认预算。
  idleTimeoutMs?: number; // 单次 attempt 无事件的最长等待；缺省使用共享默认阈值。
  deps?: Partial<ProviderStreamRetryDeps>;
};

type AttemptGate = {
  assistantText: boolean;
  providerRecord: boolean;
  reasoningComplete: boolean;
  reasoningPreview: boolean;
  toolCall: boolean;
};

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new AgentAbortError());
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    signal?.addEventListener('abort', onAbort, {once: true});
  });
}

const DEFAULT_DEPS: ProviderStreamRetryDeps = {
  sleep: defaultSleep,
  random: Math.random
};

/** 把 turn 级取消信号桥接到本次 attempt 的 controller；返回解绑函数，避免监听器跨 attempt 累积。 */
function linkAbortSignal(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (!parent) {
    return () => {};
  }

  if (parent.aborted) {
    controller.abort();
    return () => {};
  }

  const onAbort = () => controller.abort();
  parent.addEventListener('abort', onAbort, {once: true});

  return () => parent.removeEventListener('abort', onAbort);
}

function createAttemptGate(): AttemptGate {
  return {
    assistantText: false,
    providerRecord: false,
    reasoningComplete: false,
    reasoningPreview: false,
    toolCall: false
  };
}

/** 包装 attempt 级回调：只观察是否已产生不可回滚输出，不改变回调语义。 */
function wrapAttemptCallbacks(callbacks: AgentTurnCallbacks, gate: AttemptGate): AgentTurnCallbacks {
  return {
    onToken(delta, draft) {
      if (delta !== '') {
        gate.assistantText = true;
      }

      callbacks.onToken?.(delta, draft);
    },
    onReasoningUpdate(update) {
      if (update.text.trim() !== '') {
        if (update.kind === 'complete') {
          gate.reasoningComplete = true;
        } else {
          gate.reasoningPreview = true;
        }
      }

      callbacks.onReasoningUpdate?.(update);
    }
  };
}

function formatDelay(delayMs: number): string {
  if (delayMs < 1000) {
    return `${delayMs} 毫秒`;
  }

  const seconds = delayMs / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
}

/**
 * 判断当前 attempt 的失败是否允许自动重试。
 * 已产生正文、reasoning 完成通知、完整工具调用或 provider-private record 的 attempt 一律不重试。
 */
function canRetryAttempt(gate: AttemptGate, options: AgentTurnOptions, retryCount: number, maxRetries: number): boolean {
  if (retryCount >= maxRetries || options.isCompaction || options.abortSignal?.aborted) {
    return false;
  }

  return !gate.assistantText && !gate.reasoningComplete && !gate.toolCall && !gate.providerRecord;
}

/**
 * 为 stream 迭代加空闲看门狗：超时先中断本次 attempt 的连接，再以 `stream_incomplete` 结束。
 * finally 中显式释放迭代器，避免未消费的 next() 继续持有底层连接。
 */
async function* withIdleTimeout(
  source: AsyncIterable<unknown>,
  idleTimeoutMs: number,
  controller: AbortController
): AsyncGenerator<unknown> {
  const iterator = source[Symbol.asyncIterator]();

  try {
    while (true) {
      const nextPromise = iterator.next();
      // race 落败的 next() 稍后仍会 settle，先挂空处理，避免产生未处理的拒绝。
      nextPromise.catch(() => {});

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        nextPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            // 先中断连接再抛错：SDK 需要 abort 才会停止读取，仅 reject 无法释放 socket。
            controller.abort();
            reject(new ProviderError({
              kind: 'stream_incomplete',
              message: `模型响应流在 ${formatDelay(idleTimeoutMs)}内无任何事件`
            }));
          }, idleTimeoutMs);
        })
      ]).finally(() => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      });

      if (result.done) {
        return;
      }

      yield result.value;
    }
  } finally {
    try {
      await iterator.return?.();
    } catch {
      // 释放失败不得覆盖本次 attempt 的真实失败原因。
    }
  }
}

/**
 * 以 provider-neutral 方式执行一次或多次 stream attempt：
 * 每次重试都通过工厂创建新 stream，等待时长由失败类别与退避策略决定。
 */
async function runProviderStreamWithRetry(config: ProviderStreamRetryConfig): Promise<AgentTurnResult> {
  const {callbacks = {}, options = {}} = config;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  const deps: ProviderStreamRetryDeps = {...DEFAULT_DEPS, ...config.deps};
  let retryCount = 0;

  while (true) {
    throwIfAborted(options.abortSignal);
    const attemptController = new AbortController();
    const unlinkAbort = linkAbortSignal(options.abortSignal, attemptController);
    const gate = createAttemptGate();
    let stream: AsyncIterable<unknown>;

    try {
      stream = await config.createStream(attemptController.signal);
    } catch (error: unknown) {
      unlinkAbort();
      // 建连阶段失败由 SDK 的请求级重试负责，不扣减流式预算，也不在本层分类。
      throw error;
    }

    const observer: ProviderStreamAttemptObserver = {
      markProviderRecord: () => {
        gate.providerRecord = true;
      },
      markToolCall: () => {
        gate.toolCall = true;
      }
    };

    try {
      return await config.readStream(
        withIdleTimeout(stream, idleTimeoutMs, attemptController),
        wrapAttemptCallbacks(callbacks, gate),
        options,
        observer
      );
    } catch (error: unknown) {
      if (isAbortError(error) || error instanceof AgentAbortError) {
        throw new AgentAbortError();
      }

      const providerError = classifyProviderError(error);
      const nextRetryCount = retryCount + 1;
      const delayMs = canRetryAttempt(gate, options, retryCount, maxRetries)
        ? resolveRetryDelayMs(providerError, nextRetryCount, deps.random)
        : undefined;

      if (delayMs === undefined) {
        // 预算耗尽或不可重试：保留最后一次尝试的结构化证据，并补充已重试次数。
        throw retryCount === 0
          ? providerError
          : new ProviderError({
              message: `${providerError.message}（已重试 ${retryCount} 次）`,
              kind: providerError.kind,
              code: providerError.code,
              status: providerError.status,
              retryAfterMs: providerError.retryAfterMs,
              requestId: providerError.requestId,
              cause: providerError.cause
            });
      }

      retryCount = nextRetryCount;
      // 预览尚未落盘，重试前必须让 app 丢弃该 attempt 的 reasoning preview，避免残留后与下一 attempt 混淆。
      if (gate.reasoningPreview) {
        callbacks.onReasoningUpdate?.({kind: 'draft', text: ''});
      }

      const reason = describeProviderErrorKind(providerError.kind);
      callbacks.onProviderRetry?.({
        retryCount,
        maxRetries,
        delayMs,
        kind: providerError.kind,
        reason,
        message: `模型响应${reason}，${formatDelay(delayMs)}后重试第 ${retryCount}/${maxRetries} 次。`
      });
      await deps.sleep(delayMs, options.abortSignal);
    } finally {
      unlinkAbort();
    }
  }
}

export {runProviderStreamWithRetry};

export type {ProviderStreamAttemptObserver, ProviderStreamRetryConfig, ProviderStreamRetryDeps};
