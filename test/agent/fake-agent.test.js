const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeAgent, runFakeAgent } = require('../../src/agent/fake/agent');

test('createFakeAgent streams latest user text as provider turn', async () => {
  const agent = createFakeAgent();
  const callbacks = [];

  const result = await agent.runTurn([
    { role: 'user', text: '旧输入' },
    { role: 'assistant', text: 'ok' },
    { role: 'user', text: '新输入' }
  ], {
    onToken(delta, draft) {
      callbacks.push([delta, draft]);
    }
  });

  assert.deepEqual(result, { draft: '新输入', toolCalls: [] });
  assert.deepEqual(callbacks, [
    ['新', '新'],
    ['输', '新输'],
    ['入', '新输入']
  ]);
});

test('runFakeAgent keeps legacy lifecycle callbacks', async () => {
  const callbacks = [];
  const result = await runFakeAgent({ records: [{ role: 'user', text: 'hi' }] }, {
    onThinking() {
      callbacks.push(['thinking']);
    },
    onToken(delta, draft) {
      callbacks.push(['token', delta, draft]);
    },
    onComplete(text) {
      callbacks.push(['complete', text]);
    }
  });

  assert.equal(result, 'hi');
  assert.deepEqual(callbacks, [
    ['thinking'],
    ['token', 'h', 'h'],
    ['token', 'i', 'hi'],
    ['complete', 'hi']
  ]);
});

test('createFakeAgent aborts during thinking before token output', async () => {
  const agent = createFakeAgent();
  const controller = new AbortController();
  const callbacks = [];

  const turnPromise = agent.runTurn([{ role: 'user', text: 'hello' }], {
    onToken(delta, draft) {
      callbacks.push([delta, draft]);
    }
  }, { abortSignal: controller.signal });

  controller.abort();

  await assert.rejects(turnPromise, { name: 'AgentAbortError' });
  assert.deepEqual(callbacks, []);
});

test('createFakeAgent aborts during streaming and stops later tokens', async () => {
  const agent = createFakeAgent();
  const controller = new AbortController();
  const callbacks = [];

  await assert.rejects(
    agent.runTurn([{ role: 'user', text: 'hello' }], {
      onToken(delta, draft) {
        callbacks.push([delta, draft]);

        if (draft === 'h') {
          controller.abort();
        }
      }
    }, { abortSignal: controller.signal }),
    { name: 'AgentAbortError' }
  );

  assert.deepEqual(callbacks, [['h', 'h']]);
});
