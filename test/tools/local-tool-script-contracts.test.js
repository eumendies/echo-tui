const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ChildProcess, spawnSync} = require('node:child_process');
const {getEventListeners} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {canSignalChildProcesses} = require('../helpers/process-signals');

const {
  SCRIPT_TOOL_NAMES,
  SCRIPT_TOOL_CONTRACTS,
  SCRIPT_API_DESCRIPTION,
  SCRIPT_TOOL_MAX_RESPONSE_BYTES,
  SCRIPT_TOOL_ERROR_CODES,
  validateScriptInput,
  validateScriptEnvelope,
  checkedScriptEnvelope,
  scriptFailure,
  projectScriptList
} = require('../../src/tools/code-mode/contracts');
const {createGlobToolHandler} = require('../../src/tools/glob-tool-handler');
const {createGrepToolHandler} = require('../../src/tools/grep-tool-handler');
const {createReadFilesToolHandler} = require('../../src/tools/read-files/tool-handler');
const {readTextFile} = require('../../src/tools/read-files/text-reader');

const posixOnly = process.platform === 'win32' ? '需要 POSIX 可执行 fixture 与信号' : false;
const signalSkip = posixOnly || (!canSignalChildProcesses() && '当前环境禁止向子进程发送信号，需在宿主终端验证');
const hasRg = spawnSync('rg', ['--version']).status === 0;
const call = (toolName) => ({
  toolName,
  callId: 'script-contract-test',
  argumentsText: '{}'
});
function workspace(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-script-contracts-'));
  t.after(() =>
    fs.rmSync(cwd, {
      force: true,
      recursive: true
    })
  );
  return cwd;
}
function fakeRg(cwd, body) {
  const filename = path.join(cwd, 'fixture-rg');
  fs.writeFileSync(filename, `#!${process.execPath}\n${body}\n`, {mode: 0o755});
  return filename;
}

/** 只对自然退出的有限 fixture 记录终止请求；实际进程终止由独立信号测试验证。 */
function recordStopRequests(t) {
  const signals = [];
  t.mock.method(ChildProcess.prototype, 'kill', (signal) => {
    signals.push(signal);
    return false;
  });
  return signals;
}

function event(text, line = 1, file = 'note.txt', column = 1) {
  return JSON.stringify({
    type: 'match',
    data: {
      path: {text: file},
      lines: {text: `${text}\n`},
      line_number: line,
      submatches: [
        {
          start: column - 1,
          end: column
        }
      ]
    }
  });
}
// 用独立的 schema 投影核验公开 schema，而不是仅依赖生产校验器的额外语义检查。
function matchesSchema(schema, value) {
  if (schema.anyOf && !schema.anyOf.some((item) => matchesSchema(item, value))) {
    return false;
  }
  if (Object.hasOwn(schema, 'const') && schema.const !== value) {
    return false;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return false;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      !types.some((type) =>
        type === 'null'
          ? value === null
          : type === 'array'
            ? Array.isArray(value)
            : type === 'integer'
              ? Number.isInteger(value)
              : type === 'object'
                ? value !== null && typeof value === 'object' && !Array.isArray(value)
                : typeof value === type
      )
    ) {
      return false;
    }
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    return false;
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return false;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return false;
    }
    if (schema.items && !value.every((item) => matchesSchema(schema.items, item))) {
      return false;
    }
  }
  if (schema.properties && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if ((schema.required || []).some((key) => !Object.hasOwn(value, key))) {
      return false;
    }
    for (const [key, field] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) {
        if (schema.additionalProperties === false) {
          return false;
        }
      } else if (!matchesSchema(schema.properties[key], field)) {
        return false;
      }
    }
  }
  return true;
}
function assertEnvelope(name, value) {
  assert.equal(matchesSchema(SCRIPT_TOOL_CONTRACTS[name].outputSchema, value), true, JSON.stringify(value).slice(0, 200));
  const checked = validateScriptEnvelope(name, value);
  assert.equal(checked.ok, true, checked.reason);
  assert.ok(Buffer.byteLength(JSON.stringify(value), 'utf8') <= SCRIPT_TOOL_MAX_RESPONSE_BYTES);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  return value;
}
async function script(handler, args, options) {
  const name = handler.definition.name;
  return assertEnvelope(name, await handler.executeScript(args, call(name), options));
}

