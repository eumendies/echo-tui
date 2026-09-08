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

test('prepareAgent injects runtime session id into the preset-declared session header', () => {
  const prepared = agentSetupModule.prepareAgent({
    config: {
      ...TEST_CONFIG,
      sessionHeader: 'x-opencode-session',
      headers: {'User-Agent': 'echo-tui/1.0'}
    },
    cwd: '/tmp/echo-agent-setup',
    sessionId: 'session-123'
  });

  assert.deepEqual(prepared.config.headers, {
    'User-Agent': 'echo-tui/1.0',
    'x-opencode-session': 'session-123'
  });
});

test('prepareAgent lets the runtime session id override a same-name static header', () => {
  const prepared = agentSetupModule.prepareAgent({
    config: {
      ...TEST_CONFIG,
      sessionHeader: 'x-opencode-session',
      headers: {'x-opencode-session': 'static-value'}
    },
    cwd: '/tmp/echo-agent-setup',
    sessionId: 'session-123'
  });

  assert.deepEqual(prepared.config.headers, {'x-opencode-session': 'session-123'});
});

test('prepareAgent keeps config identity when session header or session id is missing', () => {
  const configWithoutIdentity = {...TEST_CONFIG, sessionHeader: 'x-opencode-session'};
  const withoutIdentity = agentSetupModule.prepareAgent({config: configWithoutIdentity, cwd: '/tmp/echo-agent-setup'});

  assert.equal(withoutIdentity.config, configWithoutIdentity);
  assert.equal(withoutIdentity.config.headers, undefined);

  const plainConfig = {...TEST_CONFIG};
  const withoutHeader = agentSetupModule.prepareAgent({config: plainConfig, cwd: '/tmp/echo-agent-setup', sessionId: 'session-123'});

  assert.equal(withoutHeader.config, plainConfig);
});
