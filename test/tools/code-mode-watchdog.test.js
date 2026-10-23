const assert = require('node:assert/strict');
const test = require('node:test');
const {setTimeout: delay} = require('node:timers/promises');
const {executeCode, isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {CODE_LIMITS} = require('../../src/tools/code-mode/protocol');
const {scriptFailure} = require('../../src/tools/code-mode/contracts');

const skip = !isCodeRuntimeAvailable() && 'QuickJS/WASM 不可用；禁止弱隔离替代';

test(
  'real wall watchdog aborts tool waiting and closes the guest without counting it as active computation',
  {
    skip,
    timeout: CODE_LIMITS.wallMs + 10000
  },
  async () => {
    let dispatched = 0;
    let cancelled = 0;
    const records = [];
    const started = Date.now();
    const result = await executeCode({
      callId: 'real-wall-watchdog',
      code: "await tools.glob({pattern: '*'}); return true;",
      onAudit(record) {
        records.push(record);
      },
      async dispatch(_name, _args, _childCallId, signal) {
        dispatched++;
        // fixture 本身也有有限寿命，不能依赖 node:test 的超时回收子进程或异步任务。
        try {
          await delay(CODE_LIMITS.wallMs + 1000, undefined, {signal});
        } catch {
          assert.equal(signal.aborted, true);
          cancelled++;
        }
        return scriptFailure('cancelled', 'Tool waiting ended');
      }
    });

    assert.equal(result.status, 'failed', JSON.stringify(result));
    assert.equal(result.error?.code, 'wall_time_exceeded');
    assert.equal(dispatched, 1);
    assert.equal(cancelled, 1);
    assert.equal(result.summary.cancelled, 1);
    assert.equal(result.summary.completed, 0);
    assert.ok(Date.now() - started >= CODE_LIMITS.wallMs - 100);
    assert.equal(records.filter((record) => record.event === 'end').length, 1);
    assert.equal(records.at(-1).status, 'failed');
    assert.equal(records.find((record) => record.event === 'call_end').status, 'cancelled');
  }
);
