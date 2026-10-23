// 此字符串只在 QuickJS 中求值；闭包捕获 guest 内建方法，不依赖用户可修改的原型链。
export const GUEST_BOOTSTRAP = String.raw`
(() => {
  const bridge = globalThis.__echoCall;
  const log = globalThis.__echoLog;
  const fault = globalThis.__echoFault;
  const serialize = globalThis.__echoSerialize;
  delete globalThis.__echoCall;
  delete globalThis.__echoLog;
  delete globalThis.__echoFault;
  delete globalThis.__echoSerialize;
  const stringify = JSON.stringify;
  const parse = JSON.parse;
  const keys = Reflect.ownKeys;
  const apply = Reflect.apply;
  const descriptor = Object.getOwnPropertyDescriptor;
  const proto = Object.getPrototypeOf;
  const objectProto = Object.prototype;
  const arrayProto = Array.prototype;
  const isArray = Array.isArray;
  const finite = Number.isFinite;
  const freeze = Object.freeze;
  const then = Promise.prototype.then;
  const define = Object.defineProperty;
  const PromiseClass = Promise;
  const promiseConstructor = freeze({[Symbol.species]: PromiseClass});
  const charCodeAt = String.prototype.charCodeAt;
  const slice = String.prototype.slice;
  const SetClass = Set;
  const setHas = Set.prototype.has;
  const setAdd = Set.prototype.add;
  const setDelete = Set.prototype.delete;
  const numberString = String;
  const ErrorClass = Error;
  const limit = freeze(Object.create(null));
  function encode(value, max, undefinedAsNull = false) {
    let bytes = 0;
    let nodes = 0;
    const ancestors = new SetClass();
    function append(text) {
      for (let i = 0; i < text.length; i++) {
        const c = apply(charCodeAt, text, [i]);
        if (c < 128) {
          bytes++;
        } else if (c < 2048) {
          bytes += 2;
        } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length &&
                   apply(charCodeAt, text, [i + 1]) >= 0xdc00 && apply(charCodeAt, text, [i + 1]) <= 0xdfff) {
          i++;
          bytes += 4;
        } else {
          bytes += 3;
        }
        if (bytes > max) {
          throw limit;
        }
      }
      return text;
    }
    function visit(v, depth) {
      if (++nodes > 4096 || depth > 32) {
        throw new ErrorClass('JSON complexity limit');
      }
      if (v === null) {
        return append('null');
      }
      switch (typeof v) {
        case 'boolean':
          return append(v ? 'true' : 'false');
        case 'number':
          if (!finite(v)) {
            throw new ErrorClass('Nonfinite JSON number');
          }
          return append(stringify(v));
        case 'string':
          if (v.length > max) {
            throw limit;
          }
          return append(stringify(v));
        case 'object':
          break;
        default:
          throw new ErrorClass('Unsupported JSON value');
      }
      if (apply(setHas, ancestors, [v])) {
        throw new ErrorClass('Cyclic JSON value');
      }
      const array = isArray(v);
      const p = proto(v);
      if (p !== (array ? arrayProto : objectProto) && !(p === null && !array)) {
        throw new ErrorClass('Non-JSON prototype');
      }
      const names = keys(v);
      if (names.length > 4096 || (array && names.length !== v.length + 1)) {
        throw new ErrorClass('Non-JSON array or complexity limit');
      }
      apply(setAdd, ancestors, [v]);
      let out = append(array ? '[' : '{');
      let count = 0;
      for (let i = 0; i < names.length; i++) {
        const key = names[i];
        if (array && key === 'length') {
          continue;
        }
        if (typeof key !== 'string' || (array && key !== numberString(count))) {
          throw new ErrorClass('Non-JSON key or sparse array');
        }
        const d = descriptor(v, key);
        if (!d.enumerable || !descriptor(d, 'value')) {
          throw new ErrorClass('Accessor or hidden field');
        }
        if (count++) {
          out += append(',');
        }
        if (!array) {
          if (key.length > max) {
            throw limit;
          }
          out += append(stringify(key)) + append(':');
        }
        out += visit(d.value, depth + 1);
      }
      apply(setDelete, ancestors, [v]);
      return out + append(array ? ']' : '}');
    }
    return visit(value === undefined && undefinedAsNull ? null : value, 0);
  }
  function chain(promise, fulfilled) {
    // 不能让用户修改 Promise.prototype.constructor/species 后替换内部完成链。
    define(promise, 'constructor', {value: promiseConstructor});
    const next = apply(then, promise, [fulfilled]);
    define(next, 'constructor', {value: PromiseClass});
    return next;
  }
  function invoke(name, args) {
    let json;
    try {
      json = encode(args, 32768);
    } catch (error) {
      json = error === limit ? '!argument-limit-exceeded' : '!invalid-json-arguments';
    }
    return chain(bridge(name, json), parse);
  }
  globalThis.tools = freeze(Object.assign(Object.create(null), {
    glob: (args) => invoke('glob', args),
    grep: (args) => invoke('grep', args),
    read_files: (args) => invoke('read_files', args)
  }));
  function logger(level) {
    return (...args) => {
      try {
        log(level + ' ' + encode(args, 1024), false);
      } catch {
        log('', true);
      }
    };
  }
  globalThis.console = freeze({log: logger('log'), warn: logger('warn'), error: logger('error')});
  return freeze({
    wrap: (promise) => chain(promise, (value) => {
      serialize();
      try {
        return encode(value, 16384, true);
      } catch (error) {
        fault(error === limit ? 'result_limit_exceeded' : 'serialization_error');
        throw new ErrorClass('Final value is not bounded JSON data');
      }
    }),
    diagnose: (error) => {
      // 仅读取自有数据属性，不执行 message/stack getter，也不物化任意 guest 对象。
      function field(name, max) {
        if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
          return '';
        }
        const d = descriptor(error, name);
        return d && descriptor(d, 'value') && typeof d.value === 'string' ? apply(slice, d.value, [0, max]) : '';
      }
      return '{"message":' + stringify(field('message', 1024)) + ',"stack":' + stringify(field('stack', 2048)) + '}';
    }
  });
})();
`;