test('v1 schemas, generated documentation and native argument names stay aligned', () => {
  const factories = {
    glob: createGlobToolHandler,
    grep: createGrepToolHandler,
    read_files: createReadFilesToolHandler
  };
  for (const name of SCRIPT_TOOL_NAMES) {
    const contract = SCRIPT_TOOL_CONTRACTS[name];
    const native = factories[name]().definition.parameters;
    assert.equal(contract.inputSchema.additionalProperties, false);
    assert.deepEqual(contract.inputSchema.required, native.required);
    assert.deepEqual(Object.keys(contract.inputSchema.properties), Object.keys(native.properties));
    assert.ok(SCRIPT_API_DESCRIPTION.includes(contract.description));
    assert.ok(contract.description.startsWith(`tools.${name}(`));
    for (const key of Object.keys(contract.outputSchema.properties)) {
      assert.ok(contract.description.includes(`${key}:`));
    }
  }
  assert.match(SCRIPT_API_DESCRIPTION, /UTF-8 bytes, NOT a JS character index/);
  assert.match(SCRIPT_API_DESCRIPTION, /maxItems=10/);
  assert.match(SCRIPT_API_DESCRIPTION, /next_offset=null/);
  assert.match(SCRIPT_API_DESCRIPTION, /65536/);
  for (const code of SCRIPT_TOOL_ERROR_CODES) {
    assert.ok(SCRIPT_API_DESCRIPTION.includes(code));
    assertEnvelope('glob', scriptFailure(code, '诊断'.repeat(2000)));
  }
});

test('input validation rejects unknown fields, non-JSON values, bad pagination and prototype traps', () => {
  const cyclic = {pattern: 'x'};
  cyclic.extra = cyclic;
  const accessor = Object.defineProperty({}, 'pattern', {
    enumerable: true,
    get() {
      throw new Error('不得调用 getter');
    }
  });
  const cases = [
    null,
    [],
    'x',
    {},
    {pattern: ''},
    {pattern: ' \n'},
    {pattern: 'x\0'},
    {
      pattern: 'x',
      paths: []
    },
    {
      pattern: 'x',
      paths: ['']
    },
    {
      pattern: 'x',
      extra: true
    },
    {
      pattern: 'x',
      paths: undefined
    },
    {
      pattern: 'x',
      paths: new Date()
    },
    Object.assign(Object.create({}), {pattern: 'x'}),
    accessor,
    cyclic,
    {
      pattern: 'x',
      [Symbol('private')]: 1
    },
    JSON.parse('{"pattern":"x","__proto__":{}}')
  ];
  for (const value of cases) {
    assert.equal(validateScriptInput('glob', value).ok, false);
  }
  for (const value of [
    {
      pattern: 'x',
      literal: 'false'
    },
    {
      pattern: 'x',
      glob: 'x\0'
    },
    {
      pattern: 'x',
      case_sensitive: 1
    }
  ]) {
    assert.equal(validateScriptInput('grep', value).ok, false);
  }
  for (const file of [
    {
      path: 'a',
      offset: -1
    },
    {
      path: 'a',
      offset: 0.1
    },
    {
      path: 'a',
      offset: Infinity
    },
    {
      path: 'a',
      limit: 0
    },
    {
      path: 'a',
      limit: 2 ** 53
    },
    {
      path: 'a',
      extra: null
    }
  ]) {
    assert.equal(validateScriptInput('read_files', {files: [file]}).ok, false);
  }
  assert.equal(validateScriptInput('read_files', {files: []}).ok, false);
  assert.equal(validateScriptInput('read_files', {files: Array.from({length: 11}, () => ({path: 'x'}))}).ok, false);
  assert.deepEqual(
    validateScriptInput('glob', {
      pattern: '*',
      paths: null
    }).value,
    {
      pattern: '*',
      paths: ['.']
    }
  );
  assert.deepEqual(
    validateScriptInput('grep', {
      pattern: 'x',
      paths: null,
      glob: null,
      literal: null,
      case_sensitive: null
    }).value,
    {
      pattern: 'x',
      paths: ['.'],
      literal: true
    }
  );
  assert.deepEqual(
    validateScriptInput('read_files', {
      files: [
        {
          path: 'a',
          offset: null,
          limit: null
        }
      ]
    }).value,
    {
      files: [
        {
          path: 'a',
          offset: 0
        }
      ]
    }
  );
});

