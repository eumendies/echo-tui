const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderError,
  annotateProviderError,
  classifyProviderError,
  createProviderError,
  describeProviderErrorKind,
  readRetryAfterMs,
  readRetryAfterMsFromMessage,
  resolveRetryDecision,
  resolveRetryDelayMs
} = require('../../src/agent/provider-error');

const FIXED_RANDOM = () => 0.5;

function createHttpError(status, code, message = 'provider failure') {
  const error = new Error(message);
  error.status = status;

  if (code !== undefined) {
    error.code = code;
  }

  return error;
}

test('classifyProviderError prefers structured provider codes over message text', () => {
  const error = new Error('Our servers are currently overloaded. Please try again later.');
  error.code = 'rate_limit_exceeded';

  // 文案指向 overloaded，但结构化错误码优先，必须判为 rate_limit。
  assert.equal(classifyProviderError(error).kind, 'rate_limit');
});

test('classifyProviderError maps provider codes to semantic kinds', () => {
  const cases = [
    ['context_length_exceeded', 'context_overflow'],
    ['content_policy_violation', 'content_filter'],
    ['insufficient_quota', 'quota'],
    ['invalid_api_key', 'auth'],
    ['rate_limit_error', 'rate_limit'],
    ['slow_down', 'rate_limit'],
    ['overloaded_error', 'overloaded'],
    ['server_is_overloaded', 'overloaded'],
    ['server_error', 'transient'],
    ['api_error', 'transient'],
    ['invalid_request_error', 'invalid_request']
  ];

  for (const [code, expected] of cases) {
    const error = new Error('detail');
    error.code = code;
    assert.equal(classifyProviderError(error).kind, expected, `unexpected kind for ${code}`);
  }
});

test('classifyProviderError treats runtime network failures as transient', () => {
  for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'EAI_AGAIN']) {
    const error = new Error('socket failure');
    error.code = code;
    assert.equal(classifyProviderError(error).kind, 'transient', `unexpected kind for ${code}`);
  }

  for (const message of ['premature close', 'socket hang up', 'other side closed', 'stream disconnected']) {
    assert.equal(classifyProviderError(new Error(message)).kind, 'transient', `unexpected kind for ${message}`);
  }
});

test('classifyProviderError maps HTTP statuses when no code is present', () => {
  assert.equal(classifyProviderError(createHttpError(401)).kind, 'auth');
  assert.equal(classifyProviderError(createHttpError(429)).kind, 'rate_limit');
  assert.equal(classifyProviderError(createHttpError(500)).kind, 'transient');
  assert.equal(classifyProviderError(createHttpError(503)).kind, 'transient');
  assert.equal(classifyProviderError(createHttpError(408)).kind, 'transient');
  assert.equal(classifyProviderError(createHttpError(400)).kind, 'invalid_request');
});

test('classifyProviderError falls back to message patterns and then unknown', () => {
  assert.equal(classifyProviderError(new Error('Rate limit reached for gpt-5')).kind, 'rate_limit');
  assert.equal(classifyProviderError(new Error('An error occurred while processing your request')).kind, 'transient');
  assert.equal(classifyProviderError(new Error('something entirely unexpected')).kind, 'unknown');
});

test('classifyProviderError keeps structured evidence on already classified errors', () => {
  const original = createProviderError({message: '服务过载', code: 'server_is_overloaded', retryAfterMs: 3000});
  const classified = classifyProviderError(original);

  assert.equal(classified, original);
  assert.equal(classified.kind, 'overloaded');
  assert.equal(classified.retryAfterMs, 3000);
});

test('readRetryAfterMs accepts numeric seconds, milliseconds and HTTP dates', () => {
  assert.equal(readRetryAfterMs(new Headers({ 'retry-after': '3' })), 3000);
  assert.equal(readRetryAfterMs(new Headers({ 'retry-after-ms': '1500' })), 1500);
  assert.equal(readRetryAfterMs({'Retry-After': '2'}), 2000);

  const future = new Date(Date.now() + 5000).toUTCString();
  const deadline = readRetryAfterMs(new Headers({ 'retry-after': future }));
  assert.ok(deadline !== undefined && deadline > 0 && deadline <= 5000);

  assert.equal(readRetryAfterMs(new Headers()), undefined);
  assert.equal(readRetryAfterMs(undefined), undefined);
});

test('readRetryAfterMsFromMessage extracts seconds and milliseconds advice', () => {
  assert.equal(readRetryAfterMsFromMessage('Please try again in 11.054s.'), 11054);
  assert.equal(readRetryAfterMsFromMessage('Please try again in 750ms.'), 750);
  assert.equal(readRetryAfterMsFromMessage('no advice here'), undefined);
});

