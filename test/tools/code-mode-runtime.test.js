const test = require('node:test');
const assert = require('node:assert/strict');
const {executeCode, isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');
const {createRunCodeToolHandler} = require('../../src/tools/code-mode/tool-handler');
const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {scriptFailure} = require('../../src/tools/code-mode/contracts');
const {CODE_LIMITS} = require('../../src/tools/code-mode/protocol');
const {canSignalChildProcesses} = require('../helpers/process-signals');
const {setTimeout: delay} = require('node:timers/promises');

const ready = isCodeRuntimeAvailable();
const skip = !ready && 'QuickJS/WASM 初始化失败，不能使用弱隔离替代';
const signals = canSignalChildProcesses();
const success = (paths = []) => ({
  schema_version: 1,
  ok: true,
  data: {
    paths,
    has_more: false
  },
  error: null,
  truncated: false
});
async function run(code, extra = {}) {
  const result = await executeCode({
    code,
    callId: 'outer-code-call',
    dispatch: async () => success(),
    ...extra
  });
  const {attempted, completed, failed, cancelled} = result.summary;
  assert.equal(attempted, completed + failed + cancelled, JSON.stringify(result));
  assert.ok(attempted <= CODE_LIMITS.calls);
  return result;
}

test('bare executor cannot grant script tools without a run policy port', async () => {
  const handler = createRunCodeToolHandler();
  const executor = createToolExecutor(createToolRegistry([handler]));
  const result = await executor.execute({
    toolName: 'run_code',
    callId: 'bare',
    argumentsText: '{"code":"return 1"}'
  });
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(result.text).error.code, ready ? 'policy_unavailable' : 'runtime_unavailable');
  assert.match(handler.definition.description, /UTF-8 bytes/);
});

test('QuickJS supports async body, native guest objects and empty return', {skip}, async () => {
  assert.deepEqual((await run('return {a: await Promise.resolve(42), b:[true,null,"中文😀"]};')).result, {
    a: 42,
    b: [true, null, '中文😀']
  });
  assert.equal((await run('')).result, null);
});

test('guest cannot acquire host process, env, fs, network, modules or constructors', {skip}, async () => {
  const result = await run(
    `return [typeof process,typeof require,typeof Buffer,typeof fetch,typeof WebAssembly,typeof tools.glob.constructor('return this')().process,typeof __echoCall,typeof __echoLog];`
  );
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(result.result, Array(8).fill('undefined'));
  const imported = await run('return await import("node:fs");');
  assert.equal(imported.status, 'failed');
});

test('script tools await structured envelopes and ordinary failures are inspectable', {skip}, async () => {
  const calls = [];
  const result = await run(
    `const a=await tools.glob({pattern:'*'}); const b=await tools.glob({pattern:'none'}); return {a:a.data.paths,b:b.error.code};`,
    {
      dispatch: async (name, args, id) => {
        calls.push({
          name,
          args,
          id
        });
        return args.pattern === '*' ? success(['a.ts']) : scriptFailure('tool_failed', 'ordinary error');
      }
    }
  );
  assert.deepEqual(result.result, {
    a: ['a.ts'],
    b: 'tool_failed'
  });
  assert.equal(result.summary.completed, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].id, calls[1].id);
});

