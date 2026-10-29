const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {runOnce, stripAnsiControlSequences} = require('../../src/cli/one-shot');
const {AgentAbortError} = require('../../src/types/agent');
const {UserConfigContext} = require('../../src/config/user-config-context');

function createResources() {
  const events = [];
  const signalListeners = new Map();

  return {
    events,
    debug: {
      enabled: false,
      logPath: null,
      emit() {},
      close() {
        events.push('debug.close');
      }
    },
    hooks: {
      emit(event, payload) {
        events.push(`hook:${event}:${payload.status}`);
      },
      async flush() {
        events.push('hooks.flush');
      },
      updateConfig() {}
    },
    mcpManager: {
      async bootstrap() {
        events.push('mcp.bootstrap');
      },
      listReadonlyToolNames() {
        return new Set();
      },
      listServerNames() {
        return [];
      },
      async close() {
        events.push('mcp.close');
      }
    },
    process: {
      once(event, listener) {
        signalListeners.set(event, listener);
        events.push(`signal.once:${event}`);
        return this;
      },
      removeListener(event, listener) {
        assert.equal(signalListeners.get(event), listener);
        signalListeners.delete(event);
        events.push(`signal.remove:${event}`);
        return this;
      }
    }
  };
}

test('runOnce executes without TTY and writes only final plain text', async () => {
  const resources = createResources();
  const output = [];
  let session;

  await runOnce({
    cwd: '/tmp/project',
    debug: resources.debug,
    fullAccess: true,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt: 'explain this',
    runAgent: async (nextSession) => {
      session = nextSession;
      return '\u001b[32mdone\u001b[0m';
    },
    stdout: {write: (text) => output.push(text)}
  });

  assert.equal(session.interactionMode, 'normal');
  assert.deepEqual(session.executionMode, {kind: 'headless', approvalPolicy: 'full-access'});
  assert.deepEqual(session.records, [{role: 'user', text: 'explain this'}]);
  assert.deepEqual(output, ['done\n']);
  assert.deepEqual(resources.events, [
    'signal.once:SIGINT',
    'signal.once:SIGTERM',
    'mcp.bootstrap',
    'hook:assistant_turn_start:started',
    'hook:assistant_turn_end:completed',
    'signal.remove:SIGINT',
    'signal.remove:SIGTERM',
    'mcp.close'
  ]);
});

test('runOnce keeps existing @ paths literal without confirmed composer metadata', async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-once-mention-'));
  t.after(() => fs.rmSync(cwd, {recursive: true, force: true}));
  fs.writeFileSync(path.join(cwd, 'note.txt'), 'PRIVATE FILE CONTENTS');
  const resources = createResources();
  const prompt = 'explain @note.txt @missing.txt user@example.com';
  await runOnce({
    cwd,
    debug: resources.debug,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt,
    runAgent: async (session) => {
      assert.deepEqual(session.records, [{role: 'user', text: prompt}]);
      assert.deepEqual(session.executionMode, {kind: 'headless', approvalPolicy: 'deny'});
      return 'literal input';
    },
    stdout: {write() {}}
  });
});

test('runOnce defaults to headless denial without supplying an interactive question callback', async () => {
  const resources = createResources();
  const output = [];
  let callbacks;

  await runOnce({
    debug: resources.debug,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt: 'inspect',
    runAgent: async (session, nextCallbacks) => {
      callbacks = nextCallbacks;
      assert.deepEqual(session.executionMode, {kind: 'headless', approvalPolicy: 'deny'});
      return 'safe';
    },
    stdout: {write: (text) => output.push(text)}
  });

  assert.equal(callbacks, undefined);
  assert.deepEqual(output, ['safe\n']);
});

