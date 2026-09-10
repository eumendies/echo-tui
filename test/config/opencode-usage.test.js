const {test} = require('node:test');
const assert = require('node:assert/strict');

const {
  OPENCODE_USAGE_URL,
  isOpencodeGoBaseUrl,
  parseOpencodeUsageResponse,
  queryOpencodeUsage
} = require('../../src/config/opencode-usage');

function createResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (payload instanceof Error) {
        throw payload;
      }
      return payload;
    }
  };
}

const ROLLING = {status: 'ok', percent: 3, resetsAt: '2026-09-10T10:09:43.223Z'};
const WEEKLY = {status: 'ok', percent: 18, resetsAt: '2026-09-14T00:00:00.223Z'};
const MONTHLY = {status: 'ok', percent: 9, resetsAt: '2026-10-07T14:07:29.223Z'};

const USAGE_PAYLOAD = {
  usage: {
    rolling: ROLLING,
    weekly: WEEKLY,
    monthly: MONTHLY
  }
};

test('isOpencodeGoBaseUrl covers all three opencode-go presets and rejects lookalikes', () => {
  assert.equal(isOpencodeGoBaseUrl('https://opencode.ai/zen/go/v1'), true);
  assert.equal(isOpencodeGoBaseUrl('https://opencode.ai/zen/go/v1/chat/completions'), true);
  assert.equal(isOpencodeGoBaseUrl('https://opencode.ai/zen/go/v1/responses'), true);
  assert.equal(isOpencodeGoBaseUrl('https://opencode.ai/zen/go/v1/messages'), true);
  // Zen 非 Go 路径与仿冒主机不命中。
  assert.equal(isOpencodeGoBaseUrl('https://opencode.ai/zen/v1'), false);
  assert.equal(isOpencodeGoBaseUrl('https://opencode.ai.example/zen/go/v1'), false);
  assert.equal(isOpencodeGoBaseUrl('https://example.com/v1'), false);
  assert.equal(isOpencodeGoBaseUrl(undefined), false);
  assert.equal(isOpencodeGoBaseUrl('not-a-url'), false);
});

test('queryOpencodeUsage sends bearer auth with self-identifying user agent to the default url', async () => {
  let requestedUrl;
  let requestedOptions;
  const usage = await queryOpencodeUsage('oc-secret-key', {
    fetch: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return createResponse(200, USAGE_PAYLOAD);
    }
  });

  assert.equal(requestedUrl, OPENCODE_USAGE_URL);
  assert.equal(requestedOptions.method, 'GET');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer oc-secret-key');
  assert.equal(requestedOptions.headers['User-Agent'], 'echo-tui/1.0');
  assert.deepEqual(usage.windows, [
    {name: 'rolling', status: 'ok', percent: 3, resetsAtMs: Date.parse(ROLLING.resetsAt)},
    {name: 'weekly', status: 'ok', percent: 18, resetsAtMs: Date.parse(WEEKLY.resetsAt)},
    {name: 'monthly', status: 'ok', percent: 9, resetsAtMs: Date.parse(MONTHLY.resetsAt)}
  ]);
});

test('parseOpencodeUsageResponse fixes window order and appends unknown keys last', () => {
  const usage = parseOpencodeUsageResponse({
    usage: {
      monthly: MONTHLY,
      custom: {status: 'ok', percent: 5, resetsAt: '2026-10-01T00:00:00.000Z'},
      rolling: ROLLING,
      weekly: WEEKLY
    }
  });

  assert.deepEqual(usage.windows.map((window) => window.name), ['rolling', 'weekly', 'monthly', 'custom']);
});

test('parseOpencodeUsageResponse clamps percent to 0-100', () => {
  const usage = parseOpencodeUsageResponse({
    usage: {
      rolling: {status: 'ok', percent: 120, resetsAt: ROLLING.resetsAt},
      weekly: {status: 'ok', percent: -5, resetsAt: WEEKLY.resetsAt}
    }
  });

  assert.equal(usage.windows[0].percent, 100);
  assert.equal(usage.windows[1].percent, 0);
});

test('parseOpencodeUsageResponse rejects malformed payloads', () => {
  const cases = [
    null,
    'ok',
    [],
    {},
    {foo: 1},
    {usage: 'ok'},
    {usage: []},
    {usage: {rolling: {status: 'ok', percent: 3}}},
    {usage: {rolling: {status: 'ok', resetsAt: ROLLING.resetsAt}}},
    {usage: {rolling: {percent: 3, resetsAt: ROLLING.resetsAt}}},
    {usage: {rolling: {status: '', percent: 3, resetsAt: ROLLING.resetsAt}}},
    {usage: {rolling: {status: 'ok', percent: 3, resetsAt: 'not-a-date'}}},
    {usage: {rolling: {status: 'ok', percent: 'many', resetsAt: ROLLING.resetsAt}}}
  ];

  for (const payload of cases) {
    assert.throws(() => parseOpencodeUsageResponse(payload), /OpenCode Go 用量响应/u);
  }
});

test('parse failures include the actual payload keys for integration debugging', () => {
  assert.throws(() => parseOpencodeUsageResponse({foo: 1, bar: []}), /实际键:foo, bar/u);
  assert.throws(
    () => parseOpencodeUsageResponse({usage: {rolling: {status: 'ok'}}}),
    /usage\.rolling 字段不完整\(实际键:status\)/u
  );
});

test('queryOpencodeUsage honors injected usage url', async () => {
  const usage = await queryOpencodeUsage('oc-secret-key', {
    usageUrl: 'https://example.test/usage',
    fetch: async () => createResponse(200, USAGE_PAYLOAD)
  });

  assert.equal(usage.windows.length, 3);
});

test('non-ok http status surfaces an opencode usage error', async () => {
  await assert.rejects(
    queryOpencodeUsage('oc-secret-key', {
      fetch: async () => createResponse(401, null)
    }),
    /HTTP 401/u
  );
});

test('network failures are wrapped with a redacted error', async () => {
  await assert.rejects(
    queryOpencodeUsage('oc-secret-key', {
      fetch: async () => {
        throw new Error('Authorization: Bearer oc-secret-key');
      }
    }),
    (error) => {
      assert.doesNotMatch(error.message, /oc-secret-key/u);
      assert.match(error.message, /<redacted>/u);
      assert.match(error.message, /OpenCode Go 用量请求失败/u);
      return true;
    }
  );
});

test('invalid json body is rejected', async () => {
  await assert.rejects(
    queryOpencodeUsage('oc-secret-key', {
      fetch: async () => createResponse(200, new Error('unexpected token'))
    }),
    /不是有效 JSON/u
  );
});
