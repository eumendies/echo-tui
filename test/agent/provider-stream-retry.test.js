const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderError } = require('../../src/agent/provider-error');
const { runProviderStreamWithRetry } = require('../../src/agent/provider-stream-retry');
const { AgentAbortError } = require('../../src/types/agent');

const FIXED_RANDOM = () => 0.5;

function createTransientError(message = 'stream disconnected') {
  const error = new Error(message);
  error.code = 'ECONNRESET';
  return error;
}

/**
 * 构造一个最小 provider-neutral 读取器：把事件翻译成回调与 attempt 事实标记。
 * `token` 触发正文增量，`reasoning-draft` / `reasoning-complete` 触发 reasoning 回调，
 * `tool` 与 `record` 只标记 attempt 事实。
 */
async function readEvents(stream, callbacks, _options, observer) {
  let draft = '';

  for await (const event of stream) {
    if (event.type === 'token') {
      draft += event.text;
      callbacks.onToken?.(event.text, draft);
      continue;
    }

    if (event.type === 'reasoning-draft') {
      callbacks.onReasoningUpdate?.({kind: 'draft', text: event.text});
      continue;
    }

    if (event.type === 'reasoning-complete') {
      callbacks.onReasoningUpdate?.({kind: 'complete', text: event.text});
      continue;
    }

    if (event.type === 'tool') {
      observer.markToolCall();
      continue;
    }

    if (event.type === 'record') {
      observer.markProviderRecord();
    }
  }

  return {draft, toolCalls: []};
}

function createScriptedStream(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        if (event instanceof Error) {
          throw event;
        }

        yield event;
      }
    }
  };
}

function createRunner(attempts, overrides = {}) {
  const signals = [];
  const sleeps = [];
  const retries = [];
  const reasoningUpdates = [];
  let index = 0;

  const run = () => runProviderStreamWithRetry({
    createStream: async (signal) => {
      signals.push(signal);
      const script = attempts[Math.min(index, attempts.length - 1)];
      index += 1;
      return createScriptedStream(script);
    },
    readStream: overrides.readStream || readEvents,
    callbacks: {
      onProviderRetry: (retry) => retries.push(retry),
      onReasoningUpdate: (update) => reasoningUpdates.push(update)
    },
    options: overrides.options || {},
    maxRetries: overrides.maxRetries ?? 3,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 5000,
    deps: {
      sleep: overrides.deps?.sleep || (async (delayMs) => {
        sleeps.push(delayMs);
      }),
      random: overrides.random || FIXED_RANDOM
    }
  });

  return {reasoningUpdates, retries, run, signals, sleeps};
}

test('runProviderStreamWithRetry creates a fresh stream for every attempt', async () => {
  const runner = createRunner([
    [createTransientError('first')],
    [createTransientError('second')],
    [{type: 'token', text: 'ok'}]
  ]);

  const result = await runner.run();

  assert.equal(result.draft, 'ok');
  assert.equal(runner.signals.length, 3);
  // 每次 attempt 使用独立信号，避免旧的空闲超时影响新连接。
  assert.equal(new Set(runner.signals).size, 3);
  assert.deepEqual(runner.retries.map((retry) => retry.retryCount), [1, 2]);
});

test('runProviderStreamWithRetry stops at the retry budget and reports the retry count', async () => {
  const runner = createRunner([[createTransientError()]], {maxRetries: 2});

  await assert.rejects(() => runner.run(), (error) => {
    assert.match(error.message, /已重试 2 次/);
    return true;
  });

  assert.equal(runner.signals.length, 3);
  assert.deepEqual(runner.retries.map((retry) => retry.retryCount), [1, 2]);
});

test('runProviderStreamWithRetry never retries terminal categories', async () => {
  const invalidRequest = new Error('invalid payload');
  invalidRequest.code = 'invalid_request_error';
  const runner = createRunner([[invalidRequest]]);

  await assert.rejects(() => runner.run(), /invalid payload/);

  assert.equal(runner.signals.length, 1);
  assert.equal(runner.retries.length, 0);
  assert.equal(runner.sleeps.length, 0);
});

test('runProviderStreamWithRetry does not retry compaction requests', async () => {
  const runner = createRunner([[createTransientError()]], {options: {isCompaction: true}});

  await assert.rejects(() => runner.run());

  assert.equal(runner.signals.length, 1);
  assert.equal(runner.retries.length, 0);
});

test('runProviderStreamWithRetry does not retry once assistant text is emitted', async () => {
  const runner = createRunner([[
    {type: 'token', text: 'partial'},
    createTransientError()
  ]]);

  await assert.rejects(() => runner.run());

  assert.equal(runner.signals.length, 1);
  assert.equal(runner.sleeps.length, 0);
});

test('runProviderStreamWithRetry does not retry once a tool call is parsed', async () => {
  const runner = createRunner([[
    {type: 'tool'},
    createTransientError()
  ]]);

  await assert.rejects(() => runner.run());

  assert.equal(runner.signals.length, 1);
});

test('runProviderStreamWithRetry does not retry once a provider record is produced', async () => {
  const runner = createRunner([[
    {type: 'record'},
    createTransientError()
  ]]);

  await assert.rejects(() => runner.run());

  assert.equal(runner.signals.length, 1);
});