test('runOnce ignores the main history display budget and emits the entire response', async () => {
  const answer = Array.from({length: 1500}, (_, index) => `headless line ${index}`).join('\n');
  for (const historyRenderLineLimit of [500, 1000, 0]) {
    const resources = createResources();
    const output = [];
    const context = new UserConfigContext({readFile: () => JSON.stringify({ui: {historyRenderLineLimit}})});
    try {
      await runOnce({
        cwd: '/tmp/project', debug: resources.debug, hooks: resources.hooks,
        mcpManager: resources.mcpManager, process: resources.process,
        userConfigContext: context, prompt: 'full answer', stdout: {write: (text) => output.push(text)},
        runAgent: async (session) => {
          assert.deepEqual(session.records, [{role: 'user', text: 'full answer'}]);
          assert.deepEqual(session.executionMode, {kind: 'headless', approvalPolicy: 'deny'});
          return answer;
        }
      });
      assert.deepEqual(output, [`${answer}\n`]);
    } finally {
      context.close();
    }
  }
});

test('runOnce shares one non-watching config revision across MCP, hooks, and agent', async () => {
  const resources = createResources();
  let reads = 0;
  let watcherStarts = 0;
  const root = JSON.stringify({
    llm: {
      selectedModel: 'fake',
      providers: {fake: {preset: 'fake-agent'}},
      models: [{id: 'fake', provider: 'fake', model: 'echo-fake-agent'}]
    },
    mcp: {enabled: false},
    hooks: {assistant_turn_start: []}
  });
  const context = new UserConfigContext({
    configPath: '/tmp/echo-once-config.json',
    readFile() {
      reads += 1;
      return root;
    },
    watchConfig() {
      watcherStarts += 1;
      return {close() {}};
    }
  });
  const snapshot = context.capture();
  let sessionSnapshot;

  await runOnce({
    cwd: '/tmp/project',
    debug: resources.debug,
    process: resources.process,
    prompt: 'shared config',
    runAgent: async (session) => {
      sessionSnapshot = session.userConfigSnapshot;
      return 'done';
    },
    stdout: {write() {}},
    userConfigContext: context
  });

  assert.equal(sessionSnapshot, snapshot);
  assert.equal(reads, 1);
  assert.equal(watcherStarts, 0);
});