test('queue caps actual host concurrency at two and audit is bounded and ordered', {skip}, async () => {
  let active = 0;
  let max = 0;
  const audit = [];
  const result = await run(`return (await Promise.all(Array.from({length:8},()=>tools.glob({pattern:'*'})))).length`, {
    dispatch: async () => {
      max = Math.max(max, ++active);
      await delay(10);
      active--;
      return success(['DO_NOT_AUDIT_FILE_BODY']);
    },
    onAudit: (record) => audit.push(record)
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.result, 8);
  assert.equal(max, 2);
  assert.equal(active, 0);
  assert.deepEqual(
    audit.map((r) => r.sequence),
    audit.map((_, i) => i + 1)
  );
  assert.equal(audit[0].event, 'start');
  assert.equal(audit.at(-1).event, 'end');
  assert.equal(audit.filter((r) => r.event === 'call_end').length, 8);
  assert.doesNotMatch(JSON.stringify(audit), /DO_NOT_AUDIT_FILE_BODY/);
  assert.ok(Buffer.byteLength(JSON.stringify(audit)) < CODE_LIMITS.auditBytes);
});

test('invalid arguments count as attempts without calling collectors', {skip}, async () => {
  let calls = 0;
  const result = await run(
    `const a=await tools.glob({pattern:'x',extra:true}); const b=await tools.glob(null); return [a.error.code,b.error.code];`,
    {
      dispatch: async () => {
        calls++;
        return success();
      }
    }
  );
  assert.deepEqual(result.result, ['invalid_arguments', 'invalid_arguments']);
  assert.equal(result.summary.attempted, 2);
  assert.equal(calls, 0);
});

test('source and JSON results have strict budgets without silent coercion', {skip}, async () => {
  assert.equal((await run(' '.repeat(32769))).error.code, 'source_limit_exceeded');
  for (const code of [
    'return 1n;',
    'return NaN;',
    'return ()=>1;',
    'return Symbol();',
    'const a={};a.self=a;return a;',
    'return {x:undefined};',
    'return new Date();',
    'return [,1];'
  ]) {
    const result = await run(code);
    assert.equal(result.error?.code, 'serialization_error', `${code}: ${JSON.stringify(result)}`);
    assert.equal(result.error.phase, 'serialize');
  }
  assert.equal((await run('return "x".repeat(17000);')).error.code, 'result_limit_exceeded');
  assert.equal((await run('return "中文😀".repeat(3000);')).error.code, 'result_limit_exceeded');
});

test('compile failure performs no inner calls; guest state is not persistent', {skip}, async () => {
  let called = false;
  const broken = await run('const =;', {
    dispatch: async () => {
      called = true;
      return success();
    }
  });
  assert.equal(broken.error.phase, 'compile');
  assert.equal(called, false);
  await run('globalThis.privateState=123;return true;');
  assert.equal((await run('return typeof privateState')).result, 'undefined');
});

test('logs cap guest emission and outer storage, and guest computation is interrupted', {skip}, async () => {
  const logged = await run('for(let i=0;i<1000;i++)console.log("中文😀".repeat(40)); return true;');
  assert.equal(logged.status, 'succeeded', JSON.stringify(logged));
  assert.equal(logged.logs_truncated, true);
  assert.ok(logged.logs.length <= 32);
  assert.ok(logged.logs.reduce((n, s) => n + Buffer.byteLength(s), 0) <= 8192);
  const started = Date.now();
  const result = await run('while(true){}');
  assert.equal(result.error.code, 'computation_limit_exceeded');
  assert.ok(Date.now() - started < 3000);
});

test('global call budget cannot be caught to reopen dispatch', {skip}, async () => {
  let calls = 0;
  const result = await run('for(let i=0;i<100;i++){try {await tools.glob({pattern:"*"})}catch{}} return true;', {
    dispatch: async () => {
      calls++;
      return success();
    }
  });
  assert.equal(result.error.code, 'call_limit_exceeded');
  assert.ok(calls <= 16);
});

test('internal output contract failure irrevocably closes dispatch', {skip}, async () => {
  let calls = 0;
  const result = await run('try {await tools.glob({pattern:"*"})}catch{} return true;', {
    dispatch: async () => {
      calls++;
      return {invalid: true};
    }
  });
  assert.equal(result.error.code, 'contract_error');
  assert.equal(calls, 1);
});

test('unawaited tools are cancelled and no callbacks change the terminal result', {skip}, async () => {
  let cancelled = false;
  const result = await run('tools.glob({pattern:"*"});return 42;', {
    dispatch: async (_n, _a, _id, signal) => {
      await delay(25, undefined, {signal}).catch(() => {
        cancelled = true;
      });
      return success();
    }
  });
  assert.equal(result.error.code, 'pending_tool_calls');
  assert.equal(result.result, null);
  assert.equal(result.summary.cancelled, 1);
  assert.equal(cancelled, true);
  const snapshot = JSON.stringify(result);
  await delay(30);
  assert.equal(JSON.stringify(result), snapshot);
});

test('already cancelled execution never invokes a tool', {skip}, async () => {
  const controller = new AbortController();
  controller.abort();
  assert.equal((await run('return 42', {signal: controller.signal})).status, 'cancelled');
});

test(
  'active cancellation enters forced child termination within one second',
  {skip: skip || (!signals && '需在允许宿主管理自建子进程的终端验证')},
  async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const started = Date.now();
    assert.equal((await run('while(true){}', {signal: controller.signal})).status, 'cancelled');
    assert.ok(Date.now() - started < 1200);
  }
);

