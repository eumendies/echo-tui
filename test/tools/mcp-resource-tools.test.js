const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  LIST_MCP_RESOURCES_TOOL_NAME,
  MAX_MCP_RESOURCE_RESULT_BYTES,
  READ_MCP_RESOURCE_TOOL_NAME,
  createMcpResourceToolHandlers
} = require('../../src/tools/mcp-resource-tools');
const {createDefaultToolRegistry, createToolRegistry} = require('../../src/tools/tool-registry');
const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createToolResultStore} = require('../../src/tools/tool-result-offloading');

function createManager(overrides = {}) {
  return {
    listResources() {
      return [
        {serverName: 'docs', uri: 'file:///guide.md', name: 'guide', title: 'Guide', description: 'Getting started', mimeType: 'text/markdown'},
        {serverName: 'notes', uri: 'note:///1', name: 'note-1', mimeType: 'text/plain'}
      ];
    },
    listResourceTemplates() {
      return [{serverName: 'docs', uriTemplate: 'file:///{path}', name: 'file', description: 'Any project file'}];
    },
    listServerNames() {
      return ['docs', 'notes'];
    },
    async readResource(serverName, uri) {
      return {contents: [{uri, text: `${serverName}:${uri}`}]};
    },
    ...overrides
  };
}

function createExecutor(manager, toolResultStore) {
  return createToolExecutor(createToolRegistry(createMcpResourceToolHandlers({manager, toolResultStore})));
}

test('createMcpResourceToolHandlers exposes two read-only resource tools', () => {
  const registry = createToolRegistry(createMcpResourceToolHandlers({manager: createManager()}));

  assert.deepEqual(registry.listDefinitions().map((definition) => definition.name), [LIST_MCP_RESOURCES_TOOL_NAME, READ_MCP_RESOURCE_TOOL_NAME]);
  assert.deepEqual(registry.getHandler(READ_MCP_RESOURCE_TOOL_NAME).definition.parameters.required, ['server', 'uri']);
  assert.equal(registry.getHandler(LIST_MCP_RESOURCES_TOOL_NAME).definition.parameters.required, undefined);
});

test('default registry registers MCP resource tools only when a server is initialized', () => {
  const config = {
    agentType: 'fake',
    apiKey: '',
    model: 'fake',
    tools: {bash: {timeoutMs: null, maxOutputBytes: 65_536}, fileEditMode: 'apply_patch', sandbox: {mode: 'off', network: false, extraWritablePaths: []}}
  };
  const namesFor = (mcpManager) => createDefaultToolRegistry(config, '/tmp/echo-mcp-resource-registry', undefined, mcpManager ? {mcpManager} : {})
    .listDefinitions()
    .map(({name}) => name);

  // 未注入 manager 或没有任何 server 初始化成功时,registry 保持仅内置工具目录。
  assert.equal(namesFor(undefined).includes(LIST_MCP_RESOURCES_TOOL_NAME), false);
  assert.equal(namesFor({listServerNames: () => []}).includes(READ_MCP_RESOURCE_TOOL_NAME), false);

  // 至少一个 server 初始化成功时注册两个资源工具。
  const withServer = namesFor({listServerNames: () => ['docs']});

  assert.equal(withServer.includes(LIST_MCP_RESOURCES_TOOL_NAME), true);
  assert.equal(withServer.includes(READ_MCP_RESOURCE_TOOL_NAME), true);
});