test('schemas reject inconsistent envelopes and checked projection returns contract_error', () => {
  const success = {
    schema_version: 1,
    ok: true,
    data: {
      paths: [],
      has_more: false
    },
    error: null,
    truncated: false
  };
  for (const bad of [
    {
      ...success,
      extra: true
    },
    {
      ...success,
      schema_version: 2
    },
    {
      ...success,
      data: null
    },
    {
      ...success,
      error: {
        code: 'tool_failed',
        message: 'bad'
      }
    },
    {
      ...success,
      ok: false
    },
    {
      ...success,
      data: {
        paths: [],
        has_more: false,
        next_cursor: 1
      }
    }
  ]) {
    assert.equal(matchesSchema(SCRIPT_TOOL_CONTRACTS.glob.outputSchema, bad), false);
    assert.equal(checkedScriptEnvelope('glob', bad).error.code, 'contract_error');
  }
  assert.equal(
    validateScriptEnvelope('glob', {
      ...success,
      truncated: true
    }).ok,
    false
  );
  assert.equal(
    validateScriptEnvelope('glob', {
      ...success,
      data: {
        paths: ['x'.repeat(70000)],
        has_more: false
      }
    }).ok,
    false
  );
});

test('list JSON budget keeps complete items including JSON escaping, with bounded oversize failures', () => {
  const paths = ['first', '"'.repeat(40000), 'last'];
  const projected = assertEnvelope('glob', projectScriptList('glob', paths, false, false));
  assert.deepEqual(projected.data.paths, ['first']);
  assert.equal(projected.data.has_more, true);
  assert.equal(projected.truncated, true);
  assert.deepEqual(paths, ['first', '"'.repeat(40000), 'last']);
  const hugeMatch = {
    path: 'a',
    line: 1,
    column: 1,
    text: '\t'.repeat(40000)
  };
  const failure = assertEnvelope('grep', projectScriptList('grep', [hugeMatch], false, false));
  assert.equal(failure.error.code, 'result_limit_exceeded');
  assert.equal(failure.truncated, true);
});

test('real glob includes hidden files, excludes .git and preserves path semantics', {skip: !hasRg}, async (t) => {
  const cwd = workspace(t);
  fs.mkdirSync(path.join(cwd, '.hidden'));
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(path.join(cwd, '.hidden', 'a.ts'), '');
  fs.writeFileSync(path.join(cwd, '.git', 'a.ts'), 'secret');
  fs.writeFileSync(path.join(cwd, 'b.ts'), '');
  const handler = createGlobToolHandler({cwd});
  const args = {
    pattern: '**/*.ts',
    paths: null
  };
  const result = await script(handler, args);
  assert.deepEqual(result.data, {
    paths: ['./.hidden/a.ts', './b.ts'],
    has_more: false
  });
  const native = await handler.execute(args, call('glob'));
  assert.deepEqual(native.details.display.paths, result.data.paths);
  assert.equal(Object.hasOwn(native, 'data'), false);
  const empty = await script(handler, {pattern: '*.nothing'});
  assert.deepEqual(empty.data, {
    paths: [],
    has_more: false
  });
  for (const args of [
    {pattern: '.git/**'},
    {
      pattern: '*',
      paths: ['.git/config']
    },
    {
      pattern: '*',
      paths: [path.join(cwd, '.git')]
    }
  ]) {
    assert.equal((await script(handler, args)).error.code, 'invalid_arguments');
  }
  const absolute = await script(handler, {
    pattern: '*.ts',
    paths: [path.join(cwd, 'b.ts')]
  });
  assert.deepEqual(absolute.data.paths, [path.join(cwd, 'b.ts')]);
  const parent = await script(handler, {
    pattern: '**/*.ts',
    paths: ['../' + path.basename(cwd)]
  });
  assert.equal(parent.data.paths.length, 2);
});