test('captured intrinsics survive prototype poisoning without changing bridge data', {skip}, async () => {
  const result = await run(`
    const poison = () => { throw new Error('poisoned intrinsic'); };
    JSON.stringify = poison;
    JSON.parse = poison;
    Reflect.apply = poison;
    Reflect.ownKeys = poison;
    Object.getOwnPropertyDescriptor = poison;
    Object.getPrototypeOf = poison;
    Object.prototype.toJSON = poison;
    Object.prototype.value = 'inherited fake descriptor';
    Array.prototype[Symbol.iterator] = poison;
    Set.prototype.has = poison;
    Set.prototype.add = poison;
    Set.prototype.delete = poison;
    String.prototype.charCodeAt = poison;
    Promise.prototype.then = poison;
    globalThis.String = poison;
    globalThis.Set = poison;
    const response = await tools.glob({pattern:'*'});
    return {paths:response.data.paths, unicode:'中文😀', count:3};
  `, {
    dispatch: async (name, args) => {
      assert.equal(name, 'glob');
      assert.equal(args.pattern, '*');
      return success(['safe.ts']);
    }
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(result.result, {
    paths: ['safe.ts'],
    unicode: '中文😀',
    count: 3
  });
});

test('tools expose exactly readonly collectors and reject prototype-shaped inputs', {skip}, async () => {
  let calls = 0;
  const result = await run(`
    let rejected = false;
    try { Object.setPrototypeOf(tools, {bash: () => 1}); } catch { rejected = true; }
    const bad = await tools.glob(JSON.parse('{"pattern":"*","__proto__":{"allowed":true}}'));
    return {keys:Object.keys(tools), frozen:Object.isFrozen(tools), prototype:Object.getPrototypeOf(tools), rejected, bad:bad.error.code};
  `, {
    dispatch: async () => {
      calls++;
      return success();
    }
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(result.result, {
    keys: ['glob', 'grep', 'read_files'],
    frozen: true,
    prototype: null,
    rejected: true,
    bad: 'invalid_arguments'
  });
  assert.equal(calls, 0);
});

test('argument byte overflow is fatal even when caught and includes the attempt', {skip}, async () => {
  for (const value of ['"x".repeat(33000)', '"中文😀".repeat(4000)']) {
    let calls = 0;
    const result = await run(`
      try { await tools.glob({pattern:${value}}); } catch {}
      try { await tools.glob({pattern:'*'}); } catch {}
      return true;
    `, {
      dispatch: async () => {
        calls++;
        return success();
      }
    });
    assert.equal(result.error?.code, 'argument_limit_exceeded', JSON.stringify(result));
    assert.equal(result.error.phase, 'tool');
    assert.equal(result.summary.attempted, 1);
    assert.equal(calls, 0);
  }
});

test('single oversized log entries set truncation rather than emitting an unmarked placeholder', {skip}, async () => {
  const result = await run('console.log("中文😀".repeat(10000));console.warn("kept");return true;');
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.logs_truncated, true);
  assert.deepEqual(result.logs, ['warn ["kept"]']);
});

test('single and aggregate response overflow permanently close dispatch', {skip}, async () => {
  let calls = 0;
  const single = await run(`
    try { await tools.glob({pattern:'*'}); } catch {}
    try { await tools.glob({pattern:'*'}); } catch {}
    return true;
  `, {
    dispatch: async () => {
      calls++;
      return success(['x'.repeat(CODE_LIMITS.response)]);
    }
  });
  assert.equal(single.error?.code, 'response_limit_exceeded', JSON.stringify(single));
  assert.equal(calls, 1);
  calls = 0;
  const aggregate = await run(`
    for (let i = 0; i < 16; i++) {
      try { await tools.glob({pattern:'*'}); } catch {}
    }
    return true;
  `, {
    dispatch: async () => {
      calls++;
      return success(['x'.repeat(60000)]);
    }
  });
  assert.equal(aggregate.error?.code, 'response_limit_exceeded', JSON.stringify(aggregate));
  assert.equal(aggregate.error.phase, 'tool');
  assert.equal(calls, 9);
  assert.equal(aggregate.summary.completed, 8);
});

test('collector-reported global result limits cannot be treated as ordinary tool errors', {skip}, async () => {
  let calls = 0;
  const result = await run(`
    const first = await tools.glob({pattern:'*'});
    await tools.glob({pattern:'again'});
    return first.ok;
  `, {
    dispatch: async () => {
      calls++;
      return scriptFailure('result_limit_exceeded', 'Cannot fit a result item');
    }
  });
  assert.equal(result.error?.code, 'result_limit_exceeded', JSON.stringify(result));
  assert.equal(result.error.phase, 'tool');
  assert.equal(calls, 1);
});

test('guest heap failure is isolated and does not poison a fresh execution', {skip}, async () => {
  const result = await run('return new ArrayBuffer(64 * 1024 * 1024);');
  assert.equal(result.error?.code, 'memory_limit_exceeded', JSON.stringify(result));
  assert.equal(result.error.phase, 'runtime');
  assert.equal((await run('return 42;')).result, 42);
});

test('caught heap allocation failure may continue without raising the heap limit', {skip}, async () => {
  let hostCalls = 0;
  const result = await run(`
    let rejected = 0;
    for (let i = 0; i < 2; i++) {
      try {
        new ArrayBuffer(64 * 1024 * 1024);
      } catch {
        rejected++;
      }
    }
    const files = await tools.glob({pattern: '*'});
    return {rejected, ok: files.ok};
  `, {
    dispatch: async () => {
      hostCalls++;
      return success();
    }
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(result.result, {rejected: 2, ok: true});
  assert.equal(hostCalls, 1);
  assert.equal(result.error, null);
});

test('catching memory failure cannot restore dispatch after an argument limit', {skip}, async () => {
  let hostCalls = 0;
  const result = await run(`
    try {
      new ArrayBuffer(64 * 1024 * 1024);
    } catch {}
    try {
      await tools.glob({pattern: 'x'.repeat(40000)});
    } catch {}
    try {
      await tools.glob({pattern: '*'});
    } catch {}
    return true;
  `, {
    dispatch: async () => {
      hostCalls++;
      return success();
    }
  });
  assert.equal(result.status, 'failed', JSON.stringify(result));
  assert.equal(result.error?.code, 'argument_limit_exceeded');
  assert.equal(hostCalls, 0);
});

test('active computation accumulates across Promise jobs but excludes tool waits', {skip}, async () => {
  let calls = 0;
  const started = Date.now();
  const result = await run(`
    for (let i = 0; i < 16; i++) {
      const until = Date.now() + 220;
      while (Date.now() < until) {}
      await tools.glob({pattern:'*'});
    }
    return true;
  `, {
    dispatch: async () => {
      calls++;
      await delay(150);
      return success();
    }
  });
  assert.equal(result.error?.code, 'computation_limit_exceeded', JSON.stringify(result));
  assert.ok(calls >= 3 && calls <= 5, `unexpected host calls: ${calls}`);
  assert.ok(Date.now() - started >= 1300);
  const waits = await run(`
    for (let i = 0; i < 3; i++) await tools.glob({pattern:'*'});
    return true;
  `, {
    dispatch: async () => {
      await delay(400);
      return success();
    }
  });
  assert.equal(waits.status, 'succeeded', JSON.stringify(waits));
  assert.ok(waits.summary.duration_ms >= 1200);
});

test('errors preserve compile/runtime phases and map user source line and column', {skip}, async () => {
  const compile = await run('\nconst x = ;');
  assert.equal(compile.error.code, 'syntax_error');
  assert.equal(compile.error.phase, 'compile');
  assert.equal(compile.error.line, 2);
  assert.equal(compile.error.column, 11);
  const runtime = await run('\nawait tools.glob({pattern:"*"});\nthrow new Error("broken");');
  assert.equal(runtime.error.code, 'script_error');
  assert.equal(runtime.error.phase, 'runtime');
  assert.equal(runtime.error.line, 3);
  assert.equal(runtime.error.column, 16);
});

test('bounded diagnostics ignore getters, enormous messages and polluted toJSON', {skip}, async () => {
  const diagnostic = await run(`
    Object.prototype.toJSON = () => { throw new Error('must not execute'); };
    throw new Error('中文😀'.repeat(100000));
  `);
  assert.equal(diagnostic.error?.code, 'script_error', JSON.stringify(diagnostic));
  assert.ok(Buffer.byteLength(diagnostic.error.message) <= 1024);
  const getter = await run('throw {get message(){while(true){}}, get stack(){while(true){}}};');
  assert.equal(getter.error?.code, 'script_error', JSON.stringify(getter));
  assert.match(getter.error.message, /non-Error/);
});

test('serialization rejects nonfinite, deep, symbol, accessor and hidden values without invoking getters', {skip}, async () => {
  for (const code of [
    'return {number:Infinity};',
    'return [NaN];',
    'return {value:Symbol()};',
    'const x={};Object.defineProperty(x,"hidden",{value:1});return x;',
    'return {get value(){while(true){}}};',
    'let x={};for(let i=0;i<40;i++)x={x};return x;',
    'return {[Symbol()]:1};',
    'return Object.assign([1],{extra:2});'
  ]) {
    const result = await run(code);
    assert.equal(result.error?.code, 'serialization_error', `${code}: ${JSON.stringify(result)}`);
    assert.equal(result.error.phase, 'serialize');
  }
  const jsonKeys = await run('return JSON.parse(\'{"__proto__":{"safe":true},"constructor":1}\');');
  assert.equal(jsonKeys.status, 'succeeded', JSON.stringify(jsonKeys));
  assert.equal(Object.hasOwn(jsonKeys.result, '__proto__'), true);
  assert.equal(Object.prototype.safe, undefined);
});

test('serialization-time hostile proxy work is covered by the active computation limit', {skip}, async () => {
  const result = await run('return new Proxy({}, {ownKeys(){while(true){}}});');
  assert.equal(result.error?.code, 'computation_limit_exceeded', JSON.stringify(result));
  assert.equal(result.error.phase, 'serialize');
});

test('audit reserves all terminal records even at the maximum internal call count', {skip}, async () => {
  const audit = [];
  const result = await run('return (await Promise.all(Array.from({length:16},()=>tools.glob({pattern:"*"})))).length;', {
    callId: '外'.repeat(85),
    dispatch: async () => success(['PRIVATE_FILE_CONTENT']),
    onAudit: (record) => audit.push(record)
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.summary.attempted, 16);
  assert.equal(result.summary.completed, 16);
  assert.equal(audit.filter((record) => record.event === 'call_start').length, 16);
  assert.equal(audit.filter((record) => record.event === 'call_end').length, 16);
  assert.equal(audit.filter((record) => record.event === 'end').length, 1);
  assert.ok(audit.reduce((bytes, record) => bytes + Buffer.byteLength(JSON.stringify(record)) + 1, 0) <= CODE_LIMITS.auditBytes);
  assert.doesNotMatch(JSON.stringify(audit), /PRIVATE_FILE_CONTENT/);
});

test('observer exceptions cannot block cleanup or leak late terminal events', {skip}, async () => {
  const result = await run('await tools.glob({pattern:"*"});return true;', {
    onAudit: () => {
      throw new Error('observer failure');
    }
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
});

test('unawaited queued calls never dispatch after the execution has closed', {skip}, async () => {
  let dispatched = 0;
  let aborted = 0;
  const audit = [];
  const result = await run(`
    for (let i = 0; i < 16; i++) tools.glob({pattern:'*'});
    return true;
  `, {
    dispatch: async (_name, _args, _id, signal) => {
      dispatched++;
      try {
        await delay(40, undefined, {signal});
      } catch {
        aborted++;
      }
      return success();
    },
    onAudit: (record) => audit.push(record)
  });
  assert.equal(result.error?.code, 'pending_tool_calls', JSON.stringify(result));
  assert.equal(dispatched, 2);
  assert.equal(aborted, 2);
  assert.equal(result.summary.cancelled, 16);
  assert.equal(audit.filter((record) => record.event === 'call_end').length, 16);
  assert.equal(audit.filter((record) => record.event === 'end').length, 1);
  const snapshot = JSON.stringify({result, audit});
  await delay(60);
  assert.equal(dispatched, 2);
  assert.equal(JSON.stringify({result, audit}), snapshot);
});

test('wall budget includes startup time before the child is forked', {skip}, async () => {
  const now = Date.now;
  let samples = 0;
  let dispatched = false;
  try {
    Date.now = () => ++samples === 1 ? 1000 : 1000 + CODE_LIMITS.wallMs;
    const result = await run('return true;', {
      dispatch: async () => {
        dispatched = true;
        return success();
      }
    });
    assert.equal(result.error?.code, 'wall_time_exceeded', JSON.stringify(result));
    assert.ok(result.summary.duration_ms >= CODE_LIMITS.wallMs);
    assert.equal(dispatched, false);
  } finally {
    Date.now = now;
  }
});

test('Promise constructor/species poisoning cannot replace the internal completion chain', {skip}, async () => {
  const result = await run(`
    const replacement = function(executor) {
      executor(() => {}, () => {});
      return {toString(){throw new Error('must not stringify a foreign completion')}};
    };
    Object.defineProperty(Promise, Symbol.species, {value:replacement});
    Object.defineProperty(Promise.prototype, 'constructor', {get(){throw new Error('poisoned constructor')}});
    const found = await tools.glob({pattern:'*'});
    return {paths:found.data.paths};
  `, {
    dispatch: async () => success(['safe.ts'])
  });
  assert.equal(result.status, 'succeeded', JSON.stringify(result));
  assert.deepEqual(result.result, {paths: ['safe.ts']});
});

test('synchronous cancellation during call observation prevents an already scheduled dispatch', {skip}, async () => {
  const controller = new AbortController();
  const audit = [];
  let calls = 0;
  const result = await run('await tools.glob({pattern:"*"});return true;', {
    signal: controller.signal,
    dispatch: async () => {
      calls++;
      return success();
    },
    onAudit: (record) => {
      audit.push(record);
      if (record.event === 'call_start') {
        controller.abort();
      }
    }
  });
  assert.equal(result.status, 'cancelled', JSON.stringify(result));
  assert.equal(calls, 0);
  assert.equal(result.summary.cancelled, 1);
  assert.equal(audit.filter((record) => record.event === 'end').length, 1);
});

test('finite late collectors cannot mutate a result after cleanup has timed out', {skip}, async () => {
  const audit = [];
  const result = await run('tools.glob({pattern:"*"});return true;', {
    dispatch: async () => {
      await delay(1200);
      return success(['LATE_PRIVATE_CONTENT']);
    },
    onAudit: (record) => audit.push(record)
  });
  assert.equal(result.error?.code, 'cleanup_failed', JSON.stringify(result));
  assert.equal(result.summary.cancelled, 1);
  const snapshot = JSON.stringify({result, audit});
  await delay(250);
  assert.equal(JSON.stringify({result, audit}), snapshot);
  assert.equal(audit.filter((record) => record.event === 'end').length, 1);
  assert.doesNotMatch(snapshot, /LATE_PRIVATE_CONTENT/);
});


test('log entry count and UTF-8 source bytes have independent fixed limits', {skip}, async () => {
  const logged = await run('for(let i=0;i<100;i++)console.log(i);return true;');
  assert.equal(logged.logs.length, CODE_LIMITS.logEntries);
  assert.equal(logged.logs_truncated, true);
  const source = await run('中'.repeat(11000));
  assert.equal(source.error?.code, 'source_limit_exceeded', JSON.stringify(source));
  assert.equal(source.error.phase, 'compile');
});

test('forged enormous error locations remain bounded diagnostics rather than malformed IPC', {skip}, async () => {
  const result = await run('throw {message:"bounded",stack:"at run-code.js:999999999999999999999:999999999"};');
  assert.equal(result.error?.code, 'script_error', JSON.stringify(result));
  assert.equal(result.error.line, undefined);
  assert.equal(result.error.column, undefined);
});
