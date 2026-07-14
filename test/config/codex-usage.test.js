const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CODEX_OAUTH_USAGE_URL,
  parseCodexUsageResponse,
  queryCodexUsage
} = require('../../src/config/codex-oauth');

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

test('parseCodexUsageResponse normalizes windows, percentages, and reset timestamps', () => {
  const usage = parseCodexUsageResponse({
    rate_limit: {
      primary_window: {used_percent: -3, reset_at: 1_800_000_000},
      secondary_window: {used_percent: 130, reset_at: 1_800_000_000_000}
    }
  });

  assert.deepEqual(usage, {
    primary: {usedPercent: 0, resetAt: 1_800_000_000_000},
    secondary: {usedPercent: 100, resetAt: 1_800_000_000_000}
  });
});

test('parseCodexUsageResponse accepts a null secondary window', () => {
  assert.deepEqual(parseCodexUsageResponse({
    rate_limit: {
      primary_window: {used_percent: 12, reset_at: 1_800_000_000},
      secondary_window: null
    }
  }), {
    primary: {usedPercent: 12, resetAt: 1_800_000_000_000}
  });
});

test('queryCodexUsage uses resolved credential and account header', async () => {
  let requestedUrl;
  let requestedOptions;
  let resolvedConfig;
  const usage = await queryCodexUsage({authFilePath: '/tmp/auth.json'}, {
    resolveCredential: async (config) => {
      resolvedConfig = config;
      return {accessToken: 'access-secret', accountId: 'acct-123'};
    },
    fetch: async (url, options) => {
      requestedUrl = url;
      requestedOptions = options;
      return createResponse(200, {
        rate_limit: {
          primary_window: {used_percent: 25, reset_at: 1_800_000_000},
          secondary_window: {used_percent: 40.5, reset_at: 1_900_000_000}
        }
      });
    }
  });

  assert.deepEqual(resolvedConfig, {authFilePath: '/tmp/auth.json'});
  assert.equal(requestedUrl, CODEX_OAUTH_USAGE_URL);
  assert.equal(requestedUrl, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(requestedOptions.method, 'GET');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer access-secret');
  assert.equal(requestedOptions.headers['ChatGPT-Account-ID'], 'acct-123');
  assert.equal(usage.primary.usedPercent, 25);
  assert.equal(usage.secondary.usedPercent, 40.5);
});

test('queryCodexUsage omits account header when credential has no account id', async () => {
  let headers;
  await queryCodexUsage({}, {
    resolveCredential: async () => ({accessToken: 'access-token'}),
    fetch: async (_url, options) => {
      headers = options.headers;
      return createResponse(200, {
        rate_limit: {
          primary_window: {used_percent: 1, reset_at: 1_800_000_000},
          secondary_window: {used_percent: 2, reset_at: 1_900_000_000}
        }
      });
    }
  });

  assert.equal('ChatGPT-Account-ID' in headers, false);
});

test('queryCodexUsage redacts credential and network errors', async () => {
  await assert.rejects(
    () => queryCodexUsage({}, {
      resolveCredential: async () => {
        throw new Error('refresh_token=refresh-secret');
      }
    }),
    (error) => {
      assert.doesNotMatch(error.message, /refresh-secret/);
      assert.match(error.message, /<redacted>/);
      return true;
    }
  );

  await assert.rejects(
    () => queryCodexUsage({}, {
      resolveCredential: async () => ({accessToken: 'access-secret'}),
      fetch: async () => {
        throw new Error('Authorization: Bearer access-secret');
      }
    }),
    (error) => {
      assert.doesNotMatch(error.message, /access-secret/);
      assert.match(error.message, /<redacted>/);
      return true;
    }
  );
});

test('queryCodexUsage rejects HTTP, invalid JSON, and incomplete windows without body leaks', async () => {
  const auth = {resolveCredential: async () => ({accessToken: 'access-secret'})};

  await assert.rejects(
    () => queryCodexUsage({}, {...auth, fetch: async () => createResponse(401, {access_token: 'access-secret'})}),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /access-secret/);
      return true;
    }
  );
  await assert.rejects(
    () => queryCodexUsage({}, {...auth, fetch: async () => createResponse(200, new Error('bad json'))}),
    /不是有效 JSON/
  );
  await assert.rejects(
    () => queryCodexUsage({}, {...auth, fetch: async () => createResponse(200, {rate_limit: {primary_window: {used_percent: 1}}})}),
    /primary_window\.reset_at/
  );
});
