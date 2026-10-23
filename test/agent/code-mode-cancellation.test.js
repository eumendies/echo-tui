const assert = require('node:assert/strict');
const test = require('node:test');
const cp = require('node:child_process');
const {setTimeout: delay} = require('node:timers/promises');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {scriptFailure} = require('../../src/tools/code-mode/contracts');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {withCodeModeProject, codeCall, toolProvider} = require('../helpers/code-mode-project');

const skip = !isCodeRuntimeAvailable() && 'QuickJS/WASM 不可用；禁止弱隔离替代';
const session = {records: [{role: 'user', text: 'inspect local files'}]};

/** 使用真实 child 与 IPC，只旁观信号调用；自然断连场景不能依赖沙箱授予 kill 权限。 */
async function observeGuestSignals(callback) {
  const originalFork = cp.fork;
  const signals = [];
  cp.fork = (...args) => {
    const child = originalFork(...args);
    const originalKill = child.kill;
    child.kill = function (signal) {
      signals.push(signal);
      return originalKill.call(this, signal);
    };
    return child;
  };
  try {
    return await callback(signals);
  } finally {
    cp.fork = originalFork;
  }
}

function replaceReader(fixture, executeScript) {
  fixture.decorateRegistry = (registry) =>
    createToolRegistry(
      registry.listDefinitions().map(({name}) => {
        const handler = registry.getHandler(name);
        return name === 'read_files' ? {...handler, executeScript} : handler;
      })
    );
}

function assertCancelledAudit(records, count) {
  assert.equal(records.filter((record) => record.event === 'end').length, 1);
  assert.equal(records.at(-1).status, 'cancelled');
  assert.equal(records.filter((record) => record.event === 'call_start').length, count);
  assert.equal(records.filter((record) => record.event === 'call_end').length, count);
  assert.ok(
    records
      .filter((record) => record.event === 'call_end')
      .every((record) => record.status === 'cancelled')
  );
  assert.deepEqual(
    records.map((record) => record.sequence),
    records.map((_, index) => index + 1)
  );
}

test(
  'turn abort closes queued dispatch, drains cooperative tools and preserves terminal audit without child signals',
  {skip},
  async () => {
    await observeGuestSignals(async (signals) => {
      await withCodeModeProject(async (fixture) => {
        const controller = new AbortController();
        let dispatched = 0;
        let drained = 0;
        let starts = 0;
        function abortWhenActive() {
          if (starts === 16 && dispatched === 2 && !controller.signal.aborted) {
            controller.abort();
          }
        }
        replaceReader(fixture, async (_args, _call, options) => {
          dispatched += 1;
          const waiting = delay(1000, undefined, {signal: options.abortSignal});
          abortWhenActive();
          try {
            await waiting;
          } catch {
            await delay(15);
            drained += 1;
          }
          return scriptFailure('cancelled', 'PRIVATE_FILE_BODY');
        });
        const requests = [];
        fixture.createProvider = () =>
          toolProvider(
            [
              codeCall(`
        await Promise.all(Array.from({length:16}, () => tools.read_files({files:[{path:'one.txt'}]})));
        return 1;
      `)
            ],
            requests
          );
        const records = [];
        await assert.rejects(
          fixture.run(
            {...session, abortSignal: controller.signal},
            {
              onCodeExecutionRecords(batch) {
                records.push(...batch);
                starts += batch.filter((record) => record.event === 'call_start').length;
                abortWhenActive();
              },
              onToolResult() {
                assert.fail('取消后不得回传普通 provider result');
              }
            }
          ),
          {name: 'AgentAbortError'}
        );
        assert.equal(dispatched, 2);
        assert.equal(drained, 2);
        assert.equal(requests.length, 1);
        assertCancelledAudit(records, 16);
        const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
        assert.equal(inner.length, 4);
        assert.ok(
          inner
            .filter((event) => event.event === 'end')
            .every((event) => event.status === 'cancelled')
        );
        const snapshot = JSON.stringify([
          records,
          fixture.lifecycle,
          fixture.hookEvents,
          fixture.debugEvents
        ]);
        fixture.decorateRegistry = undefined;
        fixture.createProvider = () => toolProvider([codeCall('return 2;', 'new-turn')]);
        const next = [];
        await fixture.run(session, {
          onToolResult(result) {
            next.push(result);
          }
        });
        assert.equal(JSON.parse(next[0].text).result, 2);
        await delay(40);
        assert.equal(fixture.lifecycle.filter((event) => event.scope.toolOrigin).length, 4);
        assert.equal(JSON.stringify(records), JSON.stringify(JSON.parse(snapshot)[0]));
        assert.doesNotMatch(snapshot, /PRIVATE_FILE_BODY/);
      });
      assert.deepEqual(signals, []);
    });
  }
);

