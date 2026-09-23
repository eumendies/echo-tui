const {test} = require('node:test');
const assert = require('node:assert/strict');

const {createTuiTheme} = require('../../src/config/theme-config');
const {displayWidth, stripAnsi} = require('../../src/render/layout');
const {calculateUsageNavigation, renderUsageSurface} = require('../../src/render/footer/usage-surface');

const THEME = createTuiTheme().footer;

function createModel(index, overrides = {}) {
  return {
    providerType: index % 2 === 0 ? 'openai' : 'anthropic',
    providerId: index % 2 === 0 ? 'primary-openai' : 'backup-anthropic',
    model: `model-${index + 1}`,
    inputTokens: 100_000 - index * 1000,
    cacheReadInputTokens: 40_000 - index * 100,
    cacheCreationInputTokens: 0,
    uncachedInputTokens: 60_000 - index * 900,
    outputTokens: 10_000 - index * 100,
    totalTokens: 110_000 - index * 1100,
    hitRate: 0.4,
    eventCount: index + 1,
    share: 0.2,
    ...overrides
  };
}

function createDay(index) {
  return {
    localDay: `2026-06-${String(index + 1).padStart(2, '0')}`,
    inputTokens: 10_000 + index * 100,
    cacheReadInputTokens: 4000,
    cacheCreationInputTokens: 0,
    uncachedInputTokens: 6000 + index * 100,
    outputTokens: 1000,
    totalTokens: 11_000 + index * 100,
    hitRate: 0.4,
    eventCount: 1
  };
}

function createUsageSurface(overrides = {}) {
  return {
    kind: 'usage',
    view: 'dayModels',
    title: 'Token 用量 · 2026-06-03 · 各模型',
    dailyUsage: [createDay(0), createDay(1), createDay(2)],
    modelUsage: [createModel(0), createModel(1), createModel(2)],
    selectedIndex: 2,
    offset: 0,
    dismissHint: 'Esc/Backspace 返回日期 · q 关闭',
    ...overrides
  };
}

test('renderUsageSurface renders the selected date and uses provider_id/model labels in wide day details', () => {
  const dailyLayout = renderUsageSurface(createUsageSurface({
    view: 'daily',
    title: 'Token 用量 · 按日期',
    modelUsage: [],
    selectedIndex: 1,
    dismissHint: 'Enter 查看模型 · Esc/q 关闭'
  }), 100, 30, THEME);
  const detailLayout = renderUsageSurface(createUsageSurface(), 130, 30, THEME);
  const dailyText = stripAnsi(dailyLayout.lines.join('\n'));
  const detailText = stripAnsi(detailLayout.lines.join('\n'));

  assert.match(dailyText, /› 06\/02/);
  assert.match(dailyText, /Enter 查看模型/);
  assert.match(detailText, /Token 用量 · 2026-06-03 · 各模型/);
  assert.match(detailText, /模型/);
  assert.match(detailText, /输入/);
  assert.match(detailText, /输出/);
  assert.match(detailText, /缓存/);
  assert.match(detailText, /命中/);
  assert.match(detailText, /调用/);
  assert.match(detailText, /占比/);
  assert.match(detailText, /趋势/);
  assert.match(detailText, /primary-openai\/model-1/);
  assert.match(detailText, /Esc\/Backspace 返回日期/);
});

test('renderUsageSurface expands a wide card for a long provider/model identity', () => {
  const providerId = 'my-corporate-openai-proxy-us-east';
  const model = 'gpt-5.4-2026-03-05-preview';
  const identity = `${providerId}/${model}`;
  const lines = renderUsageSurface(createUsageSurface({
    modelUsage: [createModel(0, {providerId, model})]
  }), 200, 30, THEME).lines.map((line) => stripAnsi(line));

  assert.ok(lines.some((line) => line.includes(identity)));
  const cardWidth = Math.max(...lines.map((line) => displayWidth(line)));
  assert.ok(cardWidth > 82);
  assert.ok(cardWidth <= 112);
});

test('renderUsageSurface keeps one complete daily navigation hint when dates are scrollable', () => {
  const layout = renderUsageSurface(createUsageSurface({
    view: 'daily',
    title: 'Token 用量 · 按日期',
    dailyUsage: Array.from({length: 20}, (_value, index) => createDay(index)),
    modelUsage: [],
    selectedIndex: 19,
    offset: 6,
    dismissHint: 'Enter 查看模型 · Esc/q 关闭'
  }), 100, 30, THEME);
  const text = stripAnsi(layout.lines.join('\n'));

  assert.match(text, /↑\/↓ 选择 · PgUp\/PgDn 翻页 · Home\/End 跳转 · Enter 查看模型 · Esc\/q 关闭/);
  assert.equal((text.match(/↑\/↓ 选择/g) || []).length, 1);
});

test('renderUsageSurface preserves provider/model identity and core token columns on narrow terminals', () => {
  const longProviderId = 'very-long-provider-id-that-must-not-expand-the-footer-beyond-its-safe-width';
  const longModel = 'very-long-model-name-that-must-not-expand-the-footer-beyond-its-safe-width';
  const layout = renderUsageSurface(createUsageSurface({
    title: `Token 用量 · 2026-06-03 · ${longProviderId}/${longModel}`,
    modelUsage: [createModel(0, {providerId: longProviderId, model: longModel})]
  }), 55, 18, THEME);
  const lines = layout.lines.map((line) => stripAnsi(line));
  const text = lines.join('\n');

  assert.match(text, /模型/);
  assert.match(text, /输入/);
  assert.match(text, /输出/);
  assert.match(text, /合计/);
  assert.doesNotMatch(text, /调用/);
  assert.doesNotMatch(text, /占比/);
  assert.ok(lines.every((line) => displayWidth(line) < 55));
  assert.doesNotMatch(text, new RegExp(longProviderId));
  assert.doesNotMatch(text, new RegExp(longModel));
});

test('calculateUsageNavigation windows selected-day model details', () => {
  const models = Array.from({length: 20}, (_value, index) => createModel(index));
  const surface = createUsageSurface({modelUsage: models, offset: 6});

  assert.deepEqual(calculateUsageNavigation(surface, 100, 26), {maxOffset: 6, windowSize: 14});
});
