const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOutputRateTracker,
  OUTPUT_RATE_MIN_SPAN_MS,
  OUTPUT_RATE_WINDOW_MS
} = require('../../src/app/state/output-rate-tracker');
const {estimateTextTokens} = require('../../src/agent/context/token-estimator');

// 8 个 ASCII 字符按 4 字符/token 估算为 2 个 token，便于把期望值写成整数。
const EIGHT_CHARS = 'abcdefgh';
const TOKENS_PER_CHUNK = estimateTextTokens(EIGHT_CHARS);

test('output rate tracker reports zero before any sample', () => {
  const tracker = createOutputRateTracker(() => 0);

  assert.equal(tracker.getRate(), 0);
});

test('output rate tracker divides window tokens by the observed span', () => {
  let now = 0;
  const tracker = createOutputRateTracker(() => now);

  tracker.record(EIGHT_CHARS);
  now = 2000;
  tracker.record(EIGHT_CHARS);

  assert.equal(tracker.getRate(), (TOKENS_PER_CHUNK * 2) / 2);
});

test('output rate tracker drops samples outside the window', () => {
  let now = 0;
  const tracker = createOutputRateTracker(() => now);

  tracker.record(EIGHT_CHARS);
  now = OUTPUT_RATE_WINDOW_MS + 2000;

  assert.equal(tracker.getRate(), 0);
});

test('output rate tracker floors the span so the first sample cannot spike', () => {
  const tracker = createOutputRateTracker(() => 0);

  tracker.record(EIGHT_CHARS);

  assert.equal(tracker.getRate(), TOKENS_PER_CHUNK / (OUTPUT_RATE_MIN_SPAN_MS / 1000));
});

test('output rate tracker ignores empty text and reset clears the window', () => {
  const tracker = createOutputRateTracker(() => 1000);

  tracker.record('');
  assert.equal(tracker.getRate(), 0);

  tracker.record(EIGHT_CHARS);
  assert.ok(tracker.getRate() > 0);
  tracker.reset();
  assert.equal(tracker.getRate(), 0);
});

test('output rate tracker keeps the sample sequence bounded', () => {
  let now = 0;
  const tracker = createOutputRateTracker(() => now);

  for (let index = 0; index < 500; index += 1) {
    tracker.record(EIGHT_CHARS);
    now += 10;
  }

  // 500 个样本跨 5 秒，其中只有最近 3 秒仍在窗口内。
  assert.equal(tracker.getRate(), Math.round((TOKENS_PER_CHUNK * 300) / 3));
});

test('output rate tracker sums fractional estimates instead of rounding each delta', () => {
  let now = 0;
  const tracker = createOutputRateTracker(() => now);

  for (let index = 0; index < 100; index += 1) {
    tracker.record('a');
  }
  now = 1000;

  // 逐片 ceil 会得到 100；整窗换算应回到 25（100 字符 / 4）。
  assert.equal(tracker.getRate(), 25);
});

test('output rate tracker keeps CJK fractional estimates accurate across deltas', () => {
  let now = 0;
  const tracker = createOutputRateTracker(() => now);

  for (let index = 0; index < 100; index += 1) {
    tracker.record('中');
  }
  now = 1000;

  // 100 个 CJK 字符按 1.5 字符/token 约为 66.7，而不是逐片取整得到的 100。
  assert.equal(tracker.getRate(), 67);
});