test('runProviderStreamWithRetry does not retry once reasoning completion is emitted', async () => {
  const runner = createRunner([[
    {type: 'reasoning-complete', text: 'done'},
    createTransientError()
  ]]);

  await assert.rejects(() => runner.run());

  assert.equal(runner.signals.length, 1);
});

test('runProviderStreamWithRetry retries after a reasoning preview and clears it first', async () => {
  const runner = createRunner([
    [
      {type: 'reasoning-draft', text: 'thinking'},
      createTransientError()
    ],
    [{type: 'token', text: 'ok'}]
  ]);

  const result = await runner.run();

  assert.equal(result.draft, 'ok');
  assert.equal(runner.signals.length, 2);
  assert.deepEqual(runner.reasoningUpdates, [
    {kind: 'draft', text: 'thinking'},
    {kind: 'draft', text: ''}
  ]);
});

test('runProviderStreamWithRetry waits with the backoff delay before retrying', async () => {
  const runner = createRunner([[createTransientError()], [{type: 'token', text: 'ok'}]]);

  await runner.run();

  // base 500ms，random 固定 0.5 时抖动系数为 1。
  assert.deepEqual(runner.sleeps, [500]);
});

test('runProviderStreamWithRetry tolerates createStream failures without spending the budget', async () => {
  let attempts = 0;
  const createFailure = new Error('401 unauthorized');
  createFailure.status = 401;

  await assert.rejects(
    () => runProviderStreamWithRetry({
      createStream: async () => {
        attempts += 1;
        throw createFailure;
      },
      readStream: readEvents,
      maxRetries: 3,
      idleTimeoutMs: 5000,
      deps: {sleep: async () => {}, random: FIXED_RANDOM}
    }),
    (error) => error === createFailure
  );

  // 建连失败交给 SDK 请求级重试处理，执行器不重试也不分类。
  assert.equal(attempts, 1);
});

test('runProviderStreamWithRetry aborts the backoff wait when the turn is cancelled', async () => {
  const controller = new AbortController();
  const runner = createRunner([[createTransientError()]], {
    options: {abortSignal: controller.signal},
    deps: {
      sleep: async () => {
        // 退避等待期间的取消必须立即结束等待，且不得创建下一次 attempt。
        controller.abort();
        throw new AgentAbortError();
      }
    }
  });

  await assert.rejects(() => runner.run(), (error) => error.name === 'AgentAbortError');
  assert.equal(runner.signals.length, 1);
});

test('runProviderStreamWithRetry stops retrying once the turn is cancelled', async () => {
  const controller = new AbortController();
  const runner = createRunner([[createTransientError()]], {
    options: {abortSignal: controller.signal},
    readStream: async () => {
      controller.abort();
      throw createTransientError();
    }
  });

  await assert.rejects(() => runner.run());
  assert.equal(runner.signals.length, 1);
  assert.equal(runner.sleeps.length, 0);
});

test('runProviderStreamWithRetry treats idle timeout as stream_incomplete and retries', async () => {
  const controllerSignals = [];
  const retries = [];
  let attempts = 0;

  const result = await runProviderStreamWithRetry({
    createStream: async (signal) => {
      attempts += 1;
      controllerSignals.push(signal);

      if (attempts > 1) {
        return createScriptedStream([{type: 'token', text: 'recovered'}]);
      }

      // 首个 attempt 永不产生事件，但必须响应 abort，以便空闲超时能释放迭代器。
      return {
        async *[Symbol.asyncIterator]() {
          await new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), {once: true});
          });
        }
      };
    },
    readStream: readEvents,
    callbacks: {onProviderRetry: (retry) => retries.push(retry)},
    maxRetries: 3,
    idleTimeoutMs: 20,
    deps: {sleep: async () => {}, random: FIXED_RANDOM}
  });

  assert.equal(result.draft, 'recovered');
  assert.equal(attempts, 2);
  assert.equal(controllerSignals[0].aborted, true);
  assert.equal(retries.length, 1);
  assert.equal(retries[0].kind, 'stream_incomplete');
  assert.match(retries[0].message, /响应流中断/);
});

test('runProviderStreamWithRetry keeps the final error structured fields', async () => {
  const terminal = new ProviderError({
    kind: 'provider_incomplete',
    message: '服务端未完整结束响应：max_output_tokens',
    requestId: 'req-final'
  });
  const runner = createRunner([[terminal]]);

  await assert.rejects(() => runner.run(), (error) => {
    assert.equal(error.kind, 'provider_incomplete');
    assert.equal(error.requestId, 'req-final');
    return true;
  });

  assert.equal(runner.signals.length, 1);
});

test('runProviderStreamWithRetry reports the failure reason in the retry notice', async () => {
  const rateLimit = createProviderErrorFixture();
  const runner = createRunner([[rateLimit], [{type: 'token', text: 'ok'}]]);

  await runner.run();

  assert.equal(runner.retries.length, 1);
  assert.equal(runner.retries[0].kind, 'rate_limit');
  assert.equal(runner.retries[0].reason, '服务限流');
  assert.equal(runner.retries[0].maxRetries, 3);
  assert.match(runner.retries[0].message, /服务限流/);
});

function createProviderErrorFixture() {
  return new ProviderError({
    kind: 'rate_limit',
    message: '模型服务响应失败：rate limit reached',
    retryAfterMs: 2000
  });
}
