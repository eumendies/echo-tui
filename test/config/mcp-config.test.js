const test = require('node:test');
const assert = require('node:assert/strict');

const {DEFAULT_MCP_TIMEOUT_MS, validateMcpConfigEditDraft} = require('../../src/config/mcp-config');
const {UserConfigContext} = require('../../src/config/user-config-context');

function withContext(options, read) {
  const context = new UserConfigContext(options);
  try {
    return read(context);
  } finally {
    context.close();
  }
}

function readMcpConfig(options = {}) {
  return withContext(options, (context) => context.capture().getMcpConfig());
}

function readMcpConfigDraft(options = {}) {
  return withContext(options, (context) => context.capture().getMcpConfigDraft());
}

function saveMcpConfigEditDraft(draft, options = {}) {
  return withContext(options, (context) => context.saveMcpConfigEditDraft(draft));
}

function createServerEditDraft(overrides = {}) {
  return {
    name: 'docs',
    originalName: 'docs',
    editable: true,
    enabled: true,
    transport: 'http',
    url: 'https://example.invalid/mcp',
    args: [],
    env: [],
    headers: [],
    timeoutMs: 30_000,
    ...overrides
  };
}

function readConfigFrom(value) {
  return () => value;
}

test('readMcpConfig returns empty enabled config when mcp is omitted', () => {
  assert.deepEqual(readMcpConfig({readFile: readConfigFrom('{}')}), {
    enabled: true,
    servers: [],
    diagnostics: []
  });
});

test('readMcpConfig parses stdio and http servers with defaults', () => {
  const config = readMcpConfig({
    readFile: readConfigFrom(JSON.stringify({
      mcp: {
        servers: {
          fs: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'server'],
            env: {FOO: 'bar'},
            cwd: '/tmp/project'
          },
          docs: {
            transport: 'http',
            url: 'https://example.invalid/mcp',
            headers: {Authorization: 'Bearer secret'},
            timeoutMs: 5000
          }
        }
      }
    }))
  });

  assert.deepEqual(config, {
    enabled: true,
    diagnostics: [],
    servers: [
      {
        name: 'fs',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'server'],
        env: {FOO: 'bar'},
        cwd: '/tmp/project',
        timeoutMs: DEFAULT_MCP_TIMEOUT_MS
      },
      {
        name: 'docs',
        enabled: true,
        transport: 'http',
        url: 'https://example.invalid/mcp',
        headers: {Authorization: 'Bearer secret'},
        timeoutMs: 5000
      }
    ]
  });
});

test('readMcpConfig ignores disabled servers and disabled root config', () => {
  assert.deepEqual(readMcpConfig({readFile: readConfigFrom(JSON.stringify({mcp: {enabled: false, servers: {fs: {transport: 'stdio', command: 'npx'}}}}))}), {
    enabled: false,
    servers: [],
    diagnostics: []
  });

  assert.deepEqual(readMcpConfig({readFile: readConfigFrom(JSON.stringify({mcp: {servers: {fs: {enabled: false, transport: 'stdio', command: 'npx'}}}}))}), {
    enabled: true,
    servers: [],
    diagnostics: []
  });
});

test('readMcpConfig reports invalid server configs per server', () => {
  const config = readMcpConfig({
    readFile: readConfigFrom(JSON.stringify({
      mcp: {
        servers: {
          badStdio: {transport: 'stdio'},
          badHttp: {transport: 'http'},
          good: {transport: 'stdio', command: 'node'}
        }
      }
    }))
  });

  assert.deepEqual(config.servers.map((server) => server.name), ['good']);
  assert.deepEqual(config.diagnostics.map((diagnostic) => diagnostic.serverName), ['badStdio', 'badHttp']);
});

test('readMcpConfigDraft keeps disabled and invalid servers for UI', () => {
  const draft = readMcpConfigDraft({
    readFile: readConfigFrom(JSON.stringify({
      mcp: {
        enabled: false,
        servers: {
          disabled: {enabled: false, transport: 'stdio', command: 'node'},
          bad: {transport: 'http'},
          docs: {transport: 'http', url: 'https://example.invalid/mcp'}
        }
      }
    }))
  });

  assert.equal(draft.enabled, false);
  assert.deepEqual(draft.servers, [
    {name: 'disabled', enabled: false, valid: true, transport: 'stdio', summary: 'node'},
    {name: 'bad', enabled: true, valid: false, summary: 'http MCP server 缺少有效 url', diagnostic: 'http MCP server 缺少有效 url'},
    {name: 'docs', enabled: true, valid: true, transport: 'http', summary: 'https://example.invalid/mcp'}
  ]);
});

