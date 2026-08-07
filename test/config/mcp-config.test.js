const test = require('node:test');
const assert = require('node:assert/strict');

const {DEFAULT_MCP_TIMEOUT_MS} = require('../../src/config/mcp-config');
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

function saveMcpEnabledStateDraft(draft, options = {}) {
  return withContext(options, (context) => context.saveMcpEnabledStateDraft(draft));
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
            timeoutMs: 5000,
            approval: 'never'
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
        timeoutMs: DEFAULT_MCP_TIMEOUT_MS,
        approval: 'always'
      },
      {
        name: 'docs',
        enabled: true,
        transport: 'http',
        url: 'https://example.invalid/mcp',
        headers: {Authorization: 'Bearer secret'},
        timeoutMs: 5000,
        approval: 'never'
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

test('saveMcpEnabledStateDraft only updates enabled fields and preserves unknown config', () => {
  const writes = new Map();
  const renames = [];
  const source = {
    llm: {selectedModel: 'fake'},
    mcp: {
      enabled: false,
      extraRoot: 'keep',
      servers: {
        docs: {enabled: false, transport: 'http', url: 'https://example.invalid/mcp', custom: 'x'},
        bad: {transport: 'stdio'}
      }
    }
  };

  saveMcpEnabledStateDraft({
    enabled: true,
      servers: [
        {name: 'docs', enabled: true},
        {name: 'bad', enabled: false},
        {name: 'deleted', enabled: true}
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
  assert.deepEqual(saved, {
    llm: {selectedModel: 'fake'},
    mcp: {
      enabled: true,
      extraRoot: 'keep',
      servers: {
        docs: {enabled: true, transport: 'http', url: 'https://example.invalid/mcp', custom: 'x'},
        bad: {transport: 'stdio', enabled: false}
      }
    }
  });
});

test('saveMcpEnabledStateDraft rejects invalid config instead of overwriting it', () => {
  assert.throws(() => saveMcpEnabledStateDraft({enabled: true, servers: []}, {
    configPath: '/tmp/.echo/config.json',
    readFile: readConfigFrom('{bad json'),
    mkdir() {},
    writeFile() {
      throw new Error('should not write');
    },
    rename() {}
  }), /不是有效 JSON/);
});
