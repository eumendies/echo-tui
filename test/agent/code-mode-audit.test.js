const assert = require('node:assert/strict');
const test = require('node:test');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {CODE_LIMITS} = require('../../src/tools/code-mode/protocol');
const {scriptFailure} = require('../../src/tools/code-mode/contracts');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {withCodeModeProject, codeCall, toolProvider} = require('../helpers/code-mode-project');

const skip = !isCodeRuntimeAvailable() && 'QuickJS/WASM 不可用；禁止弱隔离替代';
const session = {records: [{role: 'user', text: 'inspect local files'}]};

function assertAuditPairs(records, count) {
  assert.equal(records[0].event, 'start');
  assert.equal(records.at(-1).event, 'end');
  assert.equal(records.filter((record) => record.event === 'end').length, 1);
  assert.deepEqual(
    records.map((record) => record.sequence),
    records.map((_, index) => index + 1)
  );
  for (let id = 1; id <= count; id += 1) {
    const childCallId = `${records[0].executionId}:${id}`;
    const child = records.filter((record) => record.childCallId === childCallId);
    assert.deepEqual(
      child.map((record) => record.event),
      ['call_start', 'call_end']
    );
    assert.ok(
      child.every((record) => Number.isFinite(record.durationMs) && record.durationMs >= 0)
    );
  }
  assert.ok(records.every((record) => Buffer.byteLength(JSON.stringify(record)) + 1 <= 1024));
  assert.ok(
    records.reduce((bytes, record) => bytes + Buffer.byteLength(JSON.stringify(record)) + 1, 0) <=
      CODE_LIMITS.auditBytes
  );
}

test(
  'real policy dispatch audits bounded parameter shapes and pagination, never query/path/response contents',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      const records = [];
      const results = [];
      fixture.createProvider = () =>
        toolProvider([
          codeCall(`
      await tools.glob({pattern:'QUERY_PRIVATE_VALUE', paths:['PRIVATE_PATH_VALUE']});
      await tools.grep({pattern:'中文QUERY_PRIVATE_VALUE', paths:['one.txt'], literal:false, case_sensitive:true, glob:'*.txt'});
      await tools.read_files({files:[{path:'one.txt',offset:1,limit:1},{path:'two.txt'}]});
      return true;
    `)
        ]);
      await fixture.run(session, {
        onCodeExecutionRecords(batch) {
          records.push(...batch);
        },
        onToolResult(result) {
          results.push(result);
        }
      });
      assert.equal(JSON.parse(results[0].text).status, 'succeeded');
      assertAuditPairs(records, 3);
      const starts = records.filter((record) => record.event === 'call_start');
      assert.equal(starts[0].text, 'glob: pattern_bytes=19, paths=1');
      assert.match(
        starts[1].text,
        /pattern_bytes=25, paths=1, literal=false, case_sensitive=true, glob_bytes=5/
      );
      assert.equal(starts[2].text, 'read_files: files=2, pages=1:1,0:default');
      assert.doesNotMatch(
        JSON.stringify(records),
        /QUERY_PRIVATE_VALUE|PRIVATE_PATH_VALUE|PRIVATE_FILE_BODY|needle|one\.txt/
      );
      assert.match(records.at(-1).text, /attempted=3/);
      for (const {payload} of [...fixture.hookEvents, ...fixture.debugEvents].filter(
        ({payload}) => payload.toolOrigin
      )) {
        assert.ok(Buffer.byteLength(JSON.stringify(payload)) < 1024);
        assert.doesNotMatch(
          JSON.stringify(payload),
          /QUERY_PRIVATE_VALUE|PRIVATE_PATH_VALUE|PRIVATE_FILE_BODY/
        );
        assert.equal(payload.toolOrigin.parentToolCallId, 'outer-code');
      }
    });
  }
);

