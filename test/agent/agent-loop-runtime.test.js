const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {buildProviderRecords, createAgentLoopRuntime: createRuntime} = require('../../src/agent/loop-runtime/agent-loop-runtime');
const {UserConfigContext} = require('../../src/config/user-config-context');
const {createCompactionNoticeRecord} = require('../../src/agent/context/context-compaction');
const {formatAgentMemoryCatalogPrompt, formatUserMemoriesPrompt} = require('../../src/agent/context/memory-prompt');
const { createBuiltInSystemPrompt } = require('../../src/agent/context/system-prompt');
const agentSetupModule = require('../../src/agent/agent-setup');
const {createUserMemory, updateUserMemory} = require('../../src/memory/memory-store');
const {addAgentMemory, setAgentMemoryCatalogEnabled, updateAgentMemoryCatalog} = require('../../src/memory/agent-memory-store');
const {createMcpToolRegistry, mergeToolRegistries} = require('../../src/mcp/tool-adapter');
const {createDefaultToolRegistry} = require('../../src/tools/tool-registry');
const {createToolCallTranscriptRecord, createToolResultTranscriptRecord} = require('../../src/tools/tool-transcript-record');

const TEST_CWD = '/tmp/echo_tui';
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

function createAgentLoopRuntime(cwd, mcpManager, hooks, debug, usageStore, configContext) {
  return createRuntime(cwd, configContext || new UserConfigContext(), mcpManager, hooks, debug, usageStore);
}

async function withPatchedAgentRuntime(agentOrFactory, callback, config = TEST_CONFIG) {
  const originalPrepareAgent = agentSetupModule.prepareAgent;

  agentSetupModule.prepareAgent = (options = {}) => {
    const resolvedConfig = typeof config === 'function'
      ? config({configSnapshot: options.configSnapshot, modelProfileId: options.modelProfileId, reasoningEffortOverride: options.reasoningEffortOverride})
      : config;
    const baseRegistry = createDefaultToolRegistry(resolvedConfig, options.cwd);
    const registry = options.mcpManager
      ? mergeToolRegistries(baseRegistry, createMcpToolRegistry(options.mcpManager))
      : baseRegistry;
    const agent = typeof agentOrFactory === 'function'
      ? agentOrFactory(resolvedConfig, registry)
      : agentOrFactory;

    return {agent, config: resolvedConfig, registry};
  };

  try {
    return await callback();
  } finally {
    agentSetupModule.prepareAgent = originalPrepareAgent;
  }
}

function createRuntimeSnapshot(revision) {
  return {
    revision,
    getAppSettings() {
      return {
        agentInstructionFileName: 'AGENTS.md',
        compactionThresholdRatio: revision === 1 ? 0.7 : 0.9,
        skillCatalogContextRatio: 0.02,
        toolApprovalMode: 'manual'
      };
    },
    resolveLlmConfig() {
      throw new Error('patched prepareAgent should resolve this snapshot');
    },
    resolveLlmConfigForProfile() {
      throw new Error('not used');
    }
  };
}

