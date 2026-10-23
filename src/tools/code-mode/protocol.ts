import type {ScriptToolEnvelope, ScriptToolName} from './contracts';

export const CODE_LIMITS = Object.freeze({
  source: 32768,
  args: 32768,
  heap: 32 * 1024 * 1024,
  cpuMs: 1000,
  wallMs: 30000,
  calls: 16,
  concurrency: 2,
  response: 65536,
  responses: 524288,
  result: 16384,
  logEntries: 32,
  logBytes: 8192,
  auditBytes: 32768,
  ipc: 262144
});

export type CodeError = {
  code: string; // 稳定执行级分类，不以引擎消息作为协议。
  message: string; // 有界错误诊断。
  phase: 'compile' | 'runtime' | 'tool' | 'serialize'; // 失败所属阶段。
  line?: number; // 用户函数体中的一基行号。
  column?: number; // 引擎可提供时的一基列号。
};

export type CodeSummary = {
  attempted: number; // 已收到的内部调用尝试，包含被拒绝调用。
  completed: number; // 已完成且成功的内部调用数。
  failed: number; // 已完成但失败的内部调用数。
  cancelled: number; // 关闭时仍在队列或执行中的调用数。
  duration_ms: number; // 包含工具等待与收尾的墙钟耗时。
};

export type CodeResult = {
  status: 'succeeded' | 'failed' | 'cancelled'; // 外层唯一终态。
  result: unknown; // 仅成功时携带经过有界 JSON 验证的返回值。
  logs: string[]; // guest 主动输出的有界日志。
  logs_truncated: boolean; // 日志超过条数或总字节预算。
  summary: CodeSummary; // 不复制中间工具正文的计数。
  error: CodeError | null; // 成功时为 null。
};

export type CodeToolDispatch = (
  name: ScriptToolName,
  args: Record<string, unknown>,
  childCallId: string,
  signal: AbortSignal
) => Promise<ScriptToolEnvelope>;

