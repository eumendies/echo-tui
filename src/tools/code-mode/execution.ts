import {fork, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {SCRIPT_TOOL_NAMES, scriptFailure, validateScriptEnvelope, validateScriptInput} from './contracts';
import type {ScriptToolName} from './contracts';
import {CODE_LIMITS, codeError, decodeCodeMessage, encodeCodeJson} from './protocol';
import type {CodeError, CodeResult, CodeToolDispatch} from './protocol';
import type {CodeExecutionTranscriptRecord} from '../../types/transcript';
import type {ToolLifecycleStatus} from '../../types/tool';

type ExecutionOptions = {
  code: string; // 单次 async 函数体，不能解释为宿主源码。
  callId: string; // 外层 provider 工具调用身份。
  signal?: AbortSignal; // 当前 turn 取消入口。
  dispatch: CodeToolDispatch; // 必须经过当前 run 的策略边界，不能传裸 executor。
  onAudit?: (record: CodeExecutionTranscriptRecord) => void; // 本地事件持久化与展示，不向 provider 返回。
};

let runtimeReady: boolean | undefined;

/** 只保留参数的形状、字节数与分页选项；查询、路径和文件正文都不复制进审计。 */
function summarizeArguments(name: ScriptToolName, args: Record<string, unknown>): string {
  if (name === 'read_files') {
    const files = args.files as Record<string, unknown>[];
    const pages = files.slice(0, 3).map((file) => `${file.offset}:${file.limit ?? 'default'}`).join(',');
    return `files=${files.length}, pages=${pages}${files.length > 3 ? ',...' : ''}`;
  }
  const fields = [
    `pattern_bytes=${Buffer.byteLength(args.pattern as string)}`,
    `paths=${(args.paths as string[]).length}`
  ];
  if (name === 'grep') {
    fields.push(
      `literal=${args.literal}`,
      `case_sensitive=${args.case_sensitive ?? 'default'}`,
      `glob_bytes=${typeof args.glob === 'string' ? Buffer.byteLength(args.glob) : 0}`
    );
  }
  return fields.join(', ');
}

/** 每个宿主只探测一次可信引擎初始化；失败时隐藏入口，不降级为 Node 求值。 */
export function isCodeRuntimeAvailable(): boolean {
  if (runtimeReady !== undefined) {
    return runtimeReady;
  }
  try {
    runtimeReady =
      spawnSync(process.execPath, [require.resolve('./child'), '--probe'], {
        env: {PATH: process.env.PATH || ''},
        stdio: 'ignore',
        timeout: 5000
      }).status === 0;
  } catch {
    runtimeReady = false;
  }
  return runtimeReady;
}

/** 以唯一终态管理 child、两路宿主工具、取消与有界审计；返回值不包含中间工具正文。 */
export async function executeCode(options: ExecutionOptions): Promise<CodeResult> {
  const started = Date.now();
  const executionId = randomUUID();
  const summary = {
    attempted: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    duration_ms: 0
  };
  const logs: string[] = [];
  let logsBytes = 0;
  let logsTruncated = false;
  let responseBytes = 0;
  let auditBytes = 0;
  let eventSequence = 0;
  let terminalReserve = (CODE_LIMITS.calls + 1) * 1024;
  let closed = false;
  let active = 0;
  let nextCall = 0;
  const controller = new AbortController();
  const queued: Array<{
    id: number; // 当前 execution 内严格递增的调用序号。
    name: ScriptToolName; // 已通过固定白名单校验的工具名。
    args: Record<string, unknown>; // 已通过输入契约校验的纯 JSON 参数。
  }> = [];
  const calls = new Map<
    number,
    {
      name: string; // 取消收尾时使用的工具名称。
      startedAt: number; // 子调用自身的耗时锚点，包含等待队列的时间。
    }
  >();
  function audit(
    event: CodeExecutionTranscriptRecord['event'],
    text: string,
    id?: number,
    toolName?: string,
    status?: string,
    durationMs = Date.now() - started
  ): void {
    const record: CodeExecutionTranscriptRecord = {
      role: 'code_execution',
      toolCallId: options.callId,
      executionId,
      sequence: eventSequence + 1,
      event,
      text,
      ...(id === undefined ? {} : {childCallId: `${executionId}:${id}`}),
      ...(toolName ? {toolName} : {}),
      ...(status ? {status} : {}),
      durationMs
    };
    const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
    const terminal = event === 'end' || event === 'call_end';
    if (terminal) {
      terminalReserve -= 1024;
    }
    // 调用身份预先有界；每个终态最多 1 KiB，开始事件不能消耗保留的终态容量。
    if (bytes > 1024 || auditBytes + bytes + terminalReserve > CODE_LIMITS.auditBytes) {
      return;
    }
    eventSequence++;
    auditBytes += bytes;
    try {
      options.onAudit?.(record);
    } catch {
      /* 观测回调不能破坏执行终态或阻止资源清理。 */
    }
  }

  /** 先消费调用身份再通知旁路，重入取消或迟到响应均不能重复记账或追加终态。 */
  function endCall(id: number, status: ToolLifecycleStatus, reason: string = status): void {
    const call = calls.get(id);
    if (!call) {
      return;
    }
    calls.delete(id);
    if (status === 'succeeded') {
      summary.completed++;
    } else if (status === 'cancelled') {
      summary.cancelled++;
    } else {
      summary.failed++;
    }
    audit('call_end', `${call.name}: ${reason}`, id, call.name, status, Date.now() - call.startedAt);
  }

  const failure = (error: CodeError, cancelled = false): CodeResult => ({
    status: cancelled ? 'cancelled' : 'failed',
    result: null,
    logs,
    logs_truncated: logsTruncated,
    summary: {
      ...summary,
      duration_ms: Date.now() - started
    },
    error
  });
  if (!options.callId || Buffer.byteLength(JSON.stringify(options.callId)) > 258) {
    return failure(codeError('contract_error', 'Outer call identity exceeds audit budget', 'tool'));
  }
  if (options.signal?.aborted) {
    return failure(codeError('cancelled', 'Execution cancelled'), true);
  }
  if (Buffer.byteLength(options.code) > CODE_LIMITS.source) {
    return failure(codeError('source_limit_exceeded', 'Source exceeds 32 KiB', 'compile'));
  }
  if (!isCodeRuntimeAvailable()) {
    return failure(codeError('runtime_unavailable', 'QuickJS/WASM initialization failed'));
  }

  if (Date.now() - started >= CODE_LIMITS.wallMs) {
    return failure(codeError('wall_time_exceeded', 'Execution exceeded 30 seconds during startup'));
  }
  if (options.signal?.aborted) {
    return failure(codeError('cancelled', 'Execution cancelled'), true);
  }
  let child: ReturnType<typeof fork>;
  try {
    child = fork(require.resolve('./child'), [], {
      execArgv: [],
      env: {PATH: process.env.PATH || ''},
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    });
  } catch {
    return failure(codeError('runtime_unavailable', 'QuickJS child could not start'));
  }
  return new Promise<CodeResult>((resolve) => {
    const jobs = new Set<Promise<void>>();
    let childExited = false;
    const exited = new Promise<void>((done) => {
      // IPC 主动断开后 Node 不保证再发 close；exit 才是进程已回收的判断依据。
      child.once('exit', () => {
        childExited = true;
        done();
      });
      child.once('error', () => {
        if (child.pid === undefined) {
          childExited = true;
          done();
        }
      });
    });
    const watchdog = setTimeout(() => {
      void finish(codeError('wall_time_exceeded', 'Execution exceeded 30 seconds'));
    }, Math.max(0, CODE_LIMITS.wallMs - (Date.now() - started)));
    const onAbort = () => {
      void finish(codeError('cancelled', 'Execution cancelled'), null, true);
    };
    options.signal?.addEventListener('abort', onAbort, {once: true});

    async function finish(error: CodeError | null, value: unknown = null, cancelled = error?.code === 'cancelled'): Promise<void> {
      if (closed) {
        return;
      }
      closed = true;
      clearTimeout(watchdog);
      options.signal?.removeEventListener('abort', onAbort);
      queued.length = 0;
      for (const id of calls.keys()) {
        endCall(id, 'cancelled');
      }
      controller.abort();
      // 先关闭桥接，再发信号；失败也不能重新开放或忽略迟到回调。
      child.removeListener('message', onMessage);
      if (child.connected) {
        try {
          child.disconnect();
        } catch {
          /* IPC 已关闭也仍须尝试终止进程并等待资源收尾。 */
        }
      }
      // 等待 IPC 断开使正常等待工具的 guest 自然退出；给强杀后回收预留 250ms。
      const forceKill = setTimeout(() => {
        if (!childExited) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* error 事件由固定监听器吸收；不扩大执行权限。 */
          }
        }
      }, 750);
      let timer: ReturnType<typeof setTimeout> | undefined;
      // 等待工具落实取消；超出一秒明确报清理失败，而非假装资源已经回收。
      const drained = await Promise.race([
        Promise.all([Promise.allSettled([...jobs]), exited]).then(() => true),
        new Promise<false>((done) => {
          timer = setTimeout(() => done(false), 1000);
        })
      ]);
      if (timer) {
        clearTimeout(timer);
      }
      clearTimeout(forceKill);
      if (!drained) {
        if (!childExited) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* 被外层沙箱拒绝的信号不能伪装成已完成清理。 */
          }
        }
        error = codeError('cleanup_failed', 'Host tools or guest did not exit within one second', 'tool');
      }
      summary.duration_ms = Date.now() - started;
      audit(
        'end',
        `${error ? `${error.phase}: ${error.code}` : 'Run code completed'}; ` +
          `attempted=${summary.attempted}, completed=${summary.completed}, failed=${summary.failed}, cancelled=${summary.cancelled}`,
        undefined,
        undefined,
        cancelled ? 'cancelled' : error ? 'failed' : 'succeeded'
      );
      resolve(
        error
          ? failure(error, cancelled)
          : {
            status: 'succeeded',
            result: value,
            logs,
            logs_truncated: logsTruncated,
            summary,
            error: null
          }
      );
    }
    function send(message: Record<string, unknown>): void {
      if (closed || !child.connected) {
        return;
      }
      try {
        child.send(
          JSON.stringify({
            ...message,
            executionId
          }),
          (error) => {
            if (error && !closed) {
              void finish(codeError('runtime_unavailable', 'Guest IPC closed'));
            }
          }
        );
      } catch {
        void finish(codeError('runtime_unavailable', 'Guest IPC closed'));
      }
    }
    function failCall(id: number, error: CodeError): void {
      if (closed) {
        return;
      }
      endCall(id, error.code === 'cancelled' ? 'cancelled' : 'failed', error.code);
      void finish(error);
    }
    function reply(id: number, name: ScriptToolName, envelope: unknown): void {
      if (closed) {
        return;
      }
      let json: string;
      try {
        json = encodeCodeJson(envelope, CODE_LIMITS.response);
      } catch (error) {
        const overflow = error instanceof Error && error.message.includes('byte limit');
        failCall(
          id,
          codeError(
            overflow ? 'response_limit_exceeded' : 'contract_error',
            overflow ? 'Tool response exceeds 64 KiB' : 'Tool response is not bounded JSON data',
            'tool'
          )
        );
        return;
      }
      const validated = validateScriptEnvelope(name, JSON.parse(json));
      if (!validated.ok) {
        failCall(id, codeError('contract_error', validated.reason, 'tool'));
        return;
      }
      const error = validated.value.error;
      if (error && ['contract_error', 'cancelled', 'result_limit_exceeded'].includes(error.code)) {
        failCall(id, codeError(error.code, error.message, 'tool'));
        return;
      }
      responseBytes += Buffer.byteLength(json);
      if (responseBytes > CODE_LIMITS.responses) {
        failCall(id, codeError('response_limit_exceeded', 'Aggregate tool responses exceed 512 KiB', 'tool'));
        return;
      }
      endCall(
        id,
        validated.value.ok ? 'succeeded' : error?.code === 'invalid_arguments' ? 'rejected' : 'failed',
        validated.value.ok ? 'completed' : error!.code
      );
      send({
        kind: 'reply',
        id,
        json
      });
    }
    function drain(): void {
      while (!closed && !options.signal?.aborted && active < CODE_LIMITS.concurrency && queued.length > 0) {
        const call = queued.shift()!;
        active++;
        const job = Promise.resolve()
          .then(() => {
            // finish 可在微任务真正执行前关闭桥接；已排入 Promise 的回调也不能越过此闸门。
            if (closed || options.signal?.aborted || controller.signal.aborted) {
              return undefined;
            }
            return options.dispatch(call.name, call.args, `${executionId}:${call.id}`, controller.signal);
          })
          .then(
            (envelope) => {
              if (!closed) {
                reply(call.id, call.name, envelope);
              }
            },
            () => reply(call.id, call.name, scriptFailure('tool_failed', 'Local tool execution failed'))
          )
          .finally(() => {
            active--;
            jobs.delete(job);
            drain();
          });
        jobs.add(job);
      }
    }
    function onMessage(raw: unknown): void {
      if (closed) {
        return;
      }
      const message = decodeCodeMessage(raw);
      if (!message || message.executionId !== executionId) {
        void finish(codeError('contract_error', 'Invalid execution identity or IPC message', 'tool'));
        return;
      }
      if (message.kind === 'log') {
        if (message.truncated === true) {
          logsTruncated = true;
          return;
        }
        if (typeof message.text !== 'string' || Buffer.byteLength(message.text) > 4096) {
          void finish(codeError('contract_error', 'Invalid log message'));
          return;
        }
        const bytes = Buffer.byteLength(message.text);
        if (logs.length >= CODE_LIMITS.logEntries || logsBytes + bytes > CODE_LIMITS.logBytes) {
          logsTruncated = true;
          return;
        }
        logs.push(message.text);
        logsBytes += bytes;
        return;
      }
      if (message.kind === 'error') {
        void finish(message.error as CodeError);
        return;
      }
      if (message.kind === 'result') {
        if (calls.size > 0) {
          void finish(codeError('pending_tool_calls', 'Await all tool calls before returning', 'tool'));
          return;
        }
        if (typeof message.result !== 'string' || Buffer.byteLength(message.result) > CODE_LIMITS.result) {
          void finish(codeError('result_limit_exceeded', 'Final JSON exceeds 16 KiB', 'serialize'));
          return;
        }
        try {
          const value: unknown = JSON.parse(message.result);
          encodeCodeJson(value, CODE_LIMITS.result);
          void finish(null, value);
        } catch {
          void finish(codeError('serialization_error', 'Guest returned invalid JSON', 'serialize'));
        }
        return;
      }
      if (
        message.kind !== 'call' ||
        message.id !== ++nextCall ||
        typeof message.name !== 'string' ||
        message.name.length > 64 ||
        typeof message.json !== 'string'
      ) {
        void finish(codeError('contract_error', 'Invalid child call sequence or shape', 'tool'));
        return;
      }
      summary.attempted++;
      if (summary.attempted > CODE_LIMITS.calls) {
        void finish(codeError('call_limit_exceeded', 'At most 16 call attempts are allowed', 'tool'));
        return;
      }
      if (!SCRIPT_TOOL_NAMES.includes(message.name as ScriptToolName)) {
        void finish(codeError('contract_error', 'Unknown bridge method', 'tool'));
        return;
      }
      const name = message.name as ScriptToolName;
      const id = message.id as number;
      calls.set(id, {
        name,
        startedAt: Date.now()
      });
      if (message.json === '!argument-limit-exceeded' || Buffer.byteLength(message.json) > CODE_LIMITS.args) {
        audit('call_start', `${name}: arguments exceed 32 KiB`, id, name, 'running');
        failCall(id, codeError('argument_limit_exceeded', 'Tool arguments exceed 32 KiB', 'tool'));
        return;
      }
      let args: unknown;
      try {
        args = JSON.parse(message.json);
      } catch {
        audit('call_start', `${name}: invalid JSON arguments`, id, name, 'running');
        reply(id, name, scriptFailure('invalid_arguments', 'Arguments must be JSON'));
        return;
      }
      const input = validateScriptInput(name, args);
      if (!input.ok) {
        audit('call_start', `${name}: invalid arguments`, id, name, 'running');
        reply(id, name, scriptFailure('invalid_arguments', input.reason));
        return;
      }
      audit('call_start', `${name}: ${summarizeArguments(name, input.value)}`, id, name, 'running');
      if (closed || options.signal?.aborted) {
        return;
      }
      queued.push({
        id,
        name,
        args: input.value
      });
      drain();
    }
    child.on('message', onMessage);
    child.on('error', () => {
      if (!closed) {
        void finish(codeError('runtime_unavailable', 'QuickJS child could not start'));
      }
    });
    child.once('exit', () => {
      if (!closed) {
        void finish(codeError('runtime_unavailable', 'QuickJS child exited without a result'));
      }
    });
    audit('start', 'Run code started', undefined, undefined, 'running');
    if (options.signal?.aborted) {
      onAbort();
    } else {
      send({
        kind: 'start',
        code: options.code
      });
    }
  });
}
