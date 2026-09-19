const test = require('node:test');
const assert = require('node:assert/strict');

const {McpManager, createMcpToolName, redactSensitiveText} = require('../../src/mcp/manager');

function createServer(name) {
  return {name, enabled: true, transport: 'stdio', command: 'node', timeoutMs: 1000};
}

test('McpManager bootstraps successful servers and degrades failed servers', async () => {
  const closed = [];
  const manager = new McpManager({
    loadConfig() {
      return {
        enabled: true,
        diagnostics: [{serverName: 'badConfig', message: 'invalid'}],
        servers: [createServer('docs'), createServer('broken')]
      };
    },
    async createClient(server) {
      if (server.name === 'broken') {
        throw new Error('Authorization: Bearer secret-token');
      }

      return {
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
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
    readOnly: false,
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

test('McpManager exposes the tool readOnly hint as the only MCP approval input', async () => {
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('docs')]};
    },
    async createClient() {
      return {
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
        async listTools() {
          return [
            {name: 'read', description: 'Read docs', inputSchema: {type: 'object'}, readOnly: true},
            {name: 'write', description: 'Write docs', inputSchema: {type: 'object'}, readOnly: false},
            {name: 'unknown', description: 'No hint', inputSchema: {type: 'object'}}
          ];
        },
        async callTool() {
          return {content: []};
        },
        async close() {}
      };
    }
  });

  await manager.bootstrap();

  // 只读 hint 缺失或为 false 时都按“非只读”归一。
  assert.deepEqual(manager.listTools().map(({namespacedName, readOnly}) => ({namespacedName, readOnly})), [
    {namespacedName: 'mcp__docs__read', readOnly: true},
    {namespacedName: 'mcp__docs__write', readOnly: false},
    {namespacedName: 'mcp__docs__unknown', readOnly: false}
  ]);

  // 审批边界只看该事实:集合仅包含声明只读的工具,由 run 启动时一次物化。
  assert.deepEqual([...manager.listReadonlyToolNames()], ['mcp__docs__read']);
});

test('McpManager closes clients when listing tools fails', async () => {
  const closed = [];
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('brokenList')]};
    },
    async createClient(server) {
      return {
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
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
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
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
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
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
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
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

test('McpManager discovers resources only for servers that advertise the capability', async () => {
  const longDescription = 'x'.repeat(1000);
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('docs'), createServer('tools-only')]};
    },
    async createClient(server) {
      const withResources = server.name === 'docs';

      return {
        supportsResources() {
          return withResources;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
        async listTools() {
          return [{name: 'search', description: 'Search', inputSchema: {type: 'object'}}];
        },
        async listResources(limit) {
          if (!withResources) {
            throw new Error('resources/list must not be called for a server without the capability');
          }

          return [
            {uri: 'file:///a.md', name: 'a', title: 'A', description: longDescription},
            {uri: 'file:///b.md', name: 'b'}
          ].slice(0, limit);
        },
        async listResourceTemplates() {
          return withResources ? [{uriTemplate: 'file:///{path}', name: 'file'}] : [];
        },
        async readResource(uri) {
          return {contents: [{uri, mimeType: 'text/markdown', text: 'hello'}]};
        },
        async callTool() {
          return {content: []};
        },
        async close() {}
      };
    }
  });

  await manager.bootstrap();

  assert.deepEqual(manager.listServerNames(), ['docs', 'tools-only']);
  assert.deepEqual(manager.listResources().map(({serverName, uri}) => ({serverName, uri})), [
    {serverName: 'docs', uri: 'file:///a.md'},
    {serverName: 'docs', uri: 'file:///b.md'}
  ]);
  // 描述按有界文本缓存，避免 server 用超长字段撑爆工具输出。
  assert.equal(manager.listResources()[0].description.length, 512);
  assert.deepEqual(manager.listResourceTemplates().map(({serverName, uriTemplate}) => ({serverName, uriTemplate})), [
    {serverName: 'docs', uriTemplate: 'file:///{path}'}
  ]);
  assert.deepEqual(await manager.readResource('docs', 'file:///a.md'), {
    contents: [{uri: 'file:///a.md', mimeType: 'text/markdown', text: 'hello'}]
  });
  await assert.rejects(() => manager.readResource('missing', 'file:///a.md'), /MCP server unavailable/);
});

