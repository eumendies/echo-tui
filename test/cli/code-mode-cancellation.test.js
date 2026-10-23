const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {runOnce} = require('../../src/cli/one-shot');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {scriptFailure} = require('../../src/tools/code-mode/contracts');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {withCodeModeProject, codeCall, toolProvider} = require('../helpers/code-mode-project');

const skip = !isCodeRuntimeAvailable() && 'QuickJS/WASM 不可用；禁止弱隔离替代';

test(
  'headless SIGTERM controller drains real code dispatch without OS signals, stdout, stdin or session artifacts',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      const processSignals = new EventEmitter();
      let collected = 0;
      let cancelled = 0;
      fixture.decorateRegistry = (registry) =>
        createToolRegistry(
          registry.listDefinitions().map(({name}) => {
            const handler = registry.getHandler(name);
            return name === 'read_files'
              ? {
                  ...handler,
                  async executeScript(_args, _call, options) {
                    collected += 1;
                    const waiting = delay(400, undefined, {signal: options.abortSignal});
                    processSignals.emit('SIGTERM');
                    try {
                      await waiting;
                    } catch {
                      cancelled += 1;
                    }
                    return scriptFailure('cancelled', 'cancelled');
                  }
                }
              : handler;
          })
        );
      const requests = [];
      fixture.createProvider = () =>
        toolProvider(
          [codeCall('await tools.read_files({files:[{path:"one.txt"}]});return true;')],
          requests
        );
      const hooks = [];
      let output = '';
      let closed = 0;
      await assert.rejects(
        runOnce({
          prompt: 'inspect local files',
          cwd: fixture.cwd,
          userConfigContext: fixture.context,
          runAgent: fixture.run,
          process: processSignals,
          stdout: {
            write(text) {
              output += text;
            }
          },
          debug: {enabled: false, logPath: null, emit() {}, close() {}},
          hooks: {
            emit(event, payload) {
              hooks.push({event, payload});
            },
            async flush() {},
            updateConfig() {}
          },
          mcpManager: {
            async bootstrap() {},
            async close() {
              closed += 1;
            }
          }
        }),
        /中断|abort|interrupt/i
      );
      assert.equal(collected, 1);
      assert.equal(cancelled, 1);
      assert.equal(closed, 1);
      assert.equal(output, '');
      assert.equal(requests.length, 1);
      assert.equal(processSignals.listenerCount('SIGTERM'), 0);
      assert.equal(processSignals.listenerCount('SIGINT'), 0);
      assert.deepEqual(
        hooks.map((event) => event.event),
        ['assistant_turn_start', 'assistant_turn_cancelled']
      );
      const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
      assert.deepEqual(
        inner.map((event) => [event.event, event.status]),
        [
          ['start', undefined],
          ['end', 'cancelled']
        ]
      );
      const files = fs.readdirSync(path.join(fixture.home, '.echo'), {recursive: true});
      assert.ok(
        !files.some((name) => /(?:^|\/)sessions(?:\/|$)|\.jsonl$/.test(name)),
        files.join('\n')
      );
    });
  }
);