test('glob shared collector executes once per projection, filters .git, enforces count and byte caps', {skip: posixOnly}, async (t) => {
  const stopRequests = recordStopRequests(t);
  const cwd = workspace(t);
  const paths = ['.git/config', '目录/一.ts', '目录/二二二二.ts', 'third.ts'];
  const rgPath = fakeRg(
    cwd,
    `require('node:fs').appendFileSync('invocations', 'x'); process.stdout.write(${JSON.stringify(paths.join('\0') + '\0')});`
  );
  const counted = await script(
    createGlobToolHandler({
      cwd,
      rgPath,
      maxPaths: 2
    }),
    {pattern: '*'}
  );
  assert.deepEqual(counted.data, {
    paths: paths.slice(1, 3),
    has_more: true
  });
  assert.equal(counted.truncated, true);
  assert.equal(fs.readFileSync(path.join(cwd, 'invocations'), 'utf8'), 'x');
  const bounded = await script(
    createGlobToolHandler({
      cwd,
      rgPath,
      maxOutputBytes: 110
    }),
    {pattern: '*'}
  );
  assert.deepEqual(bounded.data.paths, [paths[1]]);
  assert.equal(bounded.truncated, true);
  assert.equal(fs.readFileSync(path.join(cwd, 'invocations'), 'utf8'), 'xx');
  assert.deepEqual(stopRequests, ['SIGTERM', 'SIGTERM']);
});

for (const [name, factory] of [
  ['glob', createGlobToolHandler],
  ['grep', createGrepToolHandler]
]) {
  test(`${name} distinguishes no matches, missing executable and query failure`, {skip: posixOnly}, async (t) => {
    const cwd = workspace(t);
    const emptyPath = fakeRg(cwd, 'process.exitCode = 1;');
    const empty = await script(
      factory({
        cwd,
        rgPath: emptyPath
      }),
      {pattern: 'x'}
    );
    assert.equal(empty.ok, true);
    assert.equal(empty.data.has_more, false);
    assert.deepEqual(empty.data[name === 'glob' ? 'paths' : 'matches'], []);
    const missing = await script(
      factory({
        cwd,
        rgPath: path.join(cwd, 'missing')
      }),
      {pattern: 'x'}
    );
    assert.equal(missing.error.code, 'tool_failed');
    assert.match(missing.error.message, /executable not found/);
    const errorPath = fakeRg(cwd, "process.stderr.write('查询失败'.repeat(30000)); process.exitCode = 2;");
    const failure = await script(
      factory({
        cwd,
        rgPath: errorPath
      }),
      {pattern: 'x'}
    );
    assert.equal(failure.error.code, 'tool_failed');
    assert.ok(Buffer.byteLength(failure.error.message, 'utf8') <= 1024);
    const invalid = await script(
      factory({
        cwd,
        rgPath: path.join(cwd, 'missing')
      }),
      {
        pattern: 'x',
        unknown: true
      }
    );
    assert.equal(invalid.error.code, 'invalid_arguments');
  });
}

test('real grep keeps UTF-8 byte columns, LF source lines and native search defaults', {skip: !hasRg}, async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'note.txt'), '中文😀 NeedLE [a]\r\nneedle\n');
  fs.writeFileSync(path.join(cwd, '.hidden.txt'), 'needle\n');
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(path.join(cwd, '.git', 'file.txt'), 'needle');
  const handler = createGrepToolHandler({cwd});
  const args = {
    pattern: 'NeedLE',
    paths: ['note.txt'],
    case_sensitive: true
  };
  const result = await script(handler, args);
  assert.deepEqual(result.data.matches, [
    {
      path: 'note.txt',
      line: 1,
      column: 12,
      text: '中文😀 NeedLE [a]'
    }
  ]);
  const native = await handler.execute(args, call('grep'));
  assert.deepEqual(native.details.display.matches, result.data.matches);
  assert.equal(Object.hasOwn(native, 'schema_version'), false);
  assert.equal(
    (
      await script(handler, {
        pattern: 'needle',
        case_sensitive: false
      })
    ).data.matches.length,
    2
  );
  assert.equal(
    (
      await script(handler, {
        pattern: '[a]',
        paths: ['note.txt'],
        literal: null
      })
    ).data.matches.length,
    1
  );
  assert.equal(
    (
      await script(handler, {
        pattern: '^n',
        paths: ['note.txt'],
        literal: false,
        glob: '*.txt'
      })
    ).data.matches.length,
    1
  );
  assert.deepEqual((await script(handler, {pattern: 'not present'})).data, {
    matches: [],
    has_more: false
  });
});