test('McpManager degrades a failing resource endpoint without losing tools or templates', async () => {
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('docs')]};
    },
    async createClient() {
      return {
        supportsResources() {
          return true;
        },
        supportsPrompts() {
          return false;
        },
        setPromptsListChangedHandler() {},
        async listTools() {
          return [{name: 'search', inputSchema: {type: 'object'}}];
        },
        async listResources() {
          const error = new Error('Method not found');
          error.code = -32601;
          throw error;
        },
        async listResourceTemplates() {
          return [{uriTemplate: 'file:///{path}', name: 'file'}];
        },
        async readResource() {
          return {contents: []};
        },
        async callTool() {
          return {content: []};
        },
        async close() {}
      };
    }
  });

  await manager.bootstrap();

  // 资源列表失败只降级该目录:模板、工具能力与 server 状态保持可用，并留下脱敏诊断。
  assert.deepEqual(manager.listResources(), []);
  assert.deepEqual(manager.listResourceTemplates().map((template) => template.uriTemplate), ['file:///{path}']);
  assert.deepEqual(manager.listTools().map((tool) => tool.namespacedName), ['mcp__docs__search']);
  assert.equal(manager.listServerNames().includes('docs'), true);
  assert.match(manager.getDiagnostics()[0].message, /Method not found/);
});

test('McpManager discovers prompts only for servers that advertise the capability', async () => {
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('docs'), createServer('tools-only')]};
    },
    async createClient(server) {
      const withPrompts = server.name === 'docs';

      return {
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return withPrompts;
        },
        setPromptsListChangedHandler() {},
        async listTools() {
          return [{name: 'search', inputSchema: {type: 'object'}}];
        },
        async listPrompts(limit) {
          if (!withPrompts) {
            throw new Error('prompts/list must not be called for a server without the capability');
          }

          return [{
            name: 'code_review',
            description: 'Review code',
            arguments: [{name: 'code', required: true}, {name: 'lang', description: 'Language', required: false}]
          }].slice(0, limit);
        },
        async getPrompt(name, args) {
          return {messages: [{role: 'user', content: {kind: 'text', text: `${name}:${args.code}`}}]};
        },
        async listResources() {
          return [];
        },
        async listResourceTemplates() {
          return [];
        },
        async callTool() {
          return {content: []};
        },
        async close() {}
      };
    }
  });

  await manager.bootstrap();

  assert.deepEqual(manager.listPrompts(), [{
    serverName: 'docs',
    promptName: 'code_review',
    description: 'Review code',
    arguments: [{name: 'code', required: true}, {name: 'lang', description: 'Language', required: false}]
  }]);
  assert.deepEqual(await manager.getPrompt('docs', 'code_review', {code: 'x'}), {
    messages: [{role: 'user', content: {kind: 'text', text: 'code_review:x'}}]
  });
  await assert.rejects(() => manager.getPrompt('missing', 'code_review', {}), /MCP server unavailable/);
});

test('McpManager degrades a failing prompt endpoint and refreshes on list changed', async () => {
  let listChangedHandler;
  let listCalls = 0;
  const manager = new McpManager({
    loadConfig() {
      return {enabled: true, diagnostics: [], servers: [createServer('docs')]};
    },
    async createClient() {
      return {
        supportsResources() {
          return false;
        },
        supportsPrompts() {
          return true;
        },
        setPromptsListChangedHandler(handler) {
          listChangedHandler = handler;
        },
        async listTools() {
          return [{name: 'search', inputSchema: {type: 'object'}}];
        },
        async listPrompts() {
          listCalls += 1;

          if (listCalls === 1) {
            throw new Error('Method not found');
          }

          return [{name: 'review', arguments: []}];
        },
        async getPrompt() {
          return {messages: []};
        },
        async listResources() {
          return [];
        },
        async listResourceTemplates() {
          return [];
        },
        async callTool() {
          return {content: []};
        },
        async close() {}
      };
    }
  });

  await manager.bootstrap();

  // 目录拉取失败只降级为空目录:工具能力与诊断保留,不重连也不中断。
  assert.deepEqual(manager.listPrompts(), []);
  assert.match(manager.getDiagnostics()[0].message, /Method not found/);
  assert.deepEqual(manager.listTools().map((tool) => tool.namespacedName), ['mcp__docs__search']);

  // list changed 通知只触发该 server 的目录刷新,不重连进程。
  listChangedHandler();

  // 刷新是异步的:等结果落缓存,而不是等调用计数(计数在 await 之前就自增)。
  for (let attempt = 0; attempt < 50 && manager.listPrompts().length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(listCalls, 2);
  assert.deepEqual(manager.listPrompts().map((prompt) => prompt.promptName), ['review']);
});
