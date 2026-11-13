const {mock} = require('node:test');

// 单次推进足以覆盖 60 秒退避上限，同时避免 10 轮累计跨过 300 秒空闲阈值。
const RETRY_TICK_MS = 65_000;
const MAX_RETRY_TICKS = 10;

async function flushPendingAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

/**
 * 在 mock timer 下执行 action，反复推进时间直到 promise settle。
 * 轮询推进而非固定 tick 序列：退避策略变化时测试不会退化成永久挂起。
 */
async function runWithMockedRetryTimers(action) {
  mock.timers.enable({apis: ['setTimeout']});

  try {
    const promise = action();
    let settled = false;
    promise.then(() => {
      settled = true;
    }, () => {
      settled = true;
    });

    for (let index = 0; index < MAX_RETRY_TICKS && !settled; index += 1) {
      await flushPendingAsyncWork();

      if (settled) {
        break;
      }

      mock.timers.tick(RETRY_TICK_MS);
    }

    return await promise;
  } finally {
    mock.timers.reset();
  }
}

module.exports = {flushPendingAsyncWork, runWithMockedRetryTimers};
