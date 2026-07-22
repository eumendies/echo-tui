const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {MAX_MCP_TOOL_RESULT_BYTES, createMcpToolRegistry, formatMcpToolResult, mergeToolRegistries} = require('../../src/mcp/tool-adapter');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {createToolExecutor} = require('../../src/tools/tool-executor');
const {createToolResultStore} = require('../../src/tools/tool-result-offloading');

test('createMcpToolRegistry converts MCP tools and proxies calls', async () => {
  const calls = [];
  const manager = {
    listTools() {
      return [{serverName: 'docs', toolName: 'search', namespacedName: 'mcp__docs__search', approval: 'always', description: 'Search docs', inputSchema: {type: 'object'}}];
    },
    async callTool(serverName, toolName, args) {
      calls.push({serverName, toolName, args});
      return {content: [{type: 'text', text: 'result text'}]};
    }
  };
  const registry = createMcpToolRegistry(manager);
  const executor = createToolExecutor(registry);
  const result = await executor.execute({callId: 'call_1', toolName: 'mcp__docs__search', argumentsText: JSON.stringify({query: 'mcp'})});

  assert.deepEqual(registry.listDefinitions(), [{name: 'mcp__docs__search', description: 'Search docs', parameters: {type: 'object'}}]);
  assert.deepEqual(calls, [{serverName: 'docs', toolName: 'search', args: {query: 'mcp'}}]);
  assert.deepEqual(result, {callId: 'call_1', toolName: 'mcp__docs__search', ok: true, details: {kind: 'generic'}, text: 'result text'});
});

test('MCP result formatter handles rich content and errors', () => {
  assert.equal(formatMcpToolResult({content: [{type: 'image', mimeType: 'image/png', data: 'abc'}], isError: true}), '[image] {\n  "type": "image",\n  "mimeType": "image/png",\n  "data": "abc"\n}');
  assert.equal(formatMcpToolResult({structuredContent: {count: 1}}), '{\n  "count": 1\n}');
});

test('MCP result formatter truncates oversized output', () => {
  const result = formatMcpToolResult({content: [{type: 'text', text: 'x'.repeat(MAX_MCP_TOOL_RESULT_BYTES + 100)}]});

  assert.match(result, /\[MCP tool result truncated: 100 characters omitted\]$/);
  assert.equal(result.length < MAX_MCP_TOOL_RESULT_BYTES + 100, true);
});

test('MCP formatter offloads text, structured content, and legacy results with a head marker', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-mcp-offload-'));
  const store = createToolResultStore({cwd: process.cwd(), rootDir});
  const cases = [
    {
      input: {content: [{type: 'text', text: `HEAD-${'你'.repeat(7000)}-TAIL`}]},
      expected: `HEAD-${'你'.repeat(7000)}-TAIL`
    },
    {
      input: {structuredContent: {payload: 'x'.repeat(MAX_MCP_TOOL_RESULT_BYTES + 1)}},
      expected: JSON.stringify({payload: 'x'.repeat(MAX_MCP_TOOL_RESULT_BYTES + 1)}, null, 2)
    },
    {
      input: {toolResult: `legacy-${'y'.repeat(MAX_MCP_TOOL_RESULT_BYTES)}`},
      expected: `legacy-${'y'.repeat(MAX_MCP_TOOL_RESULT_BYTES)}`
    }
  ];

  for (const {input, expected} of cases) {
    const result = formatMcpToolResult(input, store);
    const markerPath = result.match(/\[tool result truncated: ([^\]]+)\]$/)?.[1];

    assert.ok(markerPath);
    assert.equal(markerPath.startsWith(rootDir), true);
    assert.doesNotMatch(result, /\uFFFD/);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), expected);
    assert.equal((result.match(/tool result truncated/g) || []).length, 1);
  }
});

test('MCP registry preserves call identity and success while offloading oversized output', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-mcp-registry-offload-'));
  const store = createToolResultStore({cwd: process.cwd(), rootDir});
  const manager = {
    listTools() {
      return [{serverName: 'docs', toolName: 'large', namespacedName: 'mcp__docs__large', inputSchema: {type: 'object'}}];
    },
    async callTool() {
      return {content: [{type: 'text', text: 'z'.repeat(MAX_MCP_TOOL_RESULT_BYTES + 1)}]};
    }
  };
  const result = await createToolExecutor(createMcpToolRegistry(manager, store)).execute({
    callId: 'call_large',
    toolName: 'mcp__docs__large',
    argumentsText: '{}'
  });

  assert.equal(result.callId, 'call_large');
  assert.equal(result.toolName, 'mcp__docs__large');
  assert.equal(result.ok, true);
  assert.match(result.text, /\[tool result truncated: [^\]]+\]$/);
});

test('MCP offloading failure keeps the bounded legacy truncation without a path', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-mcp-offload-failure-'));
  const blockingFile = path.join(rootDir, 'blocked');
  fs.writeFileSync(blockingFile, 'block', 'utf8');
  const store = createToolResultStore({cwd: process.cwd(), rootDir: blockingFile});
  const result = formatMcpToolResult({content: [{type: 'text', text: 'x'.repeat(MAX_MCP_TOOL_RESULT_BYTES + 1)}]}, store);

  assert.match(result, /\[MCP tool result truncated: 1 characters omitted\]$/);
  assert.doesNotMatch(result, /\[tool result truncated:/);
});

test('mergeToolRegistries keeps built-in skill catalog and appends MCP tools', () => {
  const localHandler = {definition: {name: 'local', description: 'Local', parameters: {type: 'object'}}, execute() { return {callId: 'c', toolName: 'local', ok: true, details: {kind: 'generic'}, text: 'ok'}; }};
  const mcpHandler = {definition: {name: 'mcp__docs__search', description: 'Search', parameters: {type: 'object'}}, execute() { return {callId: 'c', toolName: 'mcp__docs__search', ok: true, details: {kind: 'generic'}, text: 'ok'}; }};
  const primary = {...createToolRegistry([localHandler]), listSkillCatalog: () => [{name: 'skill', description: 'desc'}]};
  const merged = mergeToolRegistries(primary, createToolRegistry([mcpHandler]));

  assert.deepEqual(merged.listDefinitions().map((definition) => definition.name), ['local', 'mcp__docs__search']);
  assert.deepEqual(merged.listSkillCatalog(), [{name: 'skill', description: 'desc'}]);
});
