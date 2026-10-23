const test = require('node:test');
const assert = require('node:assert/strict');
const {fork} = require('node:child_process');
const {CODE_LIMITS, codeError, decodeCodeMessage, encodeCodeJson} = require('../../src/tools/code-mode/protocol');
const {isCodeRuntimeAvailable} = require('../../src/tools/code-mode/execution');

const executionId = 'c18457d5-af98-4c07-a180-4f16b203668f';
const base = (kind, fields = {}) => ({kind, executionId, ...fields});
const encode = (value) => JSON.stringify(value);
const error = {code: 'script_error', message: '中文😀', phase: 'runtime', line: 2, column: 5};
const reply = {
  schema_version: 1,
  ok: true,
  data: {paths: [], has_more: false},
  error: null,
  truncated: false
};
const messages = [
  base('start', {code: 'return true;'}),
  base('call', {id: 1, name: 'glob', json: '{"pattern":"*"}'}),
  base('reply', {id: 1, json: encode(reply)}),
  base('log', {text: 'log ["中文😀"]'}),
  base('log', {truncated: true}),
  base('result', {result: '{"value":42}'}),
  base('error', {error})
];

test('strict decoder accepts each exact protocol shape, JSON whitespace and escaped data', () => {
  for (const message of messages) {
    assert.deepEqual(decodeCodeMessage(encode(message)), message);
    assert.deepEqual(decodeCodeMessage(JSON.stringify(message, null, 2)), message);
  }
  const quoted = base('start', {code: 'return {text:"\\\"\\n\\u1234",escaped:"{}[]:,"};'});
  assert.deepEqual(decodeCodeMessage(encode(quoted)), quoted);
});

test('strict decoder rejects non-text, malformed, excessive and unknown messages', () => {
  for (const raw of [null, {}, [], Buffer.from('{}'), 'null', '[]', '{', ' ', ' '.repeat(CODE_LIMITS.ipc + 1)]) {
    assert.equal(decodeCodeMessage(raw), null);
  }
  for (const message of [{}, {kind: 'result'}, base('unknown'), {...messages[0], extra: true}]) {
    assert.equal(decodeCodeMessage(encode(message)), null, encode(message));
  }
  for (const message of messages) {
    for (const key of Object.keys(message)) {
      const missing = {...message};
      delete missing[key];
      assert.equal(decodeCodeMessage(encode(missing)), null, `${message.kind} missing ${key}`);
    }
    assert.equal(decodeCodeMessage(encode({...message, extra: null})), null);
  }
});

test('identities and call ids cannot be missing, inherited, coerced or malformed', () => {
  for (const id of [null, 1, '', 'wrong-id', executionId.toUpperCase(), `${executionId}extra`]) {
    assert.equal(decodeCodeMessage(encode({...messages[0], executionId: id})), null);
  }
  for (const kind of ['call', 'reply']) {
    for (const id of [null, 0, -1, 1.5, '1', true, 17, Number.MAX_SAFE_INTEGER]) {
      const fields = kind === 'call' ? {name: 'glob', json: '{}'} : {json: encode(reply)};
      assert.equal(decodeCodeMessage(encode(base(kind, {id, ...fields}))), null);
    }
  }
  const inherited = `{"kind":"start","code":"return 1","__proto__":{"executionId":"${executionId}"}}`;
  assert.equal(decodeCodeMessage(inherited), null);
});

test('prototype and duplicate keys at every protocol object layer are rejected', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const outer = `{"kind":"result","executionId":"${executionId}","result":"null","${key}":{}}`;
    const nested = `{"kind":"error","executionId":"${executionId}","error":{"code":"script_error","message":"x","phase":"runtime","${key}":{}}}`;
    assert.equal(decodeCodeMessage(outer), null);
    assert.equal(decodeCodeMessage(nested), null);
  }
  assert.equal(decodeCodeMessage(`{"kind":"start","executionId":"wrong","executionId":"${executionId}","code":""}`), null);
  assert.equal(decodeCodeMessage(`{"kind":"start","executionId":"${executionId}","code":"","c\\u006fde":""}`), null);
  const repeatedError = `{"kind":"error","executionId":"${executionId}","error":{"code":"script_error","message":"x","phase":"tool","phase":"runtime"}}`;
  assert.equal(decodeCodeMessage(repeatedError), null);
  assert.equal(Object.prototype.executionId, undefined);
});

