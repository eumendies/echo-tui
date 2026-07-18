const test = require('node:test');
const assert = require('node:assert/strict');

const agentSetupModule = require('../../src/agent/agent-setup');
const llmConfigModule = require('../../src/config/llm-config');

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

test('prepareAgent reads the selected profile and merges MCP tools into the initialized registry', () => {
  const originalReadLlmConfig = llmConfigModule.readLlmConfig;
  const configOptions = [];
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

  llmConfigModule.readLlmConfig = (options) => {
    configOptions.push(options);
    return TEST_CONFIG;
  };

  try {
    const prepared = agentSetupModule.prepareAgent({
      cwd: '/tmp/echo-agent-setup',
      mcpManager,
      modelProfileId: 'review-profile'
    });
    const toolNames = prepared.registry.listDefinitions().map((definition) => definition.name);

    assert.deepEqual(configOptions, [{modelProfileId: 'review-profile'}]);
    assert.equal(prepared.config, TEST_CONFIG);
    assert.ok(toolNames.includes('read_files'));
    assert.ok(toolNames.includes('mcp__docs__search'));
  } finally {
    llmConfigModule.readLlmConfig = originalReadLlmConfig;
  }
});