test('runOnce discovers and executes the same frozen custom subagent catalog as the interactive runtime', async () => {
  const resources = createResources();
  const agentSetupModule = require('../../src/agent/agent-setup');
  const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const originalHomedir = os.homedir;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-once-custom-subagent-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const output = [];
  const config = {
    agentType: 'fake',
    apiKey: '',
    model: 'fake-custom-subagent',
    contextWindow: 128000,
    tools: {
      autoCompressImages: true,
      bash: {timeoutMs: 1000, maxOutputBytes: 4096},
      sandbox: {mode: 'off', network: false, extraWritablePaths: []}
    }
  };
  const reviewerConfig = {...config, model: 'fake-reviewer', reasoningEffort: 'low'};
  const snapshot = {
    revision: 1,
    getMainAgentToolsConfig() { return {disabledTools: []}; },
    getAppSettings() {
      return {
        agentInstructionFileName: 'AGENTS.md',
        compactionThresholdRatio: 0.8,
        skillCatalogContextRatio: 0.02,
        toolApprovalMode: 'manual'
      };
    },
    getLlmModelConfigInfo() {
      return {
        kind: 'profiles',
        selectedModelId: 'fake',
        models: [
          {id: 'fake', provider: 'fake', model: config.model},
          {id: 'reviewer', provider: 'fake', model: reviewerConfig.model, reasoningEffort: 'low'}
        ]
      };
    },
    resolveLlmConfig() { return config; },
    resolveLlmConfigStrict(options) {
      if (options.modelProfileId !== 'reviewer') throw new Error('unexpected profile');
      return {...reviewerConfig, ...(options.reasoningEffortOverride !== undefined ? {reasoningEffort: options.reasoningEffortOverride} : {})};
    },
    resolveLlmConfigForProfile() { return config; }
  };
  const configContext = {
    capture() { return snapshot; },
    close() {}
  };
  let parentTurn = 0;
  let childRuns = 0;

  function writeAgent(base, name, description, body, modelPolicy = {}) {
    const agentsDir = path.join(base, '.echo', 'agents');
    fs.mkdirSync(agentsDir, {recursive: true});
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), [
      '---',
      `description: ${description}`,
      'capability: readonly',
      ...(modelPolicy.model ? [`model: ${modelPolicy.model}`] : []),
      ...(modelPolicy.effort ? [`effort: ${modelPolicy.effort}`] : []),
      'tools:',
      '  - read_files',
      '---',
      '',
      body
    ].join('\n'), 'utf8');
  }

  try {
    fs.mkdirSync(path.join(project, '.git'), {recursive: true});
    writeAgent(home, 'doc-writer', 'User documentation specialist.', 'USER DOC BODY');
    writeAgent(home, 'reviewer', 'Stale user reviewer.', 'STALE USER BODY');
    writeAgent(project, 'reviewer', 'Project security reviewer.', 'PROJECT REVIEW BODY', {model: 'reviewer', effort: 'default'});
    os.homedir = () => home;
    agentSetupModule.prepareAgent = (options) => {
      const effectiveConfig = options.config || config;
      const registry = createDefaultToolRegistry(effectiveConfig, project, undefined, {
        allowedToolNames: options.allowedToolNames,
        subagentPort: options.subagentPort
      });
      const subagent = options.allowedToolNames !== undefined;
      return {
        config: effectiveConfig,
        registry,
        agent: {
          async runTurn(records) {
            if (subagent) {
              childRuns += 1;
              assert.equal(effectiveConfig.model, 'fake-reviewer');
              assert.equal(effectiveConfig.reasoningEffort, 'low');
              assert.deepEqual(registry.listDefinitions().map(({name}) => name), ['read_files']);
              assert.match(records[0].text, /PROJECT REVIEW BODY/u);
              assert.doesNotMatch(records[0].text, /STALE USER BODY/u);
              return {draft: 'review complete', toolCalls: []};
            }

            parentTurn += 1;
            if (parentTurn === 1) {
              const definition = registry.getHandler('run_subagent').definition;
              assert.deepEqual(definition.parameters.properties.agent.enum, [
                'explorer', 'worker', 'doc-writer', 'reviewer'
              ]);
              assert.match(definition.parameters.properties.agent.description, /reviewer: Project security reviewer/u);
              assert.doesNotMatch(definition.parameters.properties.agent.description, /Stale user reviewer/u);
              return {
                draft: '',
                toolCalls: [{
                  callId: 'once-custom',
                  toolName: 'run_subagent',
                  argumentsText: '{"agent":"reviewer","task":"review project auth"}'
                }]
              };
            }
            assert.ok(records.some((record) => record.role === 'tool_result' && record.toolName === 'run_subagent' && record.text === 'review complete'));
            return {draft: 'headless parent complete', toolCalls: []};
          }
        }
      };
    };

    await runOnce({
      cwd: project,
      debug: resources.debug,
      hooks: resources.hooks,
      mcpManager: resources.mcpManager,
      process: resources.process,
      prompt: 'delegate review',
      stdout: {write: (text) => output.push(text)},
      userConfigContext: configContext
    });

    assert.equal(childRuns, 1);
    assert.deepEqual(output, ['headless parent complete\n']);
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
    os.homedir = originalHomedir;
    fs.rmSync(root, {recursive: true, force: true});
  }
});