test('method, payload, log and diagnostic variants have exact keys and finite positive locations', () => {
  const malformed = [
    base('call', {id: 1, name: 'bash', json: '{}'}),
    base('call', {id: 1, name: 'constructor', json: '{}'}),
    base('call', {id: 1, name: 'glob', json: {pattern: '*'}}),
    base('reply', {id: 1, json: '{'}),
    base('reply', {id: 1, json: '{"x":1e999}'}),
    base('result', {result: 'NaN'}),
    base('result', {result: '1e999'}),
    base('log', {truncated: false}),
    base('log', {text: 'x', truncated: true}),
    base('log', {text: ['not a string']}),
    base('error', {error: null}),
    base('error', {error: {...error, extra: 'x'}}),
    base('error', {error: {...error, phase: 'host'}}),
    base('error', {error: {...error, code: ''}}),
    base('error', {error: {...error, line: 0}}),
    base('error', {error: {...error, line: 1.5}}),
    base('error', {error: {...error, column: -1}}),
    base('error', {error: {...error, column: '2'}}),
    base('error', {error: {code: 'script_error', message: 'x', phase: 'runtime', column: 2}})
  ];
  for (const message of malformed) {
    assert.equal(decodeCodeMessage(encode(message)), null, encode(message));
  }
});

test('all IPC string fields enforce UTF-8 byte rather than character limits', () => {
  const fields = [
    base('start', {code: '中'.repeat(11000)}),
    base('call', {id: 1, name: 'glob', json: '中'.repeat(11000)}),
    base('reply', {id: 1, json: encode('中'.repeat(22000))}),
    base('result', {result: encode('中'.repeat(5500))}),
    base('log', {text: '中'.repeat(2800)}),
    base('error', {error: {...error, message: '中'.repeat(342)}})
  ];
  for (const message of fields) {
    assert.equal(decodeCodeMessage(encode(message)), null, message.kind);
  }
});

test('host bounded encoder preserves JSON semantics without executing accessors or toJSON', () => {
  const value = {text: '中文😀', nested: [true, null, 42]};
  assert.equal(encodeCodeJson(value, 1024), JSON.stringify(value));
  assert.throws(() => encodeCodeJson({get value() {throw new Error('getter executed');}}, 1024), /accessor/);
  assert.throws(() => encodeCodeJson({toJSON() {throw new Error('toJSON executed');}}, 1024), /not JSON/);
  assert.throws(() => encodeCodeJson('中'.repeat(100), 100), /byte limit/);
  assert.throws(() => encodeCodeJson(NaN, 1024), /not JSON/);
  assert.throws(() => encodeCodeJson({value: Infinity}, 1024), /not JSON/);
  assert.throws(() => encodeCodeJson([, 1], 1024), /dense/);
  assert.throws(() => encodeCodeJson(new Date(), 1024), /prototype/);
  const cyclic = {};
  cyclic.cyclic = cyclic;
  assert.throws(() => encodeCodeJson(cyclic, 1024), /not JSON/);
  let deep = {};
  for (let i = 0; i < 40; i++) {
    deep = {deep};
  }
  assert.throws(() => encodeCodeJson(deep, 1024), /complexity/);
  assert.throws(() => encodeCodeJson(Array(4100).fill(0), 65536), /complexity/);
  const safe = JSON.parse('{"__proto__":{"x":1}}');
  assert.equal(encodeCodeJson(safe, 1024), '{"__proto__":{"x":1}}');
  assert.equal(Object.prototype.x, undefined);
});

test('diagnostic truncation is UTF-8 safe and never returns an unbounded message', () => {
  const bounded = codeError('script_error', '中文😀'.repeat(10000));
  assert.ok(Buffer.byteLength(bounded.message) <= 1024);
  assert.equal(bounded.message.includes('\ufffd'), false);
  assert.equal(bounded.phase, 'runtime');
});

/** 子进程等待 IPC 而不执行无限 fixture；失败时断开连接即可有限退出，不依赖信号权限。 */
function invalidReply(fields) {
  return new Promise((resolve, reject) => {
    const child = fork(require.resolve('../../src/tools/code-mode/child'), [], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {PATH: process.env.PATH || ''}
    });
    let result;
    const timeout = setTimeout(() => {
      if (child.connected) {
        child.disconnect();
      }
      reject(new Error('Finite IPC fixture did not close within two seconds'));
    }, 2000);
    child.on('error', reject);
    child.on('message', (raw) => {
      const message = decodeCodeMessage(raw);
      if (message?.kind === 'call') {
        child.send(encode(base('reply', {id: message.id, json: encode(reply), ...fields})));
      } else if (message?.kind === 'error') {
        result = message.error;
      }
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      if (result) {
        resolve(result);
      } else {
        reject(new Error('Fixture exited without the expected protocol error'));
      }
    });
    child.send(encode(base('start', {code: 'await tools.glob({pattern:"*"});return true;'})));
  });
}

test('real child rejects mismatched identities, unissued ids and invalid reply envelopes', {
  skip: !isCodeRuntimeAvailable() && 'QuickJS/WASM 初始化失败，不能使用弱隔离替代'
}, async () => {
  for (const fields of [
    {executionId: 'c18457d5-af98-4c07-a180-4f16b2036680'},
    {id: 2},
    {extra: true},
    {json: '{'},
    {json: '{}'}
  ]) {
    const result = await invalidReply(fields);
    assert.equal(result.code, 'contract_error');
    assert.equal(result.phase, 'tool');
  }
});
