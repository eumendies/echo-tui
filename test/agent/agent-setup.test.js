const test = require('node:test');
const assert = require('node:assert/strict');

const agentSetupModule = require('../../src/agent/agent-setup');

const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake',
  contextWindow: 128000,
  tools: {
    bash: {
      timeoutMs: 1000,
      maxOutputBytes: 1024
    }
  }
};

test('prepareAgent consumes the supplied runtime config and merges MCP tools', () => {
  const mcpManager = {
    listTools() {
      return [{
        serverName: 'docs',
        toolName: 'search',
        namespacedName: 'mcp__docs__search',
        approval: 'always',
        description: 'Search docs',
        inputSchema: {type: 'object'}
      }];
    }
  };

  const prepared = agentSetupModule.prepareAgent({
    config: TEST_CONFIG,
    cwd: '/tmp/echo-agent-setup',
    mcpManager
  });
  const toolNames = prepared.registry.listDefinitions().map((definition) => definition.name);

  assert.equal(prepared.config, TEST_CONFIG);
  assert.ok(toolNames.includes('read_files'));
  assert.ok(toolNames.includes('mcp__docs__search'));
});