/** 保留真实配置、目录、registry 与 executor，只替换 provider 输出，并隔离用户文件和全局补丁。 */
async function withHeadlessEnablementFixture(callback) {
  const agentSetupModule = require('../../src/agent/agent-setup');
  const originalPrepareAgent = agentSetupModule.prepareAgent;
  const originalHomedir = os.homedir;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-once-enablement-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const contexts = [];
  const fixture = {
    home, project,
    childPreparations: [],
    childRequests: [],
    debugEvents: [],
    hookEvents: [],
    writeSettings(scope, contents) {
      const target = path.join(scope === 'user' ? home : project, '.echo', 'agents.settings.json');
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, typeof contents === 'string' ? contents : JSON.stringify(contents));
      return target;
    },
    onParentTurn() { assert.fail('unexpected parent provider request'); },
    onChildTurn(records) {
      assert.match(records[0].text, /ALLOWED AUDITOR BODY/u);
      return {draft: 'auditor complete', toolCalls: []};
    },
    async run({fullAccess = false, disabledTools = []} = {}) {
      const resources = createResources();
      resources.mcpManager.listTools = () => [];
      resources.debug.enabled = true;
      resources.debug.emit = (event, payload) => fixture.debugEvents.push({event, payload});
      const emitHook = resources.hooks.emit;
      resources.hooks.emit = (event, payload) => {
        fixture.hookEvents.push({event, payload});
        emitHook(event, payload);
      };
      const context = new UserConfigContext({
        configPath: path.join(home, '.echo', 'config.json'),
        readFile: () => JSON.stringify({
          llm: {
            selectedModel: 'fake', providers: {fake: {preset: 'fake-agent'}},
            models: [{id: 'fake', provider: 'fake', model: 'echo-fake', contextWindow: 128000}]
          },
          mcp: {enabled: false},
          tools: {mainAgent: {disabledTools}, sandbox: {mode: 'off'}}
        })
      });
      contexts.push(context);
      const output = [];
      const stdinListeners = ['data', 'readable'].map((event) => process.stdin.listeners(event));
      await runOnce({
        cwd: project,
        debug: resources.debug,
        hooks: resources.hooks,
        mcpManager: resources.mcpManager,
        process: resources.process,
        prompt: 'exercise headless subagent enablement',
        // 缺省路径刻意不传 fullAccess，避免只验证显式 false 的分支。
        ...(fullAccess ? {fullAccess: true} : {}),
        abortSignal: AbortSignal.timeout(5000),
        stdout: {write: (text) => output.push(text)},
        userConfigContext: context
      });
      assert.deepEqual(['data', 'readable'].map((event) => process.stdin.listeners(event)), stdinListeners);
      assert.ok(resources.events.includes('mcp.close'));
      assert.ok(resources.events.includes('hook:assistant_turn_end:completed'));
      return output;
    }
  };

  try {
    fs.mkdirSync(home, {recursive: true});
    fs.mkdirSync(path.join(project, '.git'), {recursive: true});
    for (const [base, name, body] of [
      [home, 'reviewer', 'SHADOWED USER REVIEWER BODY'],
      [project, 'reviewer', 'DISABLED PROJECT REVIEWER BODY'],
      [project, 'auditor', 'ALLOWED AUDITOR BODY']
    ]) {
      const directory = path.join(base, '.echo', 'agents');
      fs.mkdirSync(directory, {recursive: true});
      fs.writeFileSync(path.join(directory, `${name}.md`), [
        '---', `description: ${name} fixture.`, 'capability: readonly',
        'tools:', '  - read_files', '---', '', body
      ].join('\n'));
    }
    fs.writeFileSync(path.join(project, 'sample.txt'), 'ordinary tools still work\n');
    os.homedir = () => home;
    agentSetupModule.prepareAgent = (options) => {
      // 真装配包含主工具禁用过滤；fake preset 确保此处不会初始化真实联网 provider。
      const prepared = originalPrepareAgent(options);
      assert.equal(prepared.config.agentType, 'fake');
      const child = options.allowedToolNames !== undefined;
      if (child) fixture.childPreparations.push(options);
      return {
        ...prepared,
        agent: {
          async runTurn(records) {
            if (child) {
              fixture.childRequests.push(records);
              return fixture.onChildTurn(records, prepared.registry, options);
            }
            return fixture.onParentTurn(records, prepared.registry, options);
          }
        }
      };
    };
    await callback(fixture);
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
    os.homedir = originalHomedir;
    for (const context of contexts) context.close();
    fs.rmSync(root, {recursive: true, force: true});
  }
}

