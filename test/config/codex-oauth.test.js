const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCodexOAuthCredentialExpired,
  parseCodexOAuthCredential,
  readCodexOAuthCredential,
  refreshCodexOAuthCredential,
  resolveCodexAuthFilePath,
  resolveCodexOAuthCredential
} = require('../../src/config/codex-oauth');

function createJwt(payload) {
  const header = Buffer.from(JSON.stringify({alg: 'none'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.signature`;
}

function createResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload)
  };
}

test('parseCodexOAuthCredential reads nested Codex auth.json tokens', () => {
  const accessToken = createJwt({
    exp: 2_000,
    'https://api.openai.com/auth.chatgpt_account_id': 'acct-from-jwt'
  });
  const credential = parseCodexOAuthCredential(JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: {
      access_token: accessToken,
      refresh_token: 'refresh-secret',
      account_id: 'acct-from-file'
    }
  }));

  assert.deepEqual(credential, {
    accessToken,
    refreshToken: 'refresh-secret',
    accountId: 'acct-from-file',
    expiresAt: 2_000_000
  });
});

test('parseCodexOAuthCredential falls back to auth cache expires_at metadata', () => {
  const credential = parseCodexOAuthCredential(JSON.stringify({
    tokens: {
      access_token: 'opaque-access-token',
      refresh_token: 'refresh-secret',
      expires_at: 2_000
    }
  }));

  assert.equal(credential.expiresAt, 2_000_000);
});

test('resolveCodexOAuthCredential refreshes expired access token without writing auth.json', async () => {
  const expiredAccessToken = createJwt({exp: 1});
  const freshAccessToken = createJwt({exp: 5});
  const writes = [];
  let refreshBody;
  const credential = await resolveCodexOAuthCredential({authFilePath: '/tmp/codex-auth.json'}, {
    now: () => 2_000,
    readFile(filePath) {
      assert.equal(filePath, '/tmp/codex-auth.json');
      return JSON.stringify({
        tokens: {
          access_token: expiredAccessToken,
          refresh_token: 'refresh-secret',
          account_id: 'acct-123'
        }
      });
    },
    async fetch(_url, options) {
      refreshBody = options.body.toString();
      return createResponse(200, {
        access_token: freshAccessToken,
        refresh_token: 'rotated-refresh',
        expires_in: 3600
      });
    },
    writeFile() {
      writes.push([...arguments]);
    }
  });

  assert.equal(credential.accessToken, freshAccessToken);
  assert.equal(credential.refreshToken, 'rotated-refresh');
  assert.equal(credential.accountId, 'acct-123');
  assert.equal(credential.expiresAt, 3_602_000);
  assert.match(refreshBody, /grant_type=refresh_token/);
  assert.match(refreshBody, /client_id=app_EMoamEEZ73f0CkXaXp7hrann/);
  assert.equal(writes.length, 0);
});

test('resolveCodexOAuthCredential returns unexpired access token without refresh', async () => {
  const accessToken = createJwt({exp: 1_000});
  let didFetch = false;
  const credential = await resolveCodexOAuthCredential({}, {
    now: () => 2_000,
    readFile() {
      return JSON.stringify({tokens: {access_token: accessToken, refresh_token: 'refresh-secret'}});
    },
    async fetch() {
      didFetch = true;
      return createResponse(200, {});
    }
  });

  assert.equal(credential.accessToken, accessToken);
  assert.equal(didFetch, false);
});

test('readCodexOAuthCredential reports missing auth cache without file content', () => {
  assert.throws(
    () => readCodexOAuthCredential({authFilePath: '/tmp/missing-auth.json'}, {
      readFile() {
        const error = new Error('ENOENT');
        error.code = 'ENOENT';
        throw error;
      }
    }),
    /Codex OAuth auth\.json 不存在/
  );
});

test('parseCodexOAuthCredential rejects auth cache without access token', () => {
  assert.throws(
    () => parseCodexOAuthCredential(JSON.stringify({tokens: {refresh_token: 'refresh-secret'}})),
    (error) => {
      assert.match(error.message, /缺少 tokens\.access_token/);
      assert.doesNotMatch(error.message, /refresh-secret/);
      return true;
    }
  );
});

test('refreshCodexOAuthCredential redacts token fields in failures', async () => {
  await assert.rejects(
    () => refreshCodexOAuthCredential({
      accessToken: createJwt({exp: 1}),
      refreshToken: 'refresh-secret'
    }, {
      fetch: async () => createResponse(401, {
        error: 'invalid_grant',
        refresh_token: 'refresh-secret',
        access_token: 'access-secret'
      })
    }),
    (error) => {
      assert.doesNotMatch(error.message, /refresh-secret|access-secret/);
      assert.match(error.message, /<redacted>/);
      return true;
    }
  );
});

test('resolveCodexAuthFilePath follows explicit path, CODEX_HOME, then ~/.codex/auth.json', () => {
  assert.equal(resolveCodexAuthFilePath({}, {}, '/home/tester'), '/home/tester/.codex/auth.json');
  assert.equal(resolveCodexAuthFilePath({}, {CODEX_HOME: '/tmp/codex-home'}, '/home/tester'), '/tmp/codex-home/auth.json');
  assert.equal(resolveCodexAuthFilePath({authFilePath: '~/.config/codex-auth.json'}, {CODEX_HOME: '/tmp/codex-home'}, '/home/tester'), '/home/tester/.config/codex-auth.json');
});

test('isCodexOAuthCredentialExpired uses a refresh skew', () => {
  assert.equal(isCodexOAuthCredentialExpired({accessToken: 'token', expiresAt: 61_000}, 0), false);
  assert.equal(isCodexOAuthCredentialExpired({accessToken: 'token', expiresAt: 60_000}, 0), true);
});
