const test = require('node:test');
const assert = require('node:assert/strict');

const {MAX_MCP_TOOL_RESULT_CHARS, createMcpToolRegistry, formatMcpToolResult, mergeToolRegistries} = require('../../src/mcp/tool-adapter');
const {createToolRegistry} = require('../../src/tools/tool-registry');
const {createToolExecutor} = require('../../src/tools/tool-executor');

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
  const result = formatMcpToolResult({content: [{type: 'text', text: 'x'.repeat(MAX_MCP_TOOL_RESULT_CHARS + 1)}]});

  assert.equal(result.includes('MCP tool result truncated'), true);
  assert.equal(result.length < MAX_MCP_TOOL_RESULT_CHARS + 100, true);
});

test('mergeToolRegistries keeps built-in skill catalog and appends MCP tools', () => {
  const localHandler = {definition: {name: 'local', description: 'Local', parameters: {type: 'object'}}, execute() { return {callId: 'c', toolName: 'local', ok: true, details: {kind: 'generic'}, text: 'ok'}; }};
  const mcpHandler = {definition: {name: 'mcp__docs__search', description: 'Search', parameters: {type: 'object'}}, execute() { return {callId: 'c', toolName: 'mcp__docs__search', ok: true, details: {kind: 'generic'}, text: 'ok'}; }};
  const primary = {...createToolRegistry([localHandler]), listSkillCatalog: () => [{name: 'skill', description: 'desc'}]};
  const merged = mergeToolRegistries(primary, createToolRegistry([mcpHandler]));

  assert.deepEqual(merged.listDefinitions().map((definition) => definition.name), ['local', 'mcp__docs__search']);
  assert.deepEqual(merged.listSkillCatalog(), [{name: 'skill', description: 'desc'}]);
});