function enablementToolCall(callId, toolName, args) {
  return {callId, toolName, argumentsText: JSON.stringify(args)};
}

function enablementToolResult(records, callId, toolName, ok) {
  const result = records.find((record) => record.role === 'tool_result' && record.toolCallId === callId);
  assert.ok(result, `missing result for ${callId}`);
  assert.equal(result.toolName, toolName);
  assert.equal(result.ok, ok);
  return result;
}

for (const fullAccess of [false, true]) {
  const mode = fullAccess ? 'full-access' : 'default deny';

  test(`runOnce ${mode} cannot bypass global disablement with project policies but delegates enabled agents`, {timeout: 10000}, async () => {
    await withHeadlessEnablementFixture(async (fixture) => {
      fixture.writeSettings('user', {schemaVersion: 3, overrides: {}, enabled: {explorer: false, reviewer: false, worker: false}});
      fixture.writeSettings('project', {schemaVersion: 2, overrides: {worker: {effort: 'high'}}});
      let turn = 0;
      fixture.onParentTurn = (records, registry, options) => {
        assert.deepEqual(options.executionMode, {kind: 'headless', approvalPolicy: fullAccess ? 'full-access' : 'deny'});
        assert.deepEqual(options.subagentPort.listDefinitions().map(({name}) => name), ['auditor']);
        const definition = registry.listDefinitions().find(({name}) => name === 'run_subagent');
        assert.deepEqual(definition.parameters.properties.agent.enum, ['auditor']);
        assert.doesNotMatch(definition.parameters.properties.agent.description, /explorer|worker|reviewer/u);
        turn += 1;
        if (turn === 1) {
          return {draft: '', toolCalls: ['explorer', 'worker', 'reviewer'].map((agent) =>
            enablementToolCall(`disabled-${agent}`, 'run_subagent', {agent, task: `try disabled ${agent}`}))};
        }
        if (turn === 2) {
          for (const agent of ['explorer', 'worker', 'reviewer']) {
            assert.match(enablementToolResult(records, `disabled-${agent}`, 'run_subagent', false).text, /agent must be one of: auditor/u);
          }
          assert.equal(fixture.childPreparations.length, 0);
          assert.equal(fixture.childRequests.length, 0);
          assert.equal(fixture.hookEvents.some(({event}) => event === 'tool_approval_request'), false);
          return {draft: '', toolCalls: [enablementToolCall('allowed-auditor', 'run_subagent', {agent: 'auditor', task: 'audit safely'})]};
        }
        assert.equal(turn, 3);
        assert.equal(enablementToolResult(records, 'allowed-auditor', 'run_subagent', true).text, 'auditor complete');
        return {draft: 'partial enablement complete', toolCalls: []};
      };
      assert.deepEqual(await fixture.run({fullAccess}), ['partial enablement complete\n']);
      assert.equal(fixture.childPreparations.length, 1);
      assert.equal(fixture.childRequests.length, 1);
      assert.deepEqual(fixture.childPreparations[0].executionMode, {kind: 'headless', approvalPolicy: fullAccess ? 'full-access' : 'deny'});
    });
  });

  for (const scenario of ['all disabled', 'invalid JSON', 'invalid schema', 'main tool disabled']) {
    test(`runOnce ${mode} ${scenario} omits delegation while ordinary tools and headless questions finish without stdin`, {timeout: 10000}, async () => {
      await withHeadlessEnablementFixture(async (fixture) => {
        fixture.writeSettings('user', {schemaVersion: 3, overrides: {}, enabled: {reviewer: true}});
        const contents = scenario === 'all disabled'
          ? {schemaVersion: 3, overrides: {}, enabled: {explorer: false, worker: false, reviewer: false, auditor: false}}
          : scenario === 'invalid JSON' ? '{"private-invalid-json":'
            : scenario === 'invalid schema' ? {schemaVersion: 3, overrides: {}, enabled: {reviewer: 'false'}}
              : {schemaVersion: 3, overrides: {}, enabled: {auditor: true}};
        const settingsPath = fixture.writeSettings('user', contents);
        let turn = 0;
        fixture.onParentTurn = (records, registry, options) => {
          assert.deepEqual(options.executionMode, {kind: 'headless', approvalPolicy: fullAccess ? 'full-access' : 'deny'});
          assert.equal(registry.getHandler('run_subagent'), undefined);
          assert.equal(registry.listDefinitions().some(({name}) => name === 'run_subagent'), false);
          assert.equal(options.subagentPort.listDefinitions().length > 0, scenario === 'main tool disabled');
          turn += 1;
          if (turn === 1) {
            return {draft: '', toolCalls: [
              enablementToolCall('forged-delegation', 'run_subagent', {agent: 'auditor', task: 'must not run'}),
              enablementToolCall('ordinary-read', 'read_files', {files: [{path: 'sample.txt'}]}),
              enablementToolCall('headless-question', 'ask_user_questions', {questions: [{question: 'Continue?', options: [{label: 'Yes'}]}]}),
              enablementToolCall('ordinary-patch', 'apply_patch', {patch: '*** Begin Patch\n*** Add File: approved.txt\n+approved\n*** End Patch'})
            ]};
          }
          assert.equal(turn, 2);
          assert.equal(enablementToolResult(records, 'forged-delegation', 'run_subagent', false).text, 'Unknown tool: run_subagent');
          assert.match(enablementToolResult(records, 'ordinary-read', 'read_files', true).text, /ordinary tools still work/u);
          const question = enablementToolResult(records, 'headless-question', 'ask_user_questions', false);
          assert.equal(JSON.parse(question.text).cancelled, true);
          const patch = enablementToolResult(records, 'ordinary-patch', 'apply_patch', fullAccess);
          if (!fullAccess) assert.match(patch.text, /requires approval in headless mode/u);
          return {draft: 'main run remains available', toolCalls: []};
        };
        assert.deepEqual(await fixture.run({fullAccess, disabledTools: scenario === 'main tool disabled' ? ['run_subagent'] : []}), ['main run remains available\n']);
        assert.equal(fixture.childPreparations.length, 0);
        assert.equal(fixture.childRequests.length, 0);
        assert.equal(fs.existsSync(path.join(fixture.project, 'approved.txt')), fullAccess);
        if (fullAccess) assert.equal(fs.readFileSync(path.join(fixture.project, 'approved.txt'), 'utf8'), 'approved\n');
        const diagnostics = fixture.debugEvents.filter(({event}) => event === 'subagent_catalog_diagnostic');
        assert.equal(diagnostics.length, scenario.startsWith('invalid') ? 1 : 0);
        if (diagnostics.length) {
          assert.equal(diagnostics[0].payload.sourceKind, 'user');
          assert.equal(diagnostics[0].payload.sourcePath, settingsPath);
          assert.ok(Array.from(diagnostics[0].payload.message).length <= 500);
          assert.doesNotMatch(diagnostics[0].payload.message, /private-invalid-json/u);
        }
      });
    });
  }

  test(`runOnce ${mode} freezes enablement during a child run and refreshes it on the next main run`, {timeout: 10000}, async () => {
    await withHeadlessEnablementFixture(async (fixture) => {
      const allDisabled = {schemaVersion: 3, overrides: {}, enabled: {explorer: false, worker: false, reviewer: false, auditor: false}};
      fixture.writeSettings('user', {...allDisabled, enabled: {...allDisabled.enabled, auditor: true}});
      fixture.onChildTurn = () => {
        // 当前子运行内修改磁盘；它必须正常完成，同一父轮次的后续委派仍使用冻结目录。
        fixture.writeSettings('user', allDisabled);
        return {draft: 'frozen auditor complete', toolCalls: []};
      };
      let turn = 0;
      fixture.onParentTurn = (records, registry) => {
        assert.deepEqual(registry.getHandler('run_subagent').definition.parameters.properties.agent.enum, ['auditor']);
        turn += 1;
        if (turn > 1) assert.equal(enablementToolResult(records, `frozen-${turn - 1}`, 'run_subagent', true).text, 'frozen auditor complete');
        return turn <= 2
          ? {draft: '', toolCalls: [enablementToolCall(`frozen-${turn}`, 'run_subagent', {agent: 'auditor', task: 'continue frozen delegation'})]}
          : {draft: 'frozen parent complete', toolCalls: []};
      };
      assert.deepEqual(await fixture.run({fullAccess}), ['frozen parent complete\n']);
      assert.equal(fixture.childPreparations.length, 2);
      assert.equal(fixture.childRequests.length, 2);
      turn = 0;
      fixture.onParentTurn = (records, registry, options) => {
        assert.equal(registry.getHandler('run_subagent'), undefined);
        assert.deepEqual(options.subagentPort.listDefinitions(), []);
        turn += 1;
        if (turn === 1) return {draft: '', toolCalls: [enablementToolCall('next-run', 'run_subagent', {agent: 'auditor', task: 'must stay disabled'})]};
        assert.equal(turn, 2);
        assert.equal(enablementToolResult(records, 'next-run', 'run_subagent', false).text, 'Unknown tool: run_subagent');
        return {draft: 'refreshed parent complete', toolCalls: []};
      };
      assert.deepEqual(await fixture.run({fullAccess}), ['refreshed parent complete\n']);
      assert.equal(fixture.childPreparations.length, 2);
      assert.equal(fixture.childRequests.length, 2);
    });
  });
}

