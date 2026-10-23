import {performance} from 'node:perf_hooks';
import {getQuickJS} from 'quickjs-emscripten';
import type {QuickJSContext, QuickJSDeferredPromise, QuickJSHandle} from 'quickjs-emscripten';
import {CODE_LIMITS, codeError, decodeCodeMessage} from './protocol';
import type {CodeError} from './protocol';
import {GUEST_BOOTSTRAP} from './guest-source';
import {validateScriptEnvelope} from './contracts';
import type {ScriptToolName} from './contracts';

/** 只执行可信固定初始化，供宿主探测依赖与 WASM 分发；不接收用户源码。 */
async function probe(): Promise<void> {
  const engine = await getQuickJS();
  const vm = engine.newContext();
  vm.runtime.setMemoryLimit(CODE_LIMITS.heap);
  vm.runtime.setInterruptHandler(() => false);
  vm.runtime.removeModuleLoader();
  vm.dispose();
}

/** 每个 child 只接受一次 start，结束后关闭 IPC 与整个进程，不保留 REPL 状态。 */
async function run(start: Record<string, unknown>): Promise<void> {
  const executionId = start.executionId as string;
  let vm: QuickJSContext | undefined;
  let root: QuickJSHandle | undefined;
  let helpers: QuickJSHandle | undefined;
  let sequence = 0;
  let closed = false;
  let cpu = 0;
  let sliceStart = 0;
  let pumping = false;
  let fatalError: CodeError | undefined;
  let logEntries = 0;
  let logBytes = 0;
  let logOverflow = false;
  let phase: CodeError['phase'] = 'compile';
  const pending = new Map<
    number,
    {
      name: ScriptToolName; // 已固定的方法，用于验证对应宿主响应契约。
      deferred: QuickJSDeferredPromise; // 仅在当前 context 内存活的 guest Promise。
    }
  >();
  // 自然退出仅兜底进程寿命；父进程预算从探测/启动前开始，并负责取消时强制终止。
  const wall = setTimeout(() => process.exit(1), CODE_LIMITS.wallMs);
  function send(message: Record<string, unknown>): void {
    if (!closed && process.connected) {
      process.send?.(JSON.stringify({...message, executionId}), (error) => {
        if (error) {
          process.exit(1);
        }
      });
    }
  }
  function close(message: Record<string, unknown>): void {
    if (closed) {
      return;
    }
    closed = true;
    clearTimeout(wall);
    process.removeListener('message', onMessage);
    try {
      for (const {deferred} of pending.values()) {
        if (deferred.alive) {
          deferred.dispose();
        }
      }
      pending.clear();
      root?.dispose();
      helpers?.dispose();
      vm?.dispose();
    } catch {
      /* WASM 失败后销毁也可能失败；退出进程释放余下状态，不回退宿主求值。 */
    }
    if (process.connected) {
      process.send?.(JSON.stringify({...message, executionId}), () => process.exit(0));
    } else {
      process.exit(0);
    }
  }
  function latch(error: CodeError): void {
    if (!fatalError) {
      // 只锁存，退出当前 guest 求值后由 close 提交一次终态，避免重入销毁或重复消息。
      fatalError = error;
    }
  }
  function fail(error: unknown): void {
    let failure: CodeError;
    if (fatalError) {
      failure = fatalError;
    } else if (error && typeof error === 'object' && 'phase' in error && 'code' in error) {
      failure = error as CodeError;
    } else {
      const message = error instanceof Error ? error.message : 'Guest execution failed';
      failure = codeError('script_error', message, phase);
    }
    if (/out of memory/i.test(failure.message)) {
      failure = codeError('memory_limit_exceeded', 'Guest heap exceeded 32 MiB', phase);
    } else if (phase === 'compile' && failure.code === 'script_error') {
      failure.code = 'syntax_error';
    }
    close({kind: 'error', error: failure});
  }
  /** 所有 guest 求值、诊断与 Promise jobs 累计计时；IPC 工具等待不计入。 */
  function active<T>(fn: () => T): T {
    sliceStart = performance.now();
    try {
      const result = fn();
      if (cpu + performance.now() - sliceStart >= CODE_LIMITS.cpuMs) {
        latch(codeError('computation_limit_exceeded', 'Guest computation exceeded 1,000ms', phase));
      }
      if (fatalError) {
        throw fatalError;
      }
      return result;
    } finally {
      cpu += performance.now() - sliceStart;
    }
  }
  /** guest 内只取有界自有数据属性；位置去除 async 函数包装产生的一行偏移。 */
  function diagnostic(handle: QuickJSHandle): CodeError {
    if (fatalError) {
      return fatalError;
    }
    let message = 'Guest threw a non-Error value';
    let stack = '';
    if (vm && helpers) {
      const diagnose = vm.getProp(helpers, 'diagnose');
      try {
        const result = vm.callFunction(diagnose, vm.undefined, handle);
        if (result.error) {
          result.error.dispose();
        } else {
          try {
            const fields = JSON.parse(vm.getString(result.value)) as {
              message: string; // guest 已按字符限制的错误消息。
              stack: string; // 只用于提取用户源码位置，不返回完整堆栈。
            };
            message = fields.message || message;
            stack = fields.stack;
          } finally {
            result.value.dispose();
          }
        }
      } finally {
        diagnose.dispose();
      }
    }
    const error = codeError('script_error', message, phase);
    const location = /run-code\.js:(\d+)(?::(\d+))?/.exec(stack);
    if (location) {
      const line = Number(location[1]) - 1;
      const sourceLines = (start.code as string).split('\n').length;
      if (Number.isSafeInteger(line) && line > 0 && line <= sourceLines) {
        error.line = line;
        const column = Number(location[2]);
        if (Number.isSafeInteger(column) && column > 0 && column <= CODE_LIMITS.source) {
          error.column = column;
        }
      } else if (phase === 'compile' && line === sourceLines + 1) {
        // EOF 错误可能指向包装的结束行，只回退到最后一条用户行，不伪造列号。
        error.line = sourceLines;
      }
    }
    return error;
  }
  function unwrap(result: ReturnType<QuickJSContext['evalCode']>): QuickJSHandle {
    if (result.error) {
      try {
        throw diagnostic(result.error);
      } finally {
        result.error.dispose();
      }
    }
    return result.value;
  }
  function pump(): void {
    if (closed || !vm || !root || pumping) {
      return;
    }
    pumping = true;
    try {
      const result = active(() => {
        const jobs = vm!.runtime.executePendingJobs();
        if (jobs.error) {
          try {
            throw diagnostic(jobs.error);
          } finally {
            jobs.error.dispose();
          }
        }
        const state = vm!.getPromiseState(root!);
        if (state.type === 'pending') {
          return undefined;
        }
        if (state.type === 'rejected') {
          try {
            throw diagnostic(state.error);
          } finally {
            state.error.dispose();
          }
        }
        try {
          if (vm!.typeof(state.value) !== 'string') {
            throw codeError('contract_error', 'Guest completion is not an encoded JSON string', 'serialize');
          }
          const length = vm!.getProp(state.value, 'length');
          try {
            if (vm!.getNumber(length) > CODE_LIMITS.result) {
              throw codeError('result_limit_exceeded', 'Final JSON exceeds 16 KiB', 'serialize');
            }
          } finally {
            length.dispose();
          }
          return vm!.getString(state.value);
        } finally {
          state.value.dispose();
        }
      });
      if (result === undefined) {
        return;
      }
      if (pending.size > 0) {
        close({kind: 'error', error: codeError('pending_tool_calls', 'Await all tool calls before returning', 'tool')});
      } else {
        close({kind: 'result', result});
      }
    } catch (error) {
      fail(error);
    } finally {
      pumping = false;
    }
  }
  function onMessage(raw: unknown): void {
    if (closed) {
      return;
    }
    const message = decodeCodeMessage(raw);
    if (!message || message.executionId !== executionId || message.kind !== 'reply' || !pending.has(message.id as number)) {
      close({kind: 'error', error: codeError('contract_error', 'Invalid host reply identity or shape', 'tool')});
      return;
    }
    const id = message.id as number;
    const {name, deferred} = pending.get(id)!;
    const envelope = validateScriptEnvelope(name, JSON.parse(message.json as string));
    if (!envelope.ok) {
      close({kind: 'error', error: codeError('contract_error', 'Host reply violates the tool contract', 'tool')});
      return;
    }
    pending.delete(id);
    try {
      active(() => {
        const value = vm!.newString(message.json as string);
        try {
          deferred.resolve(value);
        } finally {
          value.dispose();
          deferred.dispose();
        }
      });
      pump();
    } catch (error) {
      fail(error);
    }
  }
  process.on('message', onMessage);
  try {
    const engine = await getQuickJS();
    if (closed) {
      return;
    }
    vm = engine.newContext();
    vm.runtime.setMemoryLimit(CODE_LIMITS.heap);
    vm.runtime.setMaxStackSize(256 * 1024);
    vm.runtime.removeModuleLoader();
    vm.runtime.setInterruptHandler(() => {
      if (cpu + performance.now() - sliceStart >= CODE_LIMITS.cpuMs) {
        latch(codeError('computation_limit_exceeded', 'Guest computation exceeded 1,000ms', phase));
      }
      return fatalError !== undefined;
    });
    const call = vm.newFunction('call', (nameHandle, jsonHandle) => {
      const id = ++sequence;
      const name = vm!.getString(nameHandle);
      const json = vm!.getString(jsonHandle);
      if (id > CODE_LIMITS.calls) {
        latch(codeError('call_limit_exceeded', 'At most 16 call attempts are allowed', 'tool'));
      } else if (json === '!argument-limit-exceeded' || Buffer.byteLength(json) > CODE_LIMITS.args) {
        send({kind: 'call', id, name, json: '!argument-limit-exceeded'});
        latch(codeError('argument_limit_exceeded', 'Tool arguments exceed 32 KiB', 'tool'));
      }
      if (fatalError) {
        return {error: vm!.newError(fatalError.code)};
      }
      const deferred = vm!.newPromise();
      pending.set(id, {
        name: name as ScriptToolName,
        deferred
      });
      send({kind: 'call', id, name, json});
      return deferred.handle;
    });
    const log = vm.newFunction('log', (message, truncated) => {
      const text = vm!.getString(message);
      const bytes = Buffer.byteLength(text);
      if (vm!.eq(truncated, vm!.true) || logEntries >= CODE_LIMITS.logEntries || logBytes + bytes > CODE_LIMITS.logBytes) {
        if (!logOverflow) {
          send({kind: 'log', truncated: true});
        }
        logOverflow = true;
        return;
      }
      logEntries++;
      logBytes += bytes;
      send({kind: 'log', text});
    });
    const fault = vm.newFunction('fault', (code) => {
      latch(codeError(vm!.getString(code), 'Final value is not bounded JSON data', 'serialize'));
    });
    const serialize = vm.newFunction('serialize', () => {
      phase = 'serialize';
    });
    for (const [name, handle] of [
      ['__echoCall', call],
      ['__echoLog', log],
      ['__echoFault', fault],
      ['__echoSerialize', serialize]
    ] as const) {
      vm.setProp(vm.global, name, handle);
      handle.dispose();
    }
    active(() => {
      helpers = unwrap(vm!.evalCode(GUEST_BOOTSTRAP, 'echo-bootstrap.js'));
      // 先只求出函数对象，保证语法错误与函数体执行错误的阶段不混淆。
      const fn = unwrap(vm!.evalCode(`(async function() {\n${start.code}\n})`, 'run-code.js'));
      phase = 'runtime';
      try {
        const promise = unwrap(vm!.callFunction(fn, vm!.undefined));
        const wrap = vm!.getProp(helpers, 'wrap');
        try {
          root = unwrap(vm!.callFunction(wrap, vm!.undefined, promise));
        } finally {
          promise.dispose();
          wrap.dispose();
        }
      } finally {
        fn.dispose();
      }
    });
    pump();
  } catch (error) {
    fail(error);
  }
}

if (process.argv.includes('--probe')) {
  // 即使外层环境不允许发送终止信号，可信初始化探测也有自己的有限寿命。
  setTimeout(() => process.exit(1), 4500);
  probe().then(
    () => process.exit(0),
    () => process.exit(1)
  );
} else {
  process.once('disconnect', () => process.exit(0));
  process.once('message', (raw: unknown) => {
    const message = decodeCodeMessage(raw);
    if (!message || message.kind !== 'start') {
      process.exit(1);
    }
    void run(message);
  });
}
