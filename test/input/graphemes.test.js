const test = require('node:test');
const assert = require('node:assert/strict');

// 生产代码不为测试提供开关:这里用 Segmenter 调用计数区分快路径与回退路径,
// 同时保留真实实现作为语义 oracle。
const RealSegmenter = Intl.Segmenter;
let segmentCalls = 0;

Intl.Segmenter = function createCountingSegmenter(...args) {
  const real = new RealSegmenter(...args);

  return {
    segment(...segmentArgs) {
      segmentCalls += 1;
      return real.segment(...segmentArgs);
    }
  };
};

const {splitGraphemes} = require('../../src/input/graphemes');
const {ZERO_WIDTH_RANGES} = require('../../src/render/width-data');

function referenceSplit(text) {
  return Array.from(new RealSegmenter(undefined, {granularity: 'grapheme'}).segment(text), (entry) => entry.segment);
}

function callsFor(run) {
  const before = segmentCalls;
  const result = run();
  return {calls: segmentCalls - before, result};
}

test('splitGraphemes skips Intl.Segmenter for ASCII and CJK text', () => {
  const samples = [
    '',
    'plain ascii line',
    '中文标点：【测试】、。（）——……',
    '全角 ＡＢＣ，１２３',
    'かなカナ・キーワード',
    '한글 문장',
    'mixed 中文 and ascii 123',
    '代码 console.log("中文"); // 注释',
    'line one\nline two\nline three'
  ];

  for (const sample of samples) {
    const {calls, result} = callsFor(() => splitGraphemes(sample));

    assert.equal(calls, 0, `expected fast path for ${JSON.stringify(sample)}`);
    assert.deepEqual(result, referenceSplit(sample));
  }
});

test('splitGraphemes falls back to Intl.Segmenter for cluster-joining text', () => {
  const samples = [
    ['combining acute', 'cafe\u0301'],
    ['VS16 keycap', '1\ufe0f\u20e3'],
    ['ZWJ family', '\u{1f468}\u200d\u{1f469}\u200d\u{1f466}'],
    ['regional indicator flag', '\u{1f1e8}\u{1f1f3}'],
    ['emoji modifier', '\u{1f44d}\u{1f3fb}'],
    ['thai spacing mark', '\u0e01\u0e33'],
    ['indic spacing mark', '\u0915\u093e'],
    ['hangul jamo', '\u1100\u1161'],
    ['prepend code point', '\u0d4e\u0d15'],
    ['kana dakuten', '\u304b\u3099'],
    ['arabic harakat', '\u0628\u064b'],
    ['hebrew point', '\u05d0\u05b7'],
    ['carriage return pair', 'a\r\nb'],
    ['emoji', '\u{1f600}']
  ];

  for (const [label, sample] of samples) {
    const {calls, result} = callsFor(() => splitGraphemes(sample));

    assert.ok(calls > 0, `expected Segmenter fallback for ${label}`);
    assert.deepEqual(result, referenceSplit(sample), `unexpected split for ${label}`);
  }
});

test('fast path never merges code points that Intl.Segmenter keeps apart', () => {
  const codePoints = [];
  const collect = (start, end, step = 1) => {
    for (let codePoint = start; codePoint <= end; codePoint += step) {
      codePoints.push(codePoint);
    }
  };

  // 覆盖快路径白名单所在区块;扩展平面按步长抽样,避免穷举十多万个码点。
  collect(0x0000, 0x04ff);
  collect(0x2000, 0x2fff);
  collect(0x3000, 0x318f);
  collect(0x3400, 0xd7a3, 0x40);
  collect(0xf900, 0xfaff);
  collect(0xfe00, 0xfe4f);
  collect(0xff00, 0xffef);
  collect(0x20000, 0x3fffd, 0x400);

  let fastPathCalls = 0;

  for (const codePoint of codePoints) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      continue;
    }

    const sample = `a${String.fromCodePoint(codePoint)}`;
    const {calls, result} = callsFor(() => splitGraphemes(sample));

    if (calls > 0) {
      // 回退路径的结果由 Intl.Segmenter 保证,无需再对照。
      continue;
    }

    fastPathCalls += 1;
    assert.deepEqual(result, referenceSplit(sample), `fast path merged U+${codePoint.toString(16).toUpperCase()}`);
  }

  assert.ok(fastPathCalls > 4000, `expected the fast path to cover the common blocks, got ${fastPathCalls}`);
});

test('zero width code points always take the Segmenter path', () => {
  for (const [start, end] of ZERO_WIDTH_RANGES) {
    for (const codePoint of start === end ? [start] : [start, end]) {
      const {calls} = callsFor(() => splitGraphemes(`a${String.fromCodePoint(codePoint)}`));

      assert.ok(calls > 0, `expected Segmenter fallback for U+${codePoint.toString(16).toUpperCase()}`);
    }
  }
});