test(
  'validation refusal, registry refusal and collector failure have unique distinct audit/lifecycle ends',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      fixture.allowedToolNames = new Set(['run_code', 'glob']);
      fixture.decorateRegistry = (registry) =>
        createToolRegistry(
          registry.listDefinitions().map(({name}) => {
            const handler = registry.getHandler(name);
            return name === 'glob'
              ? {
                  ...handler,
                  async executeScript() {
                    throw new Error('PRIVATE_FILE_BODY secret callback error');
                  }
                }
              : handler;
          })
        );
      fixture.createProvider = () =>
        toolProvider([
          codeCall(`
      const invalid = await tools.grep({pattern:42});
      const denied = await tools.read_files({files:[{path:'one.txt'}]});
      const failed = await tools.glob({pattern:'*'});
      return [invalid.error.code, denied.error.code, failed.error.code];
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
      assert.deepEqual(outer.result, ['invalid_arguments', 'invalid_arguments', 'tool_failed']);
      assert.equal(outer.summary.failed, 3);
      assertAuditPairs(records, 3);
      assert.deepEqual(
        records.filter((record) => record.event === 'call_end').map((record) => record.status),
        ['rejected', 'rejected', 'failed']
      );
      const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
      assert.deepEqual(
        inner.map((event) => [event.event, event.status]),
        [
          ['start', undefined],
          ['end', 'rejected'],
          ['start', undefined],
          ['end', 'failed']
        ]
      );
      assert.doesNotMatch(
        JSON.stringify([records, inner, fixture.hookEvents, fixture.debugEvents]),
        /PRIVATE_FILE_BODY|secret callback error/
      );
    });
  }
);

test(
  'maximum-size identities and parameters retain every child/execution terminal within reserved audit capacity',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      fixture.createProvider = () =>
        toolProvider([
          codeCall(
            `
      const files = Array.from({length:10}, () => ({path:'one.txt',offset:9007199254740991,limit:9007199254740991}));
      return (await Promise.all(Array.from({length:16}, () => tools.read_files({files})))).length;
    `,
            '外'.repeat(85)
          )
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
      assert.equal(outer.status, 'succeeded', results[0].text);
      assert.equal(outer.result, 16);
      assert.equal(outer.summary.completed, 16);
      assertAuditPairs(records, 16);
      assert.equal(records.length, 34);
      assert.ok(
        records
          .filter((record) => record.event === 'call_start')
          .every((record) => record.text.includes('files=10'))
      );
      assert.doesNotMatch(JSON.stringify(records), /PRIVATE_FILE_BODY|one\.txt/);
    });
  }
);

test(
  'collector cancellation is a cancelled audit/lifecycle terminal, not an ordinary failure recoverable by guest code',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      let dispatched = 0;
      fixture.decorateRegistry = (registry) =>
        createToolRegistry(
          registry.listDefinitions().map(({name}) => {
            const handler = registry.getHandler(name);
            return name === 'read_files'
              ? {
                  ...handler,
                  async executeScript() {
                    dispatched += 1;
                    return scriptFailure('cancelled', 'Local collector cancelled');
                  }
                }
              : handler;
          })
        );
      fixture.createProvider = () =>
        toolProvider([
          codeCall(`
      try { await tools.read_files({files:[{path:'one.txt'}]}); } catch (_) {}
      await tools.read_files({files:[{path:'two.txt'}]});
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
      assert.equal(outer.status, 'cancelled', results[0].text);
      assert.equal(outer.error.code, 'cancelled');
      assert.equal(dispatched, 1);
      assertAuditPairs(records, 1);
      assert.equal(records.find((record) => record.event === 'call_end').status, 'cancelled');
      assert.equal(records.at(-1).status, 'cancelled');
      const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
      assert.deepEqual(
        inner.map((event) => [event.event, event.status]),
        [
          ['start', undefined],
          ['end', 'cancelled']
        ]
      );
    });
  }
);

test(
  'throwing local audit and hook/debug consumers cannot mask execution completion or leave lifecycle pairs open',
  {skip},
  async () => {
    await withCodeModeProject(async (fixture) => {
      fixture.hookEvents.push = () => {
        throw new Error('hook consumer failure');
      };
      fixture.debugEvents.push = () => {
        throw new Error('debug consumer failure');
      };
      fixture.createProvider = () =>
        toolProvider([codeCall('await tools.read_files({files:[{path:"one.txt"}]});return true;')]);
      const results = [];
      const records = [];
      await fixture.run(session, {
        onCodeExecutionRecords(batch) {
          records.push(...batch);
          throw new Error('untrusted observer failure');
        },
        onToolResult(result) {
          results.push(result);
        }
      });
      assert.equal(JSON.parse(results[0].text).status, 'succeeded');
      assertAuditPairs(records, 1);
      const inner = fixture.lifecycle.filter((event) => event.scope.toolOrigin);
      assert.deepEqual(
        inner.map((event) => event.event),
        ['start', 'end']
      );
      assert.equal(inner[1].status, 'succeeded');
    });
  }
);
