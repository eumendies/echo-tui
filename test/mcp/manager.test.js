const test = require('node:test');
const assert = require('node:assert/strict');

const {McpManager, createMcpToolName, redactSensitiveText} = require('../../src/mcp/manager');

function createServer(name, approval = 'always') {
  return {name, enabled: true, transport: 'stdio', command: 'node', timeoutMs: 1000, approval};
}

test('McpManager bootstraps successful servers and degrades failed servers', async () => {
  const closed = [];
  const manager = new McpManager({
    loadConfig() {
      return {
        enabled: true,
        diagnostics: [{serverName: 'badConfig', message: 'invalid'}],
        servers: [createServer('docs', 'never'), createServer('broken')]
      };
    },
    async createClient(server) {
      if (server.name === 'broken') {
        throw new Error('Authorization: Bearer secret-token');
      }

      return {
        async listTools() {
          return [{name: 'search', description: 'Search docs', inputSchema: {type: 'object'}}];
        },
        async callTool() {
          return {content: [{type: 'text', text: 'ok'}]};
        },
        async close() {
          closed.push(server.name);
        }
      };
    }
  });

  await manager.bootstrap();

  assert.deepEqual(manager.listTools(), [{
    serverName: 'docs',
    toolName: 'search',
    namespacedName: 'mcp__docs__search',
    approval: 'never',
    description: 'Search docs',
    inputSchema: {type: 'object'}
  }]);
  assert.equal(manager.getDiagnostics()[0].serverName, 'badConfig');
  assert.equal(manager.getDiagnostics()[1].serverName, 'broken');
  assert.match(manager.getDiagnostics()[1].message, /<redacted>/);

  await manager.close();
  assert.deepEqual(closed, ['docs']);
});

test('MCP tool names are normalized for provider function names', () => {
  assert.equal(createMcpToolName('docs api', 'search.files'), 'mcp__docs_api__search_files');
  assert.equal(redactSensitiveText('token=abc apiKey: def Authorization: Bearer ghi'), 'token=<redacted> apiKey: <redacted> Authorization: Bearer <redacted>');
});

test('McpManager closes clients when listing tools fails', async () => {
  const closed = [];
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('brokenList')]};
    },
    async createClient(server) {
      return {
        async listTools() {
          throw new Error('list failed');
        },
        async callTool() {
          return {content: []};
        },
        async close() {
          closed.push(server.name);
        }
      };
    }
  });

  await manager.bootstrap();

  assert.deepEqual(closed, ['brokenList']);
  assert.deepEqual(manager.listTools(), []);
});

test('McpManager skips conflicting MCP tool names', async () => {
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('docs api'), createServer('docs_api')]};
    },
    async createClient() {
      return {
        async listTools() {
          return [{name: 'search.files', description: 'Search', inputSchema: {type: 'object'}}];
        },
        async callTool() {
          return {content: []};
        },
        async close() {}
      };
    }
  });

  await manager.bootstrap();

  assert.deepEqual(manager.listTools().map((tool) => tool.namespacedName), ['mcp__docs_api__search_files']);
  assert.match(manager.getDiagnostics()[0].message, /conflict/);
});

test('McpManager reload closes old clients and uses latest config diagnostics', async () => {
  const closed = [];
  let config = {enabled: true, diagnostics: [], servers: [createServer('docs')]};
  const manager = new McpManager({
    loadConfig() {
      return config;
    },
    async createClient(server) {
      return {
        async listTools() {
          return [{name: 'search', description: `${server.name} search`, inputSchema: {type: 'object'}}];
        },
        async callTool() {
          return {content: []};
        },
        async close() {
          closed.push(server.name);
        }
      };
    }
  });

  await manager.bootstrap();
  assert.deepEqual(manager.listTools().map((tool) => tool.serverName), ['docs']);

  config = {enabled: true, diagnostics: [{serverName: 'bad', message: 'invalid'}], servers: [createServer('browser')]};
  await manager.reload();

  assert.deepEqual(closed, ['docs']);
  assert.deepEqual(manager.listTools().map((tool) => tool.serverName), ['browser']);
  assert.deepEqual(manager.getDiagnostics(), [{serverName: 'bad', message: 'invalid'}]);
});

test('McpManager reload clears all tools when MCP is globally disabled', async () => {
  const closed = [];
  let enabled = true;
  const manager = new McpManager({
    loadConfig() {
      return enabled
        ? {enabled: true, diagnostics: [], servers: [createServer('docs')]}
        : {enabled: false, diagnostics: [], servers: []};
    },
    async createClient(server) {
      return {
        async listTools() {
          return [{name: 'search', inputSchema: {type: 'object'}}];
        },
        async callTool() {
          return {content: []};
        },
        async close() {
          closed.push(server.name);
        }
      };
    }
  });

  await manager.bootstrap();
  enabled = false;
  await manager.reload();

  assert.deepEqual(closed, ['docs']);
  assert.deepEqual(manager.listTools(), []);
  assert.deepEqual(manager.getDiagnostics(), []);
});