test('grep preserves complete matches while native projection may retain a partial long source line', {skip: posixOnly}, async (t) => {
  const stopRequests = recordStopRequests(t);
  const cwd = workspace(t);
  const text = '中文😀'.repeat(100);
  const payload = [event('short'), event(text, 2)].join('\n') + '\n';
  const rgPath = fakeRg(cwd, `require('node:fs').appendFileSync('invocations', 'x'); process.stdout.write(${JSON.stringify(payload)});`);
  const handler = createGrepToolHandler({
    cwd,
    rgPath,
    maxOutputBytes: 180
  });
  const result = await script(handler, {pattern: 'x'});
  assert.deepEqual(result.data.matches, [
    {
      path: 'note.txt',
      line: 1,
      column: 1,
      text: 'short'
    }
  ]);
  assert.equal(result.data.has_more, true);
  assert.equal(result.truncated, true);
  assert.equal(fs.readFileSync(path.join(cwd, 'invocations'), 'utf8'), 'x');
  const native = await handler.execute({pattern: 'x'}, call('grep'));
  assert.equal(native.ok, true);
  assert.equal(native.details.display.matches.length, 2);
  assert.ok(text.startsWith(native.details.display.matches[1].text));
  assert.doesNotMatch(native.details.display.matches[1].text, /\uFFFD/u);
  assert.equal(fs.readFileSync(path.join(cwd, 'invocations'), 'utf8'), 'xx');
  assert.deepEqual(stopRequests, ['SIGTERM', 'SIGTERM']);
});

test('grep count and oversized parser records cannot masquerade as complete source matches', {skip: posixOnly}, async (t) => {
  const stopRequests = recordStopRequests(t);
  const cwd = workspace(t);
  let rgPath = fakeRg(cwd, `process.stdout.write(${JSON.stringify([event('first'), event('second', 2)].join('\n') + '\n')});`);
  const counted = await script(
    createGrepToolHandler({
      cwd,
      rgPath,
      maxMatches: 1
    }),
    {pattern: 'x'}
  );
  assert.equal(counted.data.matches.length, 1);
  assert.equal(counted.truncated, true);
  rgPath = fakeRg(
    cwd,
    `process.stdout.write(${JSON.stringify(event('first') + '\n')}); process.stdout.write(${JSON.stringify(event('x'.repeat(300000), 2) + '\n')});`
  );
  const oversized = await script(
    createGrepToolHandler({
      cwd,
      rgPath
    }),
    {pattern: 'x'}
  );
  assert.deepEqual(oversized.data.matches, [
    {
      path: 'note.txt',
      line: 1,
      column: 1,
      text: 'first'
    }
  ]);
  assert.equal(oversized.data.has_more, true);
  assert.equal(oversized.truncated, true);
  assert.deepEqual(stopRequests, ['SIGTERM', 'SIGTERM']);
});