test(
  'abort during call observation never crosses the real execution policy boundary',
  {skip},
  async () => {
    await observeGuestSignals(async (signals) => {
      await withCodeModeProject(async (fixture) => {
        const controller = new AbortController();
        let dispatched = 0;
        replaceReader(fixture, async () => {
          dispatched += 1;
          return scriptFailure('tool_failed', 'must not execute');
        });
        fixture.createProvider = () =>
          toolProvider([codeCall('await tools.read_files({files:[{path:"one.txt"}]});return 1;')]);
        const records = [];
        await assert.rejects(
          fixture.run(
            {...session, abortSignal: controller.signal},
            {
              onCodeExecutionRecords(batch) {
                records.push(...batch);
                if (batch.some((record) => record.event === 'call_start')) {
                  controller.abort();
                }
              }
            }
          ),
          {name: 'AgentAbortError'}
        );
        assert.equal(dispatched, 0);
        assert.equal(fixture.lifecycle.filter((event) => event.scope.toolOrigin).length, 0);
        assertCancelledAudit(records, 1);
      });
      assert.deepEqual(signals, []);
    });
  }
);

test(
  'unawaited work cancels the finite active collectors and never dispatches queued calls after gateway close',
  {skip},
  async () => {
    await observeGuestSignals(async (signals) => {
      await withCodeModeProject(async (fixture) => {
        let dispatched = 0;
        let aborted = 0;
        replaceReader(fixture, async (_args, _call, options) => {
          dispatched += 1;
          try {
            await delay(300, undefined, {signal: options.abortSignal});
          } catch {
            aborted += 1;
          }
          return scriptFailure('cancelled', 'cancelled');
        });
        fixture.createProvider = () =>
          toolProvider([
            codeCall(`
        for(let i=0;i<16;i++) tools.read_files({files:[{path:'one.txt'}]});
        return true;
      `)
          ]);
        const records = [];
        const results = [];
        await fixture.run(session, {
          onCodeExecutionRecords(batch) {
            records.push(...batch);
          },
          onToolResult(result) {
            results.push(result);
          }
        });
        const outer = JSON.parse(results[0].text);
        assert.equal(outer.error.code, 'pending_tool_calls', results[0].text);
        assert.equal(outer.summary.cancelled, 16);
        assert.ok(dispatched <= 2);
        assert.equal(aborted, dispatched);
        assert.equal(records.filter((record) => record.event === 'call_end').length, 16);
        assert.equal(records.filter((record) => record.event === 'end').length, 1);
        const snapshot = JSON.stringify([records, fixture.lifecycle, results]);
        await delay(40);
        assert.equal(JSON.stringify([records, fixture.lifecycle, results]), snapshot);
      });
      assert.deepEqual(signals, []);
    });
  }
);

test(
  'finite noncooperative collector cleanup failure cannot append late audit/hooks or mutate the next run',
  {skip},
  async () => {
    await observeGuestSignals(async (signals) => {
      await withCodeModeProject(async (fixture) => {
        let collectorEnded = false;
        const controller = new AbortController();
        replaceReader(fixture, async () => {
          controller.abort();
          await delay(1200);
          collectorEnded = true;
          return scriptFailure('tool_failed', 'LATE_PRIVATE_FILE_BODY');
        });
        fixture.createProvider = () =>
          toolProvider([
            codeCall('await tools.read_files({files:[{path:"one.txt"}]});return true;')
          ]);
        const records = [];
        const results = [];
        await assert.rejects(
          fixture.run(
            {...session, abortSignal: controller.signal},
            {
              onCodeExecutionRecords(batch) {
                records.push(...batch);
              },
              onToolResult(result) {
                results.push(result);
              }
            }
          ),
          {name: 'AgentAbortError'}
        );
        assert.equal(collectorEnded, false);
        assert.equal(results.length, 0);
        assert.equal(records.at(-1).status, 'cancelled');
        assert.match(records.at(-1).text, /tool: cleanup_failed/);
        const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
        assert.deepEqual(
          inner.map((event) => [event.event, event.status]),
          [
            ['start', undefined],
            ['end', 'cancelled']
          ]
        );
        const innerHooks = fixture.hookEvents.filter(({payload}) => payload.toolOrigin);
        const innerDebug = fixture.debugEvents.filter(({payload}) => payload.toolOrigin);
        const snapshot = JSON.stringify([records, inner, innerHooks, innerDebug, results]);
        fixture.decorateRegistry = undefined;
        fixture.createProvider = () => toolProvider([codeCall('return 2;', 'next-after-cleanup')]);
        await fixture.run(session);
        await delay(250);
        assert.equal(collectorEnded, true);
        assert.equal(
          JSON.stringify([
            records,
            fixture.lifecycle.filter((event) => event.scope.toolOrigin),
            fixture.hookEvents.filter(({payload}) => payload.toolOrigin),
            fixture.debugEvents.filter(({payload}) => payload.toolOrigin),
            results
          ]),
          snapshot
        );
        assert.doesNotMatch(snapshot, /LATE_PRIVATE_FILE_BODY/);
        assert.equal(records.filter((record) => record.event === 'end').length, 1);
      });
      assert.deepEqual(signals, []);
    });
  }
);