test('resolveRetryDecision maps kinds to the three-state policy', () => {
  assert.deepEqual(resolveRetryDecision('transient'), {kind: 'backoff', baseDelayMs: 500});
  assert.deepEqual(resolveRetryDecision('stream_incomplete'), {kind: 'backoff', baseDelayMs: 500});
  // server-directed 与 backoff 共用 baseDelayMs，额外携带独立的保守子预算。
  assert.deepEqual(resolveRetryDecision('rate_limit'), {kind: 'server-directed', baseDelayMs: 5000, maxAttempts: 2});
  assert.deepEqual(resolveRetryDecision('overloaded'), {kind: 'server-directed', baseDelayMs: 2000, maxAttempts: 2});

  for (const kind of ['provider_incomplete', 'content_filter', 'invalid_request', 'context_overflow', 'auth', 'quota', 'aborted', 'unknown']) {
    assert.deepEqual(resolveRetryDecision(kind), {kind: 'never'}, `unexpected decision for ${kind}`);
  }
});

test('resolveRetryDelayMs prefers server advice over local backoff', () => {
  const error = createProviderError({message: '限流', code: 'rate_limit_exceeded', retryAfterMs: 1234});
  assert.equal(resolveRetryDelayMs(error, 1, FIXED_RANDOM), 1234);
});

test('resolveRetryDelayMs caps server advice at 60 seconds', () => {
  const error = createProviderError({message: '限流', code: 'rate_limit_exceeded', retryAfterMs: 900_000});
  assert.equal(resolveRetryDelayMs(error, 1, FIXED_RANDOM), 60_000);
});

test('resolveRetryDelayMs falls back to category-specific conservative backoff', () => {
  const rateLimit = createProviderError({message: '限流', code: 'rate_limit_exceeded'});
  const overloaded = createProviderError({message: '过载', code: 'server_is_overloaded'});

  // random 固定为 0.5 时抖动系数为 1，等待时长等于基础延迟。
  assert.equal(resolveRetryDelayMs(rateLimit, 1, FIXED_RANDOM), 5000);
  assert.equal(resolveRetryDelayMs(overloaded, 1, FIXED_RANDOM), 2000);
  // 保守子预算为 2 次，第 3 次起不再重试。
  assert.equal(resolveRetryDelayMs(rateLimit, 2, FIXED_RANDOM), 10_000);
  assert.equal(resolveRetryDelayMs(rateLimit, 3, FIXED_RANDOM), undefined);
});

test('resolveRetryDelayMs applies exponential backoff with jitter and a 60 second cap', () => {
  const transient = createProviderError({message: '断流', code: 'server_error'});

  assert.equal(resolveRetryDelayMs(transient, 1, () => 0), 400);
  assert.equal(resolveRetryDelayMs(transient, 1, () => 1), 600);
  assert.equal(resolveRetryDelayMs(transient, 3, FIXED_RANDOM), 2000);
  assert.equal(resolveRetryDelayMs(transient, 20, FIXED_RANDOM), 60_000);
});

test('resolveRetryDelayMs returns undefined for never-retry kinds', () => {
  for (const code of ['invalid_request_error', 'context_length_exceeded', 'insufficient_quota', 'invalid_api_key']) {
    const error = createProviderError({message: 'terminal', code});
    assert.equal(resolveRetryDelayMs(error, 1, FIXED_RANDOM), undefined, `unexpected retry for ${code}`);
  }
});

test('createProviderError extracts retry advice from the message when headers are absent', () => {
  const error = createProviderError({
    message: 'Rate limit reached. Please try again in 2.5s.',
    code: 'rate_limit_exceeded'
  });

  assert.equal(error.kind, 'rate_limit');
  assert.equal(error.retryAfterMs, 2500);
});

test('annotateProviderError appends request ID and retry count without losing fields', () => {
  const error = createProviderError({message: '模型服务响应失败', code: 'server_error', retryAfterMs: 1000});
  const annotated = annotateProviderError(error, {requestId: 'req-123', messageSuffix: '已重试 2 次'});

  assert.equal(annotated.kind, 'transient');
  assert.equal(annotated.retryAfterMs, 1000);
  assert.match(annotated.message, /req-123/);
  assert.match(annotated.message, /已重试 2 次/);

  // 重复标注不叠加后缀。
  assert.equal(annotateProviderError(annotated, {requestId: 'req-123', messageSuffix: '已重试 2 次'}), annotated);
});

test('describeProviderErrorKind returns user-facing labels', () => {
  assert.equal(describeProviderErrorKind('transient'), '连接中断');
  assert.equal(describeProviderErrorKind('stream_incomplete'), '响应流中断');
  assert.equal(describeProviderErrorKind('rate_limit'), '服务限流');
  assert.equal(describeProviderErrorKind('overloaded'), '服务过载');
  assert.equal(describeProviderErrorKind('unknown'), '模型服务异常');
});

test('ProviderError redacts credentials in the displayed message', () => {
  const error = new ProviderError({
    kind: 'unknown',
    message: 'failed with Bearer secret-token and sk-abc123'
  });

  assert.doesNotMatch(error.message, /secret-token/);
  assert.doesNotMatch(error.message, /sk-abc123/);
});