/** 先逐项计费再生成 JSON，避免信任边界先物化任意大的字符串或执行 toJSON/getter。 */
export function encodeCodeJson(value: unknown, max: number): string {
  let bytes = 0;
  let nodes = 0;
  const ancestors = new Set<object>();
  function append(text: string): string {
    bytes += Buffer.byteLength(text, 'utf8');
    if (bytes > max) {
      throw new Error('JSON byte limit exceeded');
    }
    return text;
  }
  function visit(item: unknown, depth: number): string {
    if (++nodes > 4096 || depth > 32) {
      throw new Error('JSON complexity limit exceeded');
    }
    if (item === null || typeof item === 'boolean') {
      return append(String(item));
    }
    if (typeof item === 'number' && Number.isFinite(item)) {
      return append(String(item));
    }
    if (typeof item === 'string') {
      if (item.length > max) {
        throw new Error('JSON byte limit exceeded');
      }
      return append(JSON.stringify(item));
    }
    if (!item || typeof item !== 'object' || ancestors.has(item)) {
      throw new Error('Value is not JSON data');
    }
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) {
      throw new Error('Value has a non-JSON prototype');
    }
    const keys = Reflect.ownKeys(item);
    if (keys.length > 4096 || (array && keys.length !== item.length + 1)) {
      throw new Error('Value is not a dense JSON array or exceeds complexity limit');
    }
    ancestors.add(item);
    let result = append(array ? '[' : '{');
    let count = 0;
    for (const key of keys) {
      if (array && key === 'length') {
        continue;
      }
      if (typeof key !== 'string' || (array && key !== String(count))) {
        throw new Error('Value has non-JSON keys');
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error('Value has an accessor or hidden field');
      }
      if (count++) {
        result += append(',');
      }
      if (!array) {
        if (key.length > max) {
          throw new Error('JSON byte limit exceeded');
        }
        result += append(JSON.stringify(key)) + append(':');
      }
      result += visit(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    return result + append(array ? ']' : '}');
  }
  return visit(value, 0);
}

/** 固定消息逐种校验精确字段；对象只能从 JSON 字符串进入，不能继承执行身份。 */
export function decodeCodeMessage(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > CODE_LIMITS.ipc) {
    return null;
  }
  function shape(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
    return (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
    );
  }
  function text(value: unknown, max: number): value is string {
    return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max;
  }
  try {
    const value: unknown = JSON.parse(raw);
    // 先限制结构复杂度，再拒绝重复键；JSON.parse 默认允许身份字段被后一个值覆盖。
    encodeCodeJson(value, CODE_LIMITS.ipc);
    if (hasDuplicateKeys(raw)) {
      return null;
    }
    if (!shape(value, ['kind', 'executionId'], ['code', 'id', 'name', 'json', 'text', 'truncated', 'error', 'result'])) {
      return null;
    }
    if (
      typeof value.executionId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.executionId)
    ) {
      return null;
    }
    const base = ['kind', 'executionId'];
    const validId = Number.isSafeInteger(value.id) && (value.id as number) > 0 && (value.id as number) <= CODE_LIMITS.calls;
    switch (value.kind) {
      case 'start':
        return shape(value, [...base, 'code']) && text(value.code, CODE_LIMITS.source) ? value : null;
      case 'call':
        if (
          !shape(value, [...base, 'id', 'name', 'json']) ||
          !validId ||
          typeof value.name !== 'string' ||
          !['glob', 'grep', 'read_files'].includes(value.name) ||
          !text(value.json, CODE_LIMITS.args)
        ) {
          return null;
        }
        return value;
      case 'reply':
        if (!shape(value, [...base, 'id', 'json']) || !validId || !text(value.json, CODE_LIMITS.response)) {
          return null;
        }
        encodeCodeJson(JSON.parse(value.json), CODE_LIMITS.response);
        return value;
      case 'log':
        if (shape(value, [...base, 'text']) && text(value.text, CODE_LIMITS.logBytes)) {
          return value;
        }
        return shape(value, [...base, 'truncated']) && value.truncated === true ? value : null;
      case 'result':
        if (!shape(value, [...base, 'result']) || !text(value.result, CODE_LIMITS.result)) {
          return null;
        }
        encodeCodeJson(JSON.parse(value.result), CODE_LIMITS.result);
        return value;
      case 'error': {
        const error = value.error;
        if (
          !shape(value, [...base, 'error']) ||
          !shape(error, ['code', 'message', 'phase'], ['line', 'column']) ||
          typeof error.code !== 'string' ||
          !/^[a-z][a-z_]{0,63}$/.test(error.code) ||
          !text(error.message, 1024) ||
          !['compile', 'runtime', 'tool', 'serialize'].includes(error.phase as string)
        ) {
          return null;
        }
        for (const key of ['line', 'column']) {
          if (
            Object.hasOwn(error, key) &&
            (!Number.isSafeInteger(error[key]) || (error[key] as number) <= 0 || (error[key] as number) > CODE_LIMITS.source)
          ) {
            return null;
          }
        }
        return Object.hasOwn(error, 'column') && !Object.hasOwn(error, 'line') ? null : value;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** 在已经通过 JSON.parse 的文本上扫描键，保留字符串转义语义而拒绝重复字段。 */
function hasDuplicateKeys(raw: string): boolean {
  const frames: Array<Set<string> | null> = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}\[\]:,]/gs;
  for (const match of raw.matchAll(tokens)) {
    const token = match[0];
    if (token === '{' || token === '[') {
      frames.push(token === '{' ? new Set() : null);
    } else if (token === '}' || token === ']') {
      frames.pop();
    } else if (token.startsWith('"')) {
      let next = match.index! + token.length;
      while (/\s/.test(raw[next] || '') && next < raw.length) {
        next++;
      }
      if (raw[next] !== ':') {
        continue;
      }
      const frame = frames[frames.length - 1];
      const key = JSON.parse(token) as string;
      if (frame?.has(key)) {
        return true;
      }
      frame?.add(key);
    }
  }
  return false;
}

export function codeError(code: string, message: string, phase: CodeError['phase'] = 'runtime'): CodeError {
  // 按 UTF-8 截断，避免中文诊断在 IPC 中超过预算或产生半个码点。
  let bounded = '';
  let bytes = 0;
  for (const character of message) {
    bytes += Buffer.byteLength(character, 'utf8');
    if (bytes > 1024) {
      break;
    }
    bounded += character;
  }
  return {
    code,
    message: bounded,
    phase
  };
}