test('read_files returns ordered partial failures without entering directory, image or PDF readers', async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'good.txt'), 'plain\r\ntext\r');
  for (const file of ['picture.png', 'document.pdf', 'vector.svg', 'video.mp4']) {
    fs.writeFileSync(path.join(cwd, file), 'would look like UTF-8');
  }
  fs.mkdirSync(path.join(cwd, 'directory'));
  const streamPaths = [];
  const original = fs.createReadStream;
  t.mock.method(fs, 'createReadStream', (...args) => {
    streamPaths.push(args[0]);
    return original(...args);
  });
  t.mock.method(fs, 'readdirSync', () => {
    throw new Error('不得枚举目录');
  });
  const image = require('../../src/tools/read-files/image-reader');
  const pdf = require('../../src/tools/read-files/pdf-reader');
  t.mock.method(image, 'readImageFile', () => {
    throw new Error('不得解码图片');
  });
  t.mock.method(pdf, 'extractPdfText', () => {
    throw new Error('不得提取 PDF');
  });
  const paths = ['good.txt', 'missing', 'directory', 'picture.png', 'document.pdf', 'vector.svg', 'video.mp4'];
  const result = await script(createReadFilesToolHandler({cwd}), {files: paths.map((path) => ({path}))});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'partial_failure');
  assert.deepEqual(
    result.data.files.map((file) => file.path),
    paths
  );
  assert.equal(result.data.files[0].content, 'plain\ntext');
  assert.equal(result.data.files[1].error.code, 'read_failed');
  for (const file of result.data.files.slice(2)) {
    assert.equal(file.error.code, 'unsupported_type');
  }
  assert.deepEqual(streamPaths, [path.join(cwd, 'good.txt')]);
  t.mock.restoreAll();
});

test('read_files rejects special files before opening a stream and preserves encoding failures', {skip: posixOnly}, async (t) => {
  const cwd = workspace(t);
  const fifo = path.join(cwd, 'pipe');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const result = await script(createReadFilesToolHandler({cwd}), {files: [{path: 'pipe'}, {path: '/dev/null'}]});
  assert.ok(result.data.files.every((file) => file.error.code === 'unsupported_type'));
  fs.writeFileSync(path.join(cwd, 'binary'), Buffer.from([0, 1]));
  fs.writeFileSync(path.join(cwd, 'utf16'), Buffer.from([0xff, 0xfe, 0x61, 0]));
  fs.writeFileSync(path.join(cwd, 'bad-utf8'), Buffer.from([0xc3, 0x28]));
  const invalid = await script(createReadFilesToolHandler({cwd}), {
    files: ['binary', 'utf16', 'bad-utf8', '.git/config'].map((path) => ({path}))
  });
  assert.ok(invalid.data.files.slice(0, 3).every((file) => file.error.code === 'invalid_encoding'));
  assert.equal(invalid.data.files[3].error.code, 'invalid_arguments');
});

test('text pagination distinguishes EOF, empty files, blank lines and normal limit from truncation', async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'note'), 'zero\r\none\rtwo\nthree');
  fs.writeFileSync(path.join(cwd, 'empty'), '');
  fs.writeFileSync(path.join(cwd, 'blank'), '\n\n');
  const handler = createReadFilesToolHandler({cwd});
  const paged = await script(handler, {
    files: [
      {
        path: 'note',
        offset: 1,
        limit: 2
      }
    ]
  });
  assert.equal(paged.truncated, false);
  assert.deepEqual(paged.data.files[0], {
    path: 'note',
    ok: true,
    kind: 'text',
    content: 'one\ntwo',
    offset: 1,
    returned_lines: 2,
    start_line: 2,
    end_line: 3,
    has_more: true,
    content_truncated: false,
    next_offset: 3
  });
  const last = await script(handler, {
    files: [
      {
        path: 'note',
        offset: 3,
        limit: 1
      }
    ]
  });
  assert.equal(last.data.files[0].total_lines, 4);
  assert.equal(last.data.files[0].next_offset, null);
  for (const request of [
    {path: 'empty'},
    {
      path: 'note',
      offset: 99
    }
  ]) {
    const file = (await script(handler, {files: [request]})).data.files[0];
    assert.equal(file.content, '');
    assert.equal(file.returned_lines, 0);
    assert.equal(file.start_line, null);
    assert.equal(file.end_line, null);
    assert.equal(file.has_more, false);
    assert.equal(file.next_offset, null);
    assert.equal(file.total_lines, request.path === 'empty' ? 0 : 4);
  }
  const blank = (await script(handler, {files: [{path: 'blank'}]})).data.files[0];
  assert.equal(blank.content, '\n');
  assert.equal(blank.returned_lines, 2);
  assert.equal(blank.total_lines, 2);
  const native = await handler.execute(
    {
      files: [
        {
          path: 'note',
          offset: 1,
          limit: 2
        }
      ]
    },
    call('read_files')
  );
  assert.match(native.text, /2 │ one\n3 │ two/);
  assert.equal(Object.hasOwn(native, 'data'), false);
});

