const {test} = require('node:test');
const assert = require('node:assert/strict');

const {
  DEEPSEEK_BALANCE_URL,
  isDeepseekBaseUrl,
  parseDeepseekBalanceResponse,
  queryDeepseekBalance
} = require('../../src/config/deepseek-balance');

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

const BALANCE_PAYLOAD = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00'
    },
    {
      currency: 'USD',
      total_balance: '0.00',
      granted_balance: '0.00',
      topped_up_balance: '0.00'
    }
  ]
};

test('parseDeepseekBalanceResponse maps snake_case fields and keeps amount strings', () => {
  assert.deepEqual(parseDeepseekBalanceResponse(BALANCE_PAYLOAD), {
    isAvailable: true,
    balanceInfos: [
      {currency: 'CNY', totalBalance: '110.00', grantedBalance: '10.00', toppedUpBalance: '100.00'},
      {currency: 'USD', totalBalance: '0.00', grantedBalance: '0.00', toppedUpBalance: '0.00'}
    ]
  });
});

test('queryDeepseekBalance sends Bearer api key to the balance endpoint', async () => {
  let requestedUrl;
  let requestedOptions;
  const balance = await queryDeepseekBalance('ds-secret-key', {
    fetch: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return createResponse(200, BALANCE_PAYLOAD);
    }
  });

  assert.equal(requestedUrl, DEEPSEEK_BALANCE_URL);
  assert.equal(requestedUrl, 'https://api.deepseek.com/user/balance');
  assert.equal(requestedOptions.method, 'GET');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer ds-secret-key');
  assert.equal(balance.isAvailable, true);
  assert.equal(balance.balanceInfos[0].currency, 'CNY');
  assert.equal(balance.balanceInfos[0].totalBalance, '110.00');
});

test('queryDeepseekBalance redacts network errors and rejects without body leaks', async () => {
  await assert.rejects(
    () => queryDeepseekBalance('ds-secret-key', {
      fetch: async () => {
        throw new Error('Authorization: Bearer ds-secret-key');
      }
    }),
    (error) => {
      assert.doesNotMatch(error.message, /ds-secret-key/);
      assert.match(error.message, /<redacted>/);
      return true;
    }
  );

  await assert.rejects(
    () => queryDeepseekBalance('ds-secret-key', {
      fetch: async () => createResponse(401, {error: {message: 'invalid api key'}})
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /invalid api key/);
      return true;
    }
  );
});

test('queryDeepseekBalance rejects invalid JSON and incomplete balance entries', async () => {
  await assert.rejects(
    () => queryDeepseekBalance('key', {
      fetch: async () => createResponse(200, new Error('bad json'))
    }),
    /不是有效 JSON/
  );
  await assert.rejects(
    () => queryDeepseekBalance('key', {
      fetch: async () => createResponse(200, {is_available: false, balance_infos: 'not-an-array'})
    }),
    (error) => {
      assert.match(error.message, /balance_infos/);
      return true;
    }
  );
});

test('parseDeepseekBalanceResponse rejects missing is_available and malformed entries', () => {
  assert.throws(() => parseDeepseekBalanceResponse({balance_infos: []}), /is_available/);
  assert.throws(() => parseDeepseekBalanceResponse({is_available: true}), /balance_infos/);
  assert.throws(() => parseDeepseekBalanceResponse({
    is_available: true,
    balance_infos: [{currency: 'CNY', total_balance: '1.00'}]
  }), /balance_infos\[0\]/);
});

test('isDeepseekBaseUrl only matches the official DeepSeek API host', () => {
  assert.equal(isDeepseekBaseUrl('https://api.deepseek.com'), true);
  assert.equal(isDeepseekBaseUrl('https://api.deepseek.com/v1'), true);
  assert.equal(isDeepseekBaseUrl('https://api.deepseek.com/'), true);
  assert.equal(isDeepseekBaseUrl('https://open.bigmodel.cn/api/paas/v4'), false);
  assert.equal(isDeepseekBaseUrl('https://api.deepseek.com.evil.example'), false);
  assert.equal(isDeepseekBaseUrl(undefined), false);
  assert.equal(isDeepseekBaseUrl('not a url'), false);
});