function writeUserSkill(homeDir, name, description) {
  const skillDir = path.join(homeDir, '.echo', 'skills', name);
  fs.mkdirSync(skillDir, {recursive: true});
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`, 'utf8');
}

async function withTemporaryMemoryHome(callback) {
  const originalHomedir = os.homedir;
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-agent-memory-'));
  os.homedir = () => homeDir;

  try {
    return await callback(homeDir);
  } finally {
    os.homedir = originalHomedir;
    fs.rmSync(homeDir, {recursive: true, force: true});
  }
}

function createHookRecorder() {
  const events = [];

  return {
    events,
    dispatcher: {
      emit(event, payload) {
        events.push({event, payload});
      },
      async flush() {}
    }
  };
}

function createDebugRecorder() {
  const events = [];

  return {
    events,
    context: {
      enabled: true,
      logPath: '/tmp/debug.jsonl',
      emit(event, payload) {
        events.push({event, payload});
      },
      close() {}
    }
  };
}

test('buildProviderRecords includes skill catalog without skill body', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'review this' }], TEST_CWD, undefined, [
    {
      name: 'code-review',
      description: 'Review code changes',
      sourceKind: 'project',
      sourcePath: '/repo/.echo/skills/code-review/SKILL.md',
      resources: ['reference/checklist.md']
    }
  ]);

  assert.equal(records[0].role, 'system');
  assert.match(records[0].text, /Available Skills/);
  assert.match(records[0].text, /code-review: Review code changes/);
  assert.match(records[0].text, /use_skill/);
  assert.doesNotMatch(records[0].text, /SKILL\.md/);
  assert.doesNotMatch(records[0].text, /reference\/checklist\.md/);
  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'review this' }]);
});

test('BTW readonly metadata keeps system and tool cache materials unchanged', async () => {
  const primaryDebug = createDebugRecorder();
  const btwDebug = createDebugRecorder();
  const agent = {async runTurn() { return {draft: 'done', toolCalls: []}; }};

  await withPatchedAgentRuntime(agent, async () => {
    await createAgentLoopRuntime(TEST_CWD, undefined, undefined, primaryDebug.context)({records: [{role: 'user', text: 'question'}]});
    await createAgentLoopRuntime(TEST_CWD, undefined, undefined, btwDebug.context)({
      records: [{role: 'user', text: '[BTW]\nquestion'}],
      conversationKind: 'btw',
      toolPolicy: 'readonly'
    });
  });

  const primary = primaryDebug.events.find((event) => event.event === 'provider_request_built').payload;
  const btw = btwDebug.events.find((event) => event.event === 'provider_request_built').payload;
  assert.equal(btw.systemPromptHash, primary.systemPromptHash);
  assert.equal(btw.toolSchemaHash, primary.toolSchemaHash);
  assert.deepEqual(btw.toolNames, primary.toolNames);
});

test('readonly runtime rejects write tools before approval and executor callbacks', async () => {
  let turn = 0;
  let approvals = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turn += 1;
      return turn === 1
        ? {draft: '', toolCalls: [{callId: 'write-1', toolName: 'apply_patch', argumentsText: '{"patch":"bad"}'}]}
        : {draft: 'done', toolCalls: []};
    }
  };

  await withPatchedAgentRuntime(agent, () => createAgentLoopRuntime(TEST_CWD)({
    records: [{role: 'user', text: 'BTW question'}],
    toolPolicy: 'readonly',
    conversationKind: 'btw'
  }, {
    onToolApprovalRequest() {
      approvals += 1;
      return {kind: 'allow_once'};
    },
    onToolResult(result) {
      results.push(result);
    }
  }));

  assert.equal(approvals, 0);
  assert.equal(results.length, 1);
  assert.equal(results[0].callId, 'write-1');
  assert.equal(results[0].toolName, 'apply_patch');
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /read-only/);
});

test('createAgentLoopRuntime snapshots a budgeted skill catalog across tool continuation', async () => {
  await withTemporaryMemoryHome(async (homeDir) => {
    const description = `BEGIN ${'routing details '.repeat(100)} END`;
    writeUserSkill(homeDir, 'large-skill', description);
    const requests = [];
    const contextUsages = [];
    const debug = createDebugRecorder();
    let originalDescription;
    let turnCount = 0;
    const agentFactory = (_config, registry) => {
      originalDescription = registry.listSkillCatalog().find((skill) => skill.name === 'large-skill').description;
      return {
        async runTurn(records) {
          requests.push(records);
          turnCount += 1;

          if (turnCount === 1) {
            return {
              draft: '',
              toolCalls: [{callId: 'todo-call', toolName: 'create_todos', argumentsText: JSON.stringify({items: ['continue']})}]
            };
          }

          return {draft: 'done', toolCalls: [], usageInputTokens: 900};
        }
      };
    };

    await withPatchedAgentRuntime(agentFactory, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context);
      return runtime({
        records: [{role: 'user', text: 'use a skill'}],
        skillCatalogContextRatio: 0.1
      }, {
        onContextUsage(usage) {
          contextUsages.push(usage);
        }
      });
    }, {...TEST_CONFIG, contextWindow: 2000});

    const firstSystemPrompt = requests[0][0].text;
    const secondSystemPrompt = requests[1][0].text;
    const requestDebug = debug.events.filter((event) => event.event === 'provider_request_built');

    assert.equal(originalDescription, description);
    assert.equal(firstSystemPrompt, secondSystemPrompt);
    assert.match(firstSystemPrompt, /large-skill: BEGIN/);
    assert.match(firstSystemPrompt, /END/);
    assert.match(firstSystemPrompt, /\[…description truncated…\]/);
    assert.equal(requestDebug[0].payload.skillCatalogMode, 'truncated');
    assert.equal(requestDebug[0].payload.skillCatalogBudgetTokens, 200);
    assert.ok(requestDebug[0].payload.skillCatalogTokens <= 200);
    assert.equal(requestDebug[0].payload.skillCatalogOriginalTokens > requestDebug[0].payload.skillCatalogTokens, true);
    assert.equal(contextUsages[0].segments.reduce((sum, segment) => sum + segment.tokens, 0), 900);
    assert.ok(contextUsages[0].segments.find((segment) => segment.category === 'skills').tokens > 0);
  });
});

test('createAgentLoopRuntime pins one revision across tool continuation and uses the next revision on the next run', async () => {
  const oldSnapshot = createRuntimeSnapshot(1);
  const newSnapshot = createRuntimeSnapshot(2);
  let currentSnapshot = oldSnapshot;
  const providerRuns = [];
  const initialized = [];

  await withPatchedAgentRuntime((config, registry) => {
    const toolNames = registry.listDefinitions().map((tool) => tool.name);
    initialized.push({model: config.model, reasoningEffort: config.reasoningEffort, toolNames});
    let turn = 0;
    return {
      async runTurn() {
        providerRuns.push(config.model);
        turn += 1;
        if (config.model === 'old-model' && turn === 1) {
          currentSnapshot = newSnapshot;
          return {draft: '', toolCalls: [{callId: 'continue', toolName: 'create_todos', argumentsText: '{"items":["continue"]}'}]};
        }
        return {draft: 'done', toolCalls: []};
      }
    };
  }, async () => {
    const runtime = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, undefined, {
      capture() { return currentSnapshot; }
    });
    await runtime({records: [{role: 'user', text: 'first'}], userConfigSnapshot: oldSnapshot});
    await runtime({records: [{role: 'user', text: 'second'}]});
  }, ({configSnapshot}) => ({
    ...TEST_CONFIG,
    model: configSnapshot.revision === 1 ? 'old-model' : 'new-model',
    reasoningEffort: configSnapshot.revision === 1 ? 'low' : 'high',
    tools: {
      ...TEST_CONFIG.tools,
      fileEditMode: configSnapshot.revision === 1 ? 'apply_patch' : 'edit_file'
    }
  }));

  assert.deepEqual(providerRuns, ['old-model', 'old-model', 'new-model']);
  assert.deepEqual(initialized.map(({model, reasoningEffort}) => ({model, reasoningEffort})), [
    {model: 'old-model', reasoningEffort: 'low'},
    {model: 'new-model', reasoningEffort: 'high'}
  ]);
  assert.equal(initialized[0].toolNames.includes('apply_patch'), true);
  assert.equal(initialized[0].toolNames.includes('edit_file'), false);
  assert.equal(initialized[1].toolNames.includes('apply_patch'), false);
  assert.equal(initialized[1].toolNames.includes('edit_file'), true);
});

test('createAgentLoopRuntime reads the headless skill catalog ratio from app settings', async () => {
  await withTemporaryMemoryHome(async (homeDir) => {
    writeUserSkill(homeDir, 'headless-skill', `HEAD ${'details '.repeat(100)} TAIL`);
    fs.mkdirSync(path.join(homeDir, '.echo'), {recursive: true});
    fs.writeFileSync(path.join(homeDir, '.echo', 'config.json'), JSON.stringify({skills: {catalogContextRatio: 0.01}}), 'utf8');
    const requests = [];
    const agent = {
      async runTurn(records) {
        requests.push(records);
        return {draft: 'done', toolCalls: []};
      }
    };

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      return runtime({
        records: [{role: 'user', text: 'headless'}],
        executionMode: {kind: 'headless', approvalPolicy: 'deny'}
      });
    }, {...TEST_CONFIG, contextWindow: 1000});

    assert.match(requests[0][0].text, /- headless-skill/);
    assert.doesNotMatch(requests[0][0].text, /HEAD|TAIL|details/);
  });
});

test('createAgentLoopRuntime loads only the configured CLAUDE instruction files', async () => {
  await withTemporaryMemoryHome(async (homeDir) => {
    const cwd = path.join(homeDir, 'repo');
    fs.mkdirSync(path.join(homeDir, '.echo'), {recursive: true});
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    fs.writeFileSync(path.join(homeDir, '.echo', 'config.json'), JSON.stringify({instructions: {fileName: 'CLAUDE.md'}}), 'utf8');
    fs.writeFileSync(path.join(homeDir, '.echo', 'CLAUDE.md'), 'CLAUDE GLOBAL ONLY', 'utf8');
    fs.writeFileSync(path.join(homeDir, '.echo', 'AGENTS.md'), 'AGENTS GLOBAL MUST NOT LOAD', 'utf8');
    fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), 'CLAUDE PROJECT ONLY', 'utf8');
    fs.writeFileSync(path.join(cwd, 'AGENTS.md'), 'AGENTS PROJECT MUST NOT LOAD', 'utf8');
    const requests = [];
    const agent = {
      async runTurn(records) {
        requests.push(records);
        return {draft: 'done', toolCalls: []};
      }
    };

    await withPatchedAgentRuntime(agent, () => createAgentLoopRuntime(cwd)({
      records: [{role: 'user', text: 'follow instructions'}]
    }));

    assert.match(requests[0][0].text, /CLAUDE\.md instructions/);
    assert.match(requests[0][0].text, /CLAUDE GLOBAL ONLY/);
    assert.match(requests[0][0].text, /CLAUDE PROJECT ONLY/);
    assert.doesNotMatch(requests[0][0].text, /AGENTS .* MUST NOT LOAD/);
  });
});

test('buildProviderRecords includes AGENTS instructions with precedence text', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'follow repo rules' }], TEST_CWD, undefined, [], [
    {
      content: 'Use concise Chinese replies.',
      filePath: '/home/user/.echo/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'global'
    },
    {
      content: 'Run npm test before finishing.',
      filePath: '/repo/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'project'
    }
  ]);

  assert.equal(records[0].role, 'system');
  assert.match(records[0].text, /AGENTS\.md instructions/);
  assert.match(records[0].text, /Global AGENTS\.md/);
  assert.match(records[0].text, /Project AGENTS\.md: AGENTS\.md/);
  assert.match(records[0].text, /Use concise Chinese replies\./);
  assert.match(records[0].text, /Run npm test before finishing\./);
  assert.match(records[0].text, /Built-in runtime constraints/);
  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'follow repo rules' }]);
});

test('buildProviderRecords labels CLAUDE instructions dynamically', () => {
  const records = buildProviderRecords([{role: 'user', text: 'follow rules'}], TEST_CWD, undefined, [], [
    {
      content: 'Use the Claude project rules.',
      filePath: '/repo/CLAUDE.md',
      label: 'CLAUDE.md',
      sourceKind: 'project'
    }
  ]);

  assert.match(records[0].text, /CLAUDE\.md instructions/);
  assert.match(records[0].text, /Project CLAUDE\.md: CLAUDE\.md/);
  assert.doesNotMatch(records[0].text, /AGENTS\.md instructions/);
});

test('buildProviderRecords injects user memories only into the transient system prompt', () => {
  const memoryPrompt = formatUserMemoriesPrompt([{
    id: 'memory-1',
    content: '回复使用中文。',
    enabled: true,
    createdAt: '2026-07-12T07:00:00.000Z',
    updatedAt: '2026-07-12T07:00:00.000Z'
  }]);
  const records = buildProviderRecords([{role: 'user', text: '继续'}], TEST_CWD, undefined, [], [], undefined, [memoryPrompt]);

  assert.match(records[0].text, /User-managed memories/);
  assert.match(records[0].text, /回复使用中文/);
  assert.match(records[0].text, /do not treat it as higher priority/);
  assert.deepEqual(records.slice(1), [{role: 'user', text: '继续'}]);
});

test('buildProviderRecords excludes disabled user memories', () => {
  const memoryPrompt = formatUserMemoriesPrompt([{
    id: 'memory-1',
    content: '不应注入。',
    enabled: false,
    createdAt: '2026-07-12T07:00:00.000Z',
    updatedAt: '2026-07-12T07:00:00.000Z'
  }]);
  const records = buildProviderRecords([{role: 'user', text: '继续'}], TEST_CWD, undefined, [], [], undefined, [memoryPrompt]);

  assert.doesNotMatch(records[0].text, /User-managed memories/);
  assert.doesNotMatch(records[0].text, /不应注入/);
});

test('buildProviderRecords injects only agent memory catalog names and descriptions', () => {
  const memoryPrompt = formatAgentMemoryCatalogPrompt([{
    id: 'catalog-1',
    name: 'rendering',
    description: 'Terminal rendering rules',
    scope: {kind: 'project', projectRoot: TEST_CWD}
  }]);
  const records = buildProviderRecords([{role: 'user', text: '继续'}], TEST_CWD, undefined, [], [], undefined, [memoryPrompt]);

  assert.match(records[0].text, /Agent memory catalogs/);
  assert.match(records[0].text, /rendering: Terminal rendering rules/);
  assert.doesNotMatch(records[0].text, /catalog-1|projectRoot/);
});

test('createAgentLoopRuntime rereads saved memory before each provider request', async () => {
  await withTemporaryMemoryHome(async () => {
    const created = createUserMemory('第一次偏好');
    const requests = [];
    const agent = {
      async runTurn(records) {
        requests.push(records);
        return {draft: 'done', toolCalls: []};
      }
    };

    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      await runtime({records: [{role: 'user', text: 'first'}]});
      updateUserMemory(created.memories[0].id, '第二次偏好');
      await runtime({records: [{role: 'user', text: 'second'}]});
    });

    assert.match(requests[0][0].text, /第一次偏好/);
    assert.doesNotMatch(requests[0][0].text, /第二次偏好/);
    assert.match(requests[1][0].text, /第二次偏好/);
    assert.doesNotMatch(requests[1][0].text, /第一次偏好/);
  });
});

test('createAgentLoopRuntime rereads and expands small agent memory before each provider request', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'rendering', description: 'First description', content: 'private item'});
    const requests = [];
    const agent = {async runTurn(records) { requests.push(records); return {draft: 'done', toolCalls: []}; }};
    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      await runtime({records: [{role: 'user', text: 'first'}]});
      updateAgentMemoryCatalog(TEST_CWD, 'rendering', {description: 'Second description'});
      await runtime({records: [{role: 'user', text: 'second'}]});
    });
    assert.match(requests[0][0].text, /First description/);
    assert.match(requests[0][0].text, /private item/);
    assert.doesNotMatch(requests[0][0].text, /Second description/);
    assert.match(requests[1][0].text, /Second description/);
    assert.match(requests[1][0].text, /private item/);
  });
});

test('createAgentLoopRuntime falls back to the complete catalog index when one item file is unreadable', async () => {
  await withTemporaryMemoryHome(async () => {
    const first = addAgentMemory(TEST_CWD, {catalog: 'first', description: 'First description', content: 'first item'});
    const second = addAgentMemory(TEST_CWD, {catalog: 'second', description: 'Second description', content: 'second item'});
    fs.writeFileSync(path.join(os.homedir(), '.echo', 'agent-memory', 'catalogs', `${second.catalog.id}.json`), '{bad', 'utf8');
    const requests = [];
    const agent = {async runTurn(records) { requests.push(records); return {draft: 'done', toolCalls: []}; }};

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      return runtime({records: [{role: 'user', text: 'first'}]});
    });

    assert.match(requests[0][0].text, /First description/);
    assert.match(requests[0][0].text, /Second description/);
    assert.doesNotMatch(requests[0][0].text, /first item|second item/);
    assert.equal(first.ok, true);
  });
});

test('createAgentLoopRuntime counts the selected expanded agent memory prompt as memory context', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'rendering', description: 'Terminal rules', content: 'Use real cursors.'});
    const providerRecords = [];
    const contextUsages = [];
    const agent = {
      async runTurn(records) {
        providerRecords.push(records);
        return {draft: 'done', toolCalls: [], usageInputTokens: 10_000};
      }
    };

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      return runtime({records: [{role: 'user', text: 'first'}]}, {onContextUsage(usage) { contextUsages.push(usage); }});
    });

    assert.match(providerRecords[0][0].text, /Use real cursors/);
    assert.ok(contextUsages[0].segments.find((segment) => segment.category === 'memory').tokens > 0);
  });
});

test('createAgentLoopRuntime records a non-sensitive agent memory prompt summary in debug context', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'rendering', description: 'Private description', content: 'private memory content'});
    const debug = createDebugRecorder();
    const agent = {async runTurn() { return {draft: 'done', toolCalls: []}; }};

    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context);
      return runtime({records: [{role: 'user', text: 'first'}]});
    });

    const request = debug.events.find((event) => event.event === 'provider_request_built');
    assert.equal(request.payload.agentMemoryMode, 'expanded');
    assert.equal(request.payload.agentMemoryCatalogCount, 1);
    assert.equal(request.payload.agentMemoryItemCount, 1);
    assert.equal(request.payload.agentMemoryTokens > 0, true);
    assert.doesNotMatch(JSON.stringify(request.payload), /Private description|private memory content/);
  });
});

test('createAgentLoopRuntime excludes disabled catalogs and falls back to enabled global catalogs', async () => {
  await withTemporaryMemoryHome(async () => {
    addAgentMemory(TEST_CWD, {catalog: 'shared', description: 'Global description', content: 'global item', scope: 'global'});
    addAgentMemory(TEST_CWD, {catalog: 'shared', description: 'Project description', content: 'project item'});
    const requests = [];
    const agent = {async runTurn(records) { requests.push(records); return {draft: 'done', toolCalls: []}; }};
    await withPatchedAgentRuntime(agent, async () => {
      const runtime = createAgentLoopRuntime(TEST_CWD);
      await runtime({records: [{role: 'user', text: 'first'}]});
      setAgentMemoryCatalogEnabled(TEST_CWD, 'shared', false, 'project');
      await runtime({records: [{role: 'user', text: 'second'}]});
      setAgentMemoryCatalogEnabled(TEST_CWD, 'shared', false, 'global');
      await runtime({records: [{role: 'user', text: 'third'}]});
    });

    assert.match(requests[0][0].text, /Project description/);
    assert.doesNotMatch(requests[0][0].text, /Global description/);
    assert.match(requests[1][0].text, /Global description/);
    assert.doesNotMatch(requests[1][0].text, /Project description/);
    assert.doesNotMatch(requests[2][0].text, /Global description|Project description/);
  });
});

test('buildProviderRecords does not inject mode runtime context', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'plan this' }], TEST_CWD);

  assert.deepEqual(records, [
    { role: 'system', text: createBuiltInSystemPrompt({ cwd: TEST_CWD }) },
    { role: 'user', text: 'plan this' }
  ]);
  assert.equal(records.some((record) => record.text.includes('## Mode')), false);
  assert.equal(records.some((record) => record.text.includes('/mode normal')), false);
});

test('buildProviderRecords injects todo runtime context without changing system prompt', () => {
  const todoState = {
    updatedAt: '2026-06-30T00:00:00.000Z',
    items: [
      {id: 'todo_1', text: 'first task', status: 'open'},
      {id: 'todo_2', text: 'done task', status: 'completed'}
    ]
  };
  const normalRecords = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD);
  const todoRecords = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD, undefined, [], [], todoState);

  assert.equal(todoRecords[0].text, normalRecords[0].text);
  assert.deepEqual(todoRecords.slice(0, normalRecords.length), normalRecords);
  assert.equal(todoRecords.at(-1).role, 'user');
  assert.match(todoRecords.at(-1).text, /# Echo Runtime Context/);
  assert.match(todoRecords.at(-1).text, /Not a user request/);
  assert.match(todoRecords.at(-1).text, /## Todos/);
  assert.match(todoRecords.at(-1).text, /Open:/);
  assert.match(todoRecords.at(-1).text, /\[todo_1\] first task/);
  assert.equal(todoRecords.at(-1).text.includes('Done:'), false);
  assert.equal(todoRecords.at(-1).text.includes('[todo_2] done task'), false);
});

test('buildProviderRecords omits completed-only todo state from runtime context', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD, undefined, [], [], {
    updatedAt: '2026-06-30T00:00:00.000Z',
    items: [{id: 'todo_1', text: 'done task', status: 'completed'}]
  });

  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'continue' }]);
});

test('buildProviderRecords omits runtime context when no runtime state exists', () => {
  const records = buildProviderRecords([{ role: 'user', text: 'continue' }], TEST_CWD, undefined, [], [], {
    updatedAt: '2026-06-30T00:00:00.000Z',
    items: []
  });

  assert.deepEqual(records.slice(1), [{ role: 'user', text: 'continue' }]);
});

test('buildProviderRecords does not append mode context after compacted active records', () => {
  const records = buildProviderRecords([{role: 'user', text: 'next task'}], TEST_CWD, {
    summaryText: 'Earlier context.',
    activeStartIndex: 4,
    createdAt: '2026-06-29T00:00:00.000Z'
  });

  assert.deepEqual(records.map((record) => record.role), ['system', 'user', 'user']);
  assert.equal(records[1].text, 'Here is a structured summary of the earlier conversation:\nEarlier context.');
  assert.equal(records[2].text, 'next task');
  assert.equal(records.some((record) => record.text.includes('# Echo Runtime Context')), false);
});

test('buildProviderRecords injects source_file and read-back hint when source path is available', () => {
  const records = buildProviderRecords([{role: 'user', text: 'next task'}], TEST_CWD, {
    summaryText: 'Earlier context.',
    activeStartIndex: 4,
    createdAt: '2026-06-29T00:00:00.000Z'
  }, [], [], undefined, [], undefined, '/tmp/echo_tui/session.jsonl');

  assert.deepEqual(records.map((record) => record.role), ['system', 'user', 'user']);
  assert.match(records[1].text, /Here is a structured summary of the earlier conversation:\nEarlier context\./);
  assert.match(records[1].text, /source_file: \/tmp\/echo_tui\/session\.jsonl/);
  assert.match(records[1].text, /use the existing read_files tool to read source_file with pagination/);
  assert.match(records[1].text, /append-only JSONL journal/);
  assert.equal(records[2].text, 'next task');
});

test('buildProviderRecords does not inject source hint when source path is absent', () => {
  const records = buildProviderRecords([{role: 'user', text: 'next task'}], TEST_CWD, {
    summaryText: 'Earlier context.',
    activeStartIndex: 4,
    createdAt: '2026-06-29T00:00:00.000Z'
  });

  assert.equal(records[1].text, 'Here is a structured summary of the earlier conversation:\nEarlier context.');
  assert.equal(records[1].text.includes('source_file'), false);
  assert.equal(records[1].text.includes('read_files'), false);
});

test('built-in system prompt keeps minimal cross-task guidance without tool routing or generic safety reminders', () => {
  const prompt = createBuiltInSystemPrompt({ cwd: TEST_CWD });

  assert.match(prompt, /built-in terminal development assistant/);
  assert.match(prompt, /Match the user's language unless asked otherwise/);
  assert.match(prompt, /concise, direct, actionable, and terminal-friendly/);
  assert.match(prompt, /Ground answers in the conversation and tool results/);
  assert.match(prompt, /state uncertainty and never invent facts/);
  assert.doesNotMatch(prompt, /Before using a tool|Prefer glob|read_files|web_fetch|apply_patch|credentials|sensitive information/);
});

test('built-in system prompt keeps todo guidance for non-trivial multi-step work only', () => {
  const prompt = createBuiltInSystemPrompt({ cwd: TEST_CWD });

  assert.match(prompt, /non-trivial multi-step work/);
  assert.match(prompt, /maintain todos to completion/);
  assert.match(prompt, /periodically summarize findings and next steps/);
  assert.match(prompt, /skip todos for trivial tasks/);
});

test('built-in system prompt keeps runtime, AGENTS, skills, and memory sections unchanged', () => {
  const prompt = createBuiltInSystemPrompt({
    cwd: TEST_CWD,
    agentInstructions: [{
      content: 'Follow project evidence.',
      filePath: '/repo/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'project'
    }],
    skillCatalog: [{
      name: 'review',
      description: 'Review changes',
      sourceKind: 'project',
      sourcePath: '/repo/.echo/skills/review/SKILL.md',
      resources: []
    }],
    memoryPrompts: ['## User-managed memories\n- Prefer Chinese replies.']
  });

  assert.match(prompt, new RegExp(`Current working directory: ${TEST_CWD}`));
  assert.match(prompt, /Project AGENTS\.md: AGENTS\.md\nFollow project evidence\./);
  assert.match(prompt, /Available Skills:[\s\S]*review: Review changes/);
  assert.match(prompt, /## User-managed memories\n- Prefer Chinese replies\./);
});

test('SYSTEM.md base prompt replaces built-in text while preserving dynamic sections', () => {
  const prompt = createBuiltInSystemPrompt({
    basePrompt: 'You are a project-specific assistant.',
    cwd: TEST_CWD,
    agentInstructions: [{
      content: 'Follow project evidence.',
      filePath: '/repo/AGENTS.md',
      label: 'AGENTS.md',
      sourceKind: 'project'
    }],
    skillCatalog: [{
      name: 'review',
      description: 'Review changes',
      sourceKind: 'project',
      sourcePath: '/repo/.echo/skills/review/SKILL.md',
      resources: []
    }],
    memoryPrompts: ['## User-managed memories\n- Prefer Chinese replies.']
  });

  assert.equal(prompt.startsWith('You are a project-specific assistant.'), true);
  assert.doesNotMatch(prompt, /Echo TUI's built-in terminal development assistant/);
  assert.match(prompt, new RegExp(`Current working directory: ${TEST_CWD}`));
  assert.match(prompt, /Project AGENTS\.md: AGENTS\.md\nFollow project evidence\./);
  assert.match(prompt, /Available Skills:[\s\S]*review: Review changes/);
  assert.match(prompt, /## User-managed memories\n- Prefer Chinese replies\./);
});

test('createAgentLoopRuntime keeps one project SYSTEM.md snapshot through tool continuation', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-system-prompt-'));
  const systemPath = path.join(cwd, 'SYSTEM.md');
  fs.mkdirSync(path.join(cwd, '.git'));
  fs.writeFileSync(systemPath, 'First project prompt.', 'utf8');
  const requests = [];
  const agent = {
    async runTurn(records) {
      requests.push(records);

      if (requests.length === 1) {
        fs.writeFileSync(systemPath, 'Second project prompt.', 'utf8');
        return {
          draft: '',
          toolCalls: [{callId: 'todo-1', toolName: 'create_todos', argumentsText: '{"items":["continue"]}'}]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  try {
    await withPatchedAgentRuntime(agent, () => {
      const runtime = createAgentLoopRuntime(cwd);
      return runtime({records: [{role: 'user', text: 'start'}]});
    });
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }

  assert.equal(requests.length, 2);
  assert.match(requests[0][0].text, /^First project prompt\./);
  assert.match(requests[1][0].text, /^First project prompt\./);
  assert.doesNotMatch(requests[0][0].text, /Second project prompt|built-in terminal development assistant/);
  assert.doesNotMatch(requests[1][0].text, /Second project prompt|built-in terminal development assistant/);
});

test('buildProviderRecords sends slash skill invocation as ordinary user record', () => {
  const skillRecord = {
    role: 'user',
    text: '[Skill Invocation]\nskill: review\n\n# Review',
    skillInvocation: { source: 'slash', skillName: 'review' }
  };
  const records = buildProviderRecords([skillRecord], TEST_CWD);

  assert.deepEqual(records.slice(1), [skillRecord]);
});

test('buildProviderRecords filters visible reasoning summary records', () => {
  const records = buildProviderRecords([
    { role: 'user', text: 'inspect' },
    { role: 'reasoning_summary', text: 'I will inspect first.' },
    { role: 'assistant', text: 'done' }
  ], TEST_CWD);

  assert.deepEqual(records.slice(1), [
    { role: 'user', text: 'inspect' },
    { role: 'assistant', text: 'done' }
  ]);
});

test('buildProviderRecords keeps chat reasoning content records', () => {
  const reasoningRecord = {
    role: 'extension',
    text: '',
    extension: {kind: 'openai_chat_reasoning', reasoningContent: 'hidden'}
  };
  const records = buildProviderRecords([
    { role: 'user', text: 'inspect' },
    reasoningRecord,
    { role: 'assistant', text: 'done' }
  ], TEST_CWD);

  assert.deepEqual(records.slice(1), [
    { role: 'user', text: 'inspect' },
    reasoningRecord,
    { role: 'assistant', text: 'done' }
  ]);
});

test('createAgentLoopRuntime commits the provider reasoning completion before the turn returns', async () => {
  const callbackEvents = [];
  const reasoningContentRecord = {
    role: 'extension',
    text: '',
    extension: {kind: 'openai_chat_reasoning', reasoningContent: 'hidden'}
  };
  const agent = {
    async runTurn(_records, callbacks) {
      callbacks.onReasoningUpdate?.({kind: 'draft', text: 'preview'});
      callbacks.onReasoningUpdate?.({kind: 'complete', text: 'visible'});
      return {
        draft: 'done',
        providerRecords: [reasoningContentRecord],
        toolCalls: []
      };
    }
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    await runAgent({records: [{role: 'user', text: 'hello'}]}, {
      onProviderRecords(records) {
        callbackEvents.push(['providerRecords', records]);
      },
      onReasoningUpdate(update) {
        callbackEvents.push([update.kind === 'draft' ? 'preview' : 'summary', update.text]);
      },
      onComplete(text) {
        callbackEvents.push(['complete', text]);
      }
    });
  });

  assert.deepEqual(callbackEvents, [
    ['preview', 'preview'],
    ['summary', 'visible'],
    ['providerRecords', [reasoningContentRecord]],
    ['complete', 'done']
  ]);
});

test('createAgentLoopRuntime does not synthesize reasoning completion from a draft-only provider turn', async () => {
  const callbackEvents = [];
  const agent = {
    async runTurn(_records, callbacks) {
      callbacks.onReasoningUpdate?.({kind: 'draft', text: 'preview'});
      return {
        draft: 'done',
        toolCalls: []
      };
    }
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    await runAgent({records: [{role: 'user', text: 'hello'}]}, {
      onReasoningUpdate(update) {
        callbackEvents.push([update.kind === 'draft' ? 'preview' : 'summary', update.text]);
      },
      onComplete(text) {
        callbackEvents.push(['complete', text]);
      }
    });
  });

  assert.deepEqual(callbackEvents, [
    ['preview', 'preview'],
    ['complete', 'done']
  ]);
});

test('createAgentLoopRuntime uses one overridden config for provider, context, usage, and continuation', async () => {
  const initialized = [];
  const contextUsages = [];
  const usageEvents = [];
  let turnCount = 0;
  const createAgent = (config) => {
    initialized.push(config);

    return {
      async runTurn() {
        turnCount += 1;

        if (turnCount === 1) {
          return {
            draft: '',
            toolCalls: [{callId: 'todo', toolName: 'create_todos', argumentsText: JSON.stringify({items: ['continue']})}],
            usageInputTokens: 50,
            usage: {outputTokens: 2}
          };
        }

        return {draft: 'done', toolCalls: [], usageInputTokens: 60, usage: {outputTokens: 3}};
      }
    };
  };
  const overrideConfig = {
    ...TEST_CONFIG,
    model: 'override-model',
    contextWindow: 777,
    tools: {bash: {timeoutMs: 4321, maxOutputBytes: 2048}}
  };

  await withPatchedAgentRuntime(createAgent, async () => {
    const runtime = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, {
      appendEvent(event) {
        usageEvents.push(event);
      }
    });
    await runtime({records: [{role: 'user', text: 'work'}], modelProfileId: 'override-profile', reasoningEffortOverride: 'high'}, {
      onContextUsage(usage) {
        contextUsages.push(usage);
      }
    });
  }, (options) => {
    assert.equal(options.modelProfileId, 'override-profile');
    assert.equal(options.reasoningEffortOverride, 'high');
    return {...overrideConfig, reasoningEffort: options.reasoningEffortOverride};
  });

  assert.equal(initialized.length, 1);
  assert.equal(initialized[0].model, 'override-model');
  assert.equal(initialized[0].tools.bash.timeoutMs, 4321);
  assert.deepEqual(contextUsages.map((usage) => usage.contextWindow), [777, 777]);
  assert.deepEqual(usageEvents.map((event) => [event.model, event.contextWindow]), [
    ['override-model', 777],
    ['override-model', 777]
  ]);
});

test('createAgentLoopRuntime reports the model resolved for the current run', async () => {
  const resolvedModels = [];
  const agent = {
    async runTurn() {
      return {draft: 'done', toolCalls: []};
    }
  };

  await withPatchedAgentRuntime(agent, async () => {
    const runtime = createAgentLoopRuntime(TEST_CWD);

    await runtime({records: [{role: 'user', text: 'work'}]}, {
      onModelResolved(model) {
        resolvedModels.push(model);
      }
    });
  }, () => ({...TEST_CONFIG, model: 'resolved-model', reasoningEffort: 'high'}));

  assert.deepEqual(resolvedModels, [{model: 'resolved-model', reasoningEffort: 'high'}]);
});

test('autonomous use_skill keeps the model initialized for normal and slash override turns', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-skill-model-runtime-'));
  const skillDir = path.join(cwd, '.echo', 'skills', 'loaded-skill');
  const initializedModels = [];
  const configOptions = [];
  const toolResults = [];
  let turnCount = 0;

  fs.mkdirSync(skillDir, {recursive: true});
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: loaded-skill\ndescription: Loaded skill\n---\n# Loaded\n', 'utf8');
  fs.writeFileSync(path.join(cwd, '.echo', 'skills', 'skills.json'), JSON.stringify({
    schemaVersion: 2,
    disabled: [],
    effortOverrides: {'loaded-skill': 'high'},
    modelOverrides: {'loaded-skill': 'different-profile'}
  }), 'utf8');

  const createAgent = (config) => {
    initializedModels.push([config.model, config.reasoningEffort]);

    return {
      async runTurn() {
        turnCount += 1;
        return turnCount % 2 === 1
          ? {draft: '', toolCalls: [{callId: `skill-${turnCount}`, toolName: 'use_skill', argumentsText: JSON.stringify({name: 'loaded-skill'})}]}
          : {draft: 'done', toolCalls: []};
      }
    };
  };

  try {
    await withPatchedAgentRuntime(createAgent, async () => {
      const runtime = createAgentLoopRuntime(cwd);
      const callbacks = {onToolResult(result) { toolResults.push(result); }};

      await runtime({records: [{role: 'user', text: 'normal'}]}, callbacks);
      await runtime({records: [{role: 'user', text: 'slash'}], modelProfileId: 'slash-profile', reasoningEffortOverride: 'low'}, callbacks);
    }, (options) => {
      configOptions.push([options.modelProfileId, options.reasoningEffortOverride]);
      return {
        ...TEST_CONFIG,
        model: options.modelProfileId === 'slash-profile' ? 'slash-model' : 'current-model',
        ...(options.reasoningEffortOverride ? {reasoningEffort: options.reasoningEffortOverride} : {})
      };
    });
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }

  assert.deepEqual(configOptions, [[undefined, undefined], ['slash-profile', 'low']]);
  assert.deepEqual(initializedModels, [['current-model', undefined], ['slash-model', 'low']]);
  assert.equal(toolResults.length, 2);
  assert.equal(toolResults.every((result) => result.ok), true);
});

test('createAgentLoopRuntime keeps provider-visible tool definitions stable across normal and plan modes', async () => {
  const captured = [];
  const createAgent = (_config, registry) => {
    captured.push(registry.listDefinitions().map((definition) => definition.name));

    return {
      async runTurn() {
        return {draft: 'done', toolCalls: []};
      }
    };
  };
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
    },
    getToolReference() {
      return {serverName: 'docs', toolName: 'search', namespacedName: 'mcp__docs__search', approval: 'always'};
    }
  };

  await withPatchedAgentRuntime(createAgent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, mcpManager);
    await runAgent({records: [{role: 'user', text: 'normal'}], interactionMode: 'normal'});
    await runAgent({records: [{role: 'user', text: 'plan'}], interactionMode: 'plan'});
  });

  assert.equal(captured.length, 2);
  assert.deepEqual(captured[1], captured[0]);
  assert.ok(captured[1].includes('apply_patch'));
  assert.ok(captured[1].includes('create_todos'));
  assert.ok(captured[1].includes('complete_todo'));
  assert.ok(captured[1].includes('mcp__docs__search'));
});

test('createAgentLoopRuntime rejects write tools in plan mode without approval', async () => {
  let turnCount = 0;
  const approvals = [];
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'call_patch', toolName: 'apply_patch', argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch\n'})}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({records: [{role: 'user', text: 'edit'}], interactionMode: 'plan'}, {
      onToolApprovalRequest() {
        approvals.push('approval');
        return {kind: 'allow_once'};
      },
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(approvals, []);
  assert.equal(results.length, 1);
  assert.equal(results[0].toolName, 'apply_patch');
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /plan mode/);
});

test('createAgentLoopRuntime immediately denies approval-required tools in headless mode', async () => {
  const hooks = createHookRecorder();
  let turnCount = 0;
  let approvalCount = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'headless-patch',
            toolName: 'apply_patch',
            argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: denied.txt\n+denied\n*** End Patch\n'})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({
      records: [{role: 'user', text: 'edit'}],
      executionMode: {kind: 'headless', approvalPolicy: 'deny'}
    }, {
      onToolApprovalRequest() {
        approvalCount += 1;
        throw new Error('headless mode must not request approval');
      },
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.equal(approvalCount, 0);
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /--full-access/);
  assert.deepEqual(hooks.events.map((event) => event.event), [
    'tool_call_start',
    'tool_approval_request',
    'tool_approval_response',
    'tool_call_end'
  ]);
  assert.equal(hooks.events[2].payload.interactionMode, 'normal');
  assert.equal(hooks.events[2].payload.decision, 'deny');
});

test('createAgentLoopRuntime executes a safe agent-memory script in headless deny mode', async () => {
  await withTemporaryMemoryHome(async (homeDir) => {
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'echo-headless-memory-')));
    fs.mkdirSync(path.join(cwd, '.git'), {recursive: true});
    const scriptPath = require.resolve('../../src/skills/builtin/agent-memory/scripts/memory');
    const command = `HOME='${homeDir}' node '${scriptPath}' add --catalog 'rules' --description 'Project rules' --content 'Stable fact'`;
    let turnCount = 0;
    const results = [];
    const agent = {
      async runTurn() {
        turnCount += 1;
        return turnCount === 1
          ? {draft: '', toolCalls: [{callId: 'memory-script', toolName: 'run_bash_command', argumentsText: JSON.stringify({command})}]}
          : {draft: 'done', toolCalls: []};
      }
    };

    const result = await withPatchedAgentRuntime(agent, () => {
      const runAgent = createAgentLoopRuntime(cwd);
      return runAgent({
        records: [{role: 'user', text: 'remember'}],
        executionMode: {kind: 'headless', approvalPolicy: 'deny'}
      }, {
        onToolApprovalRequest() {
          throw new Error('safe memory script must not request approval');
        },
        onToolResult(toolResult) {
          results.push(toolResult);
        }
      });
    });

    assert.equal(result, 'done');
    assert.equal(results[0].ok, true);
    assert.match(results[0].text, /Stable fact/);
  });
});

test('createAgentLoopRuntime full-access executes registered patch tools without approval callback', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-full-access-'));
  const hooks = createHookRecorder();
  let turnCount = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'full-patch',
            toolName: 'apply_patch',
            argumentsText: JSON.stringify({patch: '*** Begin Patch\n*** Add File: allowed.txt\n+allowed\n*** End Patch\n'})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  try {
    const result = await withPatchedAgentRuntime(agent, () => {
      const runAgent = createAgentLoopRuntime(cwd, undefined, hooks.dispatcher);
      return runAgent({
        records: [{role: 'user', text: 'edit'}],
        executionMode: {kind: 'headless', approvalPolicy: 'full-access'}
      }, {
        onToolApprovalRequest() {
          throw new Error('full-access must not request approval');
        },
        onToolResult(toolResult) {
          results.push(toolResult);
        }
      });
    });

    assert.equal(result, 'done');
    assert.equal(results[0].ok, true);
    assert.equal(fs.readFileSync(path.join(cwd, 'allowed.txt'), 'utf8'), 'allowed\n');
    assert.deepEqual(hooks.events.map((event) => event.event), [
      'tool_call_start',
      'tool_approval_request',
      'tool_approval_response',
      'tool_call_end'
    ]);
    assert.equal(hooks.events[2].payload.interactionMode, 'normal');
    assert.equal(hooks.events[2].payload.decision, 'allow_once');
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('createAgentLoopRuntime executes high-risk bash once after approval callback', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-auto-bash-'));
  let turnCount = 0;
  let approvals = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;
      return turnCount === 1
        ? {draft: '', toolCalls: [{callId: 'bash-write', toolName: 'run_bash_command', argumentsText: JSON.stringify({command: 'touch approved.txt'})}]}
        : {draft: 'done', toolCalls: []};
    }
  };

  try {
    await withPatchedAgentRuntime(agent, () => createAgentLoopRuntime(cwd)(
      {records: [{role: 'user', text: 'create it'}]},
      {
        onToolApprovalRequest(_call, request) {
          approvals += 1;
          assert.equal(request.preview, 'touch approved.txt');
          return {kind: 'allow_once'};
        },
        onToolResult(result) { results.push(result); }
      }
    ));

    assert.equal(approvals, 1);
    assert.equal(results[0].ok, true);
    assert.equal(fs.existsSync(path.join(cwd, 'approved.txt')), true);
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('createAgentLoopRuntime applies MCP always and never approval policies before proxy execution', async () => {
  for (const approval of ['always', 'never']) {
    let turnCount = 0;
    let approvals = 0;
    let calls = 0;
    const namespacedName = `mcp__docs__${approval}`;
    const mcpManager = {
      listTools() {
        return [{serverName: 'docs', toolName: approval, namespacedName, approval, description: 'MCP test', inputSchema: {type: 'object'}}];
      },
      getToolReference(toolName) {
        return toolName === namespacedName ? {serverName: 'docs', toolName: approval, namespacedName, approval} : null;
      },
      async callTool() {
        calls += 1;
        return {content: [{type: 'text', text: 'mcp done'}]};
      }
    };
    const agent = {
      async runTurn() {
        turnCount += 1;
        return turnCount === 1
          ? {draft: '', toolCalls: [{callId: `mcp-${approval}`, toolName: namespacedName, argumentsText: '{}'}]}
          : {draft: 'done', toolCalls: []};
      }
    };
    const results = [];

    await withPatchedAgentRuntime(agent, () => createAgentLoopRuntime(TEST_CWD, mcpManager)(
      {records: [{role: 'user', text: 'call MCP'}]},
      {
        onToolApprovalRequest(_call, request) {
          approvals += 1;
          assert.match(request.preview, /Server: docs/);
          return {kind: 'allow_once'};
        },
        onToolResult(result) { results.push(result); }
      }
    ));

    assert.equal(approvals, approval === 'always' ? 1 : 0);
    assert.equal(calls, 1);
    assert.equal(results[0].ok, true);
    assert.match(results[0].text, /mcp done/);
  }
});

test('createAgentLoopRuntime applies edit_file approvals across tool continuation', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'echo-edit-session-'));
  const target = path.join(cwd, 'value.txt');
  fs.writeFileSync(target, 'one\n');
  let turnCount = 0;
  let approvalCount = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;
      if (turnCount === 1) return {draft: '', toolCalls: [{callId: 'edit-one', toolName: 'edit_file', argumentsText: JSON.stringify({path: 'value.txt', old_string: 'one', new_string: 'two'})}]};
      if (turnCount === 2) return {draft: '', toolCalls: [{callId: 'edit-two', toolName: 'edit_file', argumentsText: JSON.stringify({path: 'value.txt', old_string: 'two', new_string: 'three'})}]};
      return {draft: 'done', toolCalls: []};
    }
  };

  try {
    const config = {...TEST_CONFIG, tools: {...TEST_CONFIG.tools, fileEditMode: 'edit_file'}};
    const result = await withPatchedAgentRuntime(agent, () => createAgentLoopRuntime(cwd)(
      {records: [{role: 'user', text: 'edit twice'}]},
      {
        onToolApprovalRequest() {
          approvalCount += 1;
          return {kind: 'allow_tool_for_session', toolName: 'edit_file'};
        },
        onToolResult(toolResult) { results.push(toolResult); }
      }
    ), config);

    assert.equal(result, 'done');
    assert.equal(approvalCount, 2);
    assert.deepEqual(results.map((item) => item.ok), [true, true]);
    assert.equal(fs.readFileSync(target, 'utf8'), 'three\n');
  } finally {
    fs.rmSync(cwd, {recursive: true, force: true});
  }
});

test('createAgentLoopRuntime denies selected edit_file in headless deny mode', async () => {
  let turnCount = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;
      return turnCount === 1
        ? {draft: '', toolCalls: [{callId: 'denied-edit', toolName: 'edit_file', argumentsText: JSON.stringify({path: 'x.txt', old_string: 'x', new_string: 'y'})}]}
        : {draft: 'done', toolCalls: []};
    }
  };
  const config = {...TEST_CONFIG, tools: {...TEST_CONFIG.tools, fileEditMode: 'edit_file'}};

  await withPatchedAgentRuntime(agent, () => createAgentLoopRuntime(TEST_CWD)(
    {records: [{role: 'user', text: 'edit'}], executionMode: {kind: 'headless', approvalPolicy: 'deny'}},
    {onToolResult(result) { results.push(result); }}
  ), config);

  assert.equal(results[0].toolName, 'edit_file');
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /--full-access/);
});

test('createAgentLoopRuntime cancels ask_user_questions when no interactive callback exists', async () => {
  const hooks = createHookRecorder();
  let turnCount = 0;
  const results = [];
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'question-call',
            toolName: 'ask_user_questions',
            argumentsText: JSON.stringify({questions: [{question: 'Continue?', options: [{label: 'yes'}]}]})
          }]
        };
      }

      return {draft: 'cancelled and done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({
      records: [{role: 'user', text: 'ask'}],
      executionMode: {kind: 'headless', approvalPolicy: 'deny'}
    }, {
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'cancelled and done');
  assert.deepEqual(JSON.parse(results[0].text), {cancelled: true, reason: 'User cancelled ask_user_questions'});
  assert.deepEqual(hooks.events.map((event) => event.event), [
    'tool_call_start',
    'user_question_request',
    'user_question_response',
    'tool_call_end'
  ]);
  assert.equal(hooks.events[1].payload.interactionMode, 'normal');
  assert.equal(hooks.events[1].payload.questionCount, 1);
  assert.equal(hooks.events[2].payload.ok, false);
  assert.equal(hooks.events[2].payload.resultText, results[0].text);
});

test('createAgentLoopRuntime creates todos, persists state, and injects suffix on continuation', async () => {
  const providerRecords = [];
  const todoStates = [];
  const toolResults = [];
  let turnCount = 0;
  const agent = {
    async runTurn(records) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'todo-call', toolName: 'create_todos', argumentsText: JSON.stringify({items: ['inspect state', 'write tests']})}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({records: [{role: 'user', text: 'work'}], interactionMode: 'plan'}, {
      onTodoStateChange(todoState) {
        todoStates.push(todoState);
      },
      onToolResult(toolResult) {
        toolResults.push(toolResult);
      },
      onToolApprovalRequest() {
        throw new Error('todo tools should not request approval');
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(todoStates, [{
    updatedAt: todoStates[0].updatedAt,
    items: [
      {id: 'todo_1', text: 'inspect state', status: 'open'},
      {id: 'todo_2', text: 'write tests', status: 'open'}
    ]
  }]);
  assert.equal(toolResults[0].toolName, 'create_todos');
  assert.equal(toolResults[0].ok, true);
  assert.match(providerRecords[1].at(-1).text, /# Echo Runtime Context/);
  assert.match(providerRecords[1].at(-1).text, /Not a user request/);
  assert.doesNotMatch(providerRecords[1].at(-1).text, /## Mode/);
  assert.equal(providerRecords[1].at(-1).text.includes('/mode normal'), false);
  assert.match(providerRecords[1].at(-1).text, /## Todos/);
  assert.match(providerRecords[1].at(-1).text, /\[todo_1\] inspect state/);
});

test('createAgentLoopRuntime completes todos with partial not-found result and omits completed todo suffix', async () => {
  const providerRecords = [];
  const todoStates = [];
  const toolResults = [];
  let turnCount = 0;
  const agent = {
    async runTurn(records) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'complete-call', toolName: 'complete_todo', argumentsText: JSON.stringify({ids: ['todo_1', 'missing']})}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({
      records: [{role: 'user', text: 'finish'}],
      todoState: {
        updatedAt: '2026-06-30T00:00:00.000Z',
        items: [{id: 'todo_1', text: 'only task', status: 'open'}]
      }
    }, {
      onTodoStateChange(todoState) {
        todoStates.push(todoState);
      },
      onToolResult(toolResult) {
        toolResults.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(todoStates[0].items, [{id: 'todo_1', text: 'only task', status: 'completed'}]);
  assert.deepEqual(JSON.parse(toolResults[0].text).notFoundIds, ['missing']);
  assert.equal(providerRecords[0].some((record) => record.text.includes('# Echo Runtime Context')), true);
  assert.equal(providerRecords[1].some((record) => record.text.includes('# Echo Runtime Context')), false);
  assert.equal(providerRecords[1].some((record) => record.text.includes('[todo_1] only task')), false);
});

test('createAgentLoopRuntime keeps active todo suffix after compaction removes old todo tool records', async () => {
  const providerRecords = [];
  let turnCount = 0;
  const agent = {
    async runTurn(records) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {draft: 'summary', toolCalls: []};
      }

      return {draft: 'done', toolCalls: []};
    }
  };
  const records = Array.from({length: 30}, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `message ${index} `.repeat(10)
  }));

  await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({
      records,
      todoState: {
        updatedAt: '2026-06-30T00:00:00.000Z',
        items: [{id: 'todo_1', text: 'survive compaction', status: 'open'}]
      }
    });
  }, {...TEST_CONFIG, contextWindow: 20});

  assert.equal(providerRecords.length, 2);
  assert.match(providerRecords[1].at(-1).text, /\[todo_1\] survive compaction/);
});

test('createAgentLoopRuntime records provider retry notices across tool continuation', async () => {
  const providerRecords = [];
  const retries = [];
  const retry = {
    retryCount: 1,
    maxRetries: 7,
    delayMs: 1000,
    message: '模型响应临时失败，正在重试第 1/7 次。'
  };
  let turnCount = 0;
  const agent = {
    async runTurn(records, providerCallbacks) {
      providerRecords.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        providerCallbacks.onProviderRetry?.(retry);
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{"value":1}'}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({records: [{role: 'user', text: 'use tool'}]}, {
      onProviderRetry(nextRetry) {
        retries.push(nextRetry);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(retries, [retry]);
  assert.equal(providerRecords.length, 2);
  assert.ok(providerRecords[1].some((record) => record.role === 'local_notice' && record.text === retry.message));
});

test('createAgentLoopRuntime emits tool lifecycle hooks without changing continuation', async () => {
  const hooks = createHookRecorder();
  const callbacks = [];
  let turnCount = 0;
  const agent = {
    async runTurn(_records, providerCallbacks) {
      turnCount += 1;

      if (turnCount === 1) {
        providerCallbacks.onToken?.('x', 'x');
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{"value":1}'}
          ]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records: [{role: 'user', text: 'use tool'}]}, {
      onToolCall(call) {
        callbacks.push(['call', call.toolName]);
      },
      onToolResult(toolResult) {
        callbacks.push(['result', toolResult.toolName, toolResult.ok]);
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(callbacks, [
    ['call', 'missing_tool'],
    ['result', 'missing_tool', false]
  ]);
  assert.deepEqual(hooks.events, [
    {
      event: 'tool_call_start',
      payload: {
        interactionMode: 'normal',
        toolCallId: 'call-1',
        toolName: 'missing_tool',
        argumentsText: '{"value":1}'
      }
    },
    {
      event: 'tool_call_end',
      payload: {
        interactionMode: 'normal',
        toolCallId: 'call-1',
        toolName: 'missing_tool',
        ok: false
      }
    }
  ]);
});

test('createAgentLoopRuntime leaves interactive approval hooks to the app UI boundary', async () => {
  const hooks = createHookRecorder();
  const results = [];
  let turnCount = 0;
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'approval-call',
            toolName: 'run_bash_command',
            argumentsText: JSON.stringify({command: 'rm generated.txt'})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records: [{role: 'user', text: 'run command'}]}, {
      onToolApprovalRequest() {
        return Promise.resolve({kind: 'provide_feedback', message: 'Use ls instead.'});
      },
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /Use ls instead/);
  assert.deepEqual(hooks.events.map((event) => event.event), [
    'tool_call_start',
    'tool_call_end'
  ]);
});

test('createAgentLoopRuntime omits approval hooks for cached session decisions', async () => {
  const hooks = createHookRecorder();
  const results = [];
  let turnCount = 0;
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'cached-approval-call',
            toolName: 'apply_patch',
            argumentsText: JSON.stringify({patch: 'invalid patch'})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records: [{role: 'user', text: 'edit'}]}, {
      onToolApprovalRequest() {
        return {kind: 'allow_all_for_session'};
      },
      onToolResult(toolResult) {
        results.push(toolResult);
      }
    });
  });

  assert.equal(result, 'done');
  assert.equal(results[0].ok, false);
  assert.deepEqual(hooks.events.map((event) => event.event), [
    'tool_call_start',
    'tool_call_end'
  ]);
});

test('createAgentLoopRuntime emits user question request and response hooks with answer text', async () => {
  const hooks = createHookRecorder();
  const answerText = JSON.stringify({answers: [{index: 0, selected: 'yes'}]});
  let turnCount = 0;
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [{
            callId: 'question-call',
            toolName: 'ask_user_questions',
            argumentsText: JSON.stringify({questions: [{question: 'Continue?', options: [{label: 'yes'}, {label: 'no'}]}]})
          }]
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records: [{role: 'user', text: 'ask'}]}, {
      onUserQuestionRequest(call) {
        return {
          callId: call.callId,
          toolName: 'ask_user_questions',
          ok: true,
          details: {kind: 'generic'},
          text: answerText
        };
      }
    });
  });

  assert.equal(result, 'done');
  assert.deepEqual(hooks.events.map((event) => event.event), [
    'tool_call_start',
    'user_question_request',
    'user_question_response',
    'tool_call_end'
  ]);
  assert.equal(hooks.events[1].payload.questionCount, 1);
  assert.equal(hooks.events[1].payload.questionsText, 'Continue?');
  assert.equal(hooks.events[2].payload.ok, true);
  assert.equal(hooks.events[2].payload.answerCount, 1);
  assert.equal(hooks.events[2].payload.resultText, answerText);
});

test('createAgentLoopRuntime emits compaction hook and no token hook', async () => {
  const hooks = createHookRecorder();
  let turnCount = 0;
  const agent = {
    async runTurn(_records, providerCallbacks) {
      turnCount += 1;

      if (turnCount === 1) {
        return {draft: 'summary', toolCalls: []};
      }

      providerCallbacks.onToken?.('d', 'd');
      return {draft: 'done', toolCalls: []};
    }
  };
  const records = Array.from({length: 30}, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `message ${index} `.repeat(10)
  }));

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, hooks.dispatcher);
    return runAgent({records});
  }, {...TEST_CONFIG, contextWindow: 20});

  assert.equal(result, 'done');
  assert.equal(hooks.events.length, 1);
  assert.equal(hooks.events[0].event, 'compaction_end');
  assert.equal(hooks.events[0].payload.interactionMode, 'normal');
  assert.equal(typeof hooks.events[0].payload.activeStartIndex, 'number');
  assert.equal(typeof hooks.events[0].payload.createdAt, 'string');
});

test('createAgentLoopRuntime keeps persisted indexes aligned across two compactions in one run', async () => {
  const persistedRecords = Array.from({length: 30}, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `initial-${index} `.repeat(10)
  }));
  const compactions = [];
  const pendingCalls = new Map();
  const summaryInputs = [];
  const normalRequests = [];
  let normalTurnCount = 0;
  const agent = {
    async runTurn(records, _callbacks, options = {}) {
      if (options.isCompaction) {
        summaryInputs.push(records[1].text);
        return {draft: `summary-${summaryInputs.length}`, toolCalls: []};
      }

      normalRequests.push(records);
      normalTurnCount += 1;

      if (normalTurnCount === 1) {
        return {
          draft: '',
          toolCalls: Array.from({length: 25}, (_, index) => ({
            callId: `call-${index}`,
            toolName: 'missing_tool',
            argumentsText: JSON.stringify({index})
          }))
        };
      }

      return {draft: 'done', toolCalls: []};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD);
    return runAgent({records: persistedRecords}, {
      onCompacted(compaction) {
        compactions.push(compaction);
        persistedRecords.push(createCompactionNoticeRecord(compaction));
      },
      onToolCall(call) {
        pendingCalls.set(call.callId, call);
      },
      onToolResult(toolResult) {
        const call = pendingCalls.get(toolResult.callId);
        assert.ok(call);
        persistedRecords.push(createToolCallTranscriptRecord(call), createToolResultTranscriptRecord(toolResult));
        pendingCalls.delete(toolResult.callId);
      }
    });
  }, {...TEST_CONFIG, contextWindow: 20});

  assert.equal(result, 'done');
  assert.equal(compactions.length, 2);
  assert.equal(summaryInputs.length, 2);
  assert.equal(normalRequests.length, 2);
  assert.equal(persistedRecords[compactions[1].activeStartIndex].role, 'tool_call');
  assert.equal(persistedRecords[compactions[1].activeStartIndex].toolCallId, 'call-15');
  assert.doesNotMatch(summaryInputs[1], /missing_tool\(\{"index":15\}\)/);
  assert.equal(normalRequests[1].some((record) => record.role === 'tool_call' && record.toolCallId === 'call-15'), true);
});

test('createAgentLoopRuntime emits debug provider and tool summaries without changing provider records', async () => {
  const debug = createDebugRecorder();
  const providerRecordSnapshots = [];
  let turnCount = 0;
  const agent = {
    async runTurn(records) {
      providerRecordSnapshots.push(records);
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{"secret":"value"}'}
          ],
          usageInputTokens: 42
        };
      }

      return {draft: 'done', toolCalls: [], usageInputTokens: 43};
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context);
    return runAgent({records: [{role: 'user', text: 'use tool'}]});
  });

  assert.equal(result, 'done');
  assert.equal(providerRecordSnapshots.length, 2);
  assert.equal(providerRecordSnapshots[0].some((record) => record.text.includes('debug')), false);
  assert.deepEqual(debug.events.map((event) => event.event), [
    'provider_request_built',
    'provider_usage',
    'tool_call_start',
    'tool_call_risk',
    'tool_call_approval',
    'tool_call_end',
    'provider_request_built',
    'provider_usage'
  ]);

  const requestEvent = debug.events.find((event) => event.event === 'provider_request_built');
  assert.deepEqual(requestEvent.payload.recordRoles, ['system', 'user']);
  assert.equal(requestEvent.payload.recordCount, 2);
  assert.equal(typeof requestEvent.payload.providerInputHash, 'string');
  assert.equal(typeof requestEvent.payload.toolSchemaHash, 'string');
  assert.equal(Array.isArray(requestEvent.payload.toolNames), true);

  const resultEvent = debug.events.find((event) => event.event === 'tool_call_end');
  assert.equal(resultEvent.payload.toolName, 'missing_tool');
  assert.equal(resultEvent.payload.ok, false);
  assert.equal(resultEvent.payload.resultText.length > 0, true);
});

test('createAgentLoopRuntime records provider usage events without changing context usage callback', async () => {
  const events = [];
  const contextUsages = [];
  let turnCount = 0;
  const agent = {
    async runTurn() {
      turnCount += 1;

      if (turnCount === 1) {
        return {
          draft: '',
          toolCalls: [
            {callId: 'call-1', toolName: 'missing_tool', argumentsText: '{}'}
          ],
          usage: {
            inputTokens: 42,
            cacheReadInputTokens: 10,
            outputTokens: 6
          },
          usageInputTokens: 42
        };
      }

      return {
        draft: 'done',
        toolCalls: [],
        usage: {
          inputTokens: 50,
          cacheCreationInputTokens: 12,
          outputTokens: 7
        },
        usageInputTokens: 50
      };
    }
  };
  const usageStore = {
    appendEvent(event) {
      events.push(event);
      return null;
    },
    listDailyUsage() {
      return [];
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, usageStore);
    return runAgent({records: [{role: 'user', text: 'use tool'}]}, {
      onContextUsage(usage) {
        contextUsages.push(usage);
      }
    });
  });

  assert.equal(result, 'done');
  assert.equal(contextUsages.length, 2);
  assert.equal(contextUsages[0].usedTokens, 42);
  assert.equal(contextUsages[1].usedTokens, 50);
  assert.equal(events.length, 2);
  assert.equal(events[0].cwdHash.length, 40);
  assert.deepEqual(events.map((event) => ({
    providerType: event.providerType,
    model: event.model,
    interactionMode: event.interactionMode,
    inputTokens: event.inputTokens,
    cacheReadInputTokens: event.cacheReadInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    outputTokens: event.outputTokens,
    contextWindow: event.contextWindow
  })), [
    {
      providerType: 'fake',
      model: 'fake',
      interactionMode: 'normal',
      inputTokens: 42,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: undefined,
      outputTokens: 6,
      contextWindow: 128000
    },
    {
      providerType: 'fake',
      model: 'fake',
      interactionMode: 'normal',
      inputTokens: 50,
      cacheReadInputTokens: undefined,
      cacheCreationInputTokens: 12,
      outputTokens: 7,
      contextWindow: 128000
    }
  ]);
});

test('createAgentLoopRuntime skips absent usage and isolates usage store failures', async () => {
  const debug = createDebugRecorder();
  const agent = {
    async runTurn() {
      return {draft: 'done', toolCalls: [], usage: {outputTokens: 5}};
    }
  };
  const usageStore = {
    appendEvent() {
      throw new Error('disk full');
    },
    listDailyUsage() {
      return [];
    }
  };

  const result = await withPatchedAgentRuntime(agent, () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, debug.context, usageStore);
    return runAgent({records: [{role: 'user', text: 'hello'}]});
  });

  assert.equal(result, 'done');
  assert.ok(debug.events.some((event) => event.event === 'provider_usage_store_error'));

  const skippedEvents = [];
  const noUsageAgent = {
    async runTurn() {
      return {draft: 'done', toolCalls: []};
    }
  };

  await withPatchedAgentRuntime(noUsageAgent, async () => {
    const runAgent = createAgentLoopRuntime(TEST_CWD, undefined, undefined, undefined, {
      appendEvent(event) {
        skippedEvents.push(event);
      },
      listDailyUsage() {
        return [];
      }
    });
    await runAgent({records: [{role: 'user', text: 'hello'}]});
  });

  assert.deepEqual(skippedEvents, []);
});