test('list_mcp_resources lists resources and templates with an optional server filter', async () => {
  const executor = createExecutor(createManager());
  const result = await executor.execute({callId: 'list-all', toolName: LIST_MCP_RESOURCES_TOOL_NAME, argumentsText: '{}'});

  assert.equal(result.ok, true);
  assert.match(result.text, /- \[docs\] file:\/\/\/guide\.md \(name: guide, title: Guide, mime: text\/markdown\)/);
  assert.match(result.text, /Getting started/);
  assert.match(result.text, /- \[notes\] note:\/\/\/1 \(name: note-1, mime: text\/plain\)/);
  assert.match(result.text, /Resource templates/);
  assert.match(result.text, /- \[docs\] file:\/\/\/\{path\} \(name: file/);
  // 模板描述与资源描述使用同一渲染口径:缓存下来的元数据必须可见。
  assert.match(result.text, /- \[docs\] file:\/\/\/\{path\} \(name: file\)\n  Any project file/);

  const filtered = await executor.execute({callId: 'list-notes', toolName: LIST_MCP_RESOURCES_TOOL_NAME, argumentsText: JSON.stringify({server: 'notes'})});

  assert.match(filtered.text, /note:\/\/\/1/);
  assert.doesNotMatch(filtered.text, /guide\.md/);
  assert.doesNotMatch(filtered.text, /Resource templates/);
});

test('list_mcp_resources reports empty catalogs and unknown servers with actionable text', async () => {
  const empty = createExecutor(createManager({
    listResources() {
      return [];
    },
    listResourceTemplates() {
      return [];
    }
  }));
  const emptyResult = await empty.execute({callId: 'list-empty', toolName: LIST_MCP_RESOURCES_TOOL_NAME, argumentsText: '{}'});

  assert.equal(emptyResult.ok, true);
  assert.match(emptyResult.text, /no MCP resources available/);

  const unknown = await createExecutor(createManager()).execute({
    callId: 'list-unknown',
    toolName: LIST_MCP_RESOURCES_TOOL_NAME,
    argumentsText: JSON.stringify({server: 'missing'})
  });

  assert.equal(unknown.ok, true);
  assert.match(unknown.text, /no MCP resources found for server "missing"/);
  assert.match(unknown.text, /Known servers: docs, notes/);
});

test('read_mcp_resource merges contents in order and proxies the shared manager', async () => {
  const calls = [];
  const executor = createExecutor(createManager({
    async readResource(serverName, uri) {
      calls.push({serverName, uri});
      return {
        contents: [
          {uri, mimeType: 'text/markdown', text: 'first part'},
          {uri: `${uri}#image`, mimeType: 'image/png', blobBytes: 2048},
          {uri, text: 'second part'}
        ]
      };
    }
  }));
  const result = await executor.execute({
    callId: 'read-1',
    toolName: READ_MCP_RESOURCE_TOOL_NAME,
    argumentsText: JSON.stringify({server: 'docs', uri: 'file:///guide.md'})
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{serverName: 'docs', uri: 'file:///guide.md'}]);
  assert.match(result.text, /Resource: file:\/\/\/guide\.md \(server: docs\)/);
  assert.match(result.text, /first part\n\n\[Binary resource content image\/png, 2048 bytes\]\n\nsecond part/);
});

test('read_mcp_resource keeps oversized content bounded and offloads the full text', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-mcp-resource-offload-'));
  const toolResultStore = createToolResultStore({cwd: process.cwd(), rootDir});
  const executor = createExecutor(createManager({
    async readResource(serverName, uri) {
      return {contents: [{uri, text: 'x'.repeat(MAX_MCP_RESOURCE_RESULT_BYTES + 1_000)}]};
    }
  }), toolResultStore);

  try {
    const result = await executor.execute({
      callId: 'read-large',
      toolName: READ_MCP_RESOURCE_TOOL_NAME,
      argumentsText: JSON.stringify({server: 'docs', uri: 'file:///huge.md'})
    });

    assert.equal(result.ok, true);
    assert.ok(Buffer.byteLength(result.text, 'utf8') <= MAX_MCP_RESOURCE_RESULT_BYTES);
    assert.match(result.text, /tool result truncated: .*tool-result-.*\.txt/);
  } finally {
    fs.rmSync(rootDir, {recursive: true, force: true});
  }
});

test('read_mcp_resource returns bounded failures without leaking credentials', async () => {
  const executor = createExecutor(createManager({
    async readResource() {
      throw new Error('Authorization: Bearer tvly-secret-token');
    }
  }));
  const failed = await executor.execute({
    callId: 'read-error',
    toolName: READ_MCP_RESOURCE_TOOL_NAME,
    argumentsText: JSON.stringify({server: 'docs', uri: 'file:///guide.md'})
  });

  assert.equal(failed.ok, false);
  assert.match(failed.text, /MCP resource read failed/);
  assert.match(failed.text, /<redacted>/);
  assert.doesNotMatch(failed.text, /tvly-secret-token/);

  const invalid = await executor.execute({
    callId: 'read-invalid',
    toolName: READ_MCP_RESOURCE_TOOL_NAME,
    argumentsText: JSON.stringify({server: '  ', uri: ''})
  });

  assert.equal(invalid.ok, false);
  assert.match(invalid.text, /requires non-empty string parameters/);
});
