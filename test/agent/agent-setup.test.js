const test = require('node:test');
const assert = require('node:assert/strict');

const agentSetupModule = require('../../src/agent/agent-setup');
const sandboxProvider = require('../../src/sandbox/provider');

const TEST_CONFIG = {
  agentType: 'fake',
  apiKey: '',
  model: 'fake',
  contextWindow: 128000,
  tools: {
    bash: {
      timeoutMs: 1000,
      maxOutputBytes: 1024
    },
    sandbox: {mode: 'off', network: false, extraWritablePaths: []}
  }
};

test('prepareAgent consumes the supplied runtime config and merges MCP tools', () => {
  const mcpManager = {
    listTools() {
      return [{
        serverName: 'docs',
        toolName: 'search',
        namespacedName: 'mcp__docs__search',
        description: 'Search docs',
        inputSchema: {type: 'object'}
      }];
    },
    listServerNames() {
      return ['docs'];
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

test('prepareAgent keeps its registry while each bash invocation captures the current sandbox override', async (t) => {
  const original = sandboxProvider.resolveBashSandboxContext;
  const modes = [];
  sandboxProvider.resolveBashSandboxContext = (_config, _executionMode, options) => {
    modes.push(options.modeOverride);
    return null;
  };
  t.after(() => { sandboxProvider.resolveBashSandboxContext = original; });
  let modeOverride;
  const prepared = agentSetupModule.prepareAgent({config: TEST_CONFIG, cwd: process.cwd(),
    get sandboxModeOverride() { return modeOverride; }});
  const registry = prepared.registry;
  const bash = registry.getHandler('run_bash_command');
  const call = {callId: 'bash', toolName: 'run_bash_command', argumentsText: '{}'};
  const first = bash.execute({command: 'echo original'}, call);
  modeOverride = 'read-only';
  assert.equal((await first).ok, true);
  assert.equal((await bash.execute({command: 'echo plan'}, call)).ok, true);
  modeOverride = undefined;
  assert.equal((await bash.execute({command: 'echo normal'}, call)).ok, true);
  assert.deepEqual(modes, [undefined, 'read-only', undefined]);
  assert.equal(prepared.registry, registry);
  assert.equal(registry.getHandler('run_bash_command'), bash);
});

test('prepareAgent injects the run skill registry and honors allowed tool filtering', () => {
  const injected = {
    listCatalog() {
      return [{name: 'alpha', description: 'Alpha', sourceKind: 'project', sourcePath: '/x/alpha/SKILL.md'}];
    },
    loadSkill(name) {
      return name === 'alpha'
        ? {ok: true, skill: {name: 'alpha', description: 'Alpha', sourceKind: 'project', sourcePath: '/x/alpha/SKILL.md', content: '# Alpha body', resources: []}}
        : {ok: false, reason: 'missing', message: `Unknown skill: ${name}`, availableSkills: this.listCatalog()};
    }
  };

  const full = agentSetupModule.prepareAgent({config: TEST_CONFIG, cwd: '/tmp/echo-agent-setup', skillRegistry: injected});
  assert.deepEqual(full.registry.listSkillCatalog().map(({name}) => name), ['alpha']);
  const handler = full.registry.getHandler('use_skill');
  assert.equal(handler !== undefined, true);
  const call = {callId: 'call-1', toolName: 'use_skill', argumentsText: ''};
  const loaded = handler.execute({name: 'alpha'}, call);
  assert.equal(loaded.ok, true);
  assert.match(loaded.text, /# Alpha body/u);
  const rejected = handler.execute({name: 'other'}, call);
  assert.equal(rejected.ok, false);
  assert.match(rejected.text, /available_skills:\n- alpha/u);

  const filtered = agentSetupModule.prepareAgent({
    allowedToolNames: new Set(['read_files']),
    config: TEST_CONFIG,
    cwd: '/tmp/echo-agent-setup',
    skillRegistry: injected
  });
  assert.equal(filtered.registry.getHandler('use_skill'), undefined);
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