test('text byte budgets preserve Unicode and never advertise a cursor past an incomplete line', async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'note'), '中文😀\nnext\n');
  const partial = await script(
    createReadFilesToolHandler({
      cwd,
      maxFileContentBytes: 7
    }),
    {files: [{path: 'note'}]}
  );
  const file = partial.data.files[0];
  assert.equal(file.content, '中文');
  assert.equal(file.returned_lines, 1);
  assert.equal(file.next_offset, null);
  assert.equal(file.has_more, true);
  assert.equal(file.content_truncated, true);
  assert.equal(partial.truncated, true);
  assert.equal(Object.hasOwn(file, 'total_lines'), false);
  const native = await createReadFilesToolHandler({
    cwd,
    maxFileContentBytes: 7
  }).execute({files: [{path: 'note'}]}, call('read_files'));
  assert.doesNotMatch(native.text, /next_offset/);
  const boundary = await script(
    createReadFilesToolHandler({
      cwd,
      maxFileContentBytes: 10
    }),
    {files: [{path: 'note'}]}
  );
  assert.equal(boundary.data.files[0].content, '中文😀');
  assert.equal(boundary.data.files[0].next_offset, 1);
});

test('JSON text projection trims complete rows, accounts for escaping and keeps accurate continuation', async (t) => {
  const cwd = workspace(t);
  const line = '"'.repeat(100);
  fs.writeFileSync(path.join(cwd, 'note'), Array(400).fill(line).join('\n'));
  const result = await script(createReadFilesToolHandler({cwd}), {files: [{path: 'note'}]});
  const file = result.data.files[0];
  assert.equal(result.truncated, true);
  assert.ok(file.returned_lines > 0 && file.returned_lines < 400);
  assert.ok(file.content.split('\n').every((value) => value === line));
  assert.equal(file.next_offset, file.returned_lines);
  assert.equal(file.total_lines, 400);
  const next = await script(createReadFilesToolHandler({cwd}), {
    files: [
      {
        path: 'note',
        offset: file.next_offset,
        limit: 1
      }
    ]
  });
  assert.equal(next.data.files[0].start_line, file.returned_lines + 1);
  assert.equal(next.data.files[0].content, line);
});

test('batch text budget is cumulative and oversized metadata yields bounded result_limit_exceeded', async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'a'), 'abcde');
  fs.writeFileSync(path.join(cwd, 'b'), 'fghij');
  const result = await script(
    createReadFilesToolHandler({
      cwd,
      maxTotalOutputBytes: 7
    }),
    {files: [{path: 'a'}, {path: 'b'}]}
  );
  assert.deepEqual(
    result.data.files.map((file) => file.content),
    ['abcde', 'fg']
  );
  assert.equal(result.data.files[1].next_offset, null);
  assert.equal(result.truncated, true);
  const overflow = await script(createReadFilesToolHandler({cwd}), {files: [{path: 'x'.repeat(70000)}]});
  assert.equal(overflow.error.code, 'result_limit_exceeded');
  assert.equal(overflow.data, null);
});

test('text chunks normalize split CRLF and UTF-8 without accumulating a skipped giant line', async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'crlf'), 'x'.repeat(65535) + '\r\n中文😀\r\nlast\n');
  const result = await script(createReadFilesToolHandler({cwd}), {
    files: [
      {
        path: 'crlf',
        offset: 1
      }
    ]
  });
  assert.equal(result.data.files[0].content, '中文😀\nlast');
  assert.equal(result.data.files[0].total_lines, 3);
  fs.writeFileSync(path.join(cwd, 'utf8'), 'x'.repeat(65535) + '😀\nlast');
  const read = await readTextFile({offset: 0}, path.join(cwd, 'utf8'), 65538);
  assert.equal(read.ok, true);
  assert.equal(read.value.content, 'x'.repeat(65535));
  assert.equal(read.value.nextOffset, null);
  assert.equal(read.value.contentTruncated, true);
});

