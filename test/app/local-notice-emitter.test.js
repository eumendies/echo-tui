const test = require('node:test');
const assert = require('node:assert/strict');

const { createLocalNoticeEmitter } = require('../../src/app/local-notice-emitter');

function createHarness(options = {}) {
  const appended = [];
  const renderCalls = [];
  const context = {
    transcriptContext: {
      appendRecord(record) {
        appended.push(record);
        return record;
      },
      appendRecords(records) {
        appended.push(...records);
        return records;
      },
      getCurrentSessionId() {
        return options.sessionId === undefined ? 'session-a' : options.sessionId;
      }
    },
    turnContext: { responding: false }
  };
  const emitter = createLocalNoticeEmitter({
    appContext: context,
    renderRecords(records) {
      renderCalls.push(records.map((record) => record.text));
    }
  });

  return { appended, context, emitter, renderCalls };
}

test('notice is written immediately when the response lock is free', () => {
  const harness = createHarness();
  harness.emitter.emit('后台任务 bash-1 已完成 (exit 0)。');

  assert.deepEqual(harness.appended, [{ role: 'local_notice', text: '后台任务 bash-1 已完成 (exit 0)。' }]);
  assert.equal(harness.renderCalls.length, 1);
});

test('notice is queued while any response consumer holds the lock', () => {
  // assistant turn、shell 执行与手动压缩都会占用同一把响应锁。
  for (const owner of ['assistant', 'shell', 'compaction']) {
    const harness = createHarness();
    harness.context.turnContext.responding = true;

    harness.emitter.emit(`通知 ${owner}`);

    assert.deepEqual(harness.appended, [], owner);
    assert.equal(harness.renderCalls.length, 0, owner);
  }
});

test('drain stays queued while the lock is still held', () => {
  const harness = createHarness();
  harness.context.turnContext.responding = true;
  harness.emitter.emit('通知');

  harness.emitter.drain();

  assert.deepEqual(harness.appended, []);
});

test('drain flushes queued notices in order as one batch once the lock is released', () => {
  const harness = createHarness();
  harness.context.turnContext.responding = true;
  harness.emitter.emit('第一条');
  harness.emitter.emit('第二条');
  harness.context.turnContext.responding = false;

  harness.emitter.drain();

  assert.deepEqual(harness.appended.map((record) => record.text), ['第一条', '第二条']);
  assert.deepEqual(harness.renderCalls, [['第一条', '第二条']]);
});

test('a new notice never jumps ahead of notices queued earlier', () => {
  const harness = createHarness();
  harness.context.turnContext.responding = true;
  harness.emitter.emit('积压通知');

  // 响应锁释放后直接来一条新通知:必须排在积压通知之后。
  harness.context.turnContext.responding = false;
  harness.emitter.emit('新通知');

  assert.deepEqual(harness.appended.map((record) => record.text), ['积压通知', '新通知']);
});

test('drain is a no-op when nothing is queued', () => {
  const harness = createHarness();
  harness.emitter.drain();

  assert.deepEqual(harness.appended, []);
  assert.equal(harness.renderCalls.length, 0);
});

test('notice detail is never collapsed away, including error text', () => {
  const harness = createHarness();
  harness.context.turnContext.responding = true;

  for (let index = 1; index <= 12; index += 1) {
    harness.emitter.emit(`通知 ${index}`);
  }
  harness.emitter.emit('写入失败: EACCES /path/status.json', 'error');
  harness.context.turnContext.responding = false;
  harness.emitter.drain();

  assert.equal(harness.appended.length, 13);
  assert.equal(harness.appended.at(-1).role, 'error');
  assert.equal(harness.appended.at(-1).text, '写入失败: EACCES /path/status.json');
});

test('queued notices from an abandoned session never enter the new session', () => {
  const harness = createHarness({ sessionId: 'session-a' });
  harness.context.turnContext.responding = true;
  harness.emitter.emit('旧会话通知');

  // 会话切换:旧任务已被清理,它的迟到通知不得写进新会话。
  harness.context.transcriptContext.getCurrentSessionId = () => 'session-b';
  harness.context.turnContext.responding = false;
  harness.emitter.drain();

  assert.deepEqual(harness.appended, []);

  harness.emitter.emit('新会话通知');
  assert.deepEqual(harness.appended.map((record) => record.text), ['新会话通知']);
});