test('runOnce does not create or expose interactive session settings', async () => {
  const resources = createResources();
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-once-session-settings-'));
  const originalHomedir = os.homedir;
  os.homedir = () => homeDir;

  try {
    await runOnce({
      cwd: homeDir,
      debug: resources.debug,
      hooks: resources.hooks,
      mcpManager: resources.mcpManager,
      process: resources.process,
      prompt: 'headless',
      async runAgent(session) {
        assert.equal(session.modelProfileId, undefined);
        assert.equal(session.reasoningEffortOverride, undefined);
        return 'done';
      },
      stdout: {write() {}}
    });

    assert.deepEqual(fs.readdirSync(homeDir), []);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
});

test('runOnce redacts provider errors and still cleans resources', async () => {
  const resources = createResources();
  const output = [];

  await assert.rejects(
    runOnce({
      debug: resources.debug,
      hooks: resources.hooks,
      mcpManager: resources.mcpManager,
      process: resources.process,
      prompt: 'fail',
      runAgent: async () => {
        throw new Error('authorization: Bearer sk-secret-value');
      },
      stdout: {write: (text) => output.push(text)}
    }),
    (error) => {
      assert.match(error.message, /authorization: Bearer <redacted>/);
      return true;
    }
  );

  assert.deepEqual(output, []);
  assert.ok(resources.events.includes('mcp.close'));
  assert.equal(resources.events.includes('debug.close'), false);
  assert.ok(resources.events.includes('hook:assistant_turn_start:started'));
  assert.ok(resources.events.includes('hook:assistant_turn_error:error'));
  assert.equal(resources.events.includes('hooks.flush'), false);
});

test('runOnce emits a cancelled lifecycle hook for aborted turns', async () => {
  const resources = createResources();

  await assert.rejects(runOnce({
    debug: resources.debug,
    hooks: resources.hooks,
    mcpManager: resources.mcpManager,
    process: resources.process,
    prompt: 'cancel',
    runAgent: async () => {
      throw new AgentAbortError();
    }
  }), {name: 'Error'});

  assert.ok(resources.events.includes('hook:assistant_turn_start:started'));
  assert.ok(resources.events.includes('hook:assistant_turn_cancelled:cancelled'));
  assert.equal(resources.events.includes('hook:assistant_turn_error:error'), false);
});

test('stripAnsiControlSequences removes CSI and OSC terminal controls', () => {
  assert.equal(stripAnsiControlSequences('\u001b[31mred\u001b[0m\u001b]0;title\u0007'), 'red');
});