for (const [name, factory] of [
  ['glob', createGlobToolHandler],
  ['grep', createGrepToolHandler]
]) {
  for (const channel of ['script', 'native']) {
    test(
      `${name} ${channel} abort waits for actual rg death, escalates SIGTERM and removes listeners`,
      {
        skip: signalSkip,
        timeout: 5000
      },
      async (t) => {
        const cwd = workspace(t);
        const rgPath = fakeRg(
          cwd,
          `process.on('SIGTERM', () => {}); require('node:fs').writeFileSync('pid', String(process.pid)); setTimeout(() => process.exit(2), 3500);`
        );
        const handler = factory({
          cwd,
          rgPath
        });
        const controller = new AbortController();
        const pending =
          channel === 'script'
            ? script(handler, {pattern: 'x'}, {abortSignal: controller.signal})
            : handler.execute({pattern: 'x'}, call(name), {abortSignal: controller.signal});
        let pid;
        t.after(() => {
          if (pid) {
            try {
              process.kill(pid, 'SIGKILL');
            } catch {}
          }
        });
        const until = Date.now() + 3000;
        while (!fs.existsSync(path.join(cwd, 'pid')) && Date.now() < until) {
          await delay(10);
        }
        pid = Number(fs.readFileSync(path.join(cwd, 'pid'), 'utf8'));
        const started = Date.now();
        controller.abort();
        const result = await pending;
        assert.equal(result.ok, false);
        if (channel === 'script') {
          assert.equal(result.error.code, 'cancelled');
        } else {
          assert.match(result.text, /cancelled/);
        }
        assert.ok(Date.now() - started < 1500);
        assert.throws(() => process.kill(pid, 0), {code: 'ESRCH'});
        pid = undefined;
        assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      }
    );
  }
}

test('already-aborted calls do not start rg or open text streams', async (t) => {
  const cwd = workspace(t);
  const controller = new AbortController();
  controller.abort();
  const streamMock = t.mock.method(fs, 'createReadStream', () => {
    throw new Error('不得打开 stream');
  });
  for (const factory of [createGlobToolHandler, createGrepToolHandler, createReadFilesToolHandler]) {
    const handler = factory({
      cwd,
      rgPath: path.join(cwd, 'missing')
    });
    const args = handler.definition.name === 'read_files' ? {files: [{path: 'note'}]} : {pattern: 'x'};
    const result = await script(handler, args, {abortSignal: controller.signal});
    assert.equal(result.error.code, 'cancelled');
    const native = await handler.execute(args, call(handler.definition.name), {abortSignal: controller.signal});
    assert.equal(native.ok, false);
    assert.match(native.text, /cancelled/);
  }
  assert.equal(streamMock.mock.callCount(), 0);
});

test('active text abort closes the real file descriptor before resolving, including native channel', async (t) => {
  const cwd = workspace(t);
  fs.writeFileSync(path.join(cwd, 'long'), 'x'.repeat(1000000));
  for (const channel of ['script', 'native']) {
    const controller = new AbortController();
    const original = fs.createReadStream;
    let stream;
    const mock = t.mock.method(fs, 'createReadStream', (...args) => {
      stream = original(...args);
      stream.once('data', () => controller.abort());
      return stream;
    });
    const handler = createReadFilesToolHandler({cwd});
    const args = {files: [{path: 'long'}]};
    const result =
      channel === 'script'
        ? await script(handler, args, {abortSignal: controller.signal})
        : await handler.execute(args, call('read_files'), {abortSignal: controller.signal});
    assert.equal(result.ok, false);
    if (channel === 'script') {
      assert.equal(result.error.code, 'cancelled');
    }
    assert.equal(stream.destroyed, true);
    assert.equal(stream.closed, true);
    assert.equal(stream.fd, null);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    mock.mock.restore();
  }
});
