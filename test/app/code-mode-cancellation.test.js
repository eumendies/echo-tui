const assert = require('node:assert/strict');
const test = require('node:test');
const {setTimeout: delay} = require('node:timers/promises');
const {runAssistantTurn} = require('../../src/app/assistant-turn-runner');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {scriptFailure} = require('../../src/tools/code-mode/contracts');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {withCodeModeProject, codeCall, toolProvider} = require('../helpers/code-mode-project');
const {createHarness} = require('./assistant-turn-test-helpers');

const skip = !isCodeRuntimeAvailable() && 'QuickJS/WASM 不可用；禁止弱隔离替代';

test(
  'Esc synchronously seals code audit and the outer pair before a new turn, dropping old asynchronous cleanup callbacks',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      const harness = createHarness({userConfigContext: fixture.context});
      fixture.decorateRegistry = (registry) =>
        createToolRegistry(
          registry.listDefinitions().map(({name}) => {
            const handler = registry.getHandler(name);
            return name === 'read_files'
              ? {
                  ...handler,
                  async executeScript(_args, _call, options) {
                    try {
                      await delay(400, undefined, {signal: options.abortSignal});
                    } catch {
                      await delay(25);
                    }
                    return scriptFailure('cancelled', 'PRIVATE_FILE_BODY');
                  }
                }
              : handler;
          })
        );
      const requests = [];
      fixture.createProvider = () =>
        toolProvider(
          [
            codeCall(
              `
      await Promise.all(Array.from({length:16}, () => tools.read_files({files:[{path:'one.txt'}]})));
      return true;
    `,
              'interrupted-code'
            )
          ],
          requests
        );
      let nextTurn;
      let interrupted;
      let oldExecutionId;
      let oldCallbacks;
      let starts = 0;
      let asynchronousOldEnd = 0;
      let interruptRequested = false;
      await runAssistantTurn({
        ...harness.input,
        async runAgent(session, callbacks) {
          oldCallbacks = callbacks;
          return fixture.run(session, {
            ...callbacks,
            onCodeExecutionRecords(batch) {
              if (batch[0].event === 'start') {
                oldExecutionId = batch[0].executionId;
              }
              if (batch.some((record) => record.event === 'end')) {
                asynchronousOldEnd += 1;
              }
              callbacks.onCodeExecutionRecords(batch);
              starts += batch.filter((record) => record.event === 'call_start').length;
              if (starts === 16 && !interruptRequested) {
                interruptRequested = true;
                interrupted = harness.appContext.interruptActiveAssistantTurn();
                fixture.createProvider = () => toolProvider([codeCall('return 2;', 'next-code')]);
                nextTurn = runAssistantTurn({
                  ...harness.input,
                  userText: 'next user turn',
                  runAgent: fixture.run
                });
              }
            }
          });
        }
      });
      assert.ok(nextTurn);
      await nextTurn;
      assert.equal(interrupted.interrupted, true);
      assert.equal(asynchronousOldEnd, 1);
      const records = harness.appContext.transcriptContext.getResidentRecords();
      const audit = records.filter(
        (record) => record.role === 'code_execution' && record.executionId === oldExecutionId
      );
      assert.equal(audit.length, 34);
      assert.deepEqual(
        audit.map((record) => record.sequence),
        audit.map((_, index) => index + 1)
      );
      assert.equal(audit.filter((record) => record.event === 'end').length, 1);
      assert.equal(audit.at(-1).status, 'cancelled');
      assert.ok(
        audit
          .filter((record) => record.event === 'call_end')
          .every((record) => record.status === 'cancelled')
      );
      const nextUserIndex = records.findIndex(
        (record) => record.role === 'user' && record.text === 'next user turn'
      );
      assert.ok(nextUserIndex > 0);
      assert.ok(
        records
          .slice(nextUserIndex)
          .every(
            (record) => record.role !== 'code_execution' || record.executionId !== oldExecutionId
          )
      );
      const outer = records.filter(
        (record) =>
          ['tool_call', 'tool_result'].includes(record.role) &&
          record.toolCallId === 'interrupted-code'
      );
      assert.deepEqual(
        outer.map((record) => record.role),
        ['tool_call', 'tool_result']
      );
      assert.equal(outer[1].details.interrupted, true);
      const nextResult = records.find(
        (record) => record.role === 'tool_result' && record.toolCallId === 'next-code'
      );
      assert.equal(JSON.parse(nextResult.text).result, 2);
      assert.equal(requests.length, 1);
      assert.equal(harness.appContext.turnContext.responding, false);
      const snapshot = JSON.stringify([records, harness.appended]);
      oldCallbacks.onCodeExecutionRecords([audit[0], audit.at(-1)]);
      await delay(30);
      assert.equal(
        JSON.stringify([
          harness.appContext.transcriptContext.getResidentRecords(),
          harness.appended
        ]),
        snapshot
      );
      assert.doesNotMatch(JSON.stringify(audit), /PRIVATE_FILE_BODY|one\.txt/);
      assert.ok(
        audit.reduce((bytes, record) => bytes + Buffer.byteLength(JSON.stringify(record)) + 1, 0) <
          32768
      );
    });
  }
);

test('controller rejects duplicate execution/child ends and never reopens a completed execution', async () => {
  const harness = createHarness();
  const base = {
    role: 'code_execution',
    toolCallId: 'outer',
    executionId: 'execution',
    durationMs: 0,
    text: 'safe summary'
  };
  await runAssistantTurn({
    ...harness.input,
    async runAgent(_session, callbacks) {
      const events = [
        {...base, sequence: 1, event: 'start'},
        {...base, sequence: 2, event: 'call_start', childCallId: 'execution:1', toolName: 'glob'},
        {
          ...base,
          sequence: 3,
          event: 'call_end',
          childCallId: 'execution:1',
          toolName: 'glob',
          status: 'succeeded'
        },
        {...base, sequence: 4, event: 'end', status: 'succeeded'}
      ];
      callbacks.onCodeExecutionRecords(events);
      callbacks.onCodeExecutionRecords([events[2], events[3], {...events[0], sequence: 5}]);
      callbacks.onComplete('done');
    }
  });
  const records = harness.appContext.transcriptContext
    .getResidentRecords()
    .filter((record) => record.role === 'code_execution');
  assert.deepEqual(
    records.map((record) => record.event),
    ['start', 'call_start', 'call_end', 'end']
  );
});
