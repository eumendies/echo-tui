import {estimateTextTokensFloat} from '../../agent/context/token-estimator';

const OUTPUT_RATE_WINDOW_MS = 3000; // 速率滑动窗口长度；更短会抖动，更长对卡顿不敏感。
const OUTPUT_RATE_MIN_SPAN_MS = 1000; // 最小分母，避免首个样本产生数量级尖峰。

type OutputRateSample = {
  at: number; // 样本到达时刻的毫秒时间戳。
  tokens: number; // 该段文本的浮点估算 token 数；分片级取整会累积成系统性高估。
};

type OutputRateTracker = {
  getRate: () => number; // 最近窗口内的每秒估算 token 数；窗口内无样本时为 0。
  record: (text: string) => void; // 记录一段模型原始输出文本；空文本或无法估算的文本被忽略。
  reset: () => void; // 清空窗口；只在 assistant turn 边界调用。
};

/**
 * 维护本地估算的模型输出速率滑动窗口。
 * 速率只用于感知"模型还在不在出词"，不作为计费、token 预算或 context 估算依据。
 */
function createOutputRateTracker(now: () => number = Date.now): OutputRateTracker {
  const samples: OutputRateSample[] = [];

  /** 淘汰窗口外的样本，保证序列长度与时间跨度都有界。 */
  function prune(current: number): void {
    const from = current - OUTPUT_RATE_WINDOW_MS;

    while (samples.length > 0 && samples[0].at < from) {
      samples.shift();
    }
  }

  return {
    record(text: string): void {
      if (text === '') {
        return;
      }

      const current = now();
      prune(current);
      samples.push({at: current, tokens: estimateTextTokensFloat(text)});
    },

    getRate(): number {
      const current = now();
      prune(current);

      if (samples.length === 0) {
        return 0;
      }

      const tokens = samples.reduce((total, sample) => total + sample.tokens, 0);
      const spanMs = Math.max(current - samples[0].at, OUTPUT_RATE_MIN_SPAN_MS);

      return Math.round(tokens / (spanMs / 1000));
    },

    reset(): void {
      samples.length = 0;
    }
  };
}

export {
  createOutputRateTracker,
  OUTPUT_RATE_MIN_SPAN_MS,
  OUTPUT_RATE_WINDOW_MS
};

export type {
  OutputRateTracker
};