test('saveMcpConfigEditDraft merges fields, keeps unknown config, and removes deleted servers', () => {
  const writes = new Map();
  const renames = [];
  const source = {
    llm: {selectedModel: 'fake'},
    mcp: {
      enabled: false,
      extraRoot: 'keep',
      servers: {
        docs: {enabled: false, transport: 'http', url: 'https://old.invalid/mcp', custom: 'x', headers: {Authorization: 'Bearer old-token'}},
        bad: {transport: 'stdio'},
        removed: {transport: 'http', url: 'https://removed.invalid/mcp'}
      }
    }
  };

  saveMcpConfigEditDraft({
    enabled: true,
    servers: [
      createServerEditDraft({
        url: 'https://new.invalid/mcp',
        headers: [{key: 'Authorization', stored: true}, {key: 'x-extra', value: 'v1'}]
      }),
      createServerEditDraft({name: 'bad', originalName: 'bad', editable: false, enabled: false, transport: 'stdio'})
    ]
  }, {
    configPath: '/tmp/.echo/config.json',
    readFile: readConfigFrom(JSON.stringify(source)),
    mkdir() {},
    writeFile(filePath, data) {
      writes.set(filePath, data);
    },
    rename(from, to) {
      renames.push([from, to]);
    },
    createTempPath() {
      return '/tmp/.echo/config.json.tmp';
    }
  });

  assert.deepEqual(renames, [['/tmp/.echo/config.json.tmp', '/tmp/.echo/config.json']]);
  const saved = JSON.parse(writes.get('/tmp/.echo/config.json.tmp'));

  // 未知字段、被删除节点与不可解析节点都按字段级合并语义处理。
  assert.deepEqual(saved.llm, {selectedModel: 'fake'});
  assert.equal(saved.mcp.enabled, true);
  assert.equal(saved.mcp.extraRoot, 'keep');
  assert.deepEqual(Object.keys(saved.mcp.servers), ['docs', 'bad']);
  assert.equal(saved.mcp.servers.docs.url, 'https://new.invalid/mcp');
  assert.equal(saved.mcp.servers.docs.custom, 'x');
  assert.equal(saved.mcp.servers.docs.enabled, true);
  // 未改动的密钥保留原值,新键写入草稿值。
  assert.deepEqual(saved.mcp.servers.docs.headers, {Authorization: 'Bearer old-token', 'x-extra': 'v1'});
  assert.deepEqual(saved.mcp.servers.bad, {transport: 'stdio'});
});

test('saveMcpConfigEditDraft clears secrets only on explicit clear and validates drafts', () => {
  const writes = new Map();
  const source = {
    mcp: {
      enabled: true,
      servers: {
        docs: {transport: 'http', url: 'https://example.invalid/mcp', headers: {Authorization: 'Bearer old-token'}}
      }
    }
  };
  const options = {
    configPath: '/tmp/.echo/config.json',
    readFile: readConfigFrom(JSON.stringify(source)),
    mkdir() {},
    writeFile(filePath, data) {
      writes.set(filePath, data);
    },
    rename() {},
    createTempPath() {
      return '/tmp/.echo/config.json.tmp';
    }
  };

  // 显式清空:草稿值为空串时写入空值,与"未改动"可区分。
  saveMcpConfigEditDraft({enabled: true, servers: [createServerEditDraft({headers: [{key: 'Authorization', value: ''}]})]}, options);
  const saved = JSON.parse(writes.get('/tmp/.echo/config.json.tmp'));
  assert.deepEqual(saved.mcp.servers.docs.headers, {Authorization: ''});

  // 校验:名称、必填字段与 timeoutMs 区间都逐条报错,不静默修正。
  const issues = validateMcpConfigEditDraft({
    enabled: true,
    servers: [
      createServerEditDraft({name: '', transport: 'stdio', command: 'node'}),
      createServerEditDraft({name: 'dup', transport: 'stdio'}),
      createServerEditDraft({name: 'dup', transport: 'stdio', command: 'node'}),
      createServerEditDraft({name: 'http-missing-url', transport: 'http', url: undefined}),
      createServerEditDraft({name: 'bad-timeout', timeoutMs: 10})
    ]
  });

  assert.deepEqual(issues.map((issue) => issue.message), [
    'server 名不能为空',
    'stdio server 缺少 command',
    'server 名重复：dup',
    'http server 缺少 url',
    'timeoutMs 必须是 1000–120000 之间的整数'
  ]);
});

test('saveMcpConfigEditDraft keeps inactive transport fields and follows renamed secret keys', () => {
  const writes = new Map();
  const source = {
    mcp: {
      enabled: true,
      servers: {
        docs: {
          transport: 'http',
          url: 'https://example.invalid/mcp',
          command: 'npx',
          args: ['-y', 'legacy'],
          env: {LEGACY_TOKEN: 'keep-me'},
          headers: {Authorization: 'Bearer old-token'}
        }
      }
    }
  };
  const options = {
    configPath: '/tmp/.echo/config.json',
    readFile: readConfigFrom(JSON.stringify(source)),
    mkdir() {},
    writeFile(filePath, data) {
      writes.set(filePath, data);
    },
    rename() {},
    createTempPath() {
      return '/tmp/.echo/config.json.tmp';
    }
  };

  saveMcpConfigEditDraft({
    enabled: true,
    servers: [createServerEditDraft({headers: [{key: 'X-Auth', originalKey: 'Authorization', stored: true}]})]
  }, options);

  const saved = JSON.parse(writes.get('/tmp/.echo/config.json.tmp')).mcp.servers.docs;

  // 当前 transport 之外的字段不在面板展示范围内,保存时原样保留而不是被隐式删除。
  assert.equal(saved.command, 'npx');
  assert.deepEqual(saved.args, ['-y', 'legacy']);
  assert.deepEqual(saved.env, {LEGACY_TOKEN: 'keep-me'});
  // 键被重命名时原值跟随条目移动,而不是写成空串。
  assert.deepEqual(saved.headers, {'X-Auth': 'Bearer old-token'});
});

test('saveMcpConfigEditDraft rejects invalid config instead of overwriting it', () => {
  assert.throws(() => saveMcpConfigEditDraft({enabled: true, servers: []}, {
    configPath: '/tmp/.echo/config.json',
    readFile: readConfigFrom('{bad json'),
    mkdir() {},
    writeFile() {
      throw new Error('should not write');
    },
    rename() {}
  }), /不是有效 JSON/);
});
